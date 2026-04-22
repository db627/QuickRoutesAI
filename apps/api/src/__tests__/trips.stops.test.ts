import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

beforeEach(() => {
  jest.clearAllMocks();
});

const TRIP_ID = "trip-123";
const DRIVER_UID = "driver-123";
const STOP_A = { stopId: "stop-aaa", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "" };
const STOP_B = { stopId: "stop-bbb", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "" };

function mockInProgressTrip(stopOverrides: object[] = [STOP_A, STOP_B]) {
  return {
    driverId: DRIVER_UID,
    createdBy: "dispatcher-uid",
    status: "in_progress",
    stops: stopOverrides,
    route: null,
    notes: null,
    orgId: "org-test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function setupTripMock(
  tripData: object | null,
  tripUpdateMock = jest.fn().mockResolvedValue(undefined),
  stopUpdateMock = jest.fn().mockResolvedValue(undefined),
  addEventMock = jest.fn().mockResolvedValue(undefined),
) {
  // Derive the per-stop docs from tripData.stops (if provided) so each
  // trips/{id}/stops/{stopId} doc read returns the expected shape.
  const stopsArray: any[] = (tripData as any)?.stops ?? [];

  db.collection.mockImplementation((col: string) => {
    if (col === "trips") {
      return {
        doc: (_tripId: string) => ({
          get: jest.fn().mockResolvedValue(
            tripData
              ? { exists: true, data: () => tripData }
              : { exists: false },
          ),
          update: tripUpdateMock,
          collection: (subCol: string) => {
            if (subCol !== "stops") {
              return { doc: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ exists: false }) };
            }
            return {
              // tripRef.collection("stops").doc(stopId) — used for both .get and .update
              doc: (stopId: string) => {
                const found = stopsArray.find((s) => s.stopId === stopId);
                return {
                  get: jest.fn().mockResolvedValue(
                    found
                      ? { exists: true, data: () => found }
                      : { exists: false },
                  ),
                  update: stopUpdateMock,
                };
              },
              // tripRef.collection("stops").get() — full subcollection for sequential check
              get: jest.fn().mockResolvedValue({
                docs: stopsArray.map((s) => ({ id: s.stopId, data: () => s })),
              }),
            };
          },
        }),
      };
    }
    if (col === "events") {
      return { add: addEventMock };
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "driver", orgId: "org-test" }) }),
      set: jest.fn().mockResolvedValue(undefined),
    };
  });
  return { tripUpdateMock, stopUpdateMock, addEventMock };
}

describe("POST /trips/:id/stops/:stopId/complete", () => {
  it("marks the first stop as completed with a timestamp", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const { stopUpdateMock, addEventMock } = setupTripMock(mockInProgressTrip());

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_A.stopId}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stopId).toBe(STOP_A.stopId);
    expect(res.body.completedAt).toBeDefined();
    expect(stopUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", completedAt: expect.any(String) }),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stop_completed" }),
    );
  });

  it("returns 404 if trip does not exist", async () => {
    setupMockUser(DRIVER_UID, "driver");
    setupTripMock(null);

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_A.stopId}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not Found");
  });

  it("returns 404 if stop does not exist on the trip", async () => {
    setupMockUser(DRIVER_UID, "driver");
    setupTripMock(mockInProgressTrip());

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/nonexistent-stop/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/stop not found/i);
  });

  it("returns 400 if trip is not in_progress", async () => {
    setupMockUser(DRIVER_UID, "driver");
    setupTripMock({ ...mockInProgressTrip(), status: "assigned" });

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_A.stopId}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/in progress/i);
  });

  it("returns 403 if driver does not own the trip", async () => {
    setupMockUser("other-driver", "driver");
    setupTripMock(mockInProgressTrip());

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_A.stopId}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("returns 409 if stop is already completed", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const completedStop = { ...STOP_A, status: "completed", completedAt: new Date().toISOString() };
    setupTripMock(mockInProgressTrip([completedStop, STOP_B]));

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_A.stopId}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already completed/i);
  });

  it("returns 400 if a prior stop is not yet completed (sequential enforcement)", async () => {
    setupMockUser(DRIVER_UID, "driver");
    // STOP_A is pending, try to complete STOP_B
    setupTripMock(mockInProgressTrip([STOP_A, STOP_B]));

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_B.stopId}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/previous stops/i);
  });
});
