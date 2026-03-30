import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Alert, Linking, Platform } from "react-native";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";

export const LOCATION_TASK_NAME = "quickroutesai-background-location";
const INTERVAL_MS = parseInt(process.env.EXPO_PUBLIC_LOCATION_INTERVAL_MS || "5000", 10);

/** Shape of each location update written to Firestore. */
export interface LocationUpdate {
  lat: number;
  lng: number;
  speedMps: number;
  heading: number;
  timestamp: string;
}

/**
 * Build a normalised location payload from an expo LocationObject.
 */
export function buildLocationPayload(loc: Location.LocationObject): LocationUpdate {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    speedMps: Math.max(loc.coords.speed ?? 0, 0),
    heading: loc.coords.heading ?? 0,
    timestamp: new Date(loc.timestamp).toISOString(),
  };
}

/**
 * Write a location update to Firestore at drivers/{uid}.
 */
async function sendLocationUpdate(payload: LocationUpdate): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  await setDoc(
    doc(firestore, "drivers", uid),
    {
      lastLocation: { lat: payload.lat, lng: payload.lng },
      lastSpeedMps: payload.speedMps,
      lastHeading: payload.heading,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Define the background location task.
 * Runs even when the app is backgrounded.
 */
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("Background location error:", error);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const latest = locations[locations.length - 1];
  const payload = buildLocationPayload(latest);

  try {
    await sendLocationUpdate(payload);
  } catch (err) {
    console.error("Failed to send location ping:", err);
  }
});

/**
 * Prompt the user to open Settings when location permission is denied.
 */
function promptEnableLocation(): void {
  Alert.alert(
    "Location Permission Required",
    "QuickRoutesAI needs access to your location to track deliveries. Please enable location access in Settings.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open Settings",
        onPress: () => {
          if (Platform.OS === "ios") {
            Linking.openURL("app-settings:");
          } else {
            Linking.openSettings();
          }
        },
      },
    ],
  );
}

/**
 * Request permissions and start background location tracking.
 */
export async function startTracking(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    promptEnableLocation();
    return false;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== "granted") {
    promptEnableLocation();
    return false;
  }

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(
    () => false,
  );
  if (isTracking) return true;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: INTERVAL_MS,
    distanceInterval: 10, // meters
    foregroundService: {
      notificationTitle: "QuickRoutesAI",
      notificationBody: "Tracking your delivery route",
      notificationColor: "#2563eb",
    },
    showsBackgroundLocationIndicator: true,
  });

  return true;
}

/**
 * Stop background location tracking.
 */
export async function stopTracking(): Promise<void> {
  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(
    () => false,
  );
  if (isTracking) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

/**
 * Get current position once (foreground only).
 */
export async function getCurrentPosition(): Promise<Location.LocationObject | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;

  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}
