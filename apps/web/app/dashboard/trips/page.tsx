"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Trip, TripStatus } from "@quickroutesai/shared";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  assigned: "bg-blue-50 text-blue-600",
  in_progress: "bg-green-50 text-green-600",
  completed: "bg-purple-50 text-purple-600",
  cancelled: "bg-red-50 text-red-600",
};

const statusOptions: { label: string; value: TripStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Assigned", value: "assigned" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

function TripsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<TripStatus | "all">(
    (searchParams.get("status") ?? "all") as TripStatus | "all",
  );

  useEffect(() => {
    const q = query(collection(firestore, "trips"), orderBy("createdAt", "desc"));
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

  function updateUrl(nextSearch: string, nextStatus: TripStatus | "all") {
    const params = new URLSearchParams();
    if (nextSearch) params.set("search", nextSearch);
    if (nextStatus !== "all") params.set("status", nextStatus);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    updateUrl(value, statusFilter);
  }

  function handleStatusChange(value: TripStatus | "all") {
    setStatusFilter(value);
    updateUrl(search, value);
  }

  function clearSearch() {
    setSearch("");
    updateUrl("", statusFilter);
  }

  function clearStatus() {
    setStatusFilter("all");
    updateUrl(search, "all");
  }

  function clearAll() {
    setSearch("");
    setStatusFilter("all");
    updateUrl("", "all");
  }

  const filteredTrips = useMemo(
    () =>
      trips.filter((trip) => {
        const matchesStatus = statusFilter === "all" || trip.status === statusFilter;
        const term = search.trim().toLowerCase();
        const matchesSearch =
          term === "" ||
          (trip.stops ?? []).some((s) =>
            (s.address?.toLowerCase() ?? "").includes(term),
          );
        return matchesStatus && matchesSearch;
      }),
    [trips, search, statusFilter],
  );

  const hasSearch = search.trim() !== "";
  const hasStatusFilter = statusFilter !== "all";
  const hasActiveFilters = hasSearch || hasStatusFilter;

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

      {/* Search + filter toolbar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search input */}
          <div className="relative min-w-[200px] flex-1">
            <svg
              className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by stop address..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              aria-label="Search trips by stop address"
            />
          </div>

          {/* Status dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value as TripStatus | "all")}
            className="rounded-lg border border-gray-200 py-2 pl-3 pr-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            aria-label="Filter by status"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            {hasSearch && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                Search: &ldquo;{search}&rdquo;
                <button
                  onClick={clearSearch}
                  aria-label="Clear search filter"
                  className="ml-1 rounded-full hover:text-brand-900"
                >
                  &times;
                </button>
              </span>
            )}
            {hasStatusFilter && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                Status: {statusOptions.find((o) => o.value === statusFilter)?.label}
                <button
                  onClick={clearStatus}
                  aria-label="Clear status filter"
                  className="ml-1 rounded-full hover:text-brand-900"
                >
                  &times;
                </button>
              </span>
            )}
            {hasSearch && hasStatusFilter && (
              <button
                onClick={clearAll}
                className="text-xs text-gray-500 underline hover:text-gray-900"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Trip list */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="divide-y divide-gray-200">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <SkeletonBlock className="h-3.5 w-16" />
                    <SkeletonBlock className="h-5 w-20 rounded-full" />
                  </div>
                  <div className="flex items-center gap-4">
                    <SkeletonBlock className="h-3 w-28" />
                    <SkeletonBlock className="h-3 w-16" />
                    <SkeletonBlock className="h-3 w-10" />
                  </div>
                </div>
                <SkeletonBlock className="h-5 w-5 flex-shrink-0" />
              </div>
            ))
          ) : filteredTrips.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-gray-500">No trips found</p>
              {hasActiveFilters && (
                <p className="mt-1 text-xs text-gray-400">
                  Try adjusting your search or filter.{" "}
                  <button
                    onClick={clearAll}
                    className="text-brand-600 hover:underline"
                  >
                    Clear filters
                  </button>
                </p>
              )}
            </div>
          ) : (
            filteredTrips.map((trip) => (
              <Link
                key={trip.id}
                href={`/dashboard/trips/${trip.id}`}
                className="flex items-center justify-between px-5 py-4 transition hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-gray-900">
                      {trip.stops?.length ?? 0} stop{(trip.stops?.length ?? 0) !== 1 && "s"}
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
                      <span>{(trip.route.distanceMeters / 1000).toFixed(1)} km</span>
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function TripsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
      }
    >
      <TripsPageInner />
    </Suspense>
  );
}
