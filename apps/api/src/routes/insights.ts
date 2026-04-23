import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { ErrorCode } from "@quickroutesai/shared";
import { generateDailyInsights } from "../services/insightsGenerator";
import type { DailyInsights } from "@quickroutesai/shared";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * GET /insights?date=YYYY-MM-DD
 *
 * Returns cached insights from `insights/{YYYY-MM-DD}` if present,
 * otherwise generates, persists, and returns a fresh record.
 * Any authenticated user can read.
 */
router.get("/", async (req, res, next) => {
  const date = (req.query.date as string) || todayUtcYmd();
  if (!YMD_RE.test(date)) {
    return next(
      new AppError(ErrorCode.VALIDATION_ERROR, 400, "date must be YYYY-MM-DD"),
    );
  }

  try {
    const docRef = db.collection("insights").doc(date);
    const snap = await docRef.get();
    if (snap.exists) {
      return res.json(snap.data() as DailyInsights);
    }

    const insights = await generateDailyInsights(date);
    await docRef.set(insights);
    res.json(insights);
  } catch (err) {
    return next(
      err instanceof AppError
        ? err
        : new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            err instanceof Error ? err.message : "Failed to fetch insights",
          ),
    );
  }
});

/**
 * POST /insights/generate?date=YYYY-MM-DD
 *
 * Force-regenerates insights for the date, even if cached.
 * Admin/dispatcher only.
 */
router.post(
  "/generate",
  requireRole("admin", "dispatcher"),
  async (req, res, next) => {
    const date = (req.query.date as string) || todayUtcYmd();
    if (!YMD_RE.test(date)) {
      return next(
        new AppError(ErrorCode.VALIDATION_ERROR, 400, "date must be YYYY-MM-DD"),
      );
    }

    try {
      const insights = await generateDailyInsights(date);
      await db.collection("insights").doc(date).set(insights);
      res.json(insights);
    } catch (err) {
      return next(
        err instanceof AppError
          ? err
          : new AppError(
              ErrorCode.INTERNAL_ERROR,
              500,
              err instanceof Error ? err.message : "Failed to generate insights",
            ),
      );
    }
  },
);

export default router;
