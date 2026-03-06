import { Router } from "express";
import { auth, db } from "../config/firebase";
import admin from "firebase-admin";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { updateUserSchema } from "@quickroutesai/shared";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";

const router = Router();

/**
 * GET /users — list users
 *
 * Supports:
 * ?page=1&limit=20
 * OR
 * ?cursor=...&limit=20
 *
 * Admin + Dispatcher only.
 */
router.get(
  "/",
  requireRole("dispatcher", "admin"),
  pagination,
  async (req, res) => {
    try {
      let ref: admin.firestore.Query = db.collection("users");

      const result = await paginateFirestore(ref, req.pagination!, {
        orderField: "createdAt",
        orderDirection: "desc",
      });

      res.json(result);
    } catch (err) {
        console.error("USERS ROUTE ERROR:", err);

        res.status(500).json({
            error: "Internal Error",
            message: "Failed to fetch users",
      });
    }
  },
);

/**
 * PATCH /users/:id — update a user's role and/or status.
 * Admin only. Admins cannot deactivate their own account.
 */
router.patch(
  "/:id",
  requireRole("admin"),
  validate(updateUserSchema),
  async (req, res) => {
    const { id } = req.params;
    const { role, status } = req.body;

    // Prevent admins from deactivating themselves
    if (id === req.uid && status === "deactivated") {
      return res.status(400).json({
        error: "Bad Request",
        message: "You cannot deactivate your own account",
      });
    }

    try {
      const userRef = db.collection("users").doc(id);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "User not found" });
      }

      const updates: Record<string, string> = { updatedAt: new Date().toISOString() };
      if (role !== undefined) updates.role = role;
      if (status !== undefined) updates.status = status;

      await userRef.update(updates);

      // Sync Firebase Auth disabled state when status changes
      if (status !== undefined) {
        await auth.updateUser(id, { disabled: status === "deactivated" });
      }

      res.json({ ok: true, ...updates });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update user";
      res.status(500).json({ error: "Internal Error", message });
    }
  },
);

export default router;