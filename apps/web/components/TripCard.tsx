"use client";

import Link from "next/link";
import type { Trip } from "@quickroutesai/shared";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  assigned: "bg-blue-50 text-blue-600",
  in_progress: "bg-amber-50 text-amber-600",
  completed: "bg-green-50 text-green-600",
  cancelled: "bg-red-50 text-red-600",
};

/**
 * Human-friendly relative time ("just now", "5m ago", "2h ago", "3d ago").
 * Falls back to `MM/DD HH:mm` for anything older than ~7 days.
 */
function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export interface TripCardProps {
  trip: Trip;
  /** Resolved driver display name. If omitted, falls back to a shortened uid. */
  driverName?: string;
}

/**
 * A clickable trip summary card used on the dashboard's "Recent Trips" panel
 * and on the main trips listing page. Shows status, stop count, first stop
 * addresses, assigned driver, distance, and creation time.
 */
export function TripCard({ trip, driverName }: TripCardProps) {
  const stops = trip.stops ?? [];
  // Prefer the denormalized stopCount from the trip doc (list views subscribe
  // to the `trips` collection without reading the `stops` subcollection, so
  // `trip.stops` is undefined there). Fall back to the embedded array on
  // detail views that hydrate it.
  const stopCount = trip.stopCount ?? stops.length;
  const previewStops = stops.slice(0, 2);

  const distanceMiles =
    trip.route?.distanceMeters != null
      ? (trip.route.distanceMeters / 1609.344).toFixed(1)
      : null;

  const driverLabel = trip.driverId
    ? driverName ?? `${trip.driverId.slice(0, 8)}...`
    : "Unassigned";

  return (
    <Link
      href={`/dashboard/trips/${trip.id}`}
      className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      {/* Header row: trip id, status, created time */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-gray-400">
          #{trip.id.slice(-6)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            statusColors[trip.status] || "bg-gray-100 text-gray-600"
          }`}
        >
          {trip.status.replace("_", " ")}
        </span>
      </div>

      {/* Main: stop count + preview addresses */}
      <div className="mt-3 min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          {stopCount} stop{stopCount !== 1 && "s"}
        </p>
        {previewStops.length > 0 && (
          <ul className="mt-2 space-y-1">
            {previewStops.map((stop, idx) => (
              <li
                key={stop.stopId ?? idx}
                className="truncate text-xs text-gray-700"
                title={stop.address}
              >
                <span className="mr-1.5 text-gray-400">{idx + 1}.</span>
                {stop.address || "—"}
              </li>
            ))}
            {stopCount > previewStops.length && (
              <li className="text-xs text-gray-400">
                +{stopCount - previewStops.length} more
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Footer: driver + distance + created time */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-700">
        <span className="truncate">{driverLabel}</span>
        <div className="flex shrink-0 items-center gap-2 text-gray-400">
          {distanceMiles && <span>{distanceMiles} mi</span>}
          <span>{formatRelativeTime(trip.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}
