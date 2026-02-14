import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { apiFetch } from "./api";

const LOCATION_TASK_NAME = "quickroutesai-background-location";
const INTERVAL_MS = parseInt(process.env.EXPO_PUBLIC_LOCATION_INTERVAL_MS || "10000", 10);

/**
 * Define the background location task.
 * This runs even when the app is backgrounded.
 */
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("Background location error:", error);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const latest = locations[locations.length - 1];

  try {
    await apiFetch("/drivers/location", {
      method: "POST",
      body: JSON.stringify({
        lat: latest.coords.latitude,
        lng: latest.coords.longitude,
        speedMps: latest.coords.speed ?? 0,
        heading: latest.coords.heading ?? 0,
        timestamp: new Date(latest.timestamp).toISOString(),
      }),
    });
  } catch (err) {
    console.error("Failed to send location ping:", err);
  }
});

/**
 * Request permissions and start background location tracking.
 */
export async function startTracking(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") return false;

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== "granted") return false;

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
