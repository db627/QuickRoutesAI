import { Router } from "express";
import admin from "firebase-admin";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createOrgSchema, ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

const router = Router();

/**
 * POST /orgs — create an organization and link the current admin to it.
 *
 * Runs in a Firestore transaction:
 *   1. Re-read the user doc inside the transaction.
 *   2. Abort with 409 if the user already has an orgId.
 *   3. Create orgs/{newId} with ownerUid = req.uid.
 *   4. Patch users/{uid}: set orgId, name, phone, timezone; delete wizardProgress.
 *
 * Admin only.
 */
router.post(
  "/",
  requireRole("admin"),
  validate(createOrgSchema),
  async (req, res, next) => {
    const now = new Date().toISOString();
    const { orgBasics, address, adminProfile } = req.body;

    try {
      const userRef = db.collection("users").doc(req.uid);
      const orgRef = db.collection("orgs").doc();

      const org = {
        id: orgRef.id,
        name: orgBasics.name,
        industry: orgBasics.industry,
        fleetSize: orgBasics.fleetSize,
        address,
        ownerUid: req.uid,
        createdAt: now,
        updatedAt: now,
      };

      const userPatch = {
        orgId: orgRef.id,
        name: adminProfile.name,
        phone: adminProfile.phone,
        timezone: adminProfile.timezone,
        wizardProgress: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      };

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) {
          throw new AppError(ErrorCode.USER_NOT_FOUND, 404, "User profile not found");
        }
        if (snap.data()?.orgId) {
          throw new AppError(ErrorCode.CONFLICT, 409, "User already belongs to an organization");
        }
        tx.set(orgRef, org);
        tx.update(userRef, userPatch);
      });

      res.status(201).json({
        org,
        user: {
          uid: req.uid,
          orgId: orgRef.id,
          name: adminProfile.name,
          phone: adminProfile.phone,
          timezone: adminProfile.timezone,
        },
      });
    } catch (err) {
      console.error("ORGS ROUTE ERROR:", err);
      next(err);
    }
  },
);

export default router;
