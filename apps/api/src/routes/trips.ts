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
  reorderStopsSchema,
  ErrorCode,
} from "@quickroutesai/shared";
import { computeRoute, geocodeAddress } from "../services/directions";
import { randomUUID } from "crypto";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";
import { tripStopsValidationGuard, tripTransitionGuard } from "../middleware/trips";
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
      route: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };

    const tripDocRef = await db.collection("trips").add(tripData);
    const stopsCollectionRef = tripDocRef.collection("stops");

    const batch = db.batch();

    resolvedStops.forEach((stop, i) => {
      const stopDocRef = stopsCollectionRef.doc();

      batch.set(stopDocRef, {
        ...stop,
        stopId: stopDocRef.id,
        sequence: stop.sequence ?? i,
      });
    });

    await batch.commit();
    res.status(201).json({ id: tripDocRef.id, ...tripData });
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
router.get("/:id",tripStopsValidationGuard, async (req, res, next) => {
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

    res.json({ id: tripDoc.id, ...trip, stops: req.stops });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/duplicate — duplicate a completed trip into a new draft trip
 */
router.post("/:id/duplicate", requireRole("dispatcher", "admin"), tripStopsValidationGuard,  async (req, res, next) => {
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
    const duplicatedStops = req!.stops || [];
    

    const duplicatedTrip = {
      driverId: null,
      createdBy: req.uid,
      status: "draft" as const,
      route: null,
      notes: sourceTrip?.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const newTripRef = await db.collection("trips").add(duplicatedTrip);
    const stopsCollectionRef = newTripRef.collection("stops");

    const batch = db.batch();
    duplicatedStops.forEach((stop, i) => {
      const stopDocRef = stopsCollectionRef.doc();
      batch.set(stopDocRef, {
        ...stop,
        stopId: stopDocRef.id,
        sequence: stop.sequence ?? i,
      });
    });
    await batch.commit();
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

router.patch("/:id", requireRole("dispatcher", "admin"), validate(updateTripSchema.partial()), tripStopsValidationGuard, async (req, res, next) => {
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
            stopId: s.stopId || null,
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
    console.log("Resolved stops for update:", resolvedStops);
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (notes !== undefined) updateData.notes = notes;
    // Deletes all stops that aren't included in the update payload (matched by stopId)
    if (stops !== undefined) {
      
      const existingStops = req.stops || [];

      
      const incomingStopIds = new Set(
        stops
          .filter((s: any) => s.stopId) 
          .map((s: any) => s.stopId)
      );

      const stopsToDelete = existingStops.filter(
        (s) => !incomingStopIds.has(s.stopId)
      );

      for (const stop of stopsToDelete) {
        await tripRef.collection("stops").doc(stop.stopId).delete();
      }
    }

    // If stops changed and there are 2+, recompute the route and optimize stop order
    if (resolvedStops && resolvedStops.length >= 2) {
      try {
        const { route, optimizedStops } = await computeRoute(resolvedStops);
        let routes = trip?.route || [];

        if(!Array.isArray(routes)) {
          routes = [];
        }
        routes.push(route);
        updateData.route = routes;
        resolvedStops = optimizedStops;
      } catch (routeErr) {
        // Route computation is best-effort; save stops even if it fails
        console.error("Auto route recomputation failed:", routeErr);
      }
    } else if (resolvedStops && resolvedStops.length < 2) {
      // Clear route if fewer than 2 stops remain
      updateData.route = null;
    }

    // Updates the stop documents after they have been geocoded and sequenced
    if (resolvedStops !== undefined) {
      for (const stop of resolvedStops) {
        
        const stopRef = stop.stopId
          ? tripRef.collection("stops").doc(stop.stopId)
          : tripRef.collection("stops").doc(); // generate new ID

        await stopRef.set({
          ...stop,
          stopId: stop.stopId ?? stopRef.id,
        });
      }
    }
    await tripRef.update(updateData);

    await db.collection("events").add({
      type: "trip_update",
      uid: req.uid,
      payload: { tripId: req.params.id, from: { notes: trip?.notes || null, stops: trip?.stops || null }, to: updateData },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, ...updateData, stops: resolvedStops || req.stops! });

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
router.post("/:id/route", requireRole("dispatcher", "admin"), tripStopsValidationGuard, async (req, res, next) => {
  try {
    const tripDoc = await db.collection("trips").doc(req.params.id).get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const trip = tripDoc.data();
    const stops = req!.stops || [];

    if (stops.length < 2) {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Need at least 2 stops to compute route"));
    }

    const { route: routeResult, optimizedStops } = await computeRoute(stops);

    let routes = trip?.route || [];

    if(!Array.isArray(routes)) {
      routes = [];
    }
    routes.push(routeResult);

  
    await db.collection("trips").doc(req.params.id).update({
      route: routes,
      updatedAt: new Date().toISOString(),
    });

    const batch = db.batch();
    const tripRef = db.collection("trips").doc(req.params.id);

    for (const stop of optimizedStops) {
      const stopRef = tripRef.collection("stops").doc(stop.stopId);

      batch.update(stopRef, {
        ...stop,
        stopId: stop.stopId,
      });
    }

    await batch.commit();

    res.json({ ok: true, route: routeResult, stops: optimizedStops });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /trips/:id/override — dispatcher/admin manually reorders stops and recalculates ETA.
 * Bypasses AI optimization — trusts the caller's ordering.
 * Body: { stopIds: string[], reason: string }
 */
router.post(
  "/:id/override",
  requireRole("dispatcher", "admin"),
  validate(reorderStopsSchema),
  tripStopsValidationGuard,
  async (req, res, next) => {
    const { stopIds, reason } = req.body as { stopIds: string[]; reason: string };
    try {
      const tripRef = db.collection("trips").doc(req.params.id);
      const tripDoc = await tripRef.get();

      if (!tripDoc.exists) {
        return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
      }

      const trip = tripDoc.data();
      if (trip?.status === "completed" || trip?.status === "cancelled") {
        return next(
          new AppError(ErrorCode.CONFLICT, 409, "Completed or cancelled trips cannot be overridden"),
        );
      }

      const currentStops = req.stops || [];

      // Validate: stopIds must contain exactly the same set of stopIds as the trip.
      const currentIds = currentStops.map((s) => s.stopId);
      const sameLength = currentIds.length === stopIds.length;
      const currentSet = new Set(currentIds);
      const incomingSet = new Set(stopIds);
      const allMatch =
        sameLength &&
        currentIds.every((id) => incomingSet.has(id)) &&
        stopIds.every((id) => currentSet.has(id));

      if (!allMatch) {
        return next(
          new AppError(
            ErrorCode.BAD_REQUEST,
            400,
            "stopIds must contain exactly the same stop IDs as the trip (reordering only)",
          ),
        );
      }

      // Reorder according to stopIds, updating sequence.
      const stopById = new Map(currentStops.map((s) => [s.stopId, s]));
      const reorderedStops = stopIds.map((id, i) => ({
        ...(stopById.get(id) as (typeof currentStops)[number]),
        sequence: i,
      }));

      // Compute route directly (bypass AI optimization).
      const { route: newRoute } = await computeRoute(reorderedStops);

      const now = new Date().toISOString();
      const overrideMeta = {
        active: true,
        reason,
        overriddenAt: now,
        overriddenBy: req.uid,
      };

      // Persist: update the trip doc + each stop's sequence atomically.
      const batch = db.batch();
      for (const stop of reorderedStops) {
        const stopRef = tripRef.collection("stops").doc(stop.stopId);
        batch.update(stopRef, { ...stop, stopId: stop.stopId });
      }
      await batch.commit();

      await tripRef.update({
        stops: reorderedStops,
        route: newRoute,
        routeOverride: overrideMeta,
        updatedAt: now,
      });

      await db.collection("events").add({
        type: "trip_override",
        uid: req.uid,
        payload: {
          tripId: req.params.id,
          stopIds,
          reason,
        },
        createdAt: now,
      });

      res.json({
        ok: true,
        id: req.params.id,
        stops: reorderedStops,
        route: newRoute,
        routeOverride: overrideMeta,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /trips/:id/status — update trip status
 * Drivers can move to in_progress or completed (if assigned to them).
 * Dispatchers can set any status.
 */
router.post("/:id/status", validate(updateTripStatusSchema), tripTransitionGuard, tripStopsValidationGuard, async (req, res, next) => {
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
    if (status === "in_progress" && currentLocation && Array.isArray(req?.stops) && req.stops.length > 0) {
      try {
        const { route: reroutedRoute, optimizedStops } = await computeRoute(req.stops, currentLocation);
        updateData.route = reroutedRoute;
        const batch = db.batch();
        const tripRef = db.collection("trips").doc(req.params.id);

        for (const stop of optimizedStops) {
          const stopRef = tripRef.collection("stops").doc(stop.stopId);

          batch.update(stopRef, {
            ...stop,
            stopId: stop.stopId,
          });
        }

        await batch.commit();
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
 * POST /trips/:id/stops/:stopId/complete — driver marks a stop as completed
 * Sequential enforcement: all prior stops must be completed first.
 */
router.post("/:id/stops/:stopId/complete", async (req, res) => {
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();

    if (trip?.status !== "in_progress") {
      return res.status(400).json({ error: "Bad Request", message: "Trip must be in progress to complete stops" });
    }

    if (req.userRole === "driver" && trip?.driverId !== req.uid) {
      return res.status(403).json({ error: "Forbidden", message: "Not your trip" });
    }

    const stops: any[] = trip?.stops || [];
    const stopIndex = stops.findIndex((s) => s.stopId === req.params.stopId);

    if (stopIndex === -1) {
      return res.status(404).json({ error: "Not Found", message: "Stop not found" });
    }

    const stop = stops[stopIndex];
    if (stop.status === "completed") {
      return res.status(409).json({ error: "Conflict", message: "Stop already completed" });
    }

    // Sequential enforcement: all stops with lower sequence must be completed
    const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
    const stopSequence = stop.sequence;
    const blockedBy = sorted.find(
      (s) => s.sequence < stopSequence && s.status !== "completed",
    );
    if (blockedBy) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Previous stops must be completed first",
      });
    }

    const completedAt = new Date().toISOString();
    stops[stopIndex] = { ...stop, status: "completed", completedAt };

    await tripRef.update({ stops, updatedAt: completedAt });

    await db.collection("events").add({
      type: "stop_completed",
      driverId: trip?.driverId || req.uid,
      payload: { tripId: req.params.id, stopId: req.params.stopId, completedAt },
      createdAt: completedAt,
    });

    res.json({ ok: true, stopId: req.params.stopId, completedAt });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to complete stop" });
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
