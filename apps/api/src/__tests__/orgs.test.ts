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

  it("404 when the user doc is missing mid-transaction", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    // Setup mocks manually so tx.get returns { exists: false }
    const txGet = jest.fn().mockResolvedValue({ exists: false, data: () => null });
    const txUpdate = jest.fn();
    const txSet = jest.fn();
    db.runTransaction = jest.fn(async (fn: any) => fn({ get: txGet, update: txUpdate, set: txSet }));
    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (_id: string) => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "admin" }) }),
            id: uid,
          }),
        };
      }
      if (col === "orgs") {
        return { doc: jest.fn().mockReturnValue({ id: "new-org-id-abc" }) };
      }
      return { doc: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ exists: false }) };
    });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(404);
    expect(txSet).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });
});

/**
 * Mock helper: wire up Firestore for GET / PATCH /orgs/:id.
 *   - users/{uid}     → returns { role, orgId: userOrgId }
 *   - orgs/{orgIdArg} → returns { exists: orgExists, data: orgData }
 * Returns the orgUpdate jest.fn so PATCH tests can assert on it.
 */
function mockOrgLookup(opts: {
  uid: string;
  role: string;
  userOrgId: string | null;
  orgData?: Record<string, unknown> | null;
}) {
  const orgUpdate = jest.fn().mockResolvedValue(undefined);
  const orgExists = opts.orgData !== null && opts.orgData !== undefined;
  const orgGet = jest.fn().mockResolvedValue({
    exists: orgExists,
    data: () => opts.orgData ?? null,
  });

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (_id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              role: opts.role,
              ...(opts.userOrgId ? { orgId: opts.userOrgId } : {}),
            }),
          }),
        }),
      };
    }
    if (col === "orgs") {
      return {
        doc: (_id: string) => ({
          get: orgGet,
          update: orgUpdate,
        }),
      };
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });

  return { orgUpdate, orgGet };
}

const sampleOrg = {
  id: "org-1",
  name: "Acme Delivery",
  industry: "delivery",
  fleetSize: "6-20",
  address: {
    street: "1 Main St",
    city: "Boston",
    state: "MA",
    zip: "02101",
    country: "US",
  },
  ownerUid: "admin-1",
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
};

describe("GET /orgs/:id", () => {
  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockOrgLookup({ uid, role: "dispatcher", userOrgId: "org-1", orgData: sampleOrg });

    const res = await request(app)
      .get("/orgs/org-1")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(403);
  });

  it("403 when admin belongs to a different org", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockOrgLookup({ uid, role: "admin", userOrgId: "some-other-org", orgData: sampleOrg });

    const res = await request(app)
      .get("/orgs/org-1")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(403);
  });

  it("404 when org is missing", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockOrgLookup({ uid, role: "admin", userOrgId: "org-1", orgData: null });

    const res = await request(app)
      .get("/orgs/org-1")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(404);
  });

  it("200 returns the org for the owning admin", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockOrgLookup({ uid, role: "admin", userOrgId: "org-1", orgData: sampleOrg });

    const res = await request(app)
      .get("/orgs/org-1")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "org-1",
      name: "Acme Delivery",
      industry: "delivery",
      fleetSize: "6-20",
      ownerUid: "admin-1",
    });
  });
});

describe("PATCH /orgs/:id", () => {
  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockOrgLookup({ uid, role: "dispatcher", userOrgId: "org-1", orgData: sampleOrg });

    const res = await request(app)
      .patch("/orgs/org-1")
      .set("Authorization", "Bearer fake-token")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("403 when admin belongs to a different org", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockOrgLookup({ uid, role: "admin", userOrgId: "some-other-org", orgData: sampleOrg });

    const res = await request(app)
      .patch("/orgs/org-1")
      .set("Authorization", "Bearer fake-token")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("400 for invalid payload", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockOrgLookup({ uid, role: "admin", userOrgId: "org-1", orgData: sampleOrg });

    const res = await request(app)
      .patch("/orgs/org-1")
      .set("Authorization", "Bearer fake-token")
      .send({ industry: "not-a-real-industry" });

    expect(res.status).toBe(400);
  });

  it("200 updates the org and returns the merged doc", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const { orgUpdate, orgGet } = mockOrgLookup({
      uid,
      role: "admin",
      userOrgId: "org-1",
      orgData: sampleOrg,
    });

    // First .get() call is the existence check (returns sampleOrg via mockResolvedValue already set).
    // Second .get() call (re-read after update) returns the modified org — queue it as a once value.
    orgGet
      .mockResolvedValueOnce({ exists: true, data: () => sampleOrg })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ...sampleOrg, name: "Acme Logistics" }) });

    const patch = { name: "Acme Logistics", industry: "logistics" as const };

    const res = await request(app)
      .patch("/orgs/org-1")
      .set("Authorization", "Bearer fake-token")
      .send(patch);

    expect(res.status).toBe(200);
    expect(orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme Logistics",
        industry: "logistics",
        updatedAt: expect.any(String),
      }),
    );
    expect(res.body).toMatchObject({ name: "Acme Logistics" });
  });

  it("400 when body is empty", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockOrgLookup({ uid, role: "admin", userOrgId: "org-1", orgData: sampleOrg });

    const res = await request(app)
      .patch("/orgs/test-org")
      .set("Authorization", "Bearer fake-token")
      .send({});

    expect(res.status).toBe(400);
  });
});
