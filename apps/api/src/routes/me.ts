import { Router } from "express";
import { db } from "../config/firebase";

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
      createdAt: data?.createdAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch profile" });
  }
});

export default router;
