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

  // Always use the web URL format — it supports waypoints and opens
  // in the Google Maps / Apple Maps app automatically when installed.
  const googleUrl = buildGoogleMapsUrl(sorted);

  if (Platform.OS === "ios") {
    const appleUrl = buildAppleMapsUrl(sorted);
    const canOpenApple = await Linking.canOpenURL(appleUrl);
    if (canOpenApple) {
      await Linking.openURL(appleUrl);
      return;
    }
  }

  // Google Maps universal link — opens the app if installed, browser otherwise.
  // This preserves all waypoints unlike the comgooglemaps:// scheme.
  const canOpen = await Linking.canOpenURL(googleUrl);
  if (canOpen) {
    await Linking.openURL(googleUrl);
  } else {
    Alert.alert("Error", "Unable to open maps. Please install Google Maps or Apple Maps.");
  }
}

export { openNavigation };
