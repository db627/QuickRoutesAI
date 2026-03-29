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

    if(isAvailable !== null) {
      const inProgressTrips = await db.collection("trips").where("status", "==", "in_progress").get();
      const busyDriverIds = new Set(inProgressTrips.docs.map(doc => doc.data().driverId));
      console.log("Busy drivers: ", Array.from(busyDriverIds));
      for (let i =0; i < busyDriverIds.size; i+=10) {
        const idBatch = Array.from(busyDriverIds).slice(i, i+10);
        console.log("Filtering out busy drivers ", idBatch);
        baseQuery = baseQuery.where(admin.firestore.FieldPath.documentId(), "not-in", idBatch);
      }

      const busyDriversSnap = await baseQuery.get();
      const busyDrivers = busyDriversSnap.docs.map(doc => doc.id);
      console.log("Not Busy Drivers: ", busyDrivers);
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

    res.json({
      ...pageResult,
      data: enriched,
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
