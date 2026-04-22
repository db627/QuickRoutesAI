import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const { db } = require("../config/firebase");

const app = createTestApp();

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-1",
    status: "completed",
    orgId: "org-test",
    stopCount: 3,
    createdAt: "2026-04-01T09:00:00.000Z",
    updatedAt: "2026-04-01T10:30:00.000Z", // 90-min delivery
    ...overrides,
  };
}

function setupMocks(uid: string, role: string, tripDocs: unknown[] = []) {
  setupMockUser(uid, role);

  const chainable = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: tripDocs.map((t: any) => ({ id: t.id, data: () => t })),
    }),
  };

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role, orgId: "org-test" }),
          }),
        }),
      };
    }
    if (col === "trips") return chainable;
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false, docs: [] }),
      where: jest.fn().mockReturnThis(),
    };
  });

  return chainable;
}

// ── Role / auth guards ────────────────────────────────────────────────────────

describe("GET /analytics — auth & role guards", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get("/analytics");
    expect(res.status).toBe(401);
  });

  it("returns 403 for driver role", async () => {
    setupMocks("driver-1", "driver", []);
    const res = await request(app)
      .get("/analytics")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("allows dispatcher", async () => {
    setupMocks("disp-1", "dispatcher", []);
    const res = await request(app)
      .get("/analytics")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });

  it("allows admin", async () => {
    setupMocks("admin-1", "admin", []);
    const res = await request(app)
      .get("/analytics")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("GET /analytics — input validation", () => {
  it("returns 400 for an invalid 'from' date", async () => {
    setupMocks("disp-1", "dispatcher", []);
    const res = await request(app)
      .get("/analytics?from=not-a-date&to=2026-04-30")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 400 when 'from' is after 'to'", async () => {
    setupMocks("disp-1", "dispatcher", []);
    const res = await request(app)
      .get("/analytics?from=2026-04-30&to=2026-04-01")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("GET /analytics — response shape", () => {
  it("returns tripsByDay, avgDeliveryByDay, and summary keys", async () => {
    setupMocks("disp-1", "dispatcher", []);
    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-07")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tripsByDay");
    expect(res.body).toHaveProperty("avgDeliveryByDay");
    expect(res.body).toHaveProperty("summary");
    expect(res.body.summary).toHaveProperty("totalTrips");
    expect(res.body.summary).toHaveProperty("totalStops");
    expect(res.body.summary).toHaveProperty("onTimePercentage");
    expect(res.body.summary).toHaveProperty("tripsWithEta");
  });

  it("fills every day in range with 0 when there are no trips", async () => {
    setupMocks("disp-1", "dispatcher", []);
    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-03")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.tripsByDay).toEqual([
      { date: "2026-04-01", count: 0 },
      { date: "2026-04-02", count: 0 },
      { date: "2026-04-03", count: 0 },
    ]);
    expect(res.body.summary.totalTrips).toBe(0);
    expect(res.body.summary.totalStops).toBe(0);
  });

  it("returns null onTimePercentage when no trips have ETA data", async () => {
    setupMocks("disp-1", "dispatcher", [makeTrip()]);
    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-07")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.summary.onTimePercentage).toBeNull();
    expect(res.body.summary.tripsWithEta).toBe(0);
  });
});

// ── Aggregation logic ─────────────────────────────────────────────────────────

describe("GET /analytics — aggregation", () => {
  it("counts trips per day correctly", async () => {
    const trips = [
      makeTrip({ id: "t1", createdAt: "2026-04-01T08:00:00.000Z", updatedAt: "2026-04-01T09:30:00.000Z" }),
      makeTrip({ id: "t2", createdAt: "2026-04-01T10:00:00.000Z", updatedAt: "2026-04-01T11:30:00.000Z" }),
      makeTrip({ id: "t3", createdAt: "2026-04-03T09:00:00.000Z", updatedAt: "2026-04-03T10:00:00.000Z" }),
    ];
    setupMocks("disp-1", "dispatcher", trips);

    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-03")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const byDay: { date: string; count: number }[] = res.body.tripsByDay;
    expect(byDay.find((d) => d.date === "2026-04-01")?.count).toBe(2);
    expect(byDay.find((d) => d.date === "2026-04-02")?.count).toBe(0);
    expect(byDay.find((d) => d.date === "2026-04-03")?.count).toBe(1);
  });

  it("sums stopCount into totalStops", async () => {
    const trips = [
      makeTrip({ id: "t1", stopCount: 4 }),
      makeTrip({ id: "t2", stopCount: 2 }),
    ];
    setupMocks("disp-1", "dispatcher", trips);

    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-07")
      .set("Authorization", "Bearer valid-token");

    expect(res.body.summary.totalStops).toBe(6);
  });

  it("calculates avg delivery time only for completed trips", async () => {
    const trips = [
      // completed — 90 min
      makeTrip({
        id: "t1",
        status: "completed",
        createdAt: "2026-04-01T08:00:00.000Z",
        updatedAt: "2026-04-01T09:30:00.000Z",
      }),
      // in_progress — should be excluded from avg delivery
      makeTrip({
        id: "t2",
        status: "in_progress",
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T10:15:00.000Z",
      }),
    ];
    setupMocks("disp-1", "dispatcher", trips);

    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-07")
      .set("Authorization", "Bearer valid-token");

    expect(res.body.avgDeliveryByDay).toHaveLength(1);
    expect(res.body.avgDeliveryByDay[0].avgMinutes).toBe(90);
  });

  it("calculates on-time percentage correctly", async () => {
    const trips = [
      // on time
      makeTrip({
        id: "t1",
        predictedEta: {
          predictedArrivalAt: "2026-04-01T10:00:00.000Z",
          actualArrivalAt: "2026-04-01T09:58:00.000Z",
        },
      }),
      // late (>5 min)
      makeTrip({
        id: "t2",
        predictedEta: {
          predictedArrivalAt: "2026-04-01T10:00:00.000Z",
          actualArrivalAt: "2026-04-01T10:20:00.000Z",
        },
      }),
    ];
    setupMocks("disp-1", "dispatcher", trips);

    const res = await request(app)
      .get("/analytics?from=2026-04-01&to=2026-04-07")
      .set("Authorization", "Bearer valid-token");

    expect(res.body.summary.tripsWithEta).toBe(2);
    expect(res.body.summary.onTimePercentage).toBe(50);
  });
});
