import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole, requireOrg } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { ErrorCode } from "@quickroutesai/shared";
import type { AnalyticsResponse } from "@quickroutesai/shared";

const router = Router();

/**
 * GET /analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns trip-level analytics for the given date range (defaults to last 30 days).
 * Aggregated in-memory after a single Firestore range query — acceptable for 30-day
 * windows (~1000 trips max per org at this scale).
 */
router.get("/", requireRole("dispatcher", "admin"), requireOrg, async (req, res, next) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };

    const toDate = to ? new Date(to) : new Date();
    toDate.setUTCHours(23, 59, 59, 999);

    const fromDate = from ? new Date(from) : new Date(toDate);
    if (!from) {
      fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    }
    fromDate.setUTCHours(0, 0, 0, 0);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Invalid date format — use YYYY-MM-DD");
    }
    if (fromDate > toDate) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "'from' must not be after 'to'");
    }

    const snapshot = await db
      .collection("trips")
      .where("orgId", "==", req.orgId)
      .where("createdAt", ">=", fromDate.toISOString())
      .where("createdAt", "<=", toDate.toISOString())
      .orderBy("createdAt", "asc")
      .limit(2000)
      .get();

    const trips = snapshot.docs.map((d) => d.data());

    // Pre-fill every calendar day in range with 0 so days without trips still appear
    const tripsByDayMap: Record<string, number> = {};
    const deliveryByDayMap: Record<string, number[]> = {};
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      tripsByDayMap[cursor.toISOString().split("T")[0]] = 0;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    let totalStops = 0;
    let onTimeCount = 0;
    let tripsWithEta = 0;

    for (const trip of trips) {
      const dateKey = (trip.createdAt as string).split("T")[0];

      tripsByDayMap[dateKey] = (tripsByDayMap[dateKey] ?? 0) + 1;
      totalStops += (trip.stopCount as number | undefined) ?? 0;

      // Avg delivery time — completed trips only, capped to avoid outlier pollution
      if (
        trip.status === "completed" &&
        typeof trip.createdAt === "string" &&
        typeof trip.updatedAt === "string"
      ) {
        const durationMinutes =
          (new Date(trip.updatedAt).getTime() - new Date(trip.createdAt).getTime()) / 60_000;
        if (durationMinutes > 0 && durationMinutes < 24 * 60) {
          if (!deliveryByDayMap[dateKey]) deliveryByDayMap[dateKey] = [];
          deliveryByDayMap[dateKey].push(durationMinutes);
        }
      }

      // On-time: actual arrival within 5 min of predicted
      const eta = trip.predictedEta as { predictedArrivalAt?: string; actualArrivalAt?: string } | undefined;
      if (eta?.predictedArrivalAt && eta?.actualArrivalAt) {
        tripsWithEta++;
        const predicted = new Date(eta.predictedArrivalAt).getTime();
        const actual = new Date(eta.actualArrivalAt).getTime();
        if (actual <= predicted + 5 * 60_000) {
          onTimeCount++;
        }
      }
    }

    const tripsByDay = Object.entries(tripsByDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const avgDeliveryByDay = Object.entries(deliveryByDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, minutes]) => ({
        date,
        avgMinutes: Math.round(minutes.reduce((s, m) => s + m, 0) / minutes.length),
      }));

    const response: AnalyticsResponse = {
      tripsByDay,
      avgDeliveryByDay,
      summary: {
        totalTrips: trips.length,
        totalStops,
        onTimePercentage: tripsWithEta > 0 ? Math.round((onTimeCount / tripsWithEta) * 100) : null,
        tripsWithEta,
      },
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

export default router;
