import { Router } from "express";
import { db } from "../config/firebase";
import admin from "firebase-admin";
import { requireRole } from "../middleware/auth";
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

router.patch("/:id", requireRole("admin"), async (req, res) => {

});


export default router;