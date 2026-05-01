import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export const auth = admin.auth();
export const db = admin.firestore();

// Drop undefined fields silently instead of throwing. Without this, any
// optional field that wasn't set (e.g. route.timeWindowViolations) crashes
// .update() / .set() with "Cannot use 'undefined' as a Firestore value".
db.settings({ ignoreUndefinedProperties: true });

export default admin;
