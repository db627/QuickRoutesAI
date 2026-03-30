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
} from "@quickroutesai/shared";
import { computeRoute, geocodeAddress } from "../services/directions";
import { randomUUID } from "crypto";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";
import { tripTransitionGuard } from "../middleware/trips";

const router = Router();

/**
 * POST /trips — dispatcher creates a new trip with stops
 */
router.post("/", requireRole("dispatcher", "admin"), validate(createTripSchema), async (req, res) => {
  const { stops } = req.body;
  const now = new Date().toISOString();

  try {
    // Geocode any stops missing lat/lng
    const resolvedStops = await Promise.all(
      stops.map(async (s: { address: string; lat?: number; lng?: number; sequence?: number; notes?: string }, i: number) => {
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
    const message = err instanceof Error ? err.message : "Failed to create trip";
    res.status(500).json({ error: "Internal Error", message });
  }
});

/**
 * GET /trips — list trips with optional filters + pagination
 * Query params:
 *   filters: ?status=draft&driverId=xyz
 *   page pagination: ?page=1&limit=20
 *   cursor pagination: ?cursor=...&limit=20
 */
router.get("/", pagination, async (req, res) => {
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
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch trips" });
  }
});

/**
 * GET /trips/stats — summary counts for the dashboard stats cards.
 * Uses simple count() queries to avoid composite index requirements.
 * Returns: { totalTrips, inProgressTrips, completedToday }
 */
router.get("/stats", requireRole("dispatcher", "admin"), async (_req, res) => {
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
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch trip stats" });
  }
});

/**
 * POST /trips/:id/assign — dispatcher assigns a driver to this trip
 */
router.post("/:id/assign", requireRole("dispatcher", "admin"), validate(assignTripSchema),tripTransitionGuard, async (req, res) => {
  const { driverId } = req.body;
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();
    if (trip?.status !== "draft") {
      return res.status(400).json({ error: "Bad Request", message: "Trip can only be assigned from draft status" });
    }

    await tripRef.update({
      driverId,
      status: "assigned",
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, status: "assigned", driverId });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to assign trip" });
  }
});

/**
 * GET /trips/:id — get trip details
 */
router.get("/:id", async (req, res) => {
  try {
    const tripDoc = await db.collection("trips").doc(req.params.id).get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();

    // Drivers can only see trips assigned to them
    if (req.userRole === "driver" && trip?.driverId !== req.uid) {
      return res.status(403).json({ error: "Forbidden", message: "Not your trip" });
    }

    res.json({ id: tripDoc.id, ...trip });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch trip" });
  }
});

/**
 * PATCH /trips/:id -- update trip details
 */

router.patch("/:id", requireRole("dispatcher", "admin"), validate(updateTripSchema.partial()), async (req, res) => {
  try {
    const { notes, stops } = req.body;

    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();

    if (trip?.status !== "draft") {
      return res.status(409).json({ error: "Bad Request", message: "Only draft trips can be updated" });
    }

    const updateData: Partial<{ notes: string; stops: any[]; route: null; updatedAt: string }> = { updatedAt: new Date().toISOString() };

    if (notes !== undefined) updateData.notes = notes;

    if (stops !== undefined) {
      updateData.stops = await Promise.all(
        stops.map(async (s: { address: string; lat?: number; lng?: number; sequence?: number; notes?: string }, i: number) => {
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
            lat,
            lng,
            sequence: s.sequence ?? i,
            notes: s.notes || "",
          };
        }),
      );
      updateData.route = null;
    }

    await tripRef.update(updateData);

    await db.collection("events").add({
      type: "trip_update",
      uid: req.uid,
      payload: { tripId: req.params.id, from: { notes: trip?.notes || null, stops: trip?.stops || null }, to: updateData },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, ...updateData });

  } catch (err) {
    return res.status(500).json({ error: "Internal Error", message: "Failed to update trip" });
  }
});

/**
 * DELETE /trips/:id — delete a trip (only if draft)
 */
router.delete("/:id", requireRole("dispatcher", "admin"), async (req, res) => {
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();
    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }
    const trip = tripDoc.data();
    if (trip?.status !== "draft") {
      return res.status(409).json({ error: "Bad Request", message: "Only draft trips can be deleted" });
    }

    await tripRef.delete();
    await db.collection("events").add({
      type: "trip_delete",
      uid: req.uid,
      payload: trip,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, message: "Trip deleted" });
    
  }catch (err) {
    return res.status(500).json({ error: "Internal Error", message: "Failed to delete trip" });
  }
});
/**
 * POST /trips/:id/route — compute route using Google Directions API
 */
router.post("/:id/route", requireRole("dispatcher", "admin"), async (req, res) => {
  try {
    const tripDoc = await db.collection("trips").doc(req.params.id).get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();
    const stops = trip?.stops || [];

    if (stops.length < 2) {
      return res.status(400).json({ error: "Bad Request", message: "Need at least 2 stops to compute route" });
    }

    const routeResult = await computeRoute(stops);

    await db.collection("trips").doc(req.params.id).update({
      route: routeResult,
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, route: routeResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute route";
    res.status(500).json({ error: "Internal Error", message });
  }
});

/**
 * POST /trips/:id/status — update trip status
 * Drivers can move to in_progress or completed (if assigned to them).
 * Dispatchers can set any status.
 */
router.post("/:id/status", validate(updateTripStatusSchema), tripTransitionGuard, async (req, res) => {
  const { status } = req.body;

  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();

    // Drivers can only update their own assigned trips
    if (req.userRole === "driver") {
      if (trip?.driverId !== req.uid) {
        return res.status(403).json({ error: "Forbidden", message: "Not your trip" });
      }
      if (trip?.status === "draft") {
        return res.status(400).json({ error: "Bad Request", message: "Trip must be assigned first" });
      }
    }

    await tripRef.update({
      status,
      updatedAt: new Date().toISOString(),
    });

    // Log status change event
    await db.collection("events").add({
      type: "status_change",
      driverId: trip?.driverId || req.uid,
      payload: { tripId: req.params.id, from: trip?.status, to: status },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to update status" });
  }
});

/**
 * POST /trips/:id/cancel — dispatcher cancels a draft or assigned trip
 */
router.post("/:id/cancel", requireRole("dispatcher", "admin"), async (req, res) => {
  try {
    const tripRef = db.collection("trips").doc(req.params.id);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Trip not found" });
    }

    const trip = tripDoc.data();
    if (!["draft", "assigned"].includes(trip?.status)) {
      return res.status(400).json({ error: "Bad Request", message: "Only draft or assigned trips can be cancelled" });
    }

    await tripRef.update({
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, status: "cancelled" });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to cancel trip" });
  }
});

export default router;
