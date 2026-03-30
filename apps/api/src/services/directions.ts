import { Client, TravelMode, Status } from "@googlemaps/google-maps-services-js";
import type { TripRoute, TripStop } from "@quickroutesai/shared";
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

/**
 * Compute an optimized route through stops.
 * 1. OpenAI reorders stops for the best driving order (origin stays first).
 * 2. Google Directions computes the actual route along the optimized order.
 * Returns both the route and the reordered stops with updated sequence numbers.
 */
export async function computeRoute(stops: TripStop[]): Promise<ComputeRouteResult> {
  const apiKey = getApiKey();

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);

  // Validate coordinates before doing anything
  for (const stop of sorted) {
    if (typeof stop.lat !== "number" || typeof stop.lng !== "number" || isNaN(stop.lat) || isNaN(stop.lng)) {
      throw new Error(`Invalid coordinates for stop "${stop.address}": lat=${stop.lat}, lng=${stop.lng}`);
    }
  }

  // Compute naive distance BEFORE optimization for fuel savings comparison
  const naiveDistanceMeters = Math.round(naiveTotalDistance(sorted));

  // Step 1: Use OpenAI to find the optimal stop order
  let optimizedStops: TripStop[];
  try {
    optimizedStops = await optimizeStopOrder(sorted);
    console.log("OpenAI optimized stop order:", optimizedStops.map((s) => `${s.sequence}: ${s.address}`));
  } catch (err) {
    console.error("OpenAI optimization failed, using original order:", err);
    optimizedStops = sorted.map((s, i) => ({ ...s, sequence: i }));
  }

  // Step 2: Compute the actual route via Google Directions using optimized order
  const origin = optimizedStops[0];
  const destination = optimizedStops[optimizedStops.length - 1];
  const waypoints = optimizedStops.slice(1, -1);

  try {
    const waypointParams = waypoints.length > 0
      ? waypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }))
      : undefined;

    const response = await client.directions({
      params: {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        ...(waypointParams && { waypoints: waypointParams }),
        mode: TravelMode.driving,
        key: apiKey,
      },
    });

    if (response.data.status !== Status.OK) {
      throw new Error(
        `Directions API error: ${response.data.status}` +
          (response.data.error_message ? ` - ${response.data.error_message}` : ""),
      );
    }

    const route = response.data.routes[0];
    if (!route) {
      throw new Error("No route found from Directions API");
    }

    // Sum up total distance and duration across all legs
    let distanceMeters = 0;
    let durationSeconds = 0;
    for (const leg of route.legs) {
      distanceMeters += leg.distance.value;
      durationSeconds += leg.duration.value;
    }

    // Estimate fuel savings vs naive (original order) routing
    const distanceSavedMeters = Math.max(naiveDistanceMeters - distanceMeters, 0);
    const fuelSavingsGallons = Math.round(distanceSavedMeters * FUEL_CONSUMPTION_GAL_PER_M * 100) / 100;

    return {
      route: {
        polyline: route.overview_polyline.points,
        distanceMeters,
        durationSeconds,
        naiveDistanceMeters,
        fuelSavingsGallons,
      },
      optimizedStops,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Directions API error")) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Directions request failed: ${msg}`);
  }
}
