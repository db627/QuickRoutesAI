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

describe("POST /trips/:id/status (admin manual completion)", () => {
  function setupAdminTripMock(
    tripData: object | null,
    stopsArray: any[] = [],
    tripUpdateMock = jest.fn().mockResolvedValue(undefined),
    addEventMock = jest.fn().mockResolvedValue(undefined),
  ) {
    // Simulates Firestore for the admin completion path. The handler reads
    // tripRef.collection("stops").get() to enumerate stops, then commits a
    // batch of stopRef.update() calls to flip pending stops to completed.
    const stopRefs = new Map<string, { ref: any; updates: any[] }>();
    stopsArray.forEach((s) => {
      const updates: any[] = [];
      stopRefs.set(s.stopId, {
        ref: { __id: s.stopId, __updates: updates },
        updates,
      });
    });

    const batchUpdates: { stopId: string; data: any }[] = [];
    const batchCommit = jest.fn().mockResolvedValue(undefined);
    const batchUpdate = jest.fn((ref: any, data: any) => {
      batchUpdates.push({ stopId: ref?.__id, data });
    });
    db.batch = jest.fn(() => ({ update: batchUpdate, commit: batchCommit }));

    db.collection.mockImplementation((col: string) => {
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue(
              tripData
                ? { exists: true, data: () => tripData }
                : { exists: false },
            ),
            update: tripUpdateMock,
            collection: (subCol: string) => {
              if (subCol !== "stops") {
                return { get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) };
              }
              return {
                get: jest.fn().mockResolvedValue({
                  empty: stopsArray.length === 0,
                  docs: stopsArray.map((s) => ({
                    id: s.stopId,
                    ref: stopRefs.get(s.stopId)?.ref,
                    data: () => s,
                  })),
                }),
                doc: (stopId: string) => ({
                  get: jest.fn().mockResolvedValue({
                    exists: !!stopsArray.find((s) => s.stopId === stopId),
                    data: () => stopsArray.find((s) => s.stopId === stopId),
                  }),
                  update: jest.fn().mockResolvedValue(undefined),
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
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "admin", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
      };
    });

    return { tripUpdateMock, addEventMock, batchUpdate, batchCommit, batchUpdates };
  }

  const ADMIN_UID = "admin-uid";

  it("admin completing an in_progress trip batch-updates pending stops to completed", async () => {
    setupMockUser(ADMIN_UID, "admin");
    const pendingStop = { ...STOP_A };
    const alreadyDoneStop = { ...STOP_B, status: "completed", completedAt: "2024-01-01T00:00:00Z" };
    const { tripUpdateMock, batchUpdate, batchCommit, batchUpdates } = setupAdminTripMock(
      {
        status: "in_progress",
        driverId: DRIVER_UID,
        orgId: "org-test",
        createdBy: "dispatcher-uid",
        stops: [pendingStop, alreadyDoneStop],
      },
      [pendingStop, alreadyDoneStop],
    );

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .send({ status: "completed" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "completed" });
    // Only the pending stop should be batched (the already-completed one is skipped).
    expect(batchUpdates).toHaveLength(1);
    expect(batchUpdates[0].stopId).toBe(STOP_A.stopId);
    expect(batchUpdates[0].data).toMatchObject({
      status: "completed",
      completedAt: expect.any(String),
    });
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(tripUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("admin completing a trip with all stops already done still updates trip but skips batch commit", async () => {
    setupMockUser(ADMIN_UID, "admin");
    const doneA = { ...STOP_A, status: "completed", completedAt: "2024-01-01T00:00:00Z" };
    const doneB = { ...STOP_B, status: "completed", completedAt: "2024-01-01T00:00:00Z" };
    const { tripUpdateMock, batchCommit } = setupAdminTripMock(
      {
        status: "in_progress",
        driverId: DRIVER_UID,
        orgId: "org-test",
        createdBy: "dispatcher-uid",
        stops: [doneA, doneB],
      },
      [doneA, doneB],
    );

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .send({ status: "completed" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(batchCommit).not.toHaveBeenCalled();
    expect(tripUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("admin completing a draft trip → 400 (cannot complete a draft)", async () => {
    setupMockUser(ADMIN_UID, "admin");
    setupAdminTripMock(
      {
        status: "draft",
        driverId: null,
        orgId: "org-test",
        createdBy: "dispatcher-uid",
        stops: [STOP_A, STOP_B],
      },
      [STOP_A, STOP_B],
    );

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .send({ status: "completed" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot complete a draft/i);
  });

  it("admin completing an assigned trip → 200 (manual completion path)", async () => {
    setupMockUser(ADMIN_UID, "admin");
    const { tripUpdateMock, batchUpdates } = setupAdminTripMock(
      {
        status: "assigned",
        driverId: DRIVER_UID,
        orgId: "org-test",
        createdBy: "dispatcher-uid",
        stops: [STOP_A, STOP_B],
      },
      [STOP_A, STOP_B],
    );

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .send({ status: "completed" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    // Both pending stops should be batch-completed when an admin manually
    // marks an assigned trip as done.
    expect(batchUpdates).toHaveLength(2);
    expect(tripUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("admin completing an in_progress trip → 200", async () => {
    setupMockUser(ADMIN_UID, "admin");
    setupAdminTripMock(
      {
        status: "in_progress",
        driverId: DRIVER_UID,
        orgId: "org-test",
        createdBy: "dispatcher-uid",
        stops: [STOP_A, STOP_B],
      },
      [STOP_A, STOP_B],
    );

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .send({ status: "completed" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });
});

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
