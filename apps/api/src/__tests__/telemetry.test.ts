import request from "supertest";
import express from "express";
import { verifyFirebaseToken } from "../middleware/auth";
import telemetryRoutes from "../routes/telemetry";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/firebase", () => ({
  auth: { verifyIdToken: jest.fn() },
  db: {
    collection: jest.fn(),
  },
}));

jest.mock("../config/env", () => ({
  env: { NODE_ENV: "test" },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/telemetry", verifyFirebaseToken, telemetryRoutes);
  return app;
}

const TOKEN = "Bearer test-token";

const VALID_POINTS = [
  { lat: 40.7128, lng: -74.006, speedMps: 10, heading: 90, accuracy: 5, timestamp: "2026-04-28T10:00:00.000Z" },
  { lat: 40.714, lng: -74.008, speedMps: 12, heading: 92, accuracy: 4, timestamp: "2026-04-28T10:00:05.000Z" },
];

function mockDriver(uid = "driver-1", tripData: Record<string, any> | null = null) {
  const { auth, db } = require("../config/firebase");

  auth.verifyIdToken.mockResolvedValue({ uid });

  const batchMock = {
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };

  db.collection.mockImplementation((name: string) => {
    if (name === "users") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({ exists: false }),
        }),
      };
    }
    if (name === "drivers") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "driver" }),
          }),
          update: jest.fn().mockResolvedValue(undefined),
        }),
      };
    }
    if (name === "trips") {
      return {
        doc: (id: string) => ({
          get: jest.fn().mockResolvedValue(
            tripData
              ? { exists: true, data: () => tripData }
              : { exists: false },
          ),
          collection: () => ({ doc: () => ({ id: "tel-doc" }) }),
        }),
      };
    }
    return {};
  });

  db.batch = jest.fn().mockReturnValue(batchMock);
  return batchMock;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /telemetry", () => {
  const app = createApp();

  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when tripId is missing", async () => {
    mockDriver();
    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ points: VALID_POINTS });

    expect(res.status).toBe(400);
  });

  it("returns 400 when points array is empty", async () => {
    mockDriver();
    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 when a point has an invalid lat", async () => {
    mockDriver();
    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points: [{ lat: 999, lng: -74, timestamp: "2026-04-28T10:00:00.000Z" }] });

    expect(res.status).toBe(400);
  });

  it("returns 404 when trip does not exist", async () => {
    mockDriver("driver-1", null);
    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "nonexistent", points: VALID_POINTS });

    expect(res.status).toBe(404);
  });

  it("returns 403 when trip belongs to a different driver", async () => {
    mockDriver("driver-1", { driverId: "other-driver", status: "in_progress" });
    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points: VALID_POINTS });

    expect(res.status).toBe(403);
  });

  it("returns 400 when trip is not in_progress", async () => {
    mockDriver("driver-1", { driverId: "driver-1", status: "assigned" });
    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points: VALID_POINTS });

    expect(res.status).toBe(400);
  });

  it("returns 403 when caller is not a driver role", async () => {
    const { auth, db } = require("../config/firebase");
    auth.verifyIdToken.mockResolvedValue({ uid: "disp-1" });
    db.collection.mockImplementation((name: string) => ({
      doc: () => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ role: "dispatcher" }),
        }),
      }),
    }));

    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points: VALID_POINTS });

    expect(res.status).toBe(403);
  });

  it("returns 202 and writes telemetry batch for valid in_progress trip", async () => {
    const batchMock = mockDriver("driver-1", { driverId: "driver-1", status: "in_progress" });

    const res = await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points: VALID_POINTS });

    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(VALID_POINTS.length);
    expect(batchMock.set).toHaveBeenCalledTimes(VALID_POINTS.length);
    expect(batchMock.update).toHaveBeenCalledTimes(1); // driver location update
    expect(batchMock.commit).toHaveBeenCalledTimes(1);
  });

  it("picks the most recent point to update driver location", async () => {
    const batchMock = mockDriver("driver-1", { driverId: "driver-1", status: "in_progress" });

    const points = [
      { lat: 40.71, lng: -74.0, timestamp: "2026-04-28T10:00:00.000Z" },
      { lat: 40.72, lng: -74.1, timestamp: "2026-04-28T10:00:10.000Z" }, // latest
    ];

    await request(app)
      .post("/telemetry")
      .set("Authorization", TOKEN)
      .send({ tripId: "trip-1", points });

    const updateCall = batchMock.update.mock.calls[0];
    expect(updateCall[1].lastLocation).toEqual({ lat: 40.72, lng: -74.1 });
  });
});
