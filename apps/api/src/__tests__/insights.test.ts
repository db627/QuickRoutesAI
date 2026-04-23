import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

// Mock the AI service before the route is imported (createTestApp imports routes)
jest.mock("../services/ai", () => ({
  aiJson: jest.fn(),
}));

const { db } = require("../config/firebase");
const { aiJson } = require("../services/ai");

const app = createTestApp();

beforeEach(() => {
  jest.clearAllMocks();
});

function canonInsights(date: string) {
  return {
    date,
    highlights: ["All routes optimized"],
    concerns: ["High cancellation rate"],
    recommendations: ["Increase driver pool"],
    generatedAt: expect.any(String),
    stats: {
      tripsCompleted: 2,
      tripsCancelled: 1,
      activeDrivers: 1,
      avgDurationSeconds: 1800,
    },
  };
}

// Helper: build a db.collection mock for the users/insights/trips collections
function setupMocks({
  role = "admin",
  uid = "admin-123",
  cachedDoc = null as null | Record<string, unknown>,
  tripsDocs = [] as any[],
  insightsSetSpy,
}: {
  role?: string;
  uid?: string;
  cachedDoc?: null | Record<string, unknown>;
  tripsDocs?: any[];
  insightsSetSpy?: jest.Mock;
} = {}) {
  setupMockUser(uid, role, "Test User");

  const insightsDocSet = insightsSetSpy ?? jest.fn().mockResolvedValue(undefined);
  const insightsDocGet = jest.fn().mockResolvedValue({
    exists: cachedDoc !== null,
    data: () => cachedDoc,
  });

  const tripsWhereChain = {
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: tripsDocs.map((t) => ({ id: t.id, data: () => t })),
    }),
  };

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (id: string) => {
          if (id === uid) {
            return {
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ role, active: true }),
              }),
            };
          }
          return { get: jest.fn().mockResolvedValue({ exists: false }) };
        },
      };
    }
    if (col === "insights") {
      return {
        doc: (_id: string) => ({
          get: insightsDocGet,
          set: insightsDocSet,
        }),
      };
    }
    if (col === "trips") {
      return tripsWhereChain;
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false, docs: [] }),
      set: jest.fn().mockResolvedValue(undefined),
      where: jest.fn().mockReturnThis(),
    };
  });

  return { insightsDocSet, insightsDocGet, tripsWhereChain };
}

describe("GET /insights", () => {
  it("returns cached insights without invoking aiJson when doc exists", async () => {
    const cached = {
      date: "2026-04-18",
      highlights: ["cached h"],
      concerns: ["cached c"],
      recommendations: ["cached r"],
      generatedAt: "2026-04-18T12:00:00.000Z",
      stats: { tripsCompleted: 5, tripsCancelled: 0, activeDrivers: 3 },
    };
    const { insightsDocSet } = setupMocks({ cachedDoc: cached });

    const res = await request(app)
      .get("/insights?date=2026-04-18")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cached);
    expect(aiJson).not.toHaveBeenCalled();
    expect(insightsDocSet).not.toHaveBeenCalled();
  });

  it("generates, persists, and returns fresh insights when no cached doc", async () => {
    (aiJson as jest.Mock).mockResolvedValue({
      highlights: ["All routes optimized"],
      concerns: ["High cancellation rate"],
      recommendations: ["Increase driver pool"],
    });

    const { insightsDocSet } = setupMocks({
      cachedDoc: null,
      tripsDocs: [
        {
          id: "t1",
          status: "completed",
          driverId: "d1",
          route: { durationSeconds: 1200 },
          updatedAt: "2026-04-18T10:00:00.000Z",
        },
        {
          id: "t2",
          status: "completed",
          driverId: "d1",
          route: { durationSeconds: 2400 },
          updatedAt: "2026-04-18T11:00:00.000Z",
        },
        {
          id: "t3",
          status: "cancelled",
          driverId: "d1",
          updatedAt: "2026-04-18T12:00:00.000Z",
        },
      ],
    });

    const res = await request(app)
      .get("/insights?date=2026-04-18")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(aiJson).toHaveBeenCalledTimes(1);
    expect(insightsDocSet).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject(canonInsights("2026-04-18"));
  });

  it("defaults to today in UTC when no date query param given", async () => {
    (aiJson as jest.Mock).mockResolvedValue({
      highlights: ["h"],
      concerns: ["c"],
      recommendations: ["r"],
    });
    setupMocks({ cachedDoc: null, tripsDocs: [] });

    const res = await request(app)
      .get("/insights")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const todayYmd = new Date().toISOString().slice(0, 10);
    expect(res.body.date).toBe(todayYmd);
  });

  it("rejects invalid date format", async () => {
    setupMocks({});
    const res = await request(app)
      .get("/insights?date=bad-date")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("POST /insights/generate", () => {
  it("returns 403 for driver", async () => {
    setupMocks({ role: "driver", uid: "driver-1" });

    const res = await request(app)
      .post("/insights/generate?date=2026-04-18")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(aiJson).not.toHaveBeenCalled();
  });

  it("regenerates even when cached for admin", async () => {
    (aiJson as jest.Mock).mockResolvedValue({
      highlights: ["All routes optimized"],
      concerns: ["High cancellation rate"],
      recommendations: ["Increase driver pool"],
    });
    const cached = {
      date: "2026-04-18",
      highlights: ["stale"],
      concerns: [],
      recommendations: [],
      generatedAt: "2026-04-01T00:00:00.000Z",
      stats: { tripsCompleted: 0, tripsCancelled: 0, activeDrivers: 0 },
    };
    const { insightsDocSet } = setupMocks({
      role: "admin",
      uid: "admin-999",
      cachedDoc: cached,
      tripsDocs: [
        {
          id: "t1",
          status: "completed",
          driverId: "d1",
          route: { durationSeconds: 1800 },
          updatedAt: "2026-04-18T10:00:00.000Z",
        },
      ],
    });

    const res = await request(app)
      .post("/insights/generate?date=2026-04-18")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(aiJson).toHaveBeenCalledTimes(1);
    expect(insightsDocSet).toHaveBeenCalledTimes(1);
    // Fresh AI-generated arrays, not the cached "stale" highlight
    expect(res.body.highlights).toEqual(["All routes optimized"]);
    expect(res.body.concerns).toEqual(["High cancellation rate"]);
    expect(res.body.recommendations).toEqual(["Increase driver pool"]);
  });

  it("allows dispatcher", async () => {
    (aiJson as jest.Mock).mockResolvedValue({
      highlights: ["h"],
      concerns: ["c"],
      recommendations: ["r"],
    });
    setupMocks({ role: "dispatcher", uid: "disp-1", cachedDoc: null, tripsDocs: [] });

    const res = await request(app)
      .post("/insights/generate?date=2026-04-18")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });
});
