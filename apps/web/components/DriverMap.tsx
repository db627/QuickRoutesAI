"use client";

import React, { useEffect, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { DriverRecord, TripStop, TripRoute } from "@quickroutesai/shared";
import { useAuth } from "@/lib/auth-context";
import { decodePolyline, formatDuration } from "@/lib/utils";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

const DEFAULT_CENTER = { lat: 40.7128, lng: -74.006 };

interface Props {
  onSelectDriver?: (uid: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Route polyline renderer                                            */
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
    return () => polyline.setMap(null);
  }, [map, mapsLib, path]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Single trip's route + stop markers                                 */
/* ------------------------------------------------------------------ */
function TripRouteOverlay({ tripId, route }: { tripId: string; route: TripRoute }) {
  const [stops, setStops] = useState<TripStop[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(firestore, "trips", tripId, "stops"),
      (snap) => {
        const docs = snap.docs.map((d) => ({
          stopId: d.id,
          ...(d.data() as Omit<TripStop, "stopId">),
        }));
        docs.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        setStops(docs);
      },
    );
    return unsub;
  }, [tripId]);

  const polylinePath = decodePolyline(route.polyline);
  const nextStopIdx = stops.findIndex((s) => s.status !== "completed");

  const etaToNextStopSec = (() => {
    if (nextStopIdx <= 0 || !route.legs?.length) return null;
    const leg = route.legs.find((l) => l.toIndex === nextStopIdx);
    return leg?.durationSeconds ?? null;
  })();

  return (
    <>
      <RoutePolyline path={polylinePath} />
      {stops.map((stop, idx) => {
        if (!stop.lat || !stop.lng) return null;
        const isCompleted = stop.status === "completed";
        const isNext = idx === nextStopIdx;

        return (
          <React.Fragment key={stop.stopId}>
            <AdvancedMarker
              position={{ lat: stop.lat, lng: stop.lng }}
              title={`Stop ${idx + 1}: ${stop.address}`}
              onClick={() =>
                setSelectedStopId((prev) =>
                  prev === stop.stopId ? null : stop.stopId,
                )
              }
            >
              {isNext ? (
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-9 w-9 rounded-full bg-orange-400 animate-ping opacity-60" />
                  <div className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-orange-500 text-xs font-bold text-white shadow-lg">
                    {idx + 1}
                  </div>
                </div>
              ) : (
                <Pin
                  background={isCompleted ? "#22c55e" : "#ef4444"}
                  glyphColor="#fff"
                  borderColor={isCompleted ? "#16a34a" : "#dc2626"}
                  glyph={isCompleted ? "✓" : String(idx + 1)}
                />
              )}
            </AdvancedMarker>
            {selectedStopId === stop.stopId && (
              <InfoWindow
                position={{ lat: stop.lat, lng: stop.lng }}
                onClose={() => setSelectedStopId(null)}
                pixelOffset={[0, -40]}
              >
                <div className="min-w-[160px] space-y-1 text-sm">
                  <p className="font-semibold text-gray-900">Stop {idx + 1}</p>
                  <p className="text-gray-600">{stop.address}</p>
                  {isCompleted && stop.completedAt && (
                    <p className="text-xs text-green-600">
                      Completed{" "}
                      {new Date(stop.completedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                  {isNext && etaToNextStopSec != null && (
                    <p className="text-xs font-semibold text-orange-600">
                      ETA: ~{formatDuration(etaToNextStopSec)}
                    </p>
                  )}
                </div>
              </InfoWindow>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Subscribes to all in_progress trips and renders their overlays    */
/* ------------------------------------------------------------------ */
function ActiveTripOverlays({ orgId }: { orgId: string }) {
  const [trips, setTrips] = useState<{ id: string; route: TripRoute }[]>([]);

  useEffect(() => {
    const q = query(
      collection(firestore, "trips"),
      where("orgId", "==", orgId),
      where("status", "==", "in_progress"),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, route: d.data().route as TripRoute | null }))
        .filter((t): t is { id: string; route: TripRoute } => t.route?.polyline != null);
      setTrips(list);
    });
    return unsub;
  }, [orgId]);

  return (
    <>
      {trips.map((trip) => (
        <TripRouteOverlay key={trip.id} tripId={trip.id} route={trip.route} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main map component                                                 */
/* ------------------------------------------------------------------ */
export default function DriverMap({ onSelectDriver }: Props) {
  const { orgId } = useAuth();
  const [drivers, setDrivers] = useState<(DriverRecord & { uid: string })[]>([]);

  useEffect(() => {
    if (!orgId) {
      setDrivers([]);
      return;
    }
    const q = query(
      collection(firestore, "drivers"),
      where("orgId", "==", orgId),
      where("isOnline", "==", true),
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        uid: doc.id,
        ...(doc.data() as Omit<DriverRecord, "uid">),
      }));
      setDrivers(list);
    });
    return unsub;
  }, [orgId]);

  if (!MAPS_KEY) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
        Set NEXT_PUBLIC_GOOGLE_MAPS_KEY to enable the map
      </div>
    );
  }

  const center =
    drivers.length > 0 && drivers[0].lastLocation
      ? { lat: drivers[0].lastLocation.lat, lng: drivers[0].lastLocation.lng }
      : DEFAULT_CENTER;

  return (
    <APIProvider apiKey={MAPS_KEY}>
      <Map
        defaultCenter={center}
        defaultZoom={12}
        style={{ width: "100%", height: "400px", borderRadius: "0.75rem" }}
        mapId="quickroutesai-dashboard"
        gestureHandling="greedy"
        disableDefaultUI
      >
        {/* Active trip route overlays: polylines + colored stop markers */}
        {orgId && <ActiveTripOverlays orgId={orgId} />}

        {/* Online driver position markers */}
        {drivers.map((driver) =>
          driver.lastLocation ? (
            <AdvancedMarker
              key={driver.uid}
              position={{ lat: driver.lastLocation.lat, lng: driver.lastLocation.lng }}
              title={driver.uid}
              onClick={() => onSelectDriver?.(driver.uid)}
            >
              <Pin background="#2563eb" glyphColor="#fff" borderColor="#1d4ed8" />
            </AdvancedMarker>
          ) : null,
        )}
      </Map>
    </APIProvider>
  );
}
