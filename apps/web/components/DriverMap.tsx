"use client";

import { useEffect, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { DriverRecord, UserProfile, Trip } from "@quickroutesai/shared";
import { useAuth } from "@/lib/auth-context";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

const DEFAULT_CENTER = { lat: 40.7128, lng: -74.006 };

interface Props {
  onSelectDriver?: (uid: string) => void;
}

function pinColors(isOnline: boolean, onTrip: boolean) {
  if (!isOnline) return { background: "#9ca3af", glyphColor: "#fff", borderColor: "#6b7280" };
  if (onTrip)   return { background: "#2563eb", glyphColor: "#fff", borderColor: "#1d4ed8" };
  return         { background: "#16a34a", glyphColor: "#fff", borderColor: "#15803d" };
}

function statusLabel(isOnline: boolean, onTrip: boolean) {
  if (!isOnline) return "Offline";
  if (onTrip)   return "On trip";
  return "Available";
}

export default function DriverMap({ onSelectDriver }: Props) {
  const { orgId } = useAuth();
  const [drivers, setDrivers]           = useState<(DriverRecord & { uid: string })[]>([]);
  const [onTripIds, setOnTripIds]       = useState<Set<string>>(new Set());
  const [userNames, setUserNames]       = useState<Record<string, string>>({});
  const [popupDriverId, setPopupDriverId] = useState<string | null>(null);

  // All org drivers (online + offline) — filter to those with a location at render time
  useEffect(() => {
    if (!orgId) { setDrivers([]); return; }
    const q = query(collection(firestore, "drivers"), where("orgId", "==", orgId));
    return onSnapshot(q, (snap) => {
      setDrivers(
        snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<DriverRecord, "uid">) })),
      );
    });
  }, [orgId]);

  // In-progress trips — used to determine which drivers are "on-trip"
  useEffect(() => {
    if (!orgId) { setOnTripIds(new Set()); return; }
    const q = query(
      collection(firestore, "trips"),
      where("orgId", "==", orgId),
      where("status", "==", "in_progress"),
    );
    return onSnapshot(q, (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const driverId = (d.data() as Trip).driverId;
        if (driverId) ids.add(driverId);
      });
      setOnTripIds(ids);
    });
  }, [orgId]);

  // Driver user profiles — for names in the popup
  useEffect(() => {
    if (!orgId) { setUserNames({}); return; }
    const q = query(
      collection(firestore, "users"),
      where("orgId", "==", orgId),
      where("role", "==", "driver"),
    );
    return onSnapshot(q, (snap) => {
      const names: Record<string, string> = {};
      snap.docs.forEach((d) => {
        names[d.id] = (d.data() as UserProfile).name;
      });
      setUserNames(names);
    });
  }, [orgId]);

  if (!MAPS_KEY) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
        Set NEXT_PUBLIC_GOOGLE_MAPS_KEY to enable the map
      </div>
    );
  }

  const driversWithLocation = drivers.filter((d) => d.lastLocation);

  const center =
    driversWithLocation.length > 0
      ? { lat: driversWithLocation[0].lastLocation!.lat, lng: driversWithLocation[0].lastLocation!.lng }
      : DEFAULT_CENTER;

  const popupDriver = popupDriverId
    ? driversWithLocation.find((d) => d.uid === popupDriverId) ?? null
    : null;

  return (
    <APIProvider apiKey={MAPS_KEY}>
      <Map
        defaultCenter={center}
        defaultZoom={12}
        style={{ width: "100%", height: "400px", borderRadius: "0.75rem 0.75rem 0 0" }}
        mapId="quickroutesai-dashboard"
        gestureHandling="greedy"
        disableDefaultUI
        onClick={() => setPopupDriverId(null)}
      >
        {driversWithLocation.map((driver) => {
          const onTrip = onTripIds.has(driver.uid);
          const colors = pinColors(driver.isOnline, onTrip);
          return (
            <AdvancedMarker
              key={driver.uid}
              position={{ lat: driver.lastLocation!.lat, lng: driver.lastLocation!.lng }}
              title={userNames[driver.uid] ?? driver.uid}
              onClick={() => {
                setPopupDriverId((prev) => (prev === driver.uid ? null : driver.uid));
                onSelectDriver?.(driver.uid);
              }}
            >
              <Pin
                background={colors.background}
                glyphColor={colors.glyphColor}
                borderColor={colors.borderColor}
              />
            </AdvancedMarker>
          );
        })}

        {popupDriver?.lastLocation && (
          <InfoWindow
            position={{ lat: popupDriver.lastLocation.lat, lng: popupDriver.lastLocation.lng }}
            onClose={() => setPopupDriverId(null)}
            pixelOffset={[0, -40]}
          >
            <div className="min-w-[160px] space-y-1 text-sm">
              <p className="font-semibold text-gray-900">
                {userNames[popupDriver.uid] ?? "Driver"}
              </p>
              <p className="text-xs text-gray-500">
                {statusLabel(popupDriver.isOnline, onTripIds.has(popupDriver.uid))}
              </p>
              {popupDriver.isOnline && popupDriver.lastSpeedMps > 0 && (
                <p className="text-xs text-gray-400">
                  {(popupDriver.lastSpeedMps * 2.237).toFixed(1)} mph
                </p>
              )}
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* Legend */}
      <div className="flex gap-5 rounded-b-xl border-t border-gray-100 bg-white px-4 py-2 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-600" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-600" />
          On trip
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />
          Offline
        </span>
      </div>
    </APIProvider>
  );
}
