import { Client, TravelMode, Status } from "@googlemaps/google-maps-services-js";
import type { TripRoute, TripStop } from "@quickroutesai/shared";

const client = new Client({});

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

/**
 * Compute a route through ordered stops using Google Directions API.
 * First stop = origin, last stop = destination, middle stops = waypoints.
 */
export async function computeRoute(stops: TripStop[]): Promise<TripRoute> {
  const apiKey = getApiKey();

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const origin = sorted[0];
  const destination = sorted[sorted.length - 1];
  const waypoints = sorted.slice(1, -1);

  try {
    const response = await client.directions({
      params: {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        waypoints: waypoints.map((wp) => ({
          lat: wp.lat,
          lng: wp.lng,
        })),
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

    return {
      polyline: route.overview_polyline.points,
      distanceMeters,
      durationSeconds,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Directions API error")) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Directions request failed: ${msg}`);
  }
}
