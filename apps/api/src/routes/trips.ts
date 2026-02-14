import { Router } from "express";
import { db } from "../config/firebase";
import admin from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createTripSchema,
  assignTripSchema,
  updateTripStatusSchema,
} from "@quickroutesai/shared";
import { computeRoute, geocodeAddress } from "../services/directions";
import { randomUUID } from "crypto";

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
 * GET /trips — list trips with optional filters
 * Query params: ?status=draft&driverId=xyz&limit=50
 */
router.get("/", async (req, res) => {
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

    const limitNum = Math.min(parseInt(String(req.query.limit || "50"), 10), 100);
    ref = ref.orderBy("createdAt", "desc").limit(limitNum);

    const snapshot = await ref.get();
    const trips = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch trips" });
  }
});

/**
 * POST /trips/:id/assign — dispatcher assigns a driver to this trip
 */
router.post("/:id/assign", requireRole("dispatcher", "admin"), validate(assignTripSchema), async (req, res) => {
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
router.post("/:id/status", validate(updateTripStatusSchema), async (req, res) => {
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

export default router;
