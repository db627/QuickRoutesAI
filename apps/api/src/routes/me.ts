import { Router, NextFunction } from "express";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { wizardProgressSchema, ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

const router = Router();

/**
 * GET /me — returns the authenticated user's profile + role
 */
router.get("/", async (req, res, next: NextFunction) => {
  try {
    const userDoc = await db.collection("users").doc(req.uid).get();

    if (!userDoc.exists) {
      return next(new AppError(ErrorCode.USER_NOT_FOUND, 404, "User profile not found"));
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
    console.error("ME ROUTE ERROR:", err);
    next(err);
  }
});

/**
 * GET /me/wizard-progress — returns saved wizard state or null.
 * Admin only.
 */
router.get("/wizard-progress", requireRole("admin"), async (req, res, next: NextFunction) => {
  try {
    const userDoc = await db.collection("users").doc(req.uid).get();
    const progress = userDoc.exists ? userDoc.data()?.wizardProgress ?? null : null;
    res.json({ wizardProgress: progress });
  } catch (err) {
    console.error("ME ROUTE ERROR:", err);
    next(err);
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
  async (req, res, next: NextFunction) => {
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
      console.error("ME ROUTE ERROR:", err);
      next(err);
    }
  },
);

export default router;
