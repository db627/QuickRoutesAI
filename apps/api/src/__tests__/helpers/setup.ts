import express from "express";
import cors from "cors";
import { verifyFirebaseToken } from "../../middleware/auth";
import { errorHandler } from "../../middleware/errorHandler";
import healthRoutes from "../../routes/health";
import authRoutes from "../../routes/auth";
import meRoutes from "../../routes/me";
import driverRoutes from "../../routes/drivers";
import tripRoutes from "../../routes/trips";
import userRoutes from "../../routes/users";
import orgRoutes from "../../routes/orgs";

// Mock Firebase Admin SDK
jest.mock("../../config/firebase", () => {

  const mockCountGet = jest.fn().mockResolvedValue({
    data: () => ({ count: 0 }),
  });

  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: [],
    }),
    set: jest.fn(),
    add: jest.fn(),
    update: jest.fn(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),

    // pagination
    offset: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),

    // aggregation
    count: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({
        data: () => ({ count: 0 }),
      }),
    })),
  };

  return {
    __esModule: true,
    default: {
      firestore: {
        FieldValue: { serverTimestamp: jest.fn(() => new Date().toISOString()) },
        FieldPath: { documentId: jest.fn(() => "__name__") },
        Query: class {},
      },
    },
    auth: {
      verifyIdToken: jest.fn(),
      createUser: jest.fn(),
    },
    db: mockFirestore,
  };
});

// Mock env config
jest.mock("../../config/env", () => ({
  env: {
    PORT: 3001,
    NODE_ENV: "test",
    FIREBASE_PROJECT_ID: "test-project",
    FIREBASE_CLIENT_EMAIL: "test@test.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "test-key",
    FIREBASE_API_KEY: "test-api-key",
    GOOGLE_MAPS_SERVER_KEY: "test-maps-key",
  },
}));

// Mock Google Maps + route optimizer
jest.mock("../../services/directions", () => ({
  computeRoute: jest.fn(),
}));
jest.mock("../../services/routeOptimizer", () => ({
  optimizeStopOrder: jest.fn((stops: any[]) => stops),
}));

/**
 * Create a test Express app with all routes mounted.
 */
export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/health", healthRoutes);
  app.use("/auth", authRoutes);
  app.use("/me", verifyFirebaseToken, meRoutes);
  app.use("/drivers", verifyFirebaseToken, driverRoutes);
  app.use("/trips", verifyFirebaseToken, tripRoutes);
  app.use("/users", verifyFirebaseToken, userRoutes);
  app.use("/orgs", verifyFirebaseToken, orgRoutes);
  app.use(errorHandler);
  return app;
}

/**
 * Helper: configure the Firebase auth mock to return a specific uid/email
 */
export function mockAuthenticatedUser(uid: string, email: string = "test@example.com") {
  const { auth } = require("../../config/firebase");
  auth.verifyIdToken.mockResolvedValue({ uid, email });
}

/**
 * Helper: configure the Firestore users doc mock to return a role + orgId
 */
export function mockUserRole(
  uid: string,
  role: string,
  name: string = "Test User",
  orgId: string | null | undefined = "org-test",
) {
  const { db } = require("../../config/firebase");

  // When collection("users").doc(uid).get() is called, return this
  db.collection.mockImplementation((collectionName: string) => {
    if (collectionName === "users") {
      return {
        doc: (docId: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              email: "test@example.com",
              name,
              role,
              ...(orgId ? { orgId } : {}),
              createdAt: new Date().toISOString(),
            }),
          }),
          set: jest.fn().mockResolvedValue(undefined),
        }),

        // ⭐ ADD THESE (same as main mock)
        get: jest.fn().mockResolvedValue({ docs: [] }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),

        count: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            data: () => ({ count: 0 }),
          }),
        })),
      };
    }
    // Return default chainable mock for other collections
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false, docs: [], data: () => null }),
      set: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue({ id: "mock-id" }),
      update: jest.fn().mockResolvedValue(undefined),

      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),

      // NEW (pagination)
      offset: jest.fn().mockReturnThis(),
      startAfter: jest.fn().mockReturnThis(),

      // NEW (aggregation)
      count: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          data: () => ({ count: 0 }),
        }),
      }),
    };
  });
}

/**
 * Setup a fully mocked authenticated context for a test user.
 *
 * `orgId` defaults to "org-test" so tests automatically exercise the
 * org-scoped code paths (requireOrg + assertTripInOrg / assertDriverInOrg /
 * assertUserInOrg). Pass `null` to simulate a user who has NOT been linked
 * to an organization — useful for testing the `requireOrg` 403 path.
 */
export function setupMockUser(
  uid: string,
  role: string,
  name: string = "Test User",
  orgId: string | null | undefined = "org-test",
) {
  mockAuthenticatedUser(uid);
  mockUserRole(uid, role, name, orgId);
}
