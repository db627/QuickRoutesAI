import { Client, TravelMode, Status } from "@googlemaps/google-maps-services-js";
import type { TripRoute, TripStop, RouteLeg } from "@quickroutesai/shared";
import { optimizeStopOrder } from "./routeOptimizer";

const client = new Client({});

// Average fuel consumption: ~27.7 MPG (mid-size delivery vehicle ≈ 8.5 L/100km)
// Converted to gallons per meter: 1 / (27.7 * 1609.344) = ~0.00002243
const FUEL_CONSUMPTION_GAL_PER_M = 1 / (27.7 * 1609.344);

/**
 * Haversine distance between two lat/lng points in meters.
 */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Sum of straight-line distances between consecutive stops (naive routing estimate).
 * Multiply by 1.3 to approximate road distance from straight-line distance.
 */
function naiveTotalDistance(stops: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += haversineMeters(stops[i - 1], stops[i]);
  }
  return total * 1.3; // road-distance factor
}

function getApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_SERVER_KEY is not configured");
  }
  return apiKey;
}

/**
 * Geocode an address string into lat/lng coordinates using Google Geocoding API.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number }> {
  const apiKey = getApiKey();
  try {
    const response = await client.geocode({
      params: { address, key: apiKey },
    });

    if (response.data.status !== Status.OK || response.data.results.length === 0) {
      throw new Error(
        `Geocoding failed for "${address}": ${response.data.status}` +
          (response.data.error_message ? ` - ${response.data.error_message}` : ""),
      );
    }

    const { lat, lng } = response.data.results[0].geometry.location;
    return { lat, lng };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Geocoding failed")) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Geocoding request failed for "${address}": ${msg}`);
  }
}

export interface ComputeRouteResult {
  route: TripRoute;
  /** Stops reordered by the optimizer with updated sequence numbers. */
  optimizedStops: TripStop[];
}

interface RouteOrigin {
  lat: number;
  lng: number;
}

const routeCache = new Map<string, { expiresAt: number; value: ComputeRouteResult }>();


function buildRouteCacheKey(
  stops: TripStop[],
  originOverride?: RouteOrigin
): string {
  return JSON.stringify({
    originOverride: originOverride
      ? { lat: originOverride.lat, lng: originOverride.lng }
      : null,
    stops: stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        lat: s.lat,
        lng: s.lng,
        sequence: s.sequence,
      })),
  });
}

function durationStrToSeconds(v?: string): number {
  if (!v) return 0;
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(v);
  return match ? Math.round(Number(match[1])) : 0;
}

/**
 * Compute an optimized route through stops.
 * 1. OpenAI reorders stops for the best driving order (origin stays first).
 * 2. Google Directions computes the actual route along the optimized order.
 * Returns both the route and the reordered stops with updated sequence numbers.
 */
export async function computeRoute(stops: TripStop[], originOverride?: RouteOrigin): Promise<ComputeRouteResult> {
  const apiKey = getApiKey();

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);

  // Validate coordinates before doing anything
  for (const stop of sorted) {
    if (
      typeof stop.lat !== "number" ||
      typeof stop.lng !== "number" ||
      Number.isNaN(stop.lat) ||
      Number.isNaN(stop.lng)
    ) {
      throw new Error(
        `Invalid coordinates for stop "${stop.address}": lat=${stop.lat}, lng=${stop.lng}`
      );
    }
  }

  const cacheKey = buildRouteCacheKey(sorted, originOverride);
  const cached = routeCache.get(cacheKey);
  console.log("Cache", { cacheKey, hit: !!cached });
  if (cached && cached.expiresAt > Date.now()) {
    console.log("Using cached route for stops:", sorted.map((s) => s.address));
    return cached.value;
  }

  const naivePath = originOverride
    ? [{ lat: originOverride.lat, lng: originOverride.lng }, ...sorted]
    : sorted;

  const naiveDistanceMeters = Math.round(naiveTotalDistance(naivePath));

  // Step 1: Use OpenAI to find the optimal stop order
  let optimizedStops: TripStop[];
  let optimizationReasoning = "";
  try {
    if (originOverride) {
      const syntheticOrigin: TripStop = {
        stopId: "__driver_origin__",
        address: "Driver Current Location",
        lat: originOverride.lat,
        lng: originOverride.lng,
        sequence: -1,
        notes: "",
      };

      const withOrigin = sorted.map((s, idx) => ({ ...s, sequence: idx + 1 }));
      const optimizedWithOrigin = await optimizeStopOrder([syntheticOrigin, ...withOrigin]);

      optimizedStops = optimizedWithOrigin
        .slice(1)
        .map((s, idx) => ({ ...s, sequence: idx }));
      optimizationReasoning = optimizedWithOrigin.reasoning;
    } else {
      const result = await optimizeStopOrder(sorted);
      optimizedStops = result.stops;
      optimizationReasoning = result.reasoning;
    }
    console.log("OpenAI optimized stop order:", optimizedStops.map((s) => `${s.sequence}: ${s.address}`));
  } catch (err) {
    console.error("OpenAI optimization failed, using original order:", err);
    optimizedStops = sorted.map((s, i) => ({ ...s, sequence: i }));
  }

  // Step 2: Compute the actual route via Google Directions using optimized order
  const origin = originOverride ?? optimizedStops[0];
  const destination = optimizedStops[optimizedStops.length - 1];
  const intermediates = originOverride
    ? optimizedStops.slice(0, -1)
    : optimizedStops.slice(1, -1);

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lng,
        },
      },
    },
    intermediates: intermediates.map((s) => ({
      location: {
        latLng: {
          latitude: s.lat,
          longitude: s.lng,
        },
      },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    departureTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    computeAlternativeRoutes: false,
  };

  const fieldMask = [
    "routes.distanceMeters",
    "routes.duration",
    "routes.staticDuration",
    "routes.polyline.encodedPolyline",
    "routes.legs.distanceMeters",
    "routes.legs.duration",
    "routes.legs.staticDuration",
  ].join(",");

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Routes API error: ${response.status} ${text}`);
  }

  const json:any = await response.json();
  const route = json.routes?.[0];

  if (!route) {
    throw new Error("No route found from Routes API");
  }

  const legs: RouteLeg[] = (route.legs ?? []).map((leg: any, i: number) => ({
    fromIndex: i,
    toIndex: i + 1,
    fromStopId: originOverride
      ? (i === 0 ? "__driver_origin__" : optimizedStops[i - 1]?.stopId)
      : optimizedStops[i]?.stopId,
    toStopId: originOverride
      ? optimizedStops[i]?.stopId
      : optimizedStops[i + 1]?.stopId,
    distanceMeters: leg.distanceMeters ?? 0,
    durationSeconds: durationStrToSeconds(leg.duration),
    staticDurationSeconds: leg.staticDuration
      ? durationStrToSeconds(leg.staticDuration)
      : undefined,
  }));

  const distanceMeters = route.distanceMeters ?? legs.reduce((sum, leg) => sum + leg.distanceMeters, 0);
  const durationSeconds =
    durationStrToSeconds(route.duration) ||
    legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);

  const staticDurationSeconds = route.staticDuration
    ? durationStrToSeconds(route.staticDuration)
    : undefined;

  const distanceSavedMeters = Math.max(naiveDistanceMeters - distanceMeters, 0);
  const fuelSavingsGallons =
    Math.round(distanceSavedMeters * FUEL_CONSUMPTION_GAL_PER_M * 100) / 100;

  const result: ComputeRouteResult = {
    route: {
      polyline: route.polyline?.encodedPolyline ?? "",
      distanceMeters,
      durationSeconds,
      naiveDistanceMeters,
      fuelSavingsGallons,
      legs,
    },
    optimizedStops,
  };

  routeCache.set(cacheKey, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    value: result,
  });

  return result;
}
