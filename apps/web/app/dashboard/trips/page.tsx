"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Trip, TripStatus } from "@quickroutesai/shared";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  assigned: "bg-blue-50 text-blue-600",
  in_progress: "bg-green-50 text-green-600",
  completed: "bg-purple-50 text-purple-600",
};

const filterTabs: { label: string; value: TripStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Assigned", value: "assigned" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
];

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeFilter, setActiveFilter] = useState<TripStatus | "all">("all");

  useEffect(() => {
    const q = query(collection(firestore, "trips"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      setTrips(
        snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Trip, "id">),
        })),
      );
    });
    return unsub;
  }, []);

  const filteredTrips =
    activeFilter === "all" ? trips : trips.filter((t) => t.status === activeFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trips</h1>
          <p className="text-sm text-gray-500">Manage and monitor all trips.</p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Create Trip
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveFilter(tab.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              activeFilter === tab.value
                ? "bg-brand-50 text-brand-600"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Trip list */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="divide-y divide-gray-200">
          {filteredTrips.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-gray-400">
              No trips match the current filter.
            </p>
          )}
          {filteredTrips.map((trip) => (
            <Link
              key={trip.id}
              href={`/dashboard/trips/${trip.id}`}
              className="flex items-center justify-between px-5 py-4 transition hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-gray-900">
                    {trip.stops.length} stop{trip.stops.length !== 1 && "s"}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[trip.status] || ""}`}
                  >
                    {trip.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-4 text-xs text-gray-400">
                  <span>
                    {trip.driverId ? `Driver: ${trip.driverId.slice(0, 8)}...` : "Unassigned"}
                  </span>
                  <span>{new Date(trip.createdAt).toLocaleDateString()}</span>
                  {trip.route && (
                    <span>
                      {(trip.route.distanceMeters / 1000).toFixed(1)} km
                    </span>
                  )}
                </div>
              </div>
              <svg
                className="h-5 w-5 flex-shrink-0 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
