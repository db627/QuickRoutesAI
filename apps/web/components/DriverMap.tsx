"use client";

import { useEffect, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { DriverRecord } from "@quickroutesai/shared";
import { useAuth } from "@/lib/auth-context";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

// Default center (NYC)
const DEFAULT_CENTER = { lat: 40.7128, lng: -74.006 };

interface Props {
  onSelectDriver?: (uid: string) => void;
}

export default function DriverMap({ onSelectDriver }: Props) {
  const { orgId } = useAuth();
  const [drivers, setDrivers] = useState<(DriverRecord & { uid: string })[]>([]);

  useEffect(() => {
    if (!orgId) {
      setDrivers([]);
      return;
    }
    // Subscribe to all online drivers in the current org in real time
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
