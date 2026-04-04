import { Request, Response, NextFunction } from "express";
import { auth, db } from "../config/firebase";
import type { TripStatus, TripStop } from "@quickroutesai/shared";

declare global {
  namespace Express {
    interface Request {
      stops?: TripStop[];
    }
  }
}

export async function tripTransitionGuard(req: Request, res: Response, next: NextFunction) {
    try{

        let status = req.body.status || null;
        let curr_status = null;
        if(req.route.path == "/test"){
            status = req.body.status_test || null;
            curr_status = req.body.current_status_test || null;
        }else{
            const tripId = req.params.id;
            const tripDoc = await db.collection("trips").doc(tripId).get();

            if (!tripDoc.exists) {
                return res.status(404).json({ error: "Not Found", message: "Trip not found" });
            }
            const trip = tripDoc.data();
            curr_status = trip?.status;
        }

        
        const tripStatuses: TripStatus[] = ["draft", "assigned", "completed", "cancelled", "in_progress"];

        

        const allowedTransitions: Record<TripStatus, TripStatus[]> = {
            draft: ["assigned", "cancelled"],
            assigned: ["in_progress", "cancelled"],
            in_progress: ["completed"],
            completed: [],
            cancelled: [],
        };

        if (!tripStatuses.includes(curr_status as TripStatus)) {
            return res.status(400).json({ error: "Bad Request", message: "Invalid current trip status" });
        }
        
        // Special handling for integration tests to allow setting status directly

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

export async function tripStopsValidationGuard(req: Request, res: Response, next: NextFunction) {
    try{
        let trip_id = req.params.id;

        const stops = await db.collection("trips").doc(trip_id).collection("stops").get();
        if(stops.empty){
            return res.status(400).json({ error: "Bad Request", message: "Trip must have at least one stop" });
        }
        req.stops = stops.docs.map((doc) => doc.data() as TripStop);
        console.log("Validated trip stops:", req.stops);
        next();
    }catch (err) {
        return res.status(500).json({ error: "Internal Error", message: "Failed to validate trip stops" });
    }
    
}