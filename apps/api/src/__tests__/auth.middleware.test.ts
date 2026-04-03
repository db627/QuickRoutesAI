import type { Request, Response } from "express";
import { verifyFirebaseToken } from "../middleware/auth";

jest.mock("../config/firebase", () => ({
  auth: {
    verifyIdToken: jest.fn(),
  },
  db: {
    collection: jest.fn(),
  },
}));

const { auth, db } = require("../config/firebase");

function createResponseMock() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("verifyFirebaseToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses users profile role when users/{uid} exists", async () => {
    const req = {
      headers: { authorization: "Bearer valid-token" },
    } as unknown as Request;
    const res = createResponseMock();
    const next = jest.fn();

    auth.verifyIdToken.mockResolvedValue({ uid: "driver-1", email: "driver@example.com" });
    db.collection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ role: "dispatcher" }),
            }),
          }),
        };
      }

      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({ exists: false }),
        }),
      };
    });

    await verifyFirebaseToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.uid).toBe("driver-1");
    expect(req.userEmail).toBe("driver@example.com");
    expect(req.userRole).toBe("dispatcher");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("falls back to driver role when users/{uid} is missing but drivers/{uid} exists", async () => {
    const req = {
      headers: { authorization: "Bearer valid-token" },
    } as unknown as Request;
    const res = createResponseMock();
    const next = jest.fn();

    auth.verifyIdToken.mockResolvedValue({ uid: "driver-1", email: "driver@example.com" });
    db.collection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: false }),
          }),
        };
      }

      if (name === "drivers") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
          }),
        };
      }

      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({ exists: false }),
        }),
      };
    });

    await verifyFirebaseToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userRole).toBe("driver");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when neither users nor drivers profile exists", async () => {
    const req = {
      headers: { authorization: "Bearer valid-token" },
    } as unknown as Request;
    const res = createResponseMock();
    const next = jest.fn();

    auth.verifyIdToken.mockResolvedValue({ uid: "unknown-uid", email: "u@example.com" });
    db.collection.mockImplementation(() => ({
      doc: () => ({
        get: jest.fn().mockResolvedValue({ exists: false }),
      }),
    }));

    await verifyFirebaseToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Forbidden",
      message: "User profile not found",
    });
  });
});

