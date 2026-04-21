"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Trip, TripStatus } from "@quickroutesai/shared";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { TripCard } from "@/components/TripCard";

type TripTab = "active" | "completed" | "cancelled" | "all";

const TAB_ORDER: TripTab[] = ["active", "completed", "cancelled", "all"];

const TAB_LABELS: Record<TripTab, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  all: "All",
};

// Which trip statuses belong to each tab. "active" means the trip is still
// moving through the pipeline (draft, assigned, in_progress) — the opposite
// of a terminal state.
const ACTIVE_STATUSES: TripStatus[] = ["draft", "assigned", "in_progress"];

function matchesTab(tab: TripTab, status: TripStatus): boolean {
  switch (tab) {
    case "active":
      return ACTIVE_STATUSES.includes(status);
    case "completed":
      return status === "completed";
    case "cancelled":
      return status === "cancelled";
    case "all":
      return true;
  }
}

function parseTab(raw: string | null): TripTab {
  if (raw === "completed" || raw === "cancelled" || raw === "all" || raw === "active") {
    return raw;
  }
  return "active";
}

function TripsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  // Tab presets replace the old per-status dropdown. Default is "active" so
  // completed + cancelled trips don't clutter the primary view.
  const [tab, setTab] = useState<TripTab>(parseTab(searchParams.get("tab")));

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

  function updateUrl(nextSearch: string, nextTab: TripTab) {
    const params = new URLSearchParams();
    if (nextSearch) params.set("search", nextSearch);
    // Default tab is "active"; omit it to keep URLs clean.
    if (nextTab !== "active") params.set("tab", nextTab);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    updateUrl(value, tab);
  }

  function handleTabChange(nextTab: TripTab) {
    setTab(nextTab);
    updateUrl(search, nextTab);
  }

  function clearSearch() {
    setSearch("");
    updateUrl("", tab);
  }

  const filteredTrips = useMemo(
    () =>
      trips
        .filter((trip) => {
          if (!matchesTab(tab, trip.status)) return false;
          const term = search.trim().toLowerCase();
          if (term === "") return true;
          // Match against stop addresses (when available on the detail shape)
          // and the trip id so dispatchers can deep-link by id fragment.
          const matchesId = trip.id.toLowerCase().includes(term);
          const matchesAddress = (trip.stops ?? []).some((s) =>
            (s.address?.toLowerCase() ?? "").includes(term),
          );
          return matchesId || matchesAddress;
        })
        // Defensive newest-first sort. The Firestore query already orders by
        // createdAt desc, but we re-sort here so the UI is correct even if
        // the source data arrives in a different order (ISO 8601 sorts
        // lexicographically).
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [trips, search, tab],
  );

  const hasSearch = search.trim() !== "";

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

      {/* Tabs */}
      <div className="border-b border-gray-200" role="tablist" aria-label="Trip status filter">
        <nav className="-mb-px flex gap-6">
          {TAB_ORDER.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => handleTabChange(t)}
                className={`border-b-2 px-1 pb-3 pt-1 text-sm font-medium transition-colors ${
                  active
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Search toolbar */}
      <div className="flex flex-wrap items-center gap-3">
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
            placeholder="Search by trip id or stop address..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            aria-label="Search trips by trip id or stop address"
          />
        </div>
        {hasSearch && (
          <button
            onClick={clearSearch}
            className="text-xs text-gray-500 underline hover:text-gray-900"
          >
            Clear search
          </button>
        )}
      </div>

      {/* Trip cards */}
      {loading ? (
        <div
          data-testid="trip-card-grid"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <SkeletonBlock className="h-3 w-16" />
                <SkeletonBlock className="h-5 w-20 rounded-full" />
              </div>
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-3/4" />
              <div className="flex items-center justify-between pt-1">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredTrips.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-12 text-center">
          <p className="text-sm font-medium text-gray-500">No trips found</p>
          {(hasSearch || tab !== "active") && (
            <p className="mt-1 text-xs text-gray-400">
              Try a different tab{hasSearch ? " or clear your search" : ""}.
              {hasSearch && (
                <>
                  {" "}
                  <button
                    onClick={clearSearch}
                    className="text-brand-600 hover:underline"
                  >
                    Clear search
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        <div
          data-testid="trip-card-grid"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {filteredTrips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
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
