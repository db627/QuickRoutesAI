import request from "supertest";
import express from "express";


function mockTripData(overrides: Partial<any> = {}) {
  return {
    driverId: null,
    createdBy: "dispatcher-uid",
    status: "draft",
    notes: "Initial notes",
    stops: [
      { stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "Sign for package" },
      { stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "Pick up package" },
    ],
    route: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

jest.mock("../../config/firebase", () => ({
  db: {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => mockTripData(), 
    }),
  },
  auth: {},
}));



import { tripTransitionGuard } from "../../middleware/trips";
import { randomUUID } from "crypto";

function createValidationApp() {
  const app = express();
  app.use(express.json());
  app.post("/test", tripTransitionGuard, (_req, res) => {
    res.json({ ok: true, body: _req.body });
  });
  return app;
}

// Mock global fetch for Firebase REST API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});




describe("tripTransitionGuard middleware", () => {
  const app = createValidationApp();

  /* 
  Test valid/invalid draft transitions
  */
  it("passes from draft to assigned", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "draft",
        status_test: "assigned",
      });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.body).toBeDefined();
  });

  it("passes from draft to cancelled", async () => {
    const response = await request(app)
      .post("/test")
      .send({ 
        current_status_test: "draft", 
        status_test: "cancelled" 
        });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.body).toBeDefined();
  });

  it("rejects invalid transition from draft to completed", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "draft",
        status_test: "completed",
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Bad Request");
    expect(response.body.message).toBe("draft trips cannot transition to completed");
  });

  /* 
  Test valid/invalid assigned transitions
  */
  it("passes from assigned to in_progress", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "assigned",
        status_test: "in_progress",
      });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.body).toBeDefined();
  });

  it("passes from assigned to cancelled", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "assigned",
        status_test: "cancelled",
      });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.body).toBeDefined();
  });

  it("rejects invalid transition from assigned to completed", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "assigned",
        status_test: "completed",
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Bad Request");
    expect(response.body.message).toBe("assigned trips cannot transition to completed");
  });

  /* 
  Test valid/invalid in_progress transitions
  */

  it("passes from in_progress to completed", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "in_progress",
        status_test: "completed",
      });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.body).toBeDefined();
  });

  it("rejects invalid transition from in_progress to cancelled", async () => {
    const response = await request(app)
      .post("/test")
      .send({
        current_status_test: "in_progress",
        status_test: "cancelled",
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Bad Request");
    expect(response.body.message).toBe("in_progress trips cannot transition to cancelled");
  });

    /* 
    Test valid/invalid completed transitions
    */
    for(const nextStatus of ["draft", "assigned", "in_progress", "cancelled"]){
        it(`rejects invalid transition from completed to ${nextStatus}`, async () => {
            const response = await request(app)
            .post("/test")
            .send({
                current_status_test: "completed",
                status_test: nextStatus,
            });
            expect(response.status).toBe(409);
            expect(response.body.error).toBe("Bad Request");
            expect(response.body.message).toBe(`completed trips cannot transition to ${nextStatus}`);
        });
    }
    
    /* 
    Test invalid cancelled transitions
    */
    for(const nextStatus of ["draft", "assigned", "in_progress", "cancelled"]){
        it(`rejects invalid transition from cancelled to ${nextStatus}`, async () => {
            const response = await request(app)
            .post("/test")
            .send({
                current_status_test: "cancelled",
                status_test: nextStatus,
            });
            expect(response.status).toBe(409);
            expect(response.body.error).toBe("Bad Request");
            expect(response.body.message).toBe(`cancelled trips cannot transition to ${nextStatus}`);
        });
    }

    /*
    Test invalid transition
    */
   it(`rejects invalid current_status`, async () => {
            const response = await request(app)
            .post("/test")
            .send({
                current_status_test: "dropped_off",
                status_test: "cancelled",
            });
            expect(response.status).toBe(400);
            expect(response.body.error).toBe("Bad Request");
            expect(response.body.message).toBe("Invalid current trip status");
    });

    it(`rejects invalid status`, async () => {
            const response = await request(app)
            .post("/test")
            .send({
                current_status_test: "draft",
                status_test: "dropped_off",
            });
            expect(response.status).toBe(400);
            expect(response.body.error).toBe("Bad Request");
            expect(response.body.message).toBe("Unknown transition occurring");
    });

  
});