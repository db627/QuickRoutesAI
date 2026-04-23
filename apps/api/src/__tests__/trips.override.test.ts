import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();

const { db } = require("../config/firebase");
const { computeRoute } = require("../services/directions");

function mockTripData(overrides: Partial<any> = {}) {
  return {
    driverId: null,
    createdBy: "dispatcher-uid",
    status: "assigned",
    notes: null,
    route: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const existingStops = [
  { stopId: "s1", address: "123 Main St", contactName: "", lat: 40, lng: -74, sequence: 0, notes: "" },
  { stopId: "s2", address: "456 Oak Ave", contactName: "", lat: 41, lng: -75, sequence: 1, notes: "" },
  { stopId: "s3", address: "789 Pine Rd", contactName: "", lat: 42, lng: -76, sequence: 2, notes: "" },
];

const mockRoute = {
  polyline: "abc123",
  distanceMeters: 50000,
  durationSeconds: 3600,
  naiveDistanceMeters: 60000,
  fuelSavingsGallons: 0.2,
  legs: [],
  createdAt: new Date().toISOString(),
};

function installTripMock({
  tripId,
  trip,
  stops,
  updateMock,
  addEventMock,
  batchUpdateMock,
  stopsMissing = false,
}: {
  tripId: string;
  trip: any;
  stops: any[];
  updateMock: jest.Mock;
  addEventMock: jest.Mock;
  batchUpdateMock: jest.Mock;
  stopsMissing?: boolean;
}) {
  db.batch = jest.fn(() => ({
    update: batchUpdateMock,
    commit: jest.fn().mockResolvedValue(undefined),
  }));

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "dispatcher" }),
          }),
        }),
      };
    }

    if (col === "trips") {
      return {
        doc: (id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: trip !== null && id === tripId,
            data: () => trip,
          }),
          update: updateMock,
          collection: (subcol: string) => {
            if (subcol === "stops") {
              return {
                get: jest.fn().mockResolvedValue({
                  empty: stopsMissing,
                  docs: stopsMissing
                    ? []
                    : stops.map((stop) => ({ data: () => stop })),
                }),
                doc: (stopId: string) => ({
                  id: stopId,
                }),
              };
            }
            return {};
          },
        }),
      };
    }

    if (col === "events") {
      return { add: addEventMock };
    }

    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });
}

describe("POST /trips/:id/override", () => {
  const tripId = "trip-123";
  const uid = "dispatcher-abc";

  beforeEach(() => {
    jest.clearAllMocks();
    db.collection = jest.fn();
    db.batch = jest.fn();
  });

  it("returns 403 when called by a driver", async () => {
    setupMockUser(uid, "driver", "Test Driver");

    const res = await request(app)
      .post(`/trips/${tripId}/override`)
      .send({ stopIds: ["s1", "s2", "s3"], reason: "manual swap" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
    expect(computeRoute).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is empty", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");

    const res = await request(app)
      .post(`/trips/${tripId}/override`)
      .send({ stopIds: ["s1", "s2", "s3"], reason: "" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(computeRoute).not.toHaveBeenCalled();
  });

  it("returns 400 when stopIds don't match the trip's stops (missing id)", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");

    const updateMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue(undefined);
    const batchUpdateMock = jest.fn();

    installTripMock({
      tripId,
      trip: mockTripData(),
      stops: existingStops,
      updateMock,
      addEventMock,
      batchUpdateMock,
    });

    // Missing "s3"
    const res = await request(app)
      .post(`/trips/${tripId}/override`)
      .send({ stopIds: ["s2", "s1"], reason: "missing one stop" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toMatch(/same stop IDs/i);
    expect(computeRoute).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when stopIds has an extra / wrong id", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");

    const updateMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue(undefined);
    const batchUpdateMock = jest.fn();

    installTripMock({
      tripId,
      trip: mockTripData(),
      stops: existingStops,
      updateMock,
      addEventMock,
      batchUpdateMock,
    });

    // s4 is not part of the trip
    const res = await request(app)
      .post(`/trips/${tripId}/override`)
      .send({ stopIds: ["s1", "s2", "s4"], reason: "wrong id" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(computeRoute).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("reorders stops, calls computeRoute with reordered stops, and patches override metadata", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");
    computeRoute.mockResolvedValue({ route: mockRoute, optimizedStops: [] });

    const updateMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue({ id: "event-1" });
    const batchUpdateMock = jest.fn();

    installTripMock({
      tripId,
      trip: mockTripData(),
      stops: existingStops,
      updateMock,
      addEventMock,
      batchUpdateMock,
    });

    // Reorder: s3 -> s1 -> s2
    const res = await request(app)
      .post(`/trips/${tripId}/override`)
      .send({ stopIds: ["s3", "s1", "s2"], reason: "weather detour" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // computeRoute called once with the reordered stops in the new order,
    // each with updated sequence, and skipOptimization: true to preserve manual order.
    expect(computeRoute).toHaveBeenCalledTimes(1);
    const [callArg, callOptions] = computeRoute.mock.calls[0];
    expect(callArg.map((s: any) => s.stopId)).toEqual(["s3", "s1", "s2"]);
    expect(callArg.map((s: any) => s.sequence)).toEqual([0, 1, 2]);
    expect(callOptions).toEqual({ skipOptimization: true });

    // Trip doc updated with stops, route, routeOverride
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stops: expect.any(Array),
        route: mockRoute,
        routeOverride: expect.objectContaining({
          active: true,
          reason: "weather detour",
          overriddenBy: uid,
          overriddenAt: expect.any(String),
        }),
        updatedAt: expect.any(String),
      }),
    );

    // Stops array passed to update has new order
    const persistedStops = updateMock.mock.calls[0][0].stops;
    expect(persistedStops.map((s: any) => s.stopId)).toEqual(["s3", "s1", "s2"]);
    expect(persistedStops.map((s: any) => s.sequence)).toEqual([0, 1, 2]);

    // Per-stop batch update ran once per stop
    expect(batchUpdateMock).toHaveBeenCalledTimes(3);

    // Event logged
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trip_override",
        uid,
        payload: expect.objectContaining({
          tripId,
          stopIds: ["s3", "s1", "s2"],
          reason: "weather detour",
        }),
      }),
    );

    // Response includes the override meta and new route
    expect(res.body.route).toEqual(mockRoute);
    expect(res.body.routeOverride).toMatchObject({
      active: true,
      reason: "weather detour",
      overriddenBy: uid,
    });
  });
});
