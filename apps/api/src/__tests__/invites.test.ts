import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

beforeEach(() => {
  jest.clearAllMocks();
});

/**
 * Build a Firestore mock that:
 *   - returns the given user doc for users/{uid}.get()
 *   - lets `invites` collection return whatever the test wires up via
 *     `inviteOverrides` (default: an auto-id doc with a tracked `set`).
 */
function mockInvitesCollection(opts: {
  uid: string;
  role: string;
  orgId: string | null;
  inviteSet?: jest.Mock;
  inviteUpdate?: jest.Mock;
  inviteDocs?: { id: string; data: Record<string, unknown> }[];
  // For per-id lookups (DELETE / GET single): map id → { exists, data, orgId }
  inviteLookup?: Record<
    string,
    { exists: boolean; data?: Record<string, unknown> }
  >;
  generatedId?: string;
}) {
  const inviteSet = opts.inviteSet ?? jest.fn().mockResolvedValue(undefined);
  const inviteUpdate = opts.inviteUpdate ?? jest.fn().mockResolvedValue(undefined);
  const generatedId = opts.generatedId ?? "invite-auto-id";

  // List query (POST /invites & GET /invites)
  const listGet = jest.fn().mockResolvedValue({
    docs: (opts.inviteDocs ?? []).map((d) => ({ id: d.id, data: () => d.data })),
  });
  const where = jest.fn();
  const orderBy = jest.fn();
  const queryChain: any = { where, orderBy, get: listGet };
  where.mockReturnValue(queryChain);
  orderBy.mockReturnValue(queryChain);

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (_id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              role: opts.role,
              ...(opts.orgId ? { orgId: opts.orgId } : {}),
            }),
          }),
        }),
      };
    }

    if (col === "invites") {
      return {
        // doc() with no id → auto-id; doc(id) → look up that id.
        doc: (id?: string) => {
          if (!id) {
            return { id: generatedId, set: inviteSet };
          }
          const lookup = opts.inviteLookup?.[id];
          return {
            id,
            get: jest.fn().mockResolvedValue({
              exists: lookup?.exists ?? false,
              data: () => lookup?.data ?? null,
            }),
            set: inviteSet,
            update: inviteUpdate,
          };
        },
        where,
        orderBy,
        get: listGet,
      };
    }

    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });

  return { inviteSet, inviteUpdate, listGet, where, orderBy };
}

describe("POST /invites", () => {
  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockInvitesCollection({ uid, role: "dispatcher", orgId: "org-1" });

    const res = await request(app)
      .post("/invites")
      .set("Authorization", "Bearer fake-token")
      .send({ email: "new@example.com", role: "driver" });

    expect(res.status).toBe(403);
  });

  it("403 when admin has no orgId (requireOrg)", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin", "Admin", null);
    mockInvitesCollection({ uid, role: "admin", orgId: null });

    const res = await request(app)
      .post("/invites")
      .set("Authorization", "Bearer fake-token")
      .send({ email: "new@example.com", role: "driver" });

    expect(res.status).toBe(403);
  });

  it("400 for invalid body (missing role)", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin", "Admin", "org-1");
    mockInvitesCollection({ uid, role: "admin", orgId: "org-1" });

    const res = await request(app)
      .post("/invites")
      .set("Authorization", "Bearer fake-token")
      .send({ email: "new@example.com" });

    expect(res.status).toBe(400);
  });

  it("creates a pending invite scoped to the admin's org and lowercases email", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin", "Admin", "org-1");
    const { inviteSet } = mockInvitesCollection({
      uid,
      role: "admin",
      orgId: "org-1",
      generatedId: "invite-abc",
    });

    const res = await request(app)
      .post("/invites")
      .set("Authorization", "Bearer fake-token")
      .send({ email: "NEW@Example.com", role: "driver" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "invite-abc",
      orgId: "org-1",
      email: "new@example.com",
      role: "driver",
      status: "pending",
      createdBy: uid,
    });
    expect(inviteSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "invite-abc",
        orgId: "org-1",
        email: "new@example.com",
        role: "driver",
        status: "pending",
        createdBy: uid,
      }),
    );
  });
});

describe("GET /invites", () => {
  it("lists pending invites scoped to the admin's org", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin", "Admin", "org-1");
    const { where } = mockInvitesCollection({
      uid,
      role: "admin",
      orgId: "org-1",
      inviteDocs: [
        {
          id: "i1",
          data: {
            orgId: "org-1",
            email: "a@example.com",
            role: "driver",
            status: "pending",
            createdBy: uid,
            createdAt: "2026-04-19T00:00:00.000Z",
          },
        },
      ],
    });

    const res = await request(app)
      .get("/invites")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: "i1",
      email: "a@example.com",
      orgId: "org-1",
      status: "pending",
    });
    // Verify orgId was scoped & status filter applied for default listing.
    expect(where).toHaveBeenCalledWith("orgId", "==", "org-1");
    expect(where).toHaveBeenCalledWith("status", "==", "pending");
  });
});

describe("DELETE /invites/:id", () => {
  it("revokes a pending invite belonging to the admin's org", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin", "Admin", "org-1");
    const { inviteUpdate } = mockInvitesCollection({
      uid,
      role: "admin",
      orgId: "org-1",
      inviteLookup: {
        "invite-1": {
          exists: true,
          data: {
            orgId: "org-1",
            email: "a@example.com",
            role: "driver",
            status: "pending",
          },
        },
      },
    });

    const res = await request(app)
      .delete("/invites/invite-1")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(204);
    expect(inviteUpdate).toHaveBeenCalledWith({ status: "revoked" });
  });

  it("404 when the invite belongs to a different org (no leak)", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin", "Admin", "org-1");
    const { inviteUpdate } = mockInvitesCollection({
      uid,
      role: "admin",
      orgId: "org-1",
      inviteLookup: {
        "invite-2": {
          exists: true,
          data: {
            orgId: "some-other-org",
            email: "x@example.com",
            role: "driver",
            status: "pending",
          },
        },
      },
    });

    const res = await request(app)
      .delete("/invites/invite-2")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(404);
    expect(inviteUpdate).not.toHaveBeenCalled();
  });
});

describe("GET /invites/lookup/:token (public)", () => {
  it("returns minimal metadata for a pending invite (no auth required)", async () => {
    // No setupMockUser — public endpoint.
    mockInvitesCollection({
      uid: "anon",
      role: "driver",
      orgId: null,
      inviteLookup: {
        "tok-good": {
          exists: true,
          data: {
            orgId: "org-7",
            email: "lookup@example.com",
            role: "dispatcher",
            status: "pending",
            createdBy: "admin-9",
            createdAt: "2026-04-19T00:00:00.000Z",
          },
        },
      },
    });

    const res = await request(app).get("/invites/lookup/tok-good");

    expect(res.status).toBe(200);
    // Only the projection should leak — no createdBy / createdAt.
    expect(res.body).toEqual({
      email: "lookup@example.com",
      role: "dispatcher",
      orgId: "org-7",
      status: "pending",
    });
    expect(res.body.createdBy).toBeUndefined();
    expect(res.body.createdAt).toBeUndefined();
  });

  it("404 for a used invite", async () => {
    mockInvitesCollection({
      uid: "anon",
      role: "driver",
      orgId: null,
      inviteLookup: {
        "tok-used": {
          exists: true,
          data: {
            orgId: "org-7",
            email: "x@example.com",
            role: "driver",
            status: "used",
          },
        },
      },
    });

    const res = await request(app).get("/invites/lookup/tok-used");

    expect(res.status).toBe(404);
  });

  it("404 for a missing invite", async () => {
    mockInvitesCollection({
      uid: "anon",
      role: "driver",
      orgId: null,
      inviteLookup: {},
    });

    const res = await request(app).get("/invites/lookup/no-such-token");

    expect(res.status).toBe(404);
  });
});
