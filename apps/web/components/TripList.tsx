"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Trip } from "@quickroutesai/shared";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  assigned: "bg-blue-50 text-blue-600",
  in_progress: "bg-green-50 text-green-600",
  completed: "bg-purple-50 text-purple-600",
  cancelled: "bg-red-50 text-red-600",
};

export default function TripList() {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    const q = query(collection(firestore, "trips"), orderBy("createdAt", "desc"), limit(20));
    const unsub = onSnapshot(q, (snapshot) => {
      setTrips(
        snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Trip, "id">),
        })),
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-3">
        <h2 className="font-semibold text-gray-900">Recent Trips</h2>
      </div>
      <div className="divide-y divide-gray-200">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3">
              <div className="space-y-1.5">
                <SkeletonBlock className="h-3.5 w-20" />
                <SkeletonBlock className="h-3 w-28" />
              </div>
              <SkeletonBlock className="h-5 w-16 rounded-full" />
            </div>
          ))
        ) : trips.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-400">No trips yet</p>
        ) : (
          trips.map((trip) => (
          <Link
            key={trip.id}
            href={`/dashboard/trips/${trip.id}`}
            className="flex items-center justify-between px-5 py-3 transition hover:bg-gray-50"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">
                {trip.stops?.length ?? 0} stop{(trip.stops?.length ?? 0) !== 1 && "s"}
              </p>
              <p className="text-xs text-gray-400">
                {trip.driverId ? `Driver: ${trip.driverId.slice(0, 8)}...` : "Unassigned"}
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[trip.status] || ""}`}>
              {trip.status.replace("_", " ")}
            </span>
          </Link>
          ))
        )}
      </div>
    </div>
  );
}
