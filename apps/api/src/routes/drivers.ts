import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { locationPingSchema } from "@quickroutesai/shared";
import admin from "firebase-admin";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";

const router = Router();

/**
 * POST /drivers/location — driver posts their current GPS position
 */
router.post("/location", validate(locationPingSchema), async (req, res) => {
  if (req.userRole !== "driver") {
    return res.status(403).json({ error: "Forbidden", message: "Only drivers can post location" });
  }

  const { lat, lng, speedMps, heading } = req.body;
  const now = new Date().toISOString();

  try {
    // Update driver document

    //Proposal: store last location, with timestamp, possibly encode into a polyline for historical tracking.
    // Historical location data can be stored in a separate collection if needed for analytics or route replay features.
    // This keeps the driver document lightweight for frequent updates while still allowing us to track location history if desired.
    await db
      .collection("drivers")
      .doc(req.uid)
      .set(
        {
          isOnline: true,
          lastLocation: { lat, lng },
          lastSpeedMps: speedMps,
          lastHeading: heading,
          updatedAt: now,
        },
        { merge: true },
      );

    // Write event log
    await db.collection("events").add({
      type: "location_ping",
      driverId: req.uid,
      payload: { lat, lng, speedMps, heading },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, updatedAt: now });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to update location" });
  }
});

/**
 * GET /drivers/active — dispatcher gets list of online drivers with locations
 */
router.get("/active", requireRole("dispatcher", "admin"), async (_req, res) => {
  try {
    const snapshot = await db.collection("drivers").where("isOnline", "==", true).get();

    const drivers = snapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch drivers" });
  }
});

/**
 * GET /drivers — list all drivers (for dispatcher assignment dropdowns, etc.)
 * Supports pagination: ?page=1&limit=20 or ?cursor=...&limit=20
 * Optional filters: ?online=true, ?available=true
 *   - available=true filters out drivers with in_progress trips
 */
router.get("/", requireRole("dispatcher", "admin"), pagination, async (req, res) => {
  try {
    // paginate the drivers collection first

    const isOnline = req.query.online === "true" ? true : null;
    const isAvailable = req.query.available === "true" ? true : null;
    var baseQuery: admin.firestore.Query = db.collection("drivers");

    // Build set of busy driver IDs to filter out after pagination
    let busyDriverIds: Set<string> | null = null;
    if (isAvailable !== null) {
      const inProgressTrips = await db.collection("trips").where("status", "==", "in_progress").get();
      busyDriverIds = new Set(inProgressTrips.docs.map((d) => d.data().driverId).filter(Boolean));
    }
    
    if (isOnline !== null) {
      baseQuery = baseQuery.where("isOnline", "==", isOnline);
    }

    const pageResult = await paginateFirestore(baseQuery, req.pagination!, {
      orderField: "updatedAt",
      orderDirection: "desc",
    });

    // enrich only the returned page with user info
    const enriched = await Promise.all(
      pageResult.data.map(async (driver: any) => {
        // paginateFirestore returns { id, ...data() }
        const uid = driver.id;
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        // remove id, replace with uid to keep your existing response style
        const { id, ...driverData } = driver;

        return {
          uid,
          name: userData?.name || "Unknown",
          email: userData?.email || "",
          ...driverData,
        };
      }),
    );

    // Filter out busy drivers client-side (Firestore "not-in" is limited to 10 items)
    const finalData = busyDriverIds
      ? enriched.filter((d) => !busyDriverIds!.has(d.uid))
      : enriched;

    res.json({
      ...pageResult,
      data: finalData,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch drivers" });
  }
});

/**
 * POST /drivers/offline — driver sets themselves offline
 */
router.post("/offline", async (req, res) => {
  if (req.userRole !== "driver") {
    return res.status(403).json({ error: "Forbidden", message: "Only drivers can update status" });
  }

  try {
    await db.collection("drivers").doc(req.uid).set(
      { isOnline: false, updatedAt: new Date().toISOString() },
      { merge: true },
    );

    await db.collection("events").add({
      type: "status_change",
      driverId: req.uid,
      payload: { status: "offline" },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, isOnline: false });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to go offline" });
  }
});

export default router;
