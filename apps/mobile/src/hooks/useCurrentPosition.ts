import { useEffect, useState } from "react";
import * as Location from "expo-location";

export interface CurrentPosition {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface UseCurrentPositionOptions {
  enabled?: boolean;
  intervalMs?: number;
  distanceMeters?: number;
}

export function useCurrentPosition({
  enabled = true,
  intervalMs = 5000,
  distanceMeters = 10,
}: UseCurrentPositionOptions = {}): CurrentPosition | null {
  const [position, setPosition] = useState<CurrentPosition | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;

      try {
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!cancelled) {
          setPosition({
            lat: initial.coords.latitude,
            lng: initial.coords.longitude,
            timestamp: initial.timestamp,
          });
        }
      } catch (err) {
        console.warn("Failed to read initial position:", err);
      }

      if (cancelled) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: intervalMs,
          distanceInterval: distanceMeters,
        },
        (loc) => {
          setPosition({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            timestamp: loc.timestamp,
          });
        },
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, intervalMs, distanceMeters]);

  return position;
}
