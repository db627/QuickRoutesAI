"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Trip } from "@quickroutesai/shared";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { TripCard } from "@/components/TripCard";

export default function TripList() {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const requestedDriverIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const q = query(collection(firestore, "trips"), orderBy("createdAt", "desc"), limit(20));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Trip, "id">),
      }));
      setTrips(list);
      setLoading(false);

      // Resolve driver names
      const ids = [...new Set(list.map((t) => t.driverId).filter(Boolean))] as string[];
      ids.forEach((uid) => {
        if (requestedDriverIdsRef.current.has(uid)) return;
        requestedDriverIdsRef.current.add(uid);

        getDoc(doc(firestore, "users", uid)).then((snap) => {
          if (snap.exists()) {
            setDriverNames((prev) => ({ ...prev, [uid]: snap.data().name || uid.slice(0, 8) }));
          }
        });
      });
    });
    return unsub;
  }, []);

  // Defensive: API already sorts desc, but we guarantee newest-first here too.
  // ISO 8601 strings sort lexicographically in createdAt order.
  const sortedTrips = useMemo(
    () => [...trips].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [trips],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-3">
        <h2 className="font-semibold text-gray-900">Recent Trips</h2>
      </div>
      <div className="p-4">
        {loading ? (
          <div
            data-testid="trip-card-grid"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <SkeletonBlock className="h-3 w-16" />
                  <SkeletonBlock className="h-5 w-16 rounded-full" />
                </div>
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-3 w-full" />
                <div className="flex items-center justify-between pt-1">
                  <SkeletonBlock className="h-3 w-20" />
                  <SkeletonBlock className="h-3 w-12" />
                </div>
              </div>
            ))}
          </div>
        ) : sortedTrips.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No trips yet</p>
        ) : (
          <div
            data-testid="trip-card-grid"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {sortedTrips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                driverName={trip.driverId ? driverNames[trip.driverId] : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
