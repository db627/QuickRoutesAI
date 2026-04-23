import { Router } from "express";
import type { TripStop } from "@quickroutesai/shared";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import {
  pickBestDriver,
  correctAddresses,
  generateDailySummary,
  detectAnomalies,
  predictETA,
  distributeStopsAcrossDrivers,
} from "../services/ai";
import { geocodeAddress, computeRoute } from "../services/directions";

const router = Router();

// ─── POST /ai/auto-assign — pick the best driver for a trip ─────────

router.post("/auto-assign", requireRole("dispatcher", "admin"), async (req, res) => {
  const { tripId } = req.body;
  if (!tripId) return res.status(400).json({ error: "Bad Request", message: "tripId is required" });

  try {
    // Get the trip
    const tripDoc = await db.collection("trips").doc(tripId).get();
    if (!tripDoc.exists) return res.status(404).json({ error: "Not Found", message: "Trip not found" });

    const trip = tripDoc.data();
    if (trip?.status !== "draft") {
      return res.status(400).json({ error: "Bad Request", message: "Can only auto-assign draft trips" });
    }

    // Get online drivers
    const driversSnap = await db.collection("drivers").where("isOnline", "==", true).get();
    if (driversSnap.empty) {
      return res.status(400).json({ error: "Bad Request", message: "No online drivers available" });
    }

    // Get active trip counts per driver
    const activeTripsSnap = await db
      .collection("trips")
      .where("status", "in", ["assigned", "in_progress"])
      .get();

    const tripCountByDriver: Record<string, number> = {};
    activeTripsSnap.docs.forEach((d) => {
      const dId = d.data().driverId;
      if (dId) tripCountByDriver[dId] = (tripCountByDriver[dId] || 0) + 1;
    });

    // Build candidate list with user names
    const candidates = await Promise.all(
      driversSnap.docs.map(async (d) => {
        const data = d.data();
        const userDoc = await db.collection("users").doc(d.id).get();
        const name = userDoc.exists ? userDoc.data()?.name || "Unknown" : "Unknown";
        return {
          uid: d.id,
          name,
          lat: data.lastLocation?.lat || 0,
          lng: data.lastLocation?.lng || 0,
          currentTripCount: tripCountByDriver[d.id] || 0,
        };
      }),
    );

    const stops = (trip?.stops || []).map((s: any) => ({
      address: s.address,
      lat: s.lat,
      lng: s.lng,
    }));

    const result = await pickBestDriver(candidates, stops);

    // Auto-assign the driver
    await db.collection("trips").doc(tripId).update({
      driverId: result.driverId,
      status: "assigned",
      updatedAt: new Date().toISOString(),
    });

    // Log event
    await db.collection("events").add({
      type: "auto_assign",
      uid: req.uid,
      payload: { tripId, driverId: result.driverId, reason: result.reason },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, driverId: result.driverId, reason: result.reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-assign failed";
    res.status(500).json({ error: "Internal Error", message });
  }
});

// ─── POST /ai/correct-addresses — validate and fix addresses ────────

router.post("/correct-addresses", requireRole("dispatcher", "admin"), async (req, res) => {
  const { addresses } = req.body;
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return res.status(400).json({ error: "Bad Request", message: "addresses array is required" });
  }

  try {
    const corrections = await correctAddresses(addresses);
    res.json({ ok: true, corrections });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Address correction failed";
    res.status(500).json({ error: "Internal Error", message });
  }
});

// ─── GET /ai/daily-summary — generate AI summary for a date ─────────

router.get("/daily-summary", requireRole("dispatcher", "admin"), async (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

    // Get all trips for the date
    const dayStart = new Date(date + "T00:00:00.000Z").toISOString();
    const dayEnd = new Date(date + "T23:59:59.999Z").toISOString();

    const tripsSnap = await db
      .collection("trips")
      .where("createdAt", ">=", dayStart)
      .where("createdAt", "<=", dayEnd)
      .get();

    // Also include trips that were active/completed on this date
    const activeSnap = await db
      .collection("trips")
      .where("updatedAt", ">=", dayStart)
      .where("updatedAt", "<=", dayEnd)
      .get();

    // Merge and deduplicate
    const tripMap = new Map<string, any>();
    [...tripsSnap.docs, ...activeSnap.docs].forEach((d) => {
      if (!tripMap.has(d.id)) tripMap.set(d.id, { id: d.id, ...d.data() });
    });

    const trips = Array.from(tripMap.values());

    // Resolve driver names
    const driverIds = [...new Set(trips.map((t) => t.driverId).filter(Boolean))];
    const driverNames: Record<string, string> = {};
    await Promise.all(
      driverIds.map(async (uid: string) => {
        const userDoc = await db.collection("users").doc(uid).get();
        driverNames[uid] = userDoc.exists ? userDoc.data()?.name || "Unknown" : "Unknown";
      }),
    );

    const tripData = trips.map((t) => ({
      id: t.id,
      status: t.status,
      stops: (t.stops || []).length,
      distanceMeters: t.route?.distanceMeters,
      durationSeconds: t.route?.durationSeconds,
      fuelSavingsGallons: t.route?.fuelSavingsGallons,
      driverName: t.driverId ? driverNames[t.driverId] : undefined,
      createdAt: t.createdAt,
      completedAt: t.status === "completed" ? t.updatedAt : undefined,
    }));

    const summary = await generateDailySummary(tripData, date);
    res.json({ ok: true, date, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Summary generation failed";
    res.status(500).json({ error: "Internal Error", message });
  }
});

// ─── GET /ai/anomalies — detect driver anomalies ────────────────────

router.get("/anomalies", requireRole("dispatcher", "admin"), async (req, res) => {
  try {
    // Get active drivers with in-progress trips
    const activeTripsSnap = await db
      .collection("trips")
      .where("status", "==", "in_progress")
      .get();

    if (activeTripsSnap.empty) {
      return res.json({ ok: true, anomalies: [] });
    }

    const activities = await Promise.all(
      activeTripsSnap.docs.map(async (tripDoc) => {
        const trip = tripDoc.data();
        const driverId = trip.driverId;
        if (!driverId) return null;

        // Get driver name
        const userDoc = await db.collection("users").doc(driverId).get();
        const driverName = userDoc.exists ? userDoc.data()?.name || "Unknown" : "Unknown";

        // Get recent events for this driver (last 30 min)
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const eventsSnap = await db
          .collection("events")
          .where("driverId", "==", driverId)
          .where("createdAt", ">=", thirtyMinAgo)
          .orderBy("createdAt", "desc")
          .limit(20)
          .get();

        const events = eventsSnap.docs.map((e) => {
          const data = e.data();
          return {
            type: data.type,
            lat: data.payload?.lat,
            lng: data.payload?.lng,
            speedMps: data.payload?.speedMps,
            timestamp: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt,
          };
        });

        return {
          driverId,
          driverName,
          events,
          tripStatus: trip.status,
          tripStops: (trip.stops || []).map((s: any) => ({
            lat: s.lat,
            lng: s.lng,
            address: s.address,
          })),
        };
      }),
    );

    const validActivities = activities.filter(Boolean) as any[];
    const anomalies = await detectAnomalies(validActivities);

    res.json({ ok: true, anomalies });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Anomaly detection failed";
    res.status(500).json({ error: "Internal Error", message });
  }
});

// ─── POST /ai/eta — predict ETA for an active trip ──────────────────

router.post("/eta", async (req, res) => {
  const { tripId } = req.body;
  if (!tripId) return res.status(400).json({ error: "Bad Request", message: "tripId is required" });

  try {
    const tripDoc = await db.collection("trips").doc(tripId).get();
    if (!tripDoc.exists) return res.status(404).json({ error: "Not Found", message: "Trip not found" });

    const trip = tripDoc.data();
    if (trip?.status !== "in_progress") {
      return res.status(400).json({ error: "Bad Request", message: "Trip must be in progress" });
    }

    const driverId = trip.driverId;
    if (!driverId) {
      return res.status(400).json({ error: "Bad Request", message: "Trip has no driver assigned" });
    }

    // Get driver's current position
    const driverDoc = await db.collection("drivers").doc(driverId).get();
    if (!driverDoc.exists || !driverDoc.data()?.lastLocation) {
      return res.status(400).json({ error: "Bad Request", message: "Driver position not available" });
    }

    const driverData = driverDoc.data()!;
    const now = new Date();

    const stops = (trip.stops || [])
      .sort((a: any, b: any) => a.sequence - b.sequence)
      .map((s: any) => ({
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        sequence: s.sequence,
      }));

    const prediction = await predictETA({
      tripId,
      currentLat: driverData.lastLocation.lat,
      currentLng: driverData.lastLocation.lng,
      remainingStops: stops,
      routeDistanceMeters: trip.route?.distanceMeters,
      routeDurationSeconds: trip.route?.durationSeconds,
      currentSpeedMps: driverData.lastSpeedMps || 0,
      timeOfDay: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`,
      dayOfWeek: now.toLocaleDateString("en-US", { weekday: "long" }),
    });

    res.json({ ok: true, prediction });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ETA prediction failed";
    res.status(500).json({ error: "Internal Error", message });
  }
});

// ─── POST /ai/multi-assign — distribute stops across multiple drivers ─

router.post("/multi-assign", requireRole("dispatcher", "admin"), async (req, res) => {
  const { driverIds, stops } = req.body;

  if (!Array.isArray(driverIds) || driverIds.length < 1) {
    return res.status(400).json({ error: "Bad Request", message: "driverIds array is required" });
  }
  if (!Array.isArray(stops) || stops.length < 1) {
    return res.status(400).json({ error: "Bad Request", message: "stops array is required" });
  }
  if (stops.length < driverIds.length) {
    return res.status(400).json({ error: "Bad Request", message: "Must have at least as many stops as drivers" });
  }

  try {
    // Fetch driver info
    const [driverDocs, userDocs] = await Promise.all([
      Promise.all(driverIds.map((uid: string) => db.collection("drivers").doc(uid).get())),
      Promise.all(driverIds.map((uid: string) => db.collection("users").doc(uid).get())),
    ]);

    const drivers = driverIds.map((uid: string, i: number) => ({
      uid,
      name: userDocs[i].exists ? (userDocs[i].data()?.name ?? "Unknown") : "Unknown",
      lat: driverDocs[i].data()?.lastLocation?.lat ?? 0,
      lng: driverDocs[i].data()?.lastLocation?.lng ?? 0,
    }));

    // Geocode any stops missing coordinates
    const geocodedStops = await Promise.all(
      stops.map(async (s: any) => {
        if (s.lat && s.lng) return s;
        const coords = await geocodeAddress(s.address);
        return { ...s, ...coords };
      }),
    );

    // AI distributes stops across drivers
    const { assignments, reasoning } = await distributeStopsAcrossDrivers(drivers, geocodedStops);

    const now = new Date().toISOString();

    // Create one trip per driver, compute optimized route
    const plans = await Promise.all(
      assignments.map(async ({ driverIndex, stopIndices }) => {
        const driver = drivers[driverIndex];

        const driverStops = stopIndices.map((si, seq) => ({
          stopId: crypto.randomUUID(),
          address: geocodedStops[si].address,
          contactName: geocodedStops[si].contactName ?? "",
          lat: geocodedStops[si].lat,
          lng: geocodedStops[si].lng,
          sequence: seq,
          notes: geocodedStops[si].notes ?? "",
          ...(geocodedStops[si].timeWindow ? { timeWindow: geocodedStops[si].timeWindow } : {}),
        }));

        // Compute optimized route for this driver's stops
        let routeResult = null;
        let optimizedStops: TripStop[] = driverStops as TripStop[];
        try {
          const result = await computeRoute(driverStops, {
            lat: driver.lat,
            lng: driver.lng,
          });
          routeResult = result.route;
          optimizedStops = result.optimizedStops;
        } catch {
          // Route computation is best-effort; trip is still created
        }

        const tripRef = db.collection("trips").doc();
        await tripRef.set({
          driverId: driver.uid,
          createdBy: req.uid,
          status: "assigned",
          stops: optimizedStops,
          route: routeResult,
          notes: `Multi-driver batch. ${reasoning}`,
          createdAt: now,
          updatedAt: now,
        });

        await db.collection("events").add({
          type: "multi_assign",
          uid: req.uid,
          payload: { tripId: tripRef.id, driverId: driver.uid, stopCount: optimizedStops.length },
          createdAt: now,
        });

        return {
          driverId: driver.uid,
          driverName: driver.name,
          tripId: tripRef.id,
          stops: optimizedStops,
          reasoning,
        };
      }),
    );

    res.json({ ok: true, plans, overallReasoning: reasoning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Multi-driver assignment failed";
    res.status(500).json({ error: "Internal Error", message });
  }
});

export default router;
