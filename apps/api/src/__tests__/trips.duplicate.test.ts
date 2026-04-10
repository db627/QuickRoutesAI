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

    // Ensure these always exist as jest mocks for each test
    db.collection = jest.fn();
    db.batch = jest.fn();
  });

  it("duplicates a completed trip into a new draft trip", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");

    const sourceTrip = mockCompletedTrip();
    const stops = [
      { stopId: "old-1", address: "Hazlet, NJ", lat: 40.42, lng: -74.16, sequence: 0, notes: "" },
      { stopId: "old-2", address: "Middletown, NJ", lat: 40.39, lng: -74.11, sequence: 1, notes: "" },
    ];

    const stopDocMock = jest
      .fn()
      .mockReturnValueOnce({ id: "new-stop-1" })
      .mockReturnValueOnce({ id: "new-stop-2" });

    const addTripMock = jest.fn().mockResolvedValue({
      id: "new-trip-456",
      collection: (subcol: string) => {
        if (subcol === "stops") {
          return {
            doc: stopDocMock,
          };
        }
        return {};
      },
    });

    const addEventMock = jest.fn().mockResolvedValue(undefined);
    const batchSetMock = jest.fn();
    const batchCommitMock = jest.fn().mockResolvedValue(undefined);

    db.batch.mockReturnValue({
      set: batchSetMock,
      commit: batchCommitMock,
    });

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
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === tripId,
              data: () => sourceTrip,
            }),
            collection: (subcol: string) => {
              if (subcol === "stops") {
                return {
                  get: jest.fn().mockResolvedValue({
                    empty: false,
                    docs: stops.map((stop) => ({
                      data: () => stop,
                    })),
                  }),
                };
              }
              return {};
            },
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
    expect(res.body.notes).toBe(sourceTrip.notes);

    expect(addTripMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        driverId: null,
        route: null,
        createdBy: uid,
        notes: sourceTrip.notes,
      }),
    );

    expect(batchSetMock).toHaveBeenCalledTimes(2);

    expect(batchSetMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        address: "Hazlet, NJ",
        lat: 40.42,
        lng: -74.16,
        sequence: 0,
        stopId: "new-stop-1",
      }),
    );

    expect(batchSetMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        address: "Middletown, NJ",
        lat: 40.39,
        lng: -74.11,
        sequence: 1,
        stopId: "new-stop-2",
      }),
    );

    expect(batchCommitMock).toHaveBeenCalled();

    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trip_duplicate",
        driverId: uid,
        payload: { sourceTripId: tripId, duplicatedTripId: "new-trip-456" },
      }),
    );
  });

  it("returns 409 when source trip is not completed", async () => {
    setupMockUser(uid, "dispatcher", "Dispatcher");

    const sourceTrip = mockCompletedTrip({ status: "assigned" });
    const stops = [
      { stopId: "old-1", address: "Hazlet, NJ", lat: 40.42, lng: -74.16, sequence: 0, notes: "" },
      { stopId: "old-2", address: "Middletown, NJ", lat: 40.39, lng: -74.11, sequence: 1, notes: "" },
    ];

    const addTripMock = jest.fn().mockResolvedValue({
      id: "new-trip-456",
      collection: () => ({
        doc: jest.fn(),
      }),
    });

    const batchSetMock = jest.fn();
    const batchCommitMock = jest.fn().mockResolvedValue(undefined);

    db.batch.mockReturnValue({
      set: batchSetMock,
      commit: batchCommitMock,
    });

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
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === tripId,
              data: () => sourceTrip,
            }),
            collection: (subcol: string) => {
              if (subcol === "stops") {
                return {
                  get: jest.fn().mockResolvedValue({
                    empty: false,
                    docs: stops.map((stop) => ({
                      data: () => stop,
                    })),
                  }),
                };
              }
              return {};
            },
          }),
          add: addTripMock,
        };
      }

      if (col === "events") {
        return {
          add: jest.fn().mockResolvedValue(undefined),
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
    expect(res.body).toEqual({
      error: "Bad Request",
      message: "Only completed trips can be duplicated",
    });

    expect(addTripMock).not.toHaveBeenCalled();
    expect(batchSetMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});