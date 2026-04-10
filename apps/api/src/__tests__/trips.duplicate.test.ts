import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

function mockCompletedTrip(overrides: Partial<any> = {}) {
  return {
    driverId: "driver-123",
    createdBy: "dispatcher-1",
    status: "completed",
    notes: "Repeat this route next week",
    stops: [
      { stopId: "old-1", address: "Hazlet, NJ", lat: 40.42, lng: -74.16, sequence: 0, notes: "" },
      { stopId: "old-2", address: "Middletown, NJ", lat: 40.39, lng: -74.11, sequence: 1, notes: "" },
    ],
    route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 600 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /trips/:id/duplicate", () => {
  const uid = "dispatcher-123";
  const tripId = "trip-completed-1";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("duplicates a completed trip into a new draft trip", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");
    const sourceTrip = mockCompletedTrip();
    const addTripMock = jest.fn().mockResolvedValue({ id: "new-trip-456" });
    const addEventMock = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === uid,
              data: () => ({ role: "dispatcher" }),
            }),
          }),
        };
      }

      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => sourceTrip }),
          }),
          add: addTripMock,
        };
      }

      if (col === "events") {
        return {
          add: addEventMock,
        };
      }

      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: false }),
      };
    });

    const res = await request(app)
      .post(`/trips/${tripId}/duplicate`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe("new-trip-456");
    expect(res.body.duplicatedFrom).toBe(tripId);
    expect(res.body.status).toBe("draft");
    expect(res.body.driverId).toBeNull();
    expect(res.body.route).toBeNull();

    expect(addTripMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        driverId: null,
        route: null,
        createdBy: uid,
      }),
    );

    const insertedStops = addTripMock.mock.calls[0][0].stops;
    expect(insertedStops).toHaveLength(2);
    expect(insertedStops[0].stopId).not.toBe("old-1");
    expect(insertedStops[1].stopId).not.toBe("old-2");

    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trip_duplicate",
        payload: { sourceTripId: tripId, duplicatedTripId: "new-trip-456" },
      }),
    );
  });

  it("returns 409 when source trip is not completed", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");
    const sourceTrip = mockCompletedTrip({ status: "assigned" });
    const addTripMock = jest.fn().mockResolvedValue({ id: "new-trip-456" });

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === uid,
              data: () => ({ role: "dispatcher" }),
            }),
          }),
        };
      }

      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => sourceTrip }),
          }),
          add: addTripMock,
        };
      }

      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: false }),
      };
    });

    const res = await request(app)
      .post(`/trips/${tripId}/duplicate`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "CONFLICT", message: "Only completed trips can be duplicated" });
    expect(addTripMock).not.toHaveBeenCalled();
  });
});

