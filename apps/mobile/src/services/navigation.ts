import { Linking, Platform, Alert } from "react-native";
import type { TripStop } from "@quickroutesai/shared";

function buildAppleMapsUrl(stops: TripStop[]): string {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const origin = sorted[0];
  const destination = sorted[sorted.length - 1];
  const waypoints = sorted.slice(1, -1);

  let url = `maps://?saddr=${origin.lat},${origin.lng}&daddr=${destination.lat},${destination.lng}`;

  if (waypoints.length > 0) {
    const waypointStr = waypoints.map((s) => `${s.lat},${s.lng}`).join("+to:");
    url = `maps://?saddr=${origin.lat},${origin.lng}&daddr=${waypointStr}+to:${destination.lat},${destination.lng}`;
  }

  return url;
}

function buildGoogleMapsUrl(stops: TripStop[]): string {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const origin = sorted[0];
  const destination = sorted[sorted.length - 1];
  const waypoints = sorted.slice(1, -1);

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`;

  if (waypoints.length > 0) {
    const waypointStr = waypoints.map((s) => `${s.lat},${s.lng}`).join("|");
    url += `&waypoints=${encodeURIComponent(waypointStr)}`;
  }

  return url;
}

async function openNavigation(stops: TripStop[]): Promise<void> {
  if (stops.length === 0) {
    Alert.alert("No Stops", "This trip has no stops to navigate to.");
    return;
  }

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);

  const appleUrl = buildAppleMapsUrl(sorted);
  const googleUrl = buildGoogleMapsUrl(sorted);
  const fallbackUrl = googleUrl;

  if (Platform.OS === "ios") {
    const canOpenApple = await Linking.canOpenURL(appleUrl);
    if (canOpenApple) {
      await Linking.openURL(appleUrl);
      return;
    }
  }

  const canOpenGoogle = await Linking.canOpenURL("comgooglemaps://");
  if (canOpenGoogle) {
    const googleAppUrl = `comgooglemaps://?saddr=${sorted[0].lat},${sorted[0].lng}&daddr=${sorted[sorted.length - 1].lat},${sorted[sorted.length - 1].lng}&directionsmode=driving`;
    await Linking.openURL(googleAppUrl);
    return;
  }

  // Fallback to browser
  const canOpenBrowser = await Linking.canOpenURL(fallbackUrl);
  if (canOpenBrowser) {
    await Linking.openURL(fallbackUrl);
  } else {
    Alert.alert("Error", "Unable to open maps. Please install Google Maps or Apple Maps.");
  }
}

export { openNavigation };
