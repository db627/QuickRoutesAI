import { Request, Response, NextFunction } from "express";
import { auth, db } from "../config/firebase";
import type { UserRole } from "@quickroutesai/shared";

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
export async function verifyFirebaseToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized", message: "Missing or invalid token" });
  }

  const idToken = header.split("Bearer ")[1];

  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.uid = decoded.uid;
    req.userEmail = decoded.email || "";

    // Fetch role from Firestore users collection
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: "Forbidden", message: "User profile not found" });
    }

    req.userRole = userDoc.data()?.role || "driver";
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}

/**
 * Factory: restrict access to specific roles.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Requires one of: ${roles.join(", ")}`,
      });
    }
    next();
  };
}
