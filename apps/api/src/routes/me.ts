import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { wizardProgressSchema } from "@quickroutesai/shared";

const router = Router();

/**
 * GET /me — returns the authenticated user's profile + role
 */
router.get("/", async (req, res) => {
  try {
    const userDoc = await db.collection("users").doc(req.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "User profile not found" });
    }

    const data = userDoc.data();
    res.json({
      uid: req.uid,
      email: data?.email || req.userEmail,
      name: data?.name || "",
      role: data?.role || "driver",
      orgId: data?.orgId ?? null,
      phone: data?.phone ?? null,
      timezone: data?.timezone ?? null,
      createdAt: data?.createdAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch profile" });
  }
});

/**
 * GET /me/wizard-progress — returns saved wizard state or null.
 * Admin only.
 */
router.get("/wizard-progress", requireRole("admin"), async (req, res) => {
  try {
    const userDoc = await db.collection("users").doc(req.uid).get();
    const progress = userDoc.exists ? userDoc.data()?.wizardProgress ?? null : null;
    res.json({ wizardProgress: progress });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch wizard progress" });
  }
});

/**
 * PATCH /me/wizard-progress — saves wizard draft state for one step.
 * Admin only.
 */
router.patch(
  "/wizard-progress",
  requireRole("admin"),
  validate(wizardProgressSchema),
  async (req, res) => {
    try {
      await db.collection("users").doc(req.uid).update({
        wizardProgress: {
          currentStep: req.body.currentStep,
          data: req.body.data,
          updatedAt: new Date().toISOString(),
        },
      });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: "Internal Error", message: "Failed to save wizard progress" });
    }
  },
);

export default router;
