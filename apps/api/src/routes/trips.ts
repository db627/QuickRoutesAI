import { Router } from "express";
import { db } from "../config/firebase";
import admin from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createTripSchema,
  assignTripSchema,
  updateTripStatusSchema,
  updateTripSchema,
  ErrorCode,
} from "@quickroutesai/shared";
import { computeRoute, geocodeAddress } from "../services/directions";
import { randomUUID } from "crypto";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";
import { tripTransitionGuard } from "../middleware/trips";
import { AppError } from "../utils/AppError";

const router = Router();

/**
 * POST /trips — dispatcher creates a new trip with stops
 */
router.post("/", requireRole("dispatcher", "admin"), validate(createTripSchema), async (req, res, next) => {
  const { stops } = req.body;
  const now = new Date().toISOString();

  try {
    // Geocode any stops missing lat/lng
    const resolvedStops = await Promise.all(
      stops.map(async (s: { address: string; contactName?: string; lat?: number; lng?: number; sequence?: number; notes?: string }, i: number) => {
        let lat = s.lat;
        let lng = s.lng;
        if (lat == null || lng == null) {
          const coords = await geocodeAddress(s.address);
          lat = coords.lat;
          lng = coords.lng;
        }
        return {
          stopId: randomUUID(),
          address: s.address,
          contactName: s.contactName || "",
          lat,
          lng,
          sequence: s.sequence ?? i,
          notes: s.notes || "",
        };
      }),
    );

    const tripData = {
      driverId: null,
      createdBy: req.uid,
      status: "draft" as const,
      stops: resolvedStops,
      route: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db.collection("trips").add(tripData);
    res.status(201).json({ id: ref.id, ...tripData });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /trips — list trips with optional filters + pagination
 * Query params:
 *   filters: ?status=draft&driverId=xyz
 *   page pagination: ?page=1&limit=20
 *   cursor pagination: ?cursor=...&limit=20
 */
router.get("/", pagination, async (req, res, next) => {
  try {
    let ref: admin.firestore.Query = db.collection("trips");

    // Drivers can only see their own trips
    if (req.userRole === "driver") {
      ref = ref.where("driverId", "==", req.uid);
    }

    if (req.query.status && typeof req.query.status === "string") {
      ref = ref.where("status", "==", req.query.status);
    }

    if (req.query.driverId && typeof req.query.driverId === "string" && req.userRole !== "driver") {
      ref = ref.where("driverId", "==", req.query.driverId);
    }

    // NOTE: ordering is enforced inside paginateFirestore for stable cursor pagination.
    const result = await paginateFirestore(ref, req.pagination!, {
      orderField: "createdAt",
      orderDirection: "desc",
    });

    // Response envelope: { data, total, page, hasMore, nextCursor? }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /trips/stats — summary counts for the dashboard stats cards.
 * Uses simple count() queries to avoid composite index requirements.
 * Returns: { totalTrips, inProgressTrips, completedToday }
 */
router.get("/stats", requireRole("dispatcher", "admin"), async (_req, res, next) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalSnap, inProgressSnap, completedSnap] = await Promise.all([
      db.collection("trips").count().get(),
      db.collection("trips").where("status", "==", "in_progress").count().get(),
      // Fetch completed trips and filter by date server-side to avoid a
      // composite index on (status, updatedAt).
      db.collection("trips").where("status", "==", "completed").get(),
    ]);

    const completedToday = completedSnap.docs.filter((doc) => {
      const updatedAt = doc.data().updatedAt as string | undefined;
      return updatedAt && updatedAt >= todayStart.toISOString();
    }).length;

    res.json({
      totalTrips: totalSnap.data().count,
      inProgressTrips: inProgressSnap.data().count,
      completedToday,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/assign — dispatcher assigns a driver to this trip
 */
router.post("/:id/assign", requireRole("dispatcher", "admin"), validate(assignTripSchema), tripTransitionGuard, async (req, res, next) => {
  const { driverId } = req.body;
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();
    if (trip?.status !== "draft") {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Trip can only be assigned from draft status"));
    }

    await tripRef.update({
      driverId,
      status: "assigned",
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, status: "assigned", driverId });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /trips/:id — get trip details
 */
router.get("/:id", async (req, res, next) => {
  try {
    const tripDoc = await db.collection("trips").doc(req.params.id).get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();

    // Drivers can only see trips assigned to them
    if (req.userRole === "driver" && trip?.driverId !== req.uid) {
      return next(new AppError(ErrorCode.FORBIDDEN, 403, "Not your trip"));
    }

    res.json({ id: tripDoc.id, ...trip });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/duplicate — duplicate a completed trip into a new draft trip
 */
router.post("/:id/duplicate", requireRole("dispatcher", "admin"), async (req, res, next) => {
  try {
    const sourceTripDoc = await db.collection("trips").doc(req.params.id).get();

    if (!sourceTripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const sourceTrip = sourceTripDoc.data();
    if (sourceTrip?.status !== "completed") {
      return next(new AppError(ErrorCode.CONFLICT, 409, "Only completed trips can be duplicated"));
    }

    const now = new Date().toISOString();
    const duplicatedStops = Array.isArray(sourceTrip?.stops)
      ? sourceTrip.stops.map((stop: any, index: number) => ({
          ...stop,
          stopId: randomUUID(),
          sequence: typeof stop?.sequence === "number" ? stop.sequence : index,
        }))
      : [];

    const duplicatedTrip = {
      driverId: null,
      createdBy: req.uid,
      status: "draft" as const,
      stops: duplicatedStops,
      route: null,
      notes: sourceTrip?.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const newTripRef = await db.collection("trips").add(duplicatedTrip);

    await db.collection("events").add({
      type: "trip_duplicate",
      driverId: req.uid,
      payload: { sourceTripId: req.params.id, duplicatedTripId: newTripRef.id },
      createdAt: now,
    });

    return res.status(201).json({
      ok: true,
      id: newTripRef.id,
      duplicatedFrom: req.params.id,
      ...duplicatedTrip,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /trips/:id -- update trip details
 */
router.patch("/:id", requireRole("dispatcher", "admin"), validate(updateTripSchema.partial()), async (req, res, next) => {
  try {
    const { notes, stops } = req.body;

    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();

    // Allow editing draft, assigned, and in_progress trips (not completed/cancelled)
    if (trip?.status === "completed" || trip?.status === "cancelled") {
      return next(new AppError(ErrorCode.CONFLICT, 409, "Completed or cancelled trips cannot be updated"));
    }

    // Geocode any new stops missing lat/lng
    let resolvedStops = stops;
    if (stops !== undefined) {
      resolvedStops = await Promise.all(
        stops.map(async (s: any, i: number) => {
          let lat = s.lat;
          let lng = s.lng;
          if (lat == null || lng == null) {
            const coords = await geocodeAddress(s.address);
            lat = coords.lat;
            lng = coords.lng;
          }
          return {
            stopId: s.stopId || randomUUID(),
            address: s.address,
            contactName: s.contactName || "",
            lat,
            lng,
            sequence: s.sequence ?? i,
            notes: s.notes || "",
          };
        }),
      );
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (notes !== undefined) updateData.notes = notes;
    if (resolvedStops !== undefined) updateData.stops = resolvedStops;

    // If stops changed and there are 2+, recompute the route and optimize stop order
    let routeResult = null;
    if (resolvedStops && resolvedStops.length >= 2) {
      try {
        const { route, optimizedStops } = await computeRoute(resolvedStops);
        routeResult = route;
        updateData.route = route;
        updateData.stops = optimizedStops;
      } catch (routeErr) {
        // Route computation is best-effort; save stops even if it fails
        console.error("Auto route recomputation failed:", routeErr);
      }
    } else if (resolvedStops && resolvedStops.length < 2) {
      // Clear route if fewer than 2 stops remain
      updateData.route = null;
    }

    await tripRef.update(updateData);

    await db.collection("events").add({
      type: "trip_update",
      uid: req.uid,
      payload: { tripId: req.params.id, from: { notes: trip?.notes || null, stops: trip?.stops || null }, to: updateData },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, ...updateData, route: routeResult });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /trips/:id — delete a trip (only if draft)
 */
router.delete("/:id", requireRole("dispatcher", "admin"), async (req, res, next) => {
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();
    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }
    const trip = tripDoc.data();
    if (trip?.status !== "draft") {
      return next(new AppError(ErrorCode.CONFLICT, 409, "Only draft trips can be deleted"));
    }

    await tripRef.delete();
    await db.collection("events").add({
      type: "trip_delete",
      uid: req.uid,
      payload: trip,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, message: "Trip deleted" });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/route — compute route using Google Directions API
 */
router.post("/:id/route", requireRole("dispatcher", "admin"), async (req, res, next) => {
  try {
    const tripDoc = await db.collection("trips").doc(req.params.id).get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();
    const stops = trip?.stops || [];

    if (stops.length < 2) {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Need at least 2 stops to compute route"));
    }

    const { route: routeResult, optimizedStops } = await computeRoute(stops);

    await db.collection("trips").doc(req.params.id).update({
      route: routeResult,
      stops: optimizedStops,
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, route: routeResult, stops: optimizedStops });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/status — update trip status
 * Drivers can move to in_progress or completed (if assigned to them).
 * Dispatchers can set any status.
 */
router.post("/:id/status", validate(updateTripStatusSchema), tripTransitionGuard, async (req, res, next) => {
  const { status, currentLocation } = req.body;

  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();

    // Drivers can only update their own assigned trips
    if (req.userRole === "driver") {
      if (trip?.driverId !== req.uid) {
        return next(new AppError(ErrorCode.FORBIDDEN, 403, "Not your trip"));
      }
      if (trip?.status === "draft") {
        return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Trip must be assigned first"));
      }
    }

    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date().toISOString(),
    };

    // When a driver starts a trip, optionally recompute route from their live location.
    if (status === "in_progress" && currentLocation && Array.isArray(trip?.stops) && trip.stops.length > 0) {
      try {
        const { route: reroutedRoute, optimizedStops } = await computeRoute(trip.stops, currentLocation);
        updateData.route = reroutedRoute;
        updateData.stops = optimizedStops;
      } catch (rerouteErr) {
        const rerouteMessage = rerouteErr instanceof Error ? rerouteErr.message : "Unknown reroute error";
        console.error("Failed to reroute trip from driver location:", rerouteMessage);
      }
    }

    await tripRef.update(updateData);

    // Log status change event
    await db.collection("events").add({
      type: "status_change",
      driverId: trip?.driverId || req.uid,
      payload: { tripId: req.params.id, from: trip?.status, to: status },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/cancel — dispatcher cancels a draft or assigned trip
 */
router.post("/:id/cancel", requireRole("dispatcher", "admin"), async (req, res, next) => {
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();
    if (!["draft", "assigned"].includes(trip?.status)) {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Only draft or assigned trips can be cancelled"));
    }

    await tripRef.update({
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    next(err);
  }
});

export default router;
