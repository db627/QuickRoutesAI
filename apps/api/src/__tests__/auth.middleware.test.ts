import type { Request, Response, NextFunction } from "express";
import { verifyFirebaseToken, requireOrg } from "../middleware/auth";
import { AppError } from "../utils/AppError";

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

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0] as AppError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("User profile not found");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("populates req.orgId from the users doc when present", async () => {
    const req = {
      headers: { authorization: "Bearer valid-token" },
    } as unknown as Request;
    const res = createResponseMock();
    const next = jest.fn();

    auth.verifyIdToken.mockResolvedValue({ uid: "admin-1", email: "a@example.com" });
    db.collection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ role: "admin", orgId: "org-alpha" }),
            }),
          }),
        };
      }
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }) };
    });

    await verifyFirebaseToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.orgId).toBe("org-alpha");
    expect(req.userRole).toBe("admin");
  });

  it("leaves req.orgId undefined when the users doc lacks orgId", async () => {
    const req = {
      headers: { authorization: "Bearer valid-token" },
    } as unknown as Request;
    const res = createResponseMock();
    const next = jest.fn();

    auth.verifyIdToken.mockResolvedValue({ uid: "disp-1", email: "d@example.com" });
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
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }) };
    });

    await verifyFirebaseToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.orgId).toBeUndefined();
    expect(req.userRole).toBe("dispatcher");
  });
});

describe("requireOrg", () => {
  function runMiddleware(orgId: string | undefined) {
    const req = { orgId } as unknown as Request;
    const res = {} as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    requireOrg(req, res, next);
    return next as jest.Mock;
  }

  it("calls next() when req.orgId is present", () => {
    const next = runMiddleware("org-alpha");
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
  });

  it("403s when req.orgId is missing", () => {
    const next = runMiddleware(undefined);
    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0] as AppError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Your account is not linked to an organization");
  });
});

