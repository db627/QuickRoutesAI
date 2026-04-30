import { Router } from "express";
import { db } from "../config/firebase";
import { requireOrg, requireRole, verifyFirebaseToken } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createInviteSchema, ErrorCode, type Invite } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

/**
 * Routes for admin-generated, per-email team invite links.
 *
 * The token in `/signup?invite=<token>` IS the Firestore doc id (auto-generated,
 * sufficient entropy). One token == one invite == one email + role binding,
 * scoped to the admin's org.
 *
 * Most endpoints are admin-only (mounted under verifyFirebaseToken in index.ts),
 * but `GET /invites/lookup/:token` is public (no auth) so the signup page can
 * resolve the token to {email, role, orgId} for pre-fill before the invitee
 * has any account at all.
 */
const router = Router();

interface InviteDoc extends Omit<Invite, "id"> {}

// ────────────────────────────────────────────────────────────────────
// Public — must be registered BEFORE the auth middleware below.
// ────────────────────────────────────────────────────────────────────

/**
 * GET /invites/lookup/:token — PUBLIC.
 *
 * Returns minimal `{ email, role, orgId, status }` so the unauthenticated
 * /signup page can pre-fill its form. Returns 404 for any non-pending invite
 * (used / revoked / missing) so we don't leak whether a token ever existed.
 */
router.get("/lookup/:token", async (req, res, next) => {
  try {
    const snap = await db.collection("invites").doc(req.params.token).get();
    if (!snap.exists) {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, "Invite not found"));
    }
    const data = snap.data() as InviteDoc | undefined;
    if (!data || data.status !== "pending") {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, "Invite not found"));
    }
    res.json({
      email: data.email,
      role: data.role,
      orgId: data.orgId,
      status: data.status,
    });
  } catch (err) {
    console.error("INVITES ROUTE ERROR:", err);
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────
// Authenticated, admin-only endpoints below.
// ────────────────────────────────────────────────────────────────────

router.use(verifyFirebaseToken);

/**
 * POST /invites — admin generates a new invite.
 * Body: { email, role: "driver" | "dispatcher" }
 * Returns the full invite doc, including `id` (which is the token).
 */
router.post(
  "/",
  requireRole("admin"),
  requireOrg,
  validate(createInviteSchema),
  async (req, res, next) => {
    try {
      const { email, role } = req.body as { email: string; role: "driver" | "dispatcher" };
      const now = new Date().toISOString();

      const ref = db.collection("invites").doc();
      const invite: Invite = {
        id: ref.id,
        orgId: req.orgId!,
        email: email.toLowerCase(),
        role,
        status: "pending",
        createdBy: req.uid,
        createdAt: now,
      };

      await ref.set(invite);

      res.status(201).json(invite);
    } catch (err) {
      console.error("INVITES ROUTE ERROR:", err);
      next(err);
    }
  },
);

/**
 * GET /invites — list invites for the admin's org, newest first.
 * Default: pending only. Pass ?includeAll=true to include used/revoked too.
 */
router.get("/", requireRole("admin"), requireOrg, async (req, res, next) => {
  try {
    const includeAll = req.query.includeAll === "true";

    let query = db
      .collection("invites")
      .where("orgId", "==", req.orgId!)
      .orderBy("createdAt", "desc");

    if (!includeAll) {
      query = query.where("status", "==", "pending");
    }

    const snap = await query.get();
    const invites = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as Invite[];

    res.json({ data: invites });
  } catch (err) {
    console.error("INVITES ROUTE ERROR:", err);
    next(err);
  }
});

/**
 * DELETE /invites/:id — admin revokes a pending invite.
 * 404 if missing or not in this admin's org.
 */
router.delete("/:id", requireRole("admin"), requireOrg, async (req, res, next) => {
  try {
    const ref = db.collection("invites").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, "Invite not found"));
    }
    const data = snap.data() as InviteDoc | undefined;
    if (!data || data.orgId !== req.orgId) {
      // Don't leak existence of invites belonging to other orgs.
      return next(new AppError(ErrorCode.NOT_FOUND, 404, "Invite not found"));
    }

    await ref.update({ status: "revoked" });
    res.status(204).send();
  } catch (err) {
    console.error("INVITES ROUTE ERROR:", err);
    next(err);
  }
});

export default router;
