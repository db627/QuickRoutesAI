import { Router } from "express";
import { z } from "zod";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

const router = Router();

const telemetryPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedMps: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
  accuracy: z.number().min(0).optional(),
  timestamp: z.string().datetime(),
});

const telemetryBatchSchema = z.object({
  tripId: z.string().min(1),
  points: z.array(telemetryPointSchema).min(1).max(100),
});

// ─── POST /telemetry — ingest batch GPS points from a driver ────────────────

router.post("/", requireRole("driver"), async (req, res, next) => {
  const parsed = telemetryBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.errors[0]?.message ?? "Invalid telemetry payload",
      ),
    );
  }

  const { tripId, points } = parsed.data;

  try {
    // Validate trip: must exist, be in_progress, and belong to this driver
    const tripDoc = await db.collection("trips").doc(tripId).get();
    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, "Trip not found"));
    }

    const trip = tripDoc.data()!;
    if (trip.driverId !== req.uid) {
      return next(new AppError(ErrorCode.FORBIDDEN, 403, "Trip does not belong to this driver"));
    }
    if (trip.status !== "in_progress") {
      return next(
        new AppError(ErrorCode.VALIDATION_ERROR, 400, "Telemetry only accepted for in_progress trips"),
      );
    }

    const receivedAt = new Date().toISOString();

    // Batch-write all points into trips/{tripId}/telemetry subcollection
    const batch = db.batch();
    for (const point of points) {
      const ref = db.collection("trips").doc(tripId).collection("telemetry").doc();
      batch.set(ref, {
        driverId: req.uid,
        lat: point.lat,
        lng: point.lng,
        ...(point.speedMps !== undefined && { speedMps: point.speedMps }),
        ...(point.heading !== undefined && { heading: point.heading }),
        ...(point.accuracy !== undefined && { accuracy: point.accuracy }),
        timestamp: point.timestamp,
        receivedAt,
      });
    }

    // Update driver's last known location with the most recent point
    const latest = points.reduce((a, b) =>
      new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
    );
    batch.update(db.collection("drivers").doc(req.uid), {
      lastLocation: { lat: latest.lat, lng: latest.lng },
      ...(latest.speedMps !== undefined && { lastSpeedMps: latest.speedMps }),
      ...(latest.heading !== undefined && { lastHeading: latest.heading }),
      updatedAt: receivedAt,
    });

    await batch.commit();

    res.status(202).json({ ok: true, accepted: points.length });
  } catch (err) {
    next(err);
  }
});

export default router;
