import type { Trip, TripRoute, TripStop } from "@quickroutesai/shared";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TripETA {
  nextStop: TripStop | null;
  secondsToNextStop: number | null;
  totalRemainingSeconds: number | null;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function normalizeRoute(route: Trip["route"] | TripRoute[] | null | undefined): TripRoute | null {
  if (!route) return null;
  if (Array.isArray(route)) {
    const last = route.length > 0 ? route[route.length - 1] : null;
    return last ?? null;
  }
  return route;
}

export function computeTripETA(trip: Trip, currentPos?: LatLng | null): TripETA {
  const stops = Array.isArray(trip.stops) ? trip.stops : [];
  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);
  const remainingStops = sortedStops.filter((s) => s.status !== "completed");
  if (remainingStops.length === 0) {
    return { nextStop: null, secondsToNextStop: null, totalRemainingSeconds: null };
  }
  const nextStop = remainingStops[0];

  const route = normalizeRoute(trip.route);
  if (!route) {
    return { nextStop, secondsToNextStop: null, totalRemainingSeconds: null };
  }

  const legs = Array.isArray(route.legs) ? route.legs : [];
  const nextLegIdx = legs.findIndex((leg) => leg.toStopId === nextStop.stopId);

  const remainingStopIdsAfterNext = new Set(remainingStops.slice(1).map((s) => s.stopId));
  const futureLegsDuration = legs
    .filter((leg) => leg.toStopId !== undefined && remainingStopIdsAfterNext.has(leg.toStopId))
    .reduce((sum, leg) => sum + leg.durationSeconds, 0);

  let secondsToNextStop: number | null = null;

  if (nextLegIdx >= 0) {
    const leg = legs[nextLegIdx];
    if (currentPos && leg.distanceMeters > 0) {
      const remainingMeters = haversineMeters(currentPos, { lat: nextStop.lat, lng: nextStop.lng });
      const fraction = Math.max(0, Math.min(1, remainingMeters / leg.distanceMeters));
      secondsToNextStop = Math.round(leg.durationSeconds * fraction);
    } else {
      secondsToNextStop = leg.durationSeconds;
    }
  } else if (route.durationSeconds > 0) {
    secondsToNextStop = Math.round(route.durationSeconds / sortedStops.length);
  }

  const totalRemainingSeconds =
    secondsToNextStop != null ? secondsToNextStop + futureLegsDuration : null;

  return { nextStop, secondsToNextStop, totalRemainingSeconds };
}

export function formatDurationShort(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatArrivalTime(secondsFromNow: number, now: Date = new Date()): string {
  const arrival = new Date(now.getTime() + secondsFromNow * 1000);
  return arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
