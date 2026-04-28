"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { decodePolyline, formatDistance, formatDuration } from "@/lib/utils";
import type { TripStop, TripRoute } from "@quickroutesai/shared";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
const DEFAULT_CENTER = { lat: 40.7128, lng: -74.006 };
const FUEL_PRICE_PER_GAL = 3.5;
const METERS_PER_MILE = 1609.344;
const MPG = 27.7;

interface Props {
  stops: TripStop[];
  route: TripRoute;
}

// ── Straight-line polyline for naive stop order ───────────────────────────────
function NaivePolyline({ stops }: { stops: TripStop[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");

  useEffect(() => {
    if (!map || !mapsLib || stops.length < 2) return;
    const path = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    const polyline = new mapsLib.Polyline({
      path,
      strokeColor: "#6b7280",
      strokeWeight: 3,
      strokeOpacity: 0.75,
      map,
    });
    return () => polyline.setMap(null);
  }, [map, mapsLib, stops]);

  return null;
}

// ── Optimized encoded-polyline renderer ───────────────────────────────────────
function OptimizedPolyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");

  useEffect(() => {
    if (!map || !mapsLib || path.length === 0) return;
    const polyline = new mapsLib.Polyline({
      path,
      strokeColor: "#3b82f6",
      strokeWeight: 4,
      strokeOpacity: 0.85,
      map,
    });
    return () => polyline.setMap(null);
  }, [map, mapsLib, path]);

  return null;
}

// ── Auto-fit bounds to a set of lat/lng points ────────────────────────────────
function BoundsFitter({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !coreLib || points.length === 0) return;
    const bounds = new coreLib.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
  }, [map, coreLib, points]);

  return null;
}

// ── Pin colours ───────────────────────────────────────────────────────────────
function pinColors(index: number, total: number) {
  if (index === 0) return { bg: "#22c55e", glyph: "#fff", border: "#16a34a" };
  if (index === total - 1) return { bg: "#ef4444", glyph: "#fff", border: "#dc2626" };
  return { bg: "#6b7280", glyph: "#fff", border: "#4b5563" };
}

function optPinColors(index: number, total: number) {
  if (index === 0) return { bg: "#22c55e", glyph: "#fff", border: "#16a34a" };
  if (index === total - 1) return { bg: "#ef4444", glyph: "#fff", border: "#dc2626" };
  return { bg: "#3b82f6", glyph: "#fff", border: "#2563eb" };
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label,
  original,
  optimized,
  savings,
  savingsPositive = true,
}: {
  label: string;
  original: string;
  optimized: string;
  savings?: string;
  savingsPositive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-400">Original</p>
          <p className="mt-0.5 text-sm font-medium text-gray-500 line-through decoration-gray-300">
            {original}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Optimized</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">{optimized}</p>
        </div>
      </div>
      {savings && (
        <p
          className={`mt-2 text-xs font-medium ${savingsPositive ? "text-green-600" : "text-red-500"}`}
        >
          {savings}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RouteComparisonView({ stops, route }: Props) {
  const [activeTab, setActiveTab] = useState<"maps" | "diff">("maps");

  // Naive stop order: use route.input if available, otherwise original stops array order
  const naiveStops = useMemo<TripStop[]>(() => {
    if (route.input && route.input.length > 0) return route.input;
    return stops;
  }, [route.input, stops]);

  // Optimized stop order: sorted by sequence
  const optimizedStops = useMemo(
    () => stops.slice().sort((a, b) => a.sequence - b.sequence),
    [stops],
  );

  // Decode the encoded polyline for the optimized route
  const optimizedPath = useMemo(
    () => (route.polyline ? decodePolyline(route.polyline) : []),
    [route.polyline],
  );

  // Naive route: straight lines between stops in original order
  const naivePoints = useMemo(
    () => naiveStops.filter((s) => s.lat !== 0 || s.lng !== 0).map((s) => ({ lat: s.lat, lng: s.lng })),
    [naiveStops],
  );

  // ── Stats ──────────────────────────────────────────────────────────────────
  const optimizedDistM = route.distanceMeters;
  const naiveDistM = route.naiveDistanceMeters ?? null;
  const optimizedDurS = route.durationSeconds;

  const distSavingsM = naiveDistM !== null ? naiveDistM - optimizedDistM : null;
  const distSavingsPct =
    naiveDistM && naiveDistM > 0 ? Math.round((distSavingsM! / naiveDistM) * 100) : null;

  // Estimate naive duration proportionally if we have distance ratio
  const naiveDurS =
    naiveDistM && optimizedDistM > 0
      ? Math.round(optimizedDurS * (naiveDistM / optimizedDistM))
      : null;
  const durSavingsS = naiveDurS !== null ? naiveDurS - optimizedDurS : null;

  // Fuel & cost
  const optimizedFuelGal = optimizedDistM / METERS_PER_MILE / MPG;
  const naiveFuelGal = naiveDistM ? naiveDistM / METERS_PER_MILE / MPG : null;
  const fuelSavingsGal = route.fuelSavingsGallons ?? (naiveFuelGal ? naiveFuelGal - optimizedFuelGal : null);
  const costSavings = fuelSavingsGal ? fuelSavingsGal * FUEL_PRICE_PER_GAL : null;

  // ── Stop diff ─────────────────────────────────────────────────────────────
  const stopDiff = useMemo(() => {
    return optimizedStops.map((optStop, optIdx) => {
      const naiveIdx = naiveStops.findIndex((s) => s.stopId === optStop.stopId);
      const delta = naiveIdx === -1 ? 0 : naiveIdx - optIdx;
      return { stop: optStop, naivePos: naiveIdx + 1, optPos: optIdx + 1, delta };
    });
  }, [optimizedStops, naiveStops]);

  const mapCenter =
    optimizedStops.length > 0
      ? { lat: optimizedStops[0].lat, lng: optimizedStops[0].lng }
      : DEFAULT_CENTER;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Route Comparison</h2>
            <p className="text-xs text-gray-400">Original order vs AI-optimized route</p>
          </div>
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            {(["maps", "diff"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-brand-600 text-white"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {tab === "maps" ? "Split Map" : "Stop Diff"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4 border-b border-gray-100 bg-gray-50">
        <StatCard
          label="Distance"
          original={naiveDistM ? formatDistance(naiveDistM) : "--"}
          optimized={formatDistance(optimizedDistM)}
          savings={
            distSavingsM && distSavingsPct
              ? `↓ ${formatDistance(distSavingsM)} saved (${distSavingsPct}%)`
              : undefined
          }
        />
        <StatCard
          label="Est. Duration"
          original={naiveDurS ? formatDuration(naiveDurS) : "--"}
          optimized={formatDuration(optimizedDurS)}
          savings={durSavingsS ? `↓ ${formatDuration(durSavingsS)} saved` : undefined}
        />
        <StatCard
          label="Fuel"
          original={naiveFuelGal ? `${naiveFuelGal.toFixed(2)} gal` : "--"}
          optimized={`${optimizedFuelGal.toFixed(2)} gal`}
          savings={fuelSavingsGal ? `↓ ${fuelSavingsGal.toFixed(2)} gal saved` : undefined}
        />
        <StatCard
          label="Est. Cost"
          original={naiveFuelGal ? `$${(naiveFuelGal * FUEL_PRICE_PER_GAL).toFixed(2)}` : "--"}
          optimized={`$${(optimizedFuelGal * FUEL_PRICE_PER_GAL).toFixed(2)}`}
          savings={costSavings ? `↓ $${costSavings.toFixed(2)} saved` : undefined}
        />
      </div>

      {/* Tab content */}
      {activeTab === "maps" ? (
        MAPS_KEY ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
            {/* Original order map */}
            <div>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
                <p className="text-xs font-medium text-gray-500">Original Order</p>
              </div>
              <APIProvider apiKey={MAPS_KEY}>
                <div className="h-[280px] sm:h-[340px]">
                  <Map
                    defaultCenter={mapCenter}
                    defaultZoom={12}
                    style={{ width: "100%", height: "100%" }}
                    mapId="quickroutesai-comparison-naive"
                    gestureHandling="greedy"
                    disableDefaultUI
                  >
                    <BoundsFitter points={naivePoints} />
                    {naivePoints.length >= 2 && <NaivePolyline stops={naiveStops} />}
                    {naiveStops.map((stop, idx) => {
                      const c = pinColors(idx, naiveStops.length);
                      return (
                        <AdvancedMarker key={stop.stopId} position={{ lat: stop.lat, lng: stop.lng }}>
                          <Pin background={c.bg} glyphColor={c.glyph} borderColor={c.border}>
                            <span style={{ fontSize: 10, fontWeight: 700 }}>{idx + 1}</span>
                          </Pin>
                        </AdvancedMarker>
                      );
                    })}
                  </Map>
                </div>
              </APIProvider>
            </div>

            {/* Optimized map */}
            <div>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <p className="text-xs font-medium text-blue-600">AI-Optimized</p>
              </div>
              <APIProvider apiKey={MAPS_KEY}>
                <div className="h-[280px] sm:h-[340px]">
                  <Map
                    defaultCenter={mapCenter}
                    defaultZoom={12}
                    style={{ width: "100%", height: "100%" }}
                    mapId="quickroutesai-comparison-opt"
                    gestureHandling="greedy"
                    disableDefaultUI
                  >
                    <BoundsFitter points={optimizedPath.length > 0 ? optimizedPath : optimizedStops.map((s) => ({ lat: s.lat, lng: s.lng }))} />
                    {optimizedPath.length > 0 && <OptimizedPolyline path={optimizedPath} />}
                    {optimizedStops.map((stop, idx) => {
                      const c = optPinColors(idx, optimizedStops.length);
                      return (
                        <AdvancedMarker key={stop.stopId} position={{ lat: stop.lat, lng: stop.lng }}>
                          <Pin background={c.bg} glyphColor={c.glyph} borderColor={c.border}>
                            <span style={{ fontSize: 10, fontWeight: 700 }}>{idx + 1}</span>
                          </Pin>
                        </AdvancedMarker>
                      );
                    })}
                  </Map>
                </div>
              </APIProvider>
            </div>
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Set NEXT_PUBLIC_GOOGLE_MAPS_KEY to enable maps
          </div>
        )
      ) : (
        /* Stop diff view */
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-400">
            Showing how AI reordered stops. Arrows indicate position changes.
          </p>
          <div className="space-y-2">
            {stopDiff.map(({ stop, naivePos, optPos, delta }) => (
              <div
                key={stop.stopId}
                className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
              >
                {/* Position badges */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-500">
                    {naivePos}
                  </span>
                  <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                    {optPos}
                  </span>
                </div>

                {/* Address */}
                <p className="flex-1 truncate text-sm text-gray-700">{stop.address}</p>

                {/* Delta badge */}
                {delta !== 0 && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      delta > 0
                        ? "bg-green-50 text-green-600"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    {delta > 0 ? `↑ ${delta}` : `↓ ${Math.abs(delta)}`}
                  </span>
                )}
                {delta === 0 && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400">
                    same
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* AI reasoning */}
          {route.reasoning && (
            <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">AI Reasoning</p>
              <p className="mt-1 text-sm text-gray-700">{route.reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
