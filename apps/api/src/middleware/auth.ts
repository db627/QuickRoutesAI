import { Request, Response, NextFunction } from "express";
import { auth, db } from "../config/firebase";
import type { UserRole } from "@quickroutesai/shared";
import { ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

// Extend Express Request to include authenticated user info
declare global {
  namespace Express {
    interface Request {
      uid: string;
      userRole: UserRole;
      userEmail: string;
      orgId?: string;
    }
  }
}

/**
 * Verifies Firebase ID token from Authorization header.
 * Attaches uid, userRole, and userEmail to the request.
 */
export async function verifyFirebaseToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError(ErrorCode.UNAUTHORIZED, 401, "Missing or invalid token"));
  }

  const idToken = header.split("Bearer ")[1];

  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.uid = decoded.uid;
    req.userEmail = decoded.email || "";

    // Fetch role + orgId from Firestore users collection
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      req.userRole = data?.role || "driver";
      // orgId may be absent on drivers/dispatchers who haven't been linked to
      // an org yet, or on admins who haven't completed the setup wizard.
      // Individual routes decide how to handle absence (requireOrg middleware
      // 403s; routes that opt out accept unlinked users).
      req.orgId = data?.orgId;
      next();
      return;
    }

    // Backward compatibility: allow legacy driver accounts with only a drivers/{uid} doc.
    const driverDoc = await db.collection("drivers").doc(decoded.uid).get();
    if (driverDoc.exists) {
      req.userRole = "driver";
      req.orgId = driverDoc.data()?.orgId ?? undefined;
      next();
      return;
    }

    return next(new AppError(ErrorCode.FORBIDDEN, 403, "User profile not found"));
  } catch {
    return next(new AppError(ErrorCode.UNAUTHORIZED, 401, "Invalid or expired token"));
  }
}

/**
 * Factory: restrict access to specific roles.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.userRole)) {
      return next(
        new AppError(ErrorCode.FORBIDDEN, 403, `Requires one of: ${roles.join(", ")}`),
      );
    }
    next();
  };
}

/**
 * Require that the authenticated user is linked to an organization.
 * 403s if req.orgId is absent. Use this on any route that reads/writes
 * per-org scoped data (trips, drivers, users).
 */
export function requireOrg(req: Request, _res: Response, next: NextFunction) {
  if (!req.orgId) {
    return next(
      new AppError(
        ErrorCode.FORBIDDEN,
        403,
        "Your account is not linked to an organization",
      ),
    );
  }
  next();
}
