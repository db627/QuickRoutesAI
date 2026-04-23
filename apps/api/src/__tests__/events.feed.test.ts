/**
 * Tests for QRA-82: Live trip status event feed
 *
 * Verifies that all feed-relevant event writes include orgId, and that the
 * driver online/offline transition logic fires correctly.
 */
import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

const DRIVER_UID = "driver-abc";
const ORG_ID = "org-test";
const TRIP_ID = "trip-xyz";
const STOP_ID = "stop-111";

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Shared mock builders ──────────────────────────────────────────────────────

function makeAddEventMock() {
  return jest.fn().mockResolvedValue({ id: "event-id" });
}

function makeDriverDocMock(isOnline: boolean) {
  return {
    exists: true,
    data: () => ({ isOnline, orgId: ORG_ID, updatedAt: new Date().toISOString() }),
  };
}

function setupDriverLocationMock(isOnline: boolean, addEventMock: jest.Mock) {
  const setMock = jest.fn().mockResolvedValue(undefined);

  db.collection.mockImplementation((col: string) => {
    if (col === "drivers") {
      return {
        doc: (_uid: string) => ({
          get: jest.fn().mockResolvedValue(makeDriverDocMock(isOnline)),
          set: setMock,
        }),
      };
    }
    if (col === "events") {
      return { add: addEventMock };
    }
    if (col === "users") {
      return {
        doc: (id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "driver", orgId: ORG_ID }),
          }),
        }),
      };
    }
    return { doc: jest.fn().mockReturnThis(), get: jest.fn(), set: jest.fn() };
  });

  return { setMock };
}

function setupDriverOfflineMock(addEventMock: jest.Mock) {
  db.collection.mockImplementation((col: string) => {
    if (col === "drivers") {
      return {
        doc: () => ({
          set: jest.fn().mockResolvedValue(undefined),
        }),
      };
    }
    if (col === "events") {
      return { add: addEventMock };
    }
    if (col === "users") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "driver", orgId: ORG_ID }),
          }),
        }),
      };
    }
    return { doc: jest.fn().mockReturnThis(), get: jest.fn(), set: jest.fn() };
  });
}

function makeTripDoc(status: string) {
  return {
    exists: true,
    data: () => ({
      driverId: DRIVER_UID,
      createdBy: "dispatcher-uid",
      status,
      orgId: ORG_ID,
      stops: [],
      route: null,
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };
}

function setupTripStatusMock(currentStatus: string, addEventMock: jest.Mock) {
  db.collection.mockImplementation((col: string) => {
    if (col === "trips") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue(makeTripDoc(currentStatus)),
          update: jest.fn().mockResolvedValue(undefined),
          collection: () => ({
            get: jest.fn().mockResolvedValue({ docs: [] }),
            doc: () => ({
              get: jest.fn().mockResolvedValue({ exists: false }),
            }),
          }),
        }),
      };
    }
    if (col === "events") {
      return { add: addEventMock };
    }
    if (col === "users") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "driver", orgId: ORG_ID }),
          }),
        }),
      };
    }
    return { doc: jest.fn().mockReturnThis(), get: jest.fn(), set: jest.fn() };
  });
}

function setupStopCompleteMock(addEventMock: jest.Mock) {
  const STOP_A = { stopId: STOP_ID, address: "1 Main St", lat: 40, lng: -74, sequence: 0, notes: "", status: "pending" };
  const tripData = {
    driverId: DRIVER_UID,
    createdBy: "dispatcher-uid",
    status: "in_progress",
    orgId: ORG_ID,
    stops: [STOP_A],
    route: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.collection.mockImplementation((col: string) => {
    if (col === "trips") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({ exists: true, data: () => tripData }),
          update: jest.fn().mockResolvedValue(undefined),
          collection: (subCol: string) => {
            if (subCol === "stops") {
              return {
                doc: (stopId: string) => ({
                  get: jest.fn().mockResolvedValue(
                    stopId === STOP_ID
                      ? { exists: true, data: () => STOP_A }
                      : { exists: false },
                  ),
                  update: jest.fn().mockResolvedValue(undefined),
                }),
                get: jest.fn().mockResolvedValue({
                  docs: [{ id: STOP_ID, data: () => STOP_A }],
                }),
              };
            }
            return { doc: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ exists: false }) };
          },
        }),
      };
    }
    if (col === "events") {
      return { add: addEventMock };
    }
    if (col === "users") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "driver", orgId: ORG_ID }),
          }),
        }),
      };
    }
    return { doc: jest.fn().mockReturnThis(), get: jest.fn(), set: jest.fn() };
  });
}

// ── POST /drivers/location ────────────────────────────────────────────────────

describe("POST /drivers/location — event writes", () => {
  const validBody = { lat: 40.71, lng: -74.01, speedMps: 10, heading: 90 };

  it("emits location_ping with orgId", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupDriverLocationMock(true, addEventMock);

    const res = await request(app)
      .post("/drivers/location")
      .set("Authorization", "Bearer valid-token")
      .send(validBody);

    expect(res.status).toBe(200);

    const locationPingCall = addEventMock.mock.calls.find(
      ([args]) => args.type === "location_ping",
    );
    expect(locationPingCall).toBeDefined();
    expect(locationPingCall![0]).toMatchObject({
      type: "location_ping",
      driverId: DRIVER_UID,
      orgId: ORG_ID,
    });
  });

  it("emits status_change { status: 'online' } with orgId when driver was offline", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupDriverLocationMock(false, addEventMock); // driver is currently offline

    const res = await request(app)
      .post("/drivers/location")
      .set("Authorization", "Bearer valid-token")
      .send(validBody);

    expect(res.status).toBe(200);

    const onlineCall = addEventMock.mock.calls.find(
      ([args]) => args.type === "status_change" && args.payload?.status === "online",
    );
    expect(onlineCall).toBeDefined();
    expect(onlineCall![0]).toMatchObject({
      type: "status_change",
      driverId: DRIVER_UID,
      orgId: ORG_ID,
      payload: { status: "online" },
    });
  });

  it("does NOT emit status_change:online when driver is already online", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupDriverLocationMock(true, addEventMock); // driver is already online

    await request(app)
      .post("/drivers/location")
      .set("Authorization", "Bearer valid-token")
      .send(validBody);

    const onlineCall = addEventMock.mock.calls.find(
      ([args]) => args.type === "status_change" && args.payload?.status === "online",
    );
    expect(onlineCall).toBeUndefined();
  });

  it("emits status_change:online when driver doc does not exist yet", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    const setMock = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((col: string) => {
      if (col === "drivers") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: false }),
            set: setMock,
          }),
        };
      }
      if (col === "events") return { add: addEventMock };
      if (col === "users") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ role: "driver", orgId: ORG_ID }),
            }),
          }),
        };
      }
      return { doc: jest.fn().mockReturnThis(), get: jest.fn(), set: jest.fn() };
    });

    await request(app)
      .post("/drivers/location")
      .set("Authorization", "Bearer valid-token")
      .send(validBody);

    const onlineCall = addEventMock.mock.calls.find(
      ([args]) => args.type === "status_change" && args.payload?.status === "online",
    );
    expect(onlineCall).toBeDefined();
  });
});

// ── POST /drivers/offline ─────────────────────────────────────────────────────

describe("POST /drivers/offline — event writes", () => {
  it("emits status_change { status: 'offline' } with orgId", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupDriverOfflineMock(addEventMock);

    const res = await request(app)
      .post("/drivers/offline")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status_change",
        driverId: DRIVER_UID,
        orgId: ORG_ID,
        payload: { status: "offline" },
      }),
    );
  });
});

// ── POST /trips/:id/status ────────────────────────────────────────────────────

describe("POST /trips/:id/status — event writes", () => {
  it("emits status_change with orgId when trip moves to in_progress", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupTripStatusMock("assigned", addEventMock);

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status_change",
        orgId: ORG_ID,
        payload: expect.objectContaining({ tripId: TRIP_ID, to: "in_progress" }),
      }),
    );
  });

  it("emits status_change with orgId when trip moves to completed", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupTripStatusMock("in_progress", addEventMock);

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "completed" });

    expect(res.status).toBe(200);
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status_change",
        orgId: ORG_ID,
        payload: expect.objectContaining({ tripId: TRIP_ID, to: "completed" }),
      }),
    );
  });
});

// ── POST /trips/:id/stops/:stopId/complete ────────────────────────────────────

describe("POST /trips/:id/stops/:stopId/complete — event writes", () => {
  it("emits stop_completed with orgId", async () => {
    setupMockUser(DRIVER_UID, "driver");
    const addEventMock = makeAddEventMock();
    setupStopCompleteMock(addEventMock);

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/stops/${STOP_ID}/complete`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stop_completed",
        driverId: DRIVER_UID,
        orgId: ORG_ID,
        payload: expect.objectContaining({ tripId: TRIP_ID, stopId: STOP_ID }),
      }),
    );
  });
});
