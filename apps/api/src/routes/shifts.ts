import { Router } from "express";
import { db } from "../config/firebase";
import { ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";
import type { DriverShift, ShiftDailyTotal } from "@quickroutesai/shared";

const router = Router();

function startOfLocalDayISO(d: Date): string {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return local.toISOString();
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function findOpenShift(driverId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db
    .collection("shifts")
    .where("driverId", "==", driverId)
    .where("endedAt", "==", null)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

/**
 * POST /shifts/start — driver clocks in. Closes any stale open shift first.
 */
router.post("/start", async (req, res, next) => {
  if (req.userRole !== "driver") {
    return next(new AppError(ErrorCode.FORBIDDEN, 403, "Only drivers can start shifts"));
  }
  if (!req.orgId) {
    return next(new AppError(ErrorCode.FORBIDDEN, 403, "Driver not linked to an organization"));
  }

  const now = new Date().toISOString();

  try {
    const existing = await findOpenShift(req.uid);
    if (existing) {
      const data = existing.data();
      const start = new Date(data.startedAt).getTime();
      const end = Date.now();
      await existing.ref.update({
        endedAt: now,
        durationSeconds: Math.max(0, Math.floor((end - start) / 1000)),
        updatedAt: now,
      });
    }

    const ref = db.collection("shifts").doc();
    const shift: DriverShift = {
      id: ref.id,
      driverId: req.uid,
      orgId: req.orgId,
      startedAt: now,
      endedAt: null,
      durationSeconds: null,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(shift);

    res.json(shift);
  } catch (err) {
    console.error("[shifts/start] firestore error:", err);
    next(new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to start shift"));
  }
});

/**
 * POST /shifts/end — driver clocks out. Closes the open shift; no-op if none.
 */
router.post("/end", async (req, res, next) => {
  if (req.userRole !== "driver") {
    return next(new AppError(ErrorCode.FORBIDDEN, 403, "Only drivers can end shifts"));
  }

  const now = new Date().toISOString();

  try {
    const existing = await findOpenShift(req.uid);
    if (!existing) {
      return res.json({ ok: true, closed: false });
    }

    const data = existing.data();
    const start = new Date(data.startedAt).getTime();
    const durationSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));

    await existing.ref.update({
      endedAt: now,
      durationSeconds,
      updatedAt: now,
    });

    res.json({ ok: true, closed: true, shiftId: existing.id, durationSeconds });
  } catch (err) {
    console.error("[shifts/end] firestore error:", err);
    next(new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to end shift"));
  }
});

/**
 * GET /shifts/today — today's shifts and total seconds (includes elapsed time
 * from any still-open shift).
 */
router.get("/today", async (req, res, next) => {
  if (req.userRole !== "driver") {
    return next(new AppError(ErrorCode.FORBIDDEN, 403, "Only drivers can view their shifts"));
  }

  try {
    const now = new Date();
    const startOfDay = startOfLocalDayISO(now);

    const snap = await db
      .collection("shifts")
      .where("driverId", "==", req.uid)
      .where("startedAt", ">=", startOfDay)
      .orderBy("startedAt", "desc")
      .get();

    const shifts = snap.docs.map((d) => d.data() as DriverShift);

    let totalSeconds = 0;
    for (const s of shifts) {
      if (s.endedAt && s.durationSeconds != null) {
        totalSeconds += s.durationSeconds;
      } else {
        totalSeconds += Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
      }
    }

    res.json({ totalSeconds, shifts });
  } catch (err) {
    console.error("[shifts/today] firestore error:", err);
    next(new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to load today's shifts"));
  }
});

/**
 * GET /shifts/weekly — last 7 days grouped by local date.
 */
router.get("/weekly", async (req, res, next) => {
  if (req.userRole !== "driver") {
    return next(new AppError(ErrorCode.FORBIDDEN, 403, "Only drivers can view their shifts"));
  }

  try {
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const cutoff = startOfWeek.toISOString();

    const snap = await db
      .collection("shifts")
      .where("driverId", "==", req.uid)
      .where("startedAt", ">=", cutoff)
      .orderBy("startedAt", "desc")
      .get();

    const shifts = snap.docs.map((d) => d.data() as DriverShift);

    const buckets = new Map<string, ShiftDailyTotal>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i);
      const key = localDateKey(d.toISOString());
      buckets.set(key, { date: key, totalSeconds: 0, shiftCount: 0 });
    }

    for (const s of shifts) {
      const key = localDateKey(s.startedAt);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const seconds =
        s.endedAt && s.durationSeconds != null
          ? s.durationSeconds
          : Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
      bucket.totalSeconds += seconds;
      bucket.shiftCount += 1;
    }

    const days: ShiftDailyTotal[] = Array.from(buckets.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const totalSeconds = days.reduce((sum, d) => sum + d.totalSeconds, 0);

    res.json({ totalSeconds, days });
  } catch (err) {
    console.error("[shifts/weekly] firestore error:", err);
    next(new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to load weekly shifts"));
  }
});

export default router;
