import { Linking, Platform, Alert } from "react-native";
import type { TripStop } from "@quickroutesai/shared";
import { getNavAppPreference } from "./userPreferences";

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

async function tryOpen(url: string): Promise<boolean> {
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
    return true;
  }
  return false;
}

async function openNavigation(stops: TripStop[]): Promise<void> {
  if (stops.length === 0) {
    Alert.alert("No Stops", "This trip has no stops to navigate to.");
    return;
  }

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const pref = await getNavAppPreference();
  const googleUrl = buildGoogleMapsUrl(sorted);
  const appleUrl = buildAppleMapsUrl(sorted);

  if (pref === "google") {
    if (await tryOpen(googleUrl)) return;
  } else if (pref === "apple" && Platform.OS === "ios") {
    if (await tryOpen(appleUrl)) return;
    if (await tryOpen(googleUrl)) return;
  } else {
    // auto: iOS prefers Apple Maps if available, everyone falls back to Google.
    if (Platform.OS === "ios" && (await tryOpen(appleUrl))) return;
    if (await tryOpen(googleUrl)) return;
  }

  Alert.alert("Error", "Unable to open maps. Please install Google Maps or Apple Maps.");
}

export { openNavigation };
