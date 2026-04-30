import request from "supertest";
import express from "express";
import { verifyFirebaseToken } from "../middleware/auth";
import driverRoutes from "../routes/drivers";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/firebase", () => ({
  auth: { verifyIdToken: jest.fn() },
  db: { collection: jest.fn() },
}));

jest.mock("../config/env", () => ({ env: { NODE_ENV: "test" } }));

// ── Helpers ────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/drivers", verifyFirebaseToken, driverRoutes);
  return app;
}

const TOKEN = "Bearer test-token";

function mockDispatcher(uid = "disp-1", trips: object[] = [], prevTrips: object[] = []) {
  const { auth, db } = require("../config/firebase");
  auth.verifyIdToken.mockResolvedValue({ uid });

  let queryCallCount = 0;
  db.collection.mockImplementation((name: string) => {
    if (name === "users") {
      return {
        doc: (id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () =>
              id === uid
                ? { role: "dispatcher", name: "Dispatcher", orgId: "org-1" }
                : { name: `Driver ${id.slice(0, 4)}` },
          }),
        }),
        where: jest.fn().mockReturnThis(),
      };
    }
    if (name === "trips") {
      return {
        where: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockImplementation(() => {
              queryCallCount++;
              const docs = queryCallCount === 1 ? trips : prevTrips;
              return {
                where: jest.fn().mockReturnThis(),
                get: jest.fn().mockResolvedValue({
                  docs: docs.map((t: any, i) => ({ id: `trip-${i}`, data: () => t })),
                }),
              };
            }),
          })),
        })),
      };
    }
    return {};
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /drivers/performance", () => {
  const app = createApp();

  beforeEach(() => jest.clearAllMocks());

  it("returns 403 when caller is a driver", async () => {
    const { auth, db } = require("../config/firebase");
    auth.verifyIdToken.mockResolvedValue({ uid: "d-1" });
    db.collection.mockImplementation(() => ({
      doc: () => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ role: "driver", orgId: "org-1" }),
        }),
      }),
    }));

    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.status).toBe(403);
  });

  it("returns empty leaderboard when no completed trips exist", async () => {
    mockDispatcher("disp-1", [], []);
    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.drivers).toEqual([]);
  });

  it("returns ranked driver list sorted by trip count desc", async () => {
    mockDispatcher(
      "disp-1",
      [
        { driverId: "d1", route: { durationSeconds: 600 } },
        { driverId: "d1", route: { durationSeconds: 900 } },
        { driverId: "d2", route: { durationSeconds: 300 } },
      ],
      [],
    );

    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.drivers).toHaveLength(2);
    expect(res.body.drivers[0].driverId).toBe("d1");
    expect(res.body.drivers[0].tripCount).toBe(2);
    expect(res.body.drivers[1].driverId).toBe("d2");
    expect(res.body.drivers[1].tripCount).toBe(1);
  });

  it("computes avgCompletionTimeSeconds correctly", async () => {
    mockDispatcher(
      "disp-1",
      [
        { driverId: "d1", route: { durationSeconds: 600 } },
        { driverId: "d1", route: { durationSeconds: 1200 } },
      ],
      [],
    );

    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.body.drivers[0].avgCompletionTimeSeconds).toBe(900);
  });

  it("computes onTimePct from predictedEta.errorMinutes", async () => {
    mockDispatcher(
      "disp-1",
      [
        { driverId: "d1", predictedEta: { errorMinutes: 5 } },  // on-time
        { driverId: "d1", predictedEta: { errorMinutes: 15 } }, // late
        { driverId: "d1", predictedEta: { errorMinutes: 8 } },  // on-time
      ],
      [],
    );

    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.body.drivers[0].onTimePct).toBe(67); // 2/3
  });

  it("sets trend to 'new' when driver had no previous trips", async () => {
    mockDispatcher("disp-1", [{ driverId: "d1" }], []);
    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.body.drivers[0].trend).toBe("new");
  });

  it("sets trend to 'up' when trip count increased", async () => {
    mockDispatcher(
      "disp-1",
      [{ driverId: "d1" }, { driverId: "d1" }],
      [{ driverId: "d1" }],
    );
    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.body.drivers[0].trend).toBe("up");
  });

  it("sets trend to 'down' when trip count decreased", async () => {
    mockDispatcher(
      "disp-1",
      [{ driverId: "d1" }],
      [{ driverId: "d1" }, { driverId: "d1" }],
    );
    const res = await request(app).get("/drivers/performance").set("Authorization", TOKEN);
    expect(res.body.drivers[0].trend).toBe("down");
  });

  it("returns periodDays in response", async () => {
    mockDispatcher("disp-1", [], []);
    const res = await request(app)
      .get("/drivers/performance?days=14")
      .set("Authorization", TOKEN);
    expect(res.body.periodDays).toBe(14);
  });
});
