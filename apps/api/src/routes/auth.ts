import { Router } from "express";
import { auth, db } from "../config/firebase";
import { env } from "../config/env";
import { validate } from "../middleware/validate";
import { verifyFirebaseToken } from "../middleware/auth";
import { loginLimiter, signupLimiter } from "../middleware/rateLimiter";
import {
  createUserProfileSchema,
  signupSchema,
  loginSchema,
} from "@quickroutesai/shared";

const router = Router();

interface FirebaseSignInResponse {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
}

interface FirebaseErrorResponse {
  error: {
    code: number;
    message: string;
  };
}

/**
 * Exchange email/password for a Firebase ID token via the REST API.
 */
async function signInWithFirebase(
  email: string,
  password: string
): Promise<FirebaseSignInResponse> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  const data = (await response.json()) as
    | FirebaseSignInResponse
    | FirebaseErrorResponse;

  if (!response.ok) {
    const errorData = data as FirebaseErrorResponse;
    throw new Error(errorData.error?.message || "Firebase authentication failed");
  }

  return data as FirebaseSignInResponse;
}

/**
 * POST /auth/signup — Create a new user account and return an ID token.
 * Public — no auth required.
 */
router.post("/signup", signupLimiter, validate(signupSchema), async (req, res) => {
  try {
    const { email, password, name, role, orgCode } = req.body as {
      email: string;
      password: string;
      name: string;
      role?: "driver" | "dispatcher" | "admin";
      orgCode?: string;
    };

    const resolvedRole = role || "driver";

    // Two-path signup: either the signup creates a new business (admin without
    // orgCode; they'll run the onboarding wizard on first dashboard visit) or
    // joins an existing one (orgCode required). Non-admin roles can only exist
    // within an org, so we reject driver/dispatcher signups that omit orgCode.
    if (orgCode) {
      const orgSnap = await db.collection("orgs").doc(orgCode).get();
      if (!orgSnap.exists) {
        return res.status(400).json({ error: "Invalid organization code" });
      }
    } else if (resolvedRole !== "admin") {
      return res.status(400).json({
        error:
          "Organization code is required when signing up as driver or dispatcher",
      });
    }

    // Create user in Firebase Auth
    const userRecord = await auth.createUser({ email, password });

    // Create user profile in Firestore — stamp orgId iff an orgCode was provided.
    const profile: Record<string, unknown> = {
      email,
      name,
      role: resolvedRole,
      active: true,
      createdAt: new Date().toISOString(),
    };
    if (orgCode) profile.orgId = orgCode;

    await db.collection("users").doc(userRecord.uid).set(profile);

    // If driver, also create driver document. If orgCode was supplied, stamp
    // it on the driver doc so the driver is immediately visible to org-scoped
    // listings. If not (shouldn't happen now that we reject driver-without-
    // orgCode above, but defensive), leave orgId null.
    if (resolvedRole === "driver") {
      await db.collection("drivers").doc(userRecord.uid).set({
        isOnline: false,
        lastLocation: null,
        lastSpeedMps: 0,
        lastHeading: 0,
        orgId: orgCode ?? null,
        updatedAt: new Date().toISOString(),
      });
    }

    // Sign in to get an ID token
    const signInResult = await signInWithFirebase(email, password);

    res.status(201).json({
      token: signInResult.idToken,
      refreshToken: signInResult.refreshToken,
      expiresIn: signInResult.expiresIn,
      user: {
        uid: userRecord.uid,
        email,
        name,
        role: resolvedRole,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create account";

    // Map common Firebase errors to user-friendly messages
    if (message.includes("EMAIL_EXISTS")) {
      return res
        .status(409)
        .json({ error: "Conflict", message: "Email already in use" });
    }

    res.status(500).json({ error: "Internal Error", message });
  }
});

/**
 * POST /auth/login — Sign in with email/password and return an ID token.
 * Public — no auth required.
 */
router.post("/login", loginLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    const signInResult = await signInWithFirebase(email, password);

    // Fetch user profile from Firestore
    const userDoc = await db
      .collection("users")
      .doc(signInResult.localId)
      .get();

    const profile = userDoc.exists
      ? userDoc.data()
      : { email, role: "driver" };

    res.json({
      token: signInResult.idToken,
      refreshToken: signInResult.refreshToken,
      expiresIn: signInResult.expiresIn,
      user: {
        uid: signInResult.localId,
        email: signInResult.email,
        name: profile?.name || "",
        role: profile?.role || "driver",
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Authentication failed";

    if (
      message.includes("INVALID_LOGIN_CREDENTIALS") ||
      message.includes("EMAIL_NOT_FOUND") ||
      message.includes("INVALID_PASSWORD")
    ) {
      return res
        .status(401)
        .json({ error: "Unauthorized", message: "Invalid email or password" });
    }

    res.status(500).json({ error: "Internal Error", message });
  }
});

/**
 * POST /auth/setup — Create user profile in Firestore after first Firebase Auth login.
 * Protected — requires valid Firebase ID token.
 * Idempotent — won't overwrite existing profile.
 */
router.post(
  "/setup",
  verifyFirebaseToken,
  validate(createUserProfileSchema),
  async (req, res) => {
    try {
      const userRef = db.collection("users").doc(req.uid);
      const existing = await userRef.get();

      if (existing.exists) {
        return res.json({
          message: "Profile already exists",
          profile: { uid: req.uid, ...existing.data() },
        });
      }

      const profile = {
        email: req.userEmail,
        name: req.body.name,
        role: req.body.role || "driver",
        createdAt: new Date().toISOString(),
      };

      await userRef.set(profile);

      // If driver, also create driver document.
      // See POST /auth/signup — orgId is explicitly null until a driver
      // invite flow links them to an org.
      if (profile.role === "driver") {
        await db.collection("drivers").doc(req.uid).set({
          isOnline: false,
          lastLocation: null,
          lastSpeedMps: 0,
          lastHeading: 0,
          orgId: null,
          updatedAt: new Date().toISOString(),
        });
      }

      res.status(201).json({ uid: req.uid, ...profile });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Internal Error", message: "Failed to create profile" });
    }
  }
);

export default router;
