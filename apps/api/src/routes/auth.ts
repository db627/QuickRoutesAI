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
  ErrorCode,
} from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

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
    const { email, password, name, role, orgCode, inviteToken } = req.body as {
      email: string;
      password: string;
      name: string;
      role?: "driver" | "dispatcher" | "admin";
      orgCode?: string;
      inviteToken?: string;
    };

    // ── Invite-driven signup ────────────────────────────────────────────
    // If an inviteToken is supplied we IGNORE the body's role/orgCode and use
    // the values stamped on the invite. This prevents an attacker from
    // upgrading their own role by passing role=admin alongside a driver
    // invite. The invite is consumed in the same Firestore transaction that
    // creates the user / driver docs so we don't end up with an orphaned
    // user when the invite write races.
    if (inviteToken) {
      const inviteRef = db.collection("invites").doc(inviteToken);
      const inviteSnap = await inviteRef.get();
      if (!inviteSnap.exists) {
        return res.status(400).json({ error: "Invalid or expired invite" });
      }
      const invite = inviteSnap.data() as {
        email: string;
        role: "driver" | "dispatcher";
        orgId: string;
        status: string;
      };
      if (invite.status !== "pending") {
        return res.status(400).json({ error: "Invalid or expired invite" });
      }
      if (invite.email.toLowerCase() !== email.toLowerCase()) {
        return res
          .status(400)
          .json({ error: "Email does not match invite" });
      }

      // Create user in Firebase Auth first; if this fails we abort before
      // touching Firestore.
      const userRecord = await auth.createUser({ email, password });

      const now = new Date().toISOString();
      const userRef = db.collection("users").doc(userRecord.uid);
      const driverRef = db.collection("drivers").doc(userRecord.uid);

      await db.runTransaction(async (tx) => {
        // Re-read the invite inside the transaction so a concurrent acceptance
        // / revoke can't sneak past the earlier check.
        const fresh = await tx.get(inviteRef);
        if (!fresh.exists || fresh.data()?.status !== "pending") {
          throw new AppError(
            ErrorCode.BAD_REQUEST,
            400,
            "Invalid or expired invite",
          );
        }

        tx.set(userRef, {
          email,
          name,
          role: invite.role,
          active: true,
          orgId: invite.orgId,
          createdAt: now,
        });

        if (invite.role === "driver") {
          tx.set(driverRef, {
            isOnline: false,
            lastLocation: null,
            lastSpeedMps: 0,
            lastHeading: 0,
            orgId: invite.orgId,
            updatedAt: now,
          });
        }

        tx.update(inviteRef, {
          status: "used",
          usedAt: now,
          usedByUid: userRecord.uid,
        });
      });

      const signInResult = await signInWithFirebase(email, password);

      return res.status(201).json({
        token: signInResult.idToken,
        refreshToken: signInResult.refreshToken,
        expiresIn: signInResult.expiresIn,
        user: {
          uid: userRecord.uid,
          email,
          name,
          role: invite.role,
        },
      });
    }

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
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

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
