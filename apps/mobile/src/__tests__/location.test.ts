import { Alert, Linking, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { setDoc } from "firebase/firestore";

// ── Mocks ──

jest.mock("../config/firebase", () => ({
  auth: { currentUser: { uid: "driver123" } },
  firestore: {},
}));

jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => "mock-doc-ref"),
  setDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: jest.fn(() => "mock-server-ts"),
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  Accuracy: { High: 5 },
}));

jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
}));

// ── Import module after mocks are set up & capture task handler ──

// eslint-disable-next-line @typescript-eslint/no-var-requires
const locationModule = require("../services/location");
const {
  startTracking,
  stopTracking,
  buildLocationPayload,
  LOCATION_TASK_NAME,
} = locationModule;

// Capture the background task handler immediately after module load
const taskHandler = (TaskManager.defineTask as jest.Mock).mock.calls[0][1];

// ── Tests ──

describe("buildLocationPayload", () => {
  it("normalises an expo LocationObject into the expected shape", () => {
    const loc: Location.LocationObject = {
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        altitude: 10,
        accuracy: 5,
        altitudeAccuracy: 3,
        heading: 180,
        speed: 12.5,
      },
      timestamp: 1700000000000,
    };

    const payload = buildLocationPayload(loc);

    expect(payload).toEqual({
      lat: 40.7128,
      lng: -74.006,
      speedMps: 12.5,
      heading: 180,
      timestamp: new Date(1700000000000).toISOString(),
    });
  });

  it("clamps negative speed to 0", () => {
    const loc: Location.LocationObject = {
      coords: {
        latitude: 0,
        longitude: 0,
        altitude: null,
        accuracy: null,
        altitudeAccuracy: null,
        heading: null,
        speed: -1,
      },
      timestamp: 1700000000000,
    };

    expect(buildLocationPayload(loc).speedMps).toBe(0);
  });

  it("defaults null speed and heading to 0", () => {
    const loc: Location.LocationObject = {
      coords: {
        latitude: 0,
        longitude: 0,
        altitude: null,
        accuracy: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: 1700000000000,
    };

    const payload = buildLocationPayload(loc);
    expect(payload.speedMps).toBe(0);
    expect(payload.heading).toBe(0);
  });
});

describe("startTracking", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requests foreground and background permissions then starts updates", async () => {
    const result = await startTracking();

    expect(result).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      LOCATION_TASK_NAME,
      expect.objectContaining({
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      }),
    );
  });

  it("returns false and prompts settings when foreground permission denied", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: "denied",
    });
    jest.spyOn(Alert, "alert");

    const result = await startTracking();

    expect(result).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Location Permission Required",
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel" }),
        expect.objectContaining({ text: "Open Settings" }),
      ]),
    );
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("returns false and prompts settings when background permission denied", async () => {
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: "denied",
    });
    jest.spyOn(Alert, "alert");

    const result = await startTracking();

    expect(result).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Location Permission Required",
      expect.any(String),
      expect.any(Array),
    );
  });

  it("skips starting if already tracking", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValueOnce(true);

    const result = await startTracking();

    expect(result).toBe(true);
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("Open Settings button opens app settings on iOS", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: "denied",
    });
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "ios" });
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const openBtn = buttons?.find((b: any) => b.text === "Open Settings");
      openBtn?.onPress?.();
    });
    jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as any);

    await startTracking();

    expect(Linking.openURL).toHaveBeenCalledWith("app-settings:");
    Object.defineProperty(Platform, "OS", { value: originalOS });
  });
});

describe("stopTracking", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stops location updates when tracking is active", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValueOnce(true);

    await stopTracking();

    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK_NAME);
  });

  it("does nothing when not tracking", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValueOnce(false);

    await stopTracking();

    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

describe("background task handler", () => {
  beforeEach(() => jest.clearAllMocks());

  it("writes location to Firestore drivers/{uid}", async () => {
    await taskHandler({
      data: {
        locations: [
          {
            coords: { latitude: 40.7, longitude: -74, speed: 10, heading: 90 },
            timestamp: 1700000000000,
          },
        ],
      },
      error: null,
    });

    expect(setDoc).toHaveBeenCalledWith(
      "mock-doc-ref",
      expect.objectContaining({
        lastLocation: { lat: 40.7, lng: -74 },
        lastSpeedMps: 10,
        lastHeading: 90,
        updatedAt: "mock-server-ts",
      }),
      { merge: true },
    );
  });

  it("uses the latest location when multiple are provided", async () => {
    await taskHandler({
      data: {
        locations: [
          { coords: { latitude: 1, longitude: 1, speed: 0, heading: 0 }, timestamp: 100 },
          { coords: { latitude: 2, longitude: 2, speed: 5, heading: 45 }, timestamp: 200 },
        ],
      },
      error: null,
    });

    expect(setDoc).toHaveBeenCalledWith(
      "mock-doc-ref",
      expect.objectContaining({
        lastLocation: { lat: 2, lng: 2 },
        lastSpeedMps: 5,
        lastHeading: 45,
      }),
      { merge: true },
    );
  });

  it("does nothing on error", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    await taskHandler({ data: {}, error: new Error("GPS unavailable") });

    expect(setDoc).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does nothing when locations array is empty", async () => {
    await taskHandler({ data: { locations: [] }, error: null });

    expect(setDoc).not.toHaveBeenCalled();
  });
});
