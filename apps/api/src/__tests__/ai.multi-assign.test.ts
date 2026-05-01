import request from "supertest";
import express from "express";
import { verifyFirebaseToken } from "../middleware/auth";
import aiRoutes from "../routes/ai";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/firebase", () => ({
  auth: { verifyIdToken: jest.fn() },
  db: {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue({ id: "event-1" }),
    update: jest.fn().mockResolvedValue(undefined),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  },
}));

jest.mock("../config/env", () => ({
  env: { NODE_ENV: "test" },
}));

jest.mock("../services/ai", () => ({
  distributeStopsAcrossDrivers: jest.fn(),
  pickBestDriver: jest.fn(),
  correctAddresses: jest.fn(),
  generateDailySummary: jest.fn(),
  detectAnomalies: jest.fn(),
  predictETA: jest.fn(),
}));

jest.mock("../services/directions", () => ({
  geocodeAddress: jest.fn(),
  computeRoute: jest.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/ai", verifyFirebaseToken, aiRoutes);
  return app;
}

function mockDispatcher(uid = "disp-1") {
  const { auth, db } = require("../config/firebase");
  auth.verifyIdToken.mockResolvedValue({ uid });
  db.collection.mockImplementation((name: string) => {
    if (name === "users") {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "dispatcher", name: "Test Dispatcher" }),
          }),
        }),
      };
    }
    return {
      doc: () => ({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        set: jest.fn().mockResolvedValue(undefined),
      }),
      add: jest.fn().mockResolvedValue({ id: "event-1" }),
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    };
  });
}

const TOKEN = "Bearer test-token";

const STOPS = [
  { address: "100 Main St, NYC" },
  { address: "200 Oak Ave, Brooklyn" },
  { address: "300 Pine Rd, Queens" },
];

const DRIVER_IDS = ["driver-1", "driver-2"];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /ai/multi-assign", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatcher();
  });

  it("returns 400 when driverIds is missing", async () => {
    const res = await request(app)
      .post("/ai/multi-assign")
      .set("Authorization", TOKEN)
      .send({ stops: STOPS });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/driverIds/i);
  });

  it("returns 400 when stops is missing", async () => {
    const res = await request(app)
      .post("/ai/multi-assign")
      .set("Authorization", TOKEN)
      .send({ driverIds: DRIVER_IDS });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stops/i);
  });

  it("returns 400 when there are more drivers than stops", async () => {
    const res = await request(app)
      .post("/ai/multi-assign")
      .set("Authorization", TOKEN)
      .send({ driverIds: ["d1", "d2", "d3"], stops: [{ address: "One stop" }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least as many stops/i);
  });

  it("returns 403 when user is a driver (not dispatcher/admin)", async () => {
    const { auth, db } = require("../config/firebase");
    auth.verifyIdToken.mockResolvedValue({ uid: "driver-uid" });
    db.collection.mockImplementation(() => ({
      doc: () => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ role: "driver", name: "Bob" }),
        }),
      }),
    }));

    const res = await request(app)
      .post("/ai/multi-assign")
      .set("Authorization", TOKEN)
      .send({ driverIds: DRIVER_IDS, stops: STOPS });

    expect(res.status).toBe(403);
  });

  it("distributes stops, creates trips, and returns plans", async () => {
    const { distributeStopsAcrossDrivers } = require("../services/ai");
    const { geocodeAddress, computeRoute } = require("../services/directions");
    const { db } = require("../config/firebase");

    geocodeAddress.mockResolvedValue({ lat: 40.71, lng: -74.01 });

    distributeStopsAcrossDrivers.mockResolvedValue({
      assignments: [
        { driverIndex: 0, stopIndices: [0, 1] },
        { driverIndex: 1, stopIndices: [2] },
      ],
      reasoning: "Cluster north stops to driver 1, south stop to driver 2.",
    });

    computeRoute.mockResolvedValue({
      route: { distanceMeters: 5000, durationSeconds: 600, polyline: "abc", legs: [] },
      optimizedStops: [],
    });

    let tripSetCallCount = 0;
    const tripDocMock = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", name: "Dispatcher" }) }),
      set: jest.fn().mockImplementation(() => { tripSetCallCount++; return Promise.resolve(); }),
    };
    const eventAddMock = jest.fn().mockResolvedValue({ id: "event-1" });

    db.collection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ role: "dispatcher", name: "Test Dispatcher" }),
            }),
          }),
        };
      }
      if (name === "drivers") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ lastLocation: { lat: 40.71, lng: -74.01 } }),
            }),
          }),
        };
      }
      if (name === "trips") {
        return { doc: () => ({ ...tripDocMock, id: `trip-${Math.random()}` }) };
      }
      if (name === "events") {
        return { add: eventAddMock };
      }
      return { doc: () => tripDocMock, add: eventAddMock };
    });

    const res = await request(app)
      .post("/ai/multi-assign")
      .set("Authorization", TOKEN)
      .send({ driverIds: DRIVER_IDS, stops: STOPS });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.plans).toHaveLength(2);
    expect(res.body.overallReasoning).toBeTruthy();
    expect(distributeStopsAcrossDrivers).toHaveBeenCalledTimes(1);
    expect(computeRoute).toHaveBeenCalledTimes(2);
  });
});
