import { Router } from "express";
import { db } from "../config/firebase";
import { validate } from "../middleware/validate";
import { createUserProfileSchema } from "@quickroutesai/shared";

const router = Router();

/**
 * POST /auth/setup — creates user profile in Firestore after first Firebase Auth login.
 * Idempotent — won't overwrite existing profile.
 */
router.post("/setup", validate(createUserProfileSchema), async (req, res) => {
  try {
    const userRef = db.collection("users").doc(req.uid);
    const existing = await userRef.get();

    if (existing.exists) {
      return res.json({ message: "Profile already exists", profile: { uid: req.uid, ...existing.data() } });
    }

    const profile = {
      email: req.userEmail,
      name: req.body.name,
      role: req.body.role || "driver",
      createdAt: new Date().toISOString(),
    };

    await userRef.set(profile);

    // If driver, also create driver document
    if (profile.role === "driver") {
      await db.collection("drivers").doc(req.uid).set({
        isOnline: false,
        lastLocation: null,
        lastSpeedMps: 0,
        lastHeading: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    res.status(201).json({ uid: req.uid, ...profile });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to create profile" });
  }
});

export default router;
