import express from "express";
import cors from "cors";
import { verifyFirebaseToken } from "../../middleware/auth";
import healthRoutes from "../../routes/health";
import meRoutes from "../../routes/me";
import driverRoutes from "../../routes/drivers";
import tripRoutes from "../../routes/trips";

// Mock Firebase Admin SDK
jest.mock("../../config/firebase", () => {
  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn(),
    set: jest.fn(),
    add: jest.fn(),
    update: jest.fn(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };

  return {
    __esModule: true,
    default: {
      firestore: {
        FieldValue: { serverTimestamp: jest.fn(() => new Date().toISOString()) },
        Query: class {},
      },
    },
    auth: {
      verifyIdToken: jest.fn(),
    },
    db: mockFirestore,
  };
});

// Mock Google Maps
jest.mock("../../services/directions", () => ({
  computeRoute: jest.fn(),
}));

/**
 * Create a test Express app with all routes mounted.
 */
export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/health", healthRoutes);
  app.use("/me", verifyFirebaseToken, meRoutes);
  app.use("/drivers", verifyFirebaseToken, driverRoutes);
  app.use("/trips", verifyFirebaseToken, tripRoutes);
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
 * Helper: configure the Firestore users doc mock to return a role
 */
export function mockUserRole(uid: string, role: string, name: string = "Test User") {
  const { db } = require("../../config/firebase");

  // When collection("users").doc(uid).get() is called, return this
  db.collection.mockImplementation((collectionName: string) => {
    if (collectionName === "users") {
      return {
        doc: (docId: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ email: "test@example.com", name, role, createdAt: new Date().toISOString() }),
          }),
          set: jest.fn().mockResolvedValue(undefined),
        }),
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
    };
  });
}

/**
 * Setup a fully mocked authenticated context for a test user.
 */
export function setupMockUser(uid: string, role: string, name: string = "Test User") {
  mockAuthenticatedUser(uid);
  mockUserRole(uid, role, name);
}
