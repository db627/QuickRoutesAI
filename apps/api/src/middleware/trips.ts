import { Request, Response, NextFunction } from "express";
import { auth, db } from "../config/firebase";
import type { TripStatus } from "@quickroutesai/shared";

export async function tripTransitionGuard(req: Request, res: Response, next: NextFunction) {
    try{
        const tripId = req.params.id;
        const tripDoc = await db.collection("trips").doc(tripId).get();

        if (!tripDoc.exists) {
            return res.status(404).json({ error: "Not Found", message: "Trip not found" });
        }

        const trip = tripDoc.data();

        const curr_status = trip?.status;
        const tripStatuses: TripStatus[] = ["draft", "assigned", "completed", "cancelled", "in_progress"];

        let status = req.body.status || null;

        const allowedTransitions: Record<TripStatus, TripStatus[]> = {
            draft: ["assigned", "cancelled"],
            assigned: ["completed", "cancelled"],
            in_progress: ["completed"],
            completed: [],
            cancelled: [],
        };

        if (!tripStatuses.includes(curr_status as TripStatus)) {
            console.error(`Invalid current trip status: ${curr_status}`);
            return res.status(400).json({ error: "Bad Request", message: "Invalid current trip status" });
        }

        if(req.route.path == "/:id/assign"){
            status = "assigned";
        }
        
        if (!tripStatuses.includes(status as TripStatus)) {
            return res.status(400).json({ error: "Bad Request", message: "Unknown transition occurring" });
        }


        if (!allowedTransitions[curr_status as TripStatus].includes(status as TripStatus)) {
            return res.status(409).json({
                error: "Bad Request",
                message: `${curr_status} trips cannot transition to ${status}`,
            });
        }
        next();
    }catch (err) {
        return res.status(500).json({ error: "Internal Error", message: "Failed to verify trip status" });
    }
}