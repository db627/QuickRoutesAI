import { Router } from "express";
import { auth, db } from "../config/firebase";
import admin from "firebase-admin";
import { requireRole } from "../middleware/auth";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";
import { validate } from "../middleware/validate";
import { updateUserSchema } from "@quickroutesai/shared/src/schemas";
import { create } from "domain";

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

router.patch("/:id", requireRole("admin"), validate(updateUserSchema), async (req, res) => {
  try {
    const { role, active } = req.body;
    const updateData: Partial<{ role: string; active: boolean }> = {};
    if (role !== undefined) updateData.role = role;
    if (active !== undefined) updateData.active = active === "true" ? true : active === "false" ? false : undefined;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "Bad Request", message: "No valid fields to update" });
    }
    const userRef = db.collection("users").doc(req.params.id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "User not found" });
    }
    const data = userDoc.data();
    
    await db.collection("users").doc(req.params.id).update(updateData);

    await db.collection("events").add({
      createdAt: new Date().toISOString(),
      payload: { from: { active: data?.active ?? true, role: data?.role ?? "user" }, to: updateData, userId: req.params.id },
      type: "user_updated",
      uid: req.uid,
    });
    res.json({ ok : true, message: "User updated successfully" });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update user";
    res.status(500).json({ error: "Internal Error", message });
  }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const userRef = db.collection("users").doc(req.params.id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "User not found" });
    }
    const data = userDoc.data();
    const deleteProfile = await userRef.delete();
    const deleteAuth = await auth.deleteUser(req.params.id);
    
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