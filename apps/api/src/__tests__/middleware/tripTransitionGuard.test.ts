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
});