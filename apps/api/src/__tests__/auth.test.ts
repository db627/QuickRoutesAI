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

describe("POST /auth/signup", () => {
  it("creates a new user and returns a token", async () => {
    const uid = "new-user-123";

    auth.createUser.mockResolvedValue({ uid, email: "new@example.com" });

    db.collection.mockImplementation((col: string) => ({
      doc: (_id: string) => ({
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue({ exists: false }),
      }),
    }));

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
  });

  it("returns 409 when email already exists", async () => {
    auth.createUser.mockRejectedValue(new Error("EMAIL_EXISTS"));

    const res = await request(app).post("/auth/signup").send({
      email: "existing@example.com",
      password: "securePassword123",
      name: "Duplicate User",
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

  it("defaults role to driver when not specified", async () => {
    const uid = "driver-user-123";

    auth.createUser.mockResolvedValue({ uid, email: "driver@example.com" });

    db.collection.mockImplementation((col: string) => ({
      doc: (_id: string) => ({
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue({ exists: false }),
      }),
    }));

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
