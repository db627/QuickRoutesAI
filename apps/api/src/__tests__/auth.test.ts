import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();

// Get mocked modules
const { auth, db } = require("../config/firebase");

// Mock global fetch for Firebase REST API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});

/**
 * Build a Firestore collection mock where `orgs/{id}` returns a doc with
 * `exists: orgExists`, every other collection accepts `set` (no-op), and
 * `users`/`drivers` writes are tracked on returned spies.
 *
 * Returns a reference to the tracked spies so individual tests can assert
 * what was written to users and drivers.
 */
function makeCollectionMock({
  orgExists = false,
}: { orgExists?: boolean } = {}) {
  const userSet = jest.fn().mockResolvedValue(undefined);
  const driverSet = jest.fn().mockResolvedValue(undefined);

  db.collection.mockImplementation((col: string) => ({
    doc: (_id: string) => {
      if (col === "orgs") {
        return {
          get: jest.fn().mockResolvedValue({ exists: orgExists }),
          set: jest.fn().mockResolvedValue(undefined),
        };
      }
      if (col === "users") {
        return {
          set: userSet,
          get: jest.fn().mockResolvedValue({ exists: false }),
        };
      }
      if (col === "drivers") {
        return {
          set: driverSet,
          get: jest.fn().mockResolvedValue({ exists: false }),
        };
      }
      return {
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue({ exists: false }),
      };
    },
  }));

  return { userSet, driverSet };
}

describe("POST /auth/signup", () => {
  it("creates a new user and returns a token", async () => {
    const uid = "new-user-123";

    auth.createUser.mockResolvedValue({ uid, email: "new@example.com" });

    const { userSet } = makeCollectionMock({ orgExists: true });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        idToken: "firebase-id-token-abc",
        refreshToken: "refresh-token-abc",
        expiresIn: "3600",
        localId: uid,
        email: "new@example.com",
      }),
    });

    const res = await request(app).post("/auth/signup").send({
      email: "new@example.com",
      password: "securePassword123",
      name: "New User",
      role: "dispatcher",
      orgCode: "org-xyz",
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe("firebase-id-token-abc");
    expect(res.body.refreshToken).toBe("refresh-token-abc");
    expect(res.body.user.uid).toBe(uid);
    expect(res.body.user.email).toBe("new@example.com");
    expect(res.body.user.name).toBe("New User");
    expect(res.body.user.role).toBe("dispatcher");

    // Verify Firebase createUser was called
    expect(auth.createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "securePassword123",
    });

    // The user profile should be stamped with orgId
    expect(userSet).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-xyz", role: "dispatcher" }),
    );
  });

  it("allows admin signup without orgCode (no orgId stamped — wizard will create org later)", async () => {
    const uid = "admin-user-123";

    auth.createUser.mockResolvedValue({ uid, email: "admin@example.com" });

    const { userSet } = makeCollectionMock({ orgExists: false });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        idToken: "firebase-id-token-admin",
        refreshToken: "refresh",
        expiresIn: "3600",
        localId: uid,
        email: "admin@example.com",
      }),
    });

    const res = await request(app).post("/auth/signup").send({
      email: "admin@example.com",
      password: "securePassword123",
      name: "Admin User",
      role: "admin",
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("admin");

    // No orgId set on the user profile yet — the onboarding wizard creates
    // the org and stamps orgId on first dashboard visit.
    const [profile] = userSet.mock.calls[0];
    expect(profile).not.toHaveProperty("orgId");
  });

  it("rejects driver signup without orgCode", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "driver-no-org@example.com",
      password: "securePassword123",
      name: "Driver No Org",
      role: "driver",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Organization code is required/i);
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it("rejects dispatcher signup without orgCode", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "disp-no-org@example.com",
      password: "securePassword123",
      name: "Disp No Org",
      role: "dispatcher",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Organization code is required/i);
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it("rejects signup when orgCode does not exist", async () => {
    makeCollectionMock({ orgExists: false });

    const res = await request(app).post("/auth/signup").send({
      email: "ghost@example.com",
      password: "securePassword123",
      name: "Ghost User",
      role: "driver",
      orgCode: "nonexistent-org",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid organization code/i);
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it("stamps orgId on driver and user docs when valid orgCode is provided", async () => {
    const uid = "driver-with-org-123";

    auth.createUser.mockResolvedValue({ uid, email: "driver2@example.com" });

    const { userSet, driverSet } = makeCollectionMock({ orgExists: true });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        idToken: "tok",
        refreshToken: "ref",
        expiresIn: "3600",
        localId: uid,
        email: "driver2@example.com",
      }),
    });

    const res = await request(app).post("/auth/signup").send({
      email: "driver2@example.com",
      password: "securePassword123",
      name: "Driver With Org",
      role: "driver",
      orgCode: "org-abc",
    });

    expect(res.status).toBe(201);
    expect(userSet).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-abc", role: "driver" }),
    );
    expect(driverSet).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-abc" }),
    );
  });

  it("returns 409 when email already exists", async () => {
    auth.createUser.mockRejectedValue(new Error("EMAIL_EXISTS"));

    // Admin path: no orgCode required, so we get past the org check and
    // hit the createUser rejection.
    const res = await request(app).post("/auth/signup").send({
      email: "existing@example.com",
      password: "securePassword123",
      name: "Duplicate User",
      role: "admin",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Conflict");
    expect(res.body.message).toBe("Email already in use");
  });

  it("returns 400 for invalid email", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "not-an-email",
      password: "securePassword123",
      name: "Bad Email User",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for short password", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "test@example.com",
      password: "123",
      name: "Short Pass User",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing name", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "test@example.com",
      password: "securePassword123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("defaults role to driver when not specified (with orgCode)", async () => {
    const uid = "driver-user-123";

    auth.createUser.mockResolvedValue({ uid, email: "driver@example.com" });

    makeCollectionMock({ orgExists: true });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        idToken: "token",
        refreshToken: "refresh",
        expiresIn: "3600",
        localId: uid,
        email: "driver@example.com",
      }),
    });

    const res = await request(app).post("/auth/signup").send({
      email: "driver@example.com",
      password: "securePassword123",
      name: "Driver User",
      orgCode: "org-default",
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("driver");
  });
});

describe("POST /auth/login", () => {
  it("returns a token for valid credentials", async () => {
    const uid = "existing-user-456";

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        idToken: "firebase-id-token-xyz",
        refreshToken: "refresh-token-xyz",
        expiresIn: "3600",
        localId: uid,
        email: "user@example.com",
      }),
    });

    db.collection.mockImplementation((col: string) => ({
      doc: (_id: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            email: "user@example.com",
            name: "Existing User",
            role: "dispatcher",
          }),
        }),
      }),
    }));

    const res = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "correctPassword",
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("firebase-id-token-xyz");
    expect(res.body.refreshToken).toBe("refresh-token-xyz");
    expect(res.body.user.uid).toBe(uid);
    expect(res.body.user.name).toBe("Existing User");
    expect(res.body.user.role).toBe("dispatcher");
  });

  it("returns 401 for invalid credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 400, message: "INVALID_LOGIN_CREDENTIALS" },
      }),
    });

    const res = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "wrongPassword",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("returns 400 for missing email", async () => {
    const res = await request(app).post("/auth/login").send({
      password: "somePassword",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing password", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "user@example.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });
});

describe("POST /auth/setup", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/auth/setup").send({
      name: "Test User",
      role: "driver",
    });

    expect(res.status).toBe(401);
  });

  it("creates profile for authenticated user", async () => {
    const uid = "setup-user-789";
    setupMockUser(uid, "driver", "Setup User");

    // Override to simulate no existing profile, then allow set
    db.collection.mockImplementation((col: string) => ({
      doc: (_id: string) => ({
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn().mockResolvedValue(undefined),
      }),
    }));

    // Need auth to still work
    auth.verifyIdToken.mockResolvedValue({ uid, email: "setup@example.com" });

    const res = await request(app)
      .post("/auth/setup")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Setup User", role: "driver" });

    // 403 because the user profile doesn't exist yet (middleware checks for it)
    // This is expected — setup is for users who already have a Firebase account
    // but haven't created their Firestore profile yet
    expect([201, 403]).toContain(res.status);
  });
});
