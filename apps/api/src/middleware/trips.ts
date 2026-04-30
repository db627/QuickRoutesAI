import { Request, Response, NextFunction } from "express";
import { db } from "../config/firebase";
import type { TripStatus, TripStop } from "@quickroutesai/shared";
import { ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

declare global {
  namespace Express {
    interface Request {
      stops?: TripStop[];
    }
  }
}

export async function tripTransitionGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    let status = req.body.status || null;
    let curr_status: TripStatus | null = null;

    if (req.route.path === "/test") {
      status = req.body.status_test || null;
      curr_status = req.body.current_status_test || null;
    } else {
      const tripId = req.params.id;
      const tripDoc = await db.collection("trips").doc(tripId).get();

      if (!tripDoc.exists) {
        return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
      }

      const trip = tripDoc.data();
      curr_status = (trip?.status as TripStatus) ?? null;
    }

    const tripStatuses: TripStatus[] = ["draft", "assigned", "completed", "cancelled", "in_progress"];

    const allowedTransitions: Record<TripStatus, TripStatus[]> = {
      draft: ["assigned", "cancelled"],
      // Dispatchers/admins can manually mark an assigned trip complete
      // (e.g. driver finished but never tapped Start). The route handler is
      // responsible for syncing per-stop status when this fires.
      assigned: ["in_progress", "completed", "cancelled"],
      in_progress: ["completed"],
      completed: [],
      cancelled: [],
    };

    if (!tripStatuses.includes(curr_status as TripStatus)) {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Invalid current trip status"));
    }

    if (req.route.path === "/:id/assign") {
      status = "assigned";
    }

    if (!tripStatuses.includes(status as TripStatus)) {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Unknown transition occurring"));
    }

    if (!allowedTransitions[curr_status as TripStatus].includes(status as TripStatus)) {
      return next(
        new AppError(
          ErrorCode.INVALID_STATUS_TRANSITION,
          409,
          `${curr_status} trips cannot transition to ${status}`,
        ),
      );
    }

    return next();
  } catch {
    return next(new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to verify trip status"));
  }
}

export async function tripStopsValidationGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const tripId = req.params.id;
    const tripDoc = await db.collection("trips").doc(tripId).get();

    if (!tripDoc.exists) {
      return next(new AppError(ErrorCode.TRIP_NOT_FOUND, 404));
    }

    const stopsSnapshot = await db.collection("trips").doc(tripId).collection("stops").get();

    if (stopsSnapshot.empty) {
      return next(new AppError(ErrorCode.BAD_REQUEST, 400, "Trip must have at least one stop"));
    }

    req.stops = stopsSnapshot.docs.map((doc) => doc.data() as TripStop);

    return next();
  } catch {
    return next(new AppError(ErrorCode.INTERNAL_ERROR, 500, "Failed to validate trip stops"));
  }
}