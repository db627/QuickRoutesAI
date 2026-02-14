"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
} from "firebase/firestore";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { firestore } from "@/lib/firebase";
import { apiFetch } from "@/lib/api";
import { decodePolyline, formatDistance, formatDuration } from "@/lib/utils";
import type { Trip, DriverRecord } from "@quickroutesai/shared";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
const DEFAULT_CENTER = { lat: 40.7128, lng: -74.006 };

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  assigned: "bg-blue-50 text-blue-600",
  in_progress: "bg-green-50 text-green-600",
  completed: "bg-purple-50 text-purple-600",
};

/* ------------------------------------------------------------------ */
/*  Route polyline rendered via the Maps JS Polyline class             */
/* ------------------------------------------------------------------ */
function RoutePolyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");

  useEffect(() => {
    if (!map || !mapsLib || path.length === 0) return;
    const polyline = new mapsLib.Polyline({
      path,
      strokeColor: "#3b82f6",
      strokeWeight: 4,
      strokeOpacity: 0.8,
      map,
    });
    return () => {
      polyline.setMap(null);
    };
  }, [map, mapsLib, path]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Driver selector dropdown                                           */
/* ------------------------------------------------------------------ */
interface DriverOption {
  uid: string;
  isOnline: boolean;
}

function AssignDriverDropdown({
  tripId,
  currentDriverId,
  onAssigned,
}: {
  tripId: string;
  currentDriverId: string | null;
  onAssigned: () => void;
}) {
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    // Fetch drivers list from the API
    apiFetch<DriverOption[]>("/drivers")
      .then(setDrivers)
      .catch(() => {
        // Fallback: subscribe to the drivers collection
        const q = query(collection(firestore, "drivers"));
        const unsub = onSnapshot(q, (snap) => {
          setDrivers(
            snap.docs.map((d) => ({
              uid: d.id,
              isOnline: (d.data() as DriverRecord).isOnline,
            })),
          );
        });
        return unsub;
      });
  }, []);

  const assign = async (driverId: string) => {
    setAssigning(true);
    try {
      await apiFetch(`/trips/${tripId}/assign`, {
        method: "POST",
        body: JSON.stringify({ driverId }),
      });
      onAssigned();
      setOpen(false);
    } catch (err) {
      console.error("Failed to assign driver", err);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:border-gray-300"
      >
        {currentDriverId ? "Reassign Driver" : "Assign Driver"}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="max-h-60 overflow-y-auto divide-y divide-gray-200">
            {drivers.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400">No drivers found</p>
            )}
            {drivers.map((d) => (
              <button
                key={d.uid}
                onClick={() => assign(d.uid)}
                disabled={assigning}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50"
              >
                <span className="truncate">{d.uid.slice(0, 16)}...</span>
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                    d.isOnline
                      ? "bg-green-50 text-green-600"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {d.isOnline ? "Online" : "Offline"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */
export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState("");

  // Subscribe to trip document in real-time
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(firestore, "trips", id), (snap) => {
      if (snap.exists()) {
        setTrip({ id: snap.id, ...(snap.data() as Omit<Trip, "id">) });
      } else {
        setTrip(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [id]);

  // Subscribe to driver's live position when driver is assigned
  useEffect(() => {
    if (!trip?.driverId) {
      setDriverPos(null);
      return;
    }
    const unsub = onSnapshot(doc(firestore, "drivers", trip.driverId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as DriverRecord;
        if (data.isOnline && data.lastLocation) {
          setDriverPos({ lat: data.lastLocation.lat, lng: data.lastLocation.lng });
        } else {
          setDriverPos(null);
        }
      }
    });
    return unsub;
  }, [trip?.driverId]);

  const computeRoute = useCallback(async () => {
    if (!id) return;
    setComputing(true);
    setError("");
    try {
      await apiFetch(`/trips/${id}/route`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compute route");
    } finally {
      setComputing(false);
    }
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <p className="text-gray-500">Trip not found.</p>
        <Link
          href="/dashboard/trips"
          className="text-sm text-brand-600 hover:underline"
        >
          Back to trips
        </Link>
      </div>
    );
  }

  // Decode route polyline if available
  const polylinePath = trip.route?.polyline ? decodePolyline(trip.route.polyline) : [];

  // Determine map center from first stop or default
  const mapCenter =
    trip.stops.length > 0
      ? { lat: trip.stops[0].lat, lng: trip.stops[0].lng }
      : DEFAULT_CENTER;

  // Stop marker color helper
  const stopPinColors = (index: number, total: number) => {
    if (index === 0) return { bg: "#22c55e", glyph: "#fff", border: "#16a34a" }; // green
    if (index === total - 1) return { bg: "#ef4444", glyph: "#fff", border: "#dc2626" }; // red
    return { bg: "#3b82f6", glyph: "#fff", border: "#2563eb" }; // blue
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/trips"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900"
          >
            &larr; Back
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Trip Detail</h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[trip.status] || ""}`}
              >
                {trip.status.replace("_", " ")}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-400">ID: {trip.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!trip.route && (
            <button
              onClick={computeRoute}
              disabled={computing}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {computing ? "Computing..." : "Compute Route"}
            </button>
          )}
          <AssignDriverDropdown
            tripId={trip.id}
            currentDriverId={trip.driverId}
            onAssigned={() => {}}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Metadata cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Status</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900 capitalize">
            {trip.status.replace("_", " ")}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Driver</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">
            {trip.driverId ? trip.driverId.slice(0, 12) + "..." : "Unassigned"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Distance</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">
            {trip.route ? formatDistance(trip.route.distanceMeters) : "--"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Duration</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">
            {trip.route ? formatDuration(trip.route.durationSeconds) : "--"}
          </p>
        </div>
      </div>

      {/* Map */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {MAPS_KEY ? (
          <APIProvider apiKey={MAPS_KEY}>
            <Map
              defaultCenter={mapCenter}
              defaultZoom={13}
              style={{ width: "100%", height: "500px" }}
              mapId="quickroutesai-trip-detail"
              gestureHandling="greedy"
              disableDefaultUI
            >
              {/* Route polyline */}
              {polylinePath.length > 0 && <RoutePolyline path={polylinePath} />}

              {/* Stop markers */}
              {trip.stops
                .slice()
                .sort((a, b) => a.sequence - b.sequence)
                .map((stop, idx) => {
                  const colors = stopPinColors(idx, trip.stops.length);
                  return (
                    <AdvancedMarker
                      key={stop.stopId}
                      position={{ lat: stop.lat, lng: stop.lng }}
                      title={`Stop ${idx + 1}: ${stop.address}`}
                    >
                      <Pin
                        background={colors.bg}
                        glyphColor={colors.glyph}
                        borderColor={colors.border}
                        glyph={String(idx + 1)}
                      />
                    </AdvancedMarker>
                  );
                })}

              {/* Driver live position */}
              {driverPos && (
                <AdvancedMarker
                  position={driverPos}
                  title="Driver (live)"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand-600 shadow-lg">
                    <svg
                      className="h-4 w-4 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616L18 10.804V17a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3H8v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-6.196l1.786-3.293-1.233-.616a1 1 0 01.894-1.79l1.599.8L9 4.323V3a1 1 0 011-1z" />
                    </svg>
                  </div>
                </AdvancedMarker>
              )}
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-[500px] items-center justify-center text-gray-400">
            Set NEXT_PUBLIC_GOOGLE_MAPS_KEY to enable the map
          </div>
        )}
      </div>

      {/* Stop list */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="font-semibold text-gray-900">
            Stops ({trip.stops.length})
          </h2>
        </div>
        <div className="divide-y divide-gray-200">
          {trip.stops
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((stop, idx) => (
              <div key={stop.stopId} className="flex items-start gap-4 px-5 py-4">
                <div
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    idx === 0
                      ? "bg-green-600"
                      : idx === trip.stops.length - 1
                        ? "bg-red-600"
                        : "bg-blue-600"
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{stop.address}</p>
                  <p className="text-xs text-gray-400">
                    {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                  </p>
                  {stop.notes && (
                    <p className="mt-1 text-xs text-gray-500">{stop.notes}</p>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Created / Updated */}
      <div className="flex gap-6 text-xs text-gray-400">
        <span>Created: {new Date(trip.createdAt).toLocaleString()}</span>
        <span>Updated: {new Date(trip.updatedAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
