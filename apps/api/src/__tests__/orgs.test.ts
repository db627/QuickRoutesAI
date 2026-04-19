import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

beforeEach(() => {
  jest.clearAllMocks();
});

const validPayload = {
  orgBasics: { name: "Acme Delivery", industry: "delivery", fleetSize: "6-20" },
  address: {
    street: "1 Main St",
    city: "Boston",
    state: "MA",
    zip: "02101",
    country: "US",
  },
  adminProfile: {
    name: "Alice Admin",
    phone: "555-123-4567",
    timezone: "America/New_York",
  },
};

/**
 * Mock helper: wires up Firestore so that `users/{uid}` behaves like a doc
 * with the given role / orgId, and `db.runTransaction` executes the callback
 * immediately with a transaction object that uses the same doc mock.
 */
function mockTransactionalOrgCreate(opts: {
  uid: string;
  role: string;
  existingOrgId?: string | null;
}) {
  const userDocRef = { id: opts.uid };
  const txGet = jest.fn().mockResolvedValue({
    exists: true,
    data: () => ({
      role: opts.role,
      ...(opts.existingOrgId ? { orgId: opts.existingOrgId } : {}),
    }),
  });
  const txUpdate = jest.fn();
  const txSet = jest.fn();

  const orgDocRef = { id: "new-org-id-abc" };
  const orgDocCreator = jest.fn().mockReturnValue(orgDocRef);

  db.runTransaction = jest.fn(async (fn: any) => {
    return fn({
      get: txGet,
      update: txUpdate,
      set: txSet,
    });
  });

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (_id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              role: opts.role,
              ...(opts.existingOrgId ? { orgId: opts.existingOrgId } : {}),
            }),
          }),
          // Returned reference for use inside the transaction
          ...userDocRef,
        }),
      };
    }
    if (col === "orgs") {
      return {
        doc: orgDocCreator,
      };
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });

  return { txGet, txUpdate, txSet, orgDocCreator };
}

describe("POST /orgs", () => {
  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockTransactionalOrgCreate({ uid, role: "dispatcher" });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  it("400 when payload is invalid", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockTransactionalOrgCreate({ uid, role: "admin" });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send({ ...validPayload, orgBasics: { name: "", industry: "delivery", fleetSize: "6-20" } });

    expect(res.status).toBe(400);
  });

  it("happy path: creates org, patches user, returns org+user", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const { txGet, txUpdate, txSet, orgDocCreator } = mockTransactionalOrgCreate({
      uid,
      role: "admin",
    });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.org).toMatchObject({
      id: "new-org-id-abc",
      name: "Acme Delivery",
      industry: "delivery",
      fleetSize: "6-20",
      address: validPayload.address,
      ownerUid: uid,
    });
    expect(res.body.user).toMatchObject({
      uid,
      orgId: "new-org-id-abc",
      name: "Alice Admin",
      phone: "555-123-4567",
      timezone: "America/New_York",
    });

    expect(txGet).toHaveBeenCalled();
    expect(orgDocCreator).toHaveBeenCalled(); // auto-id doc ref
    expect(txSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-org-id-abc" }),
      expect.objectContaining({
        name: "Acme Delivery",
        ownerUid: uid,
      }),
    );
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: uid }),
      expect.objectContaining({
        orgId: "new-org-id-abc",
        name: "Alice Admin",
        phone: "555-123-4567",
        timezone: "America/New_York",
        wizardProgress: expect.anything(), // FieldValue.delete() sentinel
      }),
    );
  });

  it("409 when the user already has an orgId", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockTransactionalOrgCreate({
      uid,
      role: "admin",
      existingOrgId: "existing-org",
    });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(409);
  });
});
