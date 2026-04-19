import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

beforeEach(() => {
  jest.clearAllMocks();
});

function mockUsersCollection(handlers: {
  uid: string;
  role: string;
  wizardProgress?: any;
  update?: jest.Mock;
}) {
  const update = handlers.update ?? jest.fn().mockResolvedValue(undefined);
  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (_id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              role: handlers.role,
              ...(handlers.wizardProgress !== undefined
                ? { wizardProgress: handlers.wizardProgress }
                : {}),
            }),
          }),
          update,
          set: jest.fn(),
        }),
      };
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });
  return { update };
}

describe("GET /me/wizard-progress", () => {
  it("returns null when no progress is saved", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockUsersCollection({ uid, role: "admin" });

    const res = await request(app)
      .get("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wizardProgress: null });
  });

  it("returns saved progress", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const progress = {
      currentStep: 2,
      data: {
        orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      },
      updatedAt: "2026-04-19T00:00:00.000Z",
    };
    mockUsersCollection({ uid, role: "admin", wizardProgress: progress });

    const res = await request(app)
      .get("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(200);
    expect(res.body.wizardProgress).toEqual(progress);
  });

  it("403 for non-admin", async () => {
    const uid = "driver-1";
    setupMockUser(uid, "driver");
    mockUsersCollection({ uid, role: "driver" });

    const res = await request(app)
      .get("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(403);
  });
});

describe("PATCH /me/wizard-progress", () => {
  it("writes wizardProgress and returns 204", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const { update } = mockUsersCollection({ uid, role: "admin" });

    const body = {
      currentStep: 1,
      data: {
        orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      },
    };

    const res = await request(app)
      .patch("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token")
      .send(body);

    expect(res.status).toBe(204);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        wizardProgress: expect.objectContaining({
          currentStep: 1,
          data: body.data,
          updatedAt: expect.any(String),
        }),
      }),
    );
  });

  it("400 when currentStep is invalid", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockUsersCollection({ uid, role: "admin" });

    const res = await request(app)
      .patch("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token")
      .send({ currentStep: 4, data: {} });

    expect(res.status).toBe(400);
  });

  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockUsersCollection({ uid, role: "dispatcher" });

    const res = await request(app)
      .patch("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token")
      .send({ currentStep: 1, data: {} });

    expect(res.status).toBe(403);
  });
});
