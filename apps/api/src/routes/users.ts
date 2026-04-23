import { Router } from "express";
import { auth, db } from "../config/firebase";
import admin from "firebase-admin";
import { requireRole, requireOrg } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { updateUserSchema, ErrorCode } from "@quickroutesai/shared";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";
import { AppError } from "../utils/AppError";

const router = Router();

/**
 * Ensures the target user belongs to the caller's organization.
 * Throws AppError(FORBIDDEN, 403) on mismatch or if the target user has no orgId.
 */
function assertUserInOrg(
  userData: FirebaseFirestore.DocumentData | undefined,
  orgId: string | undefined,
): void {
  const userOrgId = userData?.orgId;
  if (!userOrgId || !orgId || userOrgId !== orgId) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, "User belongs to another organization");
  }
}

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
  requireOrg,
  pagination,
  async (req, res) => {
    try {
      // Scope to caller's org. Combined with `role` filter, may need a
      // composite index (orgId ASC, role ASC, createdAt DESC) — see PR.
      let ref: admin.firestore.Query = db
        .collection("users")
        .where("orgId", "==", req.orgId!);

      if (req.query.role === "driver") {
        ref = ref.where("role", "==", "driver");
      }
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
  requireOrg,
  validate(updateUserSchema),
  async (req, res, next) => {
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
        return next(new AppError(ErrorCode.USER_NOT_FOUND, 404));
      }

      const data = userDoc.data();
      try {
        assertUserInOrg(data, req.orgId);
      } catch (err) {
        return next(err);
      }
      const updates: Record<string, string> = { updatedAt: new Date().toISOString() };
      if (role !== undefined) updates.role = role;
      if (status !== undefined) updates.status = status;

      await userRef.update(updates);

      // Sync Firebase Auth disabled state when status changes
      if (status !== undefined) {
        await auth.updateUser(id, { disabled: status === "deactivated" });
      }

      await db.collection("events").add({
        createdAt: new Date().toISOString(),
        payload: { from: { status: data?.status ?? "active", role: data?.role ?? "driver" }, to: updates, userId: id },
        type: "user_updated",
        uid: req.uid,
        orgId: req.orgId,
      });

      res.json({ ok: true, ...updates });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update user";
      res.status(500).json({ error: "Internal Error", message });
    }
  },
);

/**
 * DELETE /users/:id — permanently delete a user.
 * Admin only.
 */
router.delete("/:id", requireRole("admin"), requireOrg, async (req, res, next) => {
  try {
    const userRef = db.collection("users").doc(req.params.id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return next(new AppError(ErrorCode.USER_NOT_FOUND, 404));
    }

    const data = userDoc.data();
    try {
      assertUserInOrg(data, req.orgId);
    } catch (err) {
      return next(err);
    }

    await userRef.delete();
    await auth.deleteUser(req.params.id);

    await db.collection("events").add({
      createdAt: new Date().toISOString(),
      payload: { userId: req.params.id, ...data },
      type: "user_deleted",
      uid: req.uid,
      orgId: req.orgId,
    });

    res.json({ ok: true, message: "User deleted successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete user";
    return res.status(500).json({ error: "Internal Error", message });
  }
});

export default router;
