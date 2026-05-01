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
 * GET /users/unassigned — list users that are not linked to any organization.
 *
 * Admin-only. Deliberately does NOT use `requireOrg` on the *target* lookup
 * (the caller must still have an org via `requireRole("admin")` + their own
 * profile, but the *result set* is users WITHOUT an org). Filters out
 * deactivated accounts. Capped at 100.
 *
 * Used by the admin dashboard "Unassigned users" section to claim individual
 * drivers / dispatchers into the admin's org.
 */
router.get("/unassigned", requireRole("admin"), async (req, res, next) => {
  try {
    // Try the indexed query first; fall back to a full scan if `orgId == null`
    // can't be queried (older Firestore versions / emulator quirks).
    let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const snap = await db
        .collection("users")
        .where("orgId", "==", null)
        .limit(100)
        .get();
      docs = snap.docs;
    } catch {
      const snap = await db.collection("users").limit(500).get();
      docs = snap.docs.filter((d) => {
        const data = d.data();
        return data.orgId === null || data.orgId === undefined;
      });
    }

    const data = docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u: any) => u.status !== "deactivated")
      .slice(0, 100);

    res.json({ data });
  } catch (err) {
    return next(
      err instanceof AppError
        ? err
        : new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to fetch unassigned users"),
    );
  }
});

/**
 * PATCH /users/:id — update a user's role, status, and/or org membership.
 *
 * Admin only. Admins cannot deactivate their own account.
 *
 * orgId semantics:
 *   - `orgId: <admin's orgId>` — claim an unlinked user OR no-op if already
 *     in this org. 403 if the target already belongs to a *different* org
 *     (no cross-org poaching).
 *   - `orgId: null` — remove a user from the admin's org. The target MUST
 *     currently be in the admin's org.
 *   - Setting orgId to any other org's id is rejected (admins can only
 *     assign to their *own* org).
 *
 * When the target is a driver, the matching drivers/{uid} doc gets the
 * same orgId stamped on it (consistent with POST /drivers/claim-unlinked).
 */
router.patch(
  "/:id",
  requireRole("admin"),
  requireOrg,
  validate(updateUserSchema),
  async (req, res, next) => {
    const { id } = req.params;
    const { role, status, orgId: requestedOrgId } = req.body as {
      role?: string;
      status?: string;
      orgId?: string | null;
    };
    const adminOrgId = req.orgId!;
    const orgIdProvided = Object.prototype.hasOwnProperty.call(req.body, "orgId");

    // Admins can only set orgId to their own org or null. Block attempts to
    // stamp some other org's id onto a user.
    if (
      orgIdProvided &&
      requestedOrgId !== null &&
      requestedOrgId !== adminOrgId
    ) {
      return next(
        new AppError(
          ErrorCode.FORBIDDEN,
          403,
          "You can only assign users to your own organization",
        ),
      );
    }

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
      const targetCurrentOrgId: string | null | undefined = data?.orgId ?? null;

      // Org membership changes have their own auth rules — handle them BEFORE
      // the generic same-org assertion (which would 403 unlinked users).
      if (orgIdProvided) {
        if (requestedOrgId === null) {
          // Removing from org: target must currently be in admin's org.
          if (targetCurrentOrgId !== adminOrgId) {
            return next(
              new AppError(
                ErrorCode.FORBIDDEN,
                403,
                "User does not belong to your organization",
              ),
            );
          }
        } else {
          // Adding to admin's org: target must be unlinked OR already here.
          if (
            targetCurrentOrgId !== null &&
            targetCurrentOrgId !== undefined &&
            targetCurrentOrgId !== adminOrgId
          ) {
            return next(
              new AppError(
                ErrorCode.FORBIDDEN,
                403,
                "User already belongs to another organization",
              ),
            );
          }
        }
      } else {
        // Plain role/status update: target must be in admin's org.
        try {
          assertUserInOrg(data, adminOrgId);
        } catch (err) {
          return next(err);
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (role !== undefined) updates.role = role;
      if (status !== undefined) updates.status = status;
      if (orgIdProvided) updates.orgId = requestedOrgId;

      await userRef.update(updates);

      // Mirror orgId onto matching drivers/{uid} doc when the target is a
      // driver (consistent with POST /drivers/claim-unlinked).
      if (orgIdProvided) {
        const effectiveRole = role ?? data?.role;
        if (effectiveRole === "driver") {
          await db
            .collection("drivers")
            .doc(id)
            .set(
              { orgId: requestedOrgId, updatedAt: new Date().toISOString() },
              { merge: true },
            );
        }
      }

      // Sync Firebase Auth disabled state when status changes
      if (status !== undefined) {
        await auth.updateUser(id, { disabled: status === "deactivated" });
      }

      await db.collection("events").add({
        createdAt: new Date().toISOString(),
        payload: {
          from: {
            status: data?.status ?? "active",
            role: data?.role ?? "driver",
            orgId: targetCurrentOrgId,
          },
          to: updates,
          userId: id,
        },
        type: "user_updated",
        uid: req.uid,
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
    });

    res.json({ ok: true, message: "User deleted successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete user";
    return res.status(500).json({ error: "Internal Error", message });
  }
});

export default router;
