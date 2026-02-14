import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { locationPingSchema } from "@quickroutesai/shared";
import admin from "firebase-admin";

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
 */
router.get("/", requireRole("dispatcher", "admin"), async (_req, res) => {
  try {
    const snapshot = await db.collection("drivers").get();
    const drivers = await Promise.all(
      snapshot.docs.map(async (driverDoc) => {
        const userDoc = await db.collection("users").doc(driverDoc.id).get();
        const userData = userDoc.data();
        return {
          uid: driverDoc.id,
          name: userData?.name || "Unknown",
          email: userData?.email || "",
          ...driverDoc.data(),
        };
      }),
    );
    res.json(drivers);
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
