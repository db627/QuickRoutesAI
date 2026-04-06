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

    // Fetch role from Firestore users collection
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    if (userDoc.exists) {
      req.userRole = userDoc.data()?.role || "driver";
      next();
      return;
    }

    // Backward compatibility: allow legacy driver accounts with only a drivers/{uid} doc.
    const driverDoc = await db.collection("drivers").doc(decoded.uid).get();
    if (driverDoc.exists) {
      req.userRole = "driver";
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
