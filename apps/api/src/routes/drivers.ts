import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole, requireOrg } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { locationPingSchema, ErrorCode } from "@quickroutesai/shared";
import admin from "firebase-admin";
import { pagination } from "../middleware/pagination";
import { paginateFirestore } from "../utils/paginateFirestore";
import { AppError } from "../utils/AppError";

const router = Router();

/**
 * Ensures the given driver document belongs to the caller's organization.
 * Throws AppError(FORBIDDEN, 403) on mismatch or on legacy (no orgId) drivers.
 * Call after verifying the driver doc exists.
 */
function assertDriverInOrg(
  driverData: FirebaseFirestore.DocumentData | undefined,
  orgId: string | undefined,
): void {
  const driverOrgId = driverData?.orgId;
  if (!driverOrgId || !orgId || driverOrgId !== orgId) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, "Driver belongs to another organization");
  }
}

/**
 * POST /drivers/location — driver posts their current GPS position
 */
router.post("/location", validate(locationPingSchema), async (req, res) => {
  if (req.userRole !== "driver") {
    return res.status(403).json({ error: "Forbidden", message: "Only drivers can post location" });
  }

  const { lat, lng, speedMps, heading } = req.body;
  const now = new Date().toISOString();

  try {
    const driverRef = db.collection("drivers").doc(req.uid);
    const driverSnap = await driverRef.get();
    const wasOffline = !driverSnap.exists || driverSnap.data()?.isOnline === false;

    // Update driver document
    await driverRef.set(
      {
        isOnline: true,
        lastLocation: { lat, lng },
        lastSpeedMps: speedMps,
        lastHeading: heading,
        updatedAt: now,
      },
      { merge: true },
    );

    // Emit online transition event only when driver was previously offline
    if (wasOffline) {
      await db.collection("events").add({
        type: "status_change",
        driverId: req.uid,
        orgId: req.orgId,
        payload: { status: "online" },
        createdAt: now,
      });
    }

    // Write event log
    await db.collection("events").add({
      type: "location_ping",
      driverId: req.uid,
      orgId: req.orgId,
      payload: { lat, lng, speedMps, heading },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, updatedAt: now });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to update location" });
  }
});

/**
 * GET /drivers/active — dispatcher gets list of online drivers with locations
 */
router.get("/active", requireRole("dispatcher", "admin"), requireOrg, async (req, res) => {
  try {
    const snapshot = await db
      .collection("drivers")
      .where("orgId", "==", req.orgId!)
      .where("isOnline", "==", true)
      .get();

    const drivers = snapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch drivers" });
  }
});

/**
 * GET /drivers — list all drivers (for dispatcher assignment dropdowns, etc.)
 * Supports pagination: ?page=1&limit=20 or ?cursor=...&limit=20
 * Optional filters: ?online=true, ?available=true
 *   - available=true filters out drivers with in_progress trips
 */
router.get("/", requireRole("dispatcher", "admin"), requireOrg, pagination, async (req, res) => {
  try {
    // paginate the drivers collection first

    const isOnline = req.query.online === "true" ? true : null;
    const isAvailable = req.query.available === "true" ? true : null;
    // Scope to caller's org. Combined with `isOnline`, this needs the composite
    // index defined in firestore.indexes.json: (orgId ASC, isOnline ASC, updatedAt DESC).
    var baseQuery: admin.firestore.Query = db
      .collection("drivers")
      .where("orgId", "==", req.orgId!);

    // Build set of busy driver IDs to filter out after pagination
    let busyDriverIds: Set<string> | null = null;
    if (isAvailable !== null) {
      const inProgressTrips = await db
        .collection("trips")
        .where("orgId", "==", req.orgId!)
        .where("status", "==", "in_progress")
        .get();
      busyDriverIds = new Set(inProgressTrips.docs.map((d) => d.data().driverId).filter(Boolean));
    }

    if (isOnline !== null) {
      baseQuery = baseQuery.where("isOnline", "==", isOnline);
    }

    const pageResult = await paginateFirestore(baseQuery, req.pagination!, {
      orderField: "updatedAt",
      orderDirection: "desc",
    });

    // enrich only the returned page with user info
    const enriched = await Promise.all(
      pageResult.data.map(async (driver: any) => {
        // paginateFirestore returns { id, ...data() }
        const uid = driver.id;
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        // remove id, replace with uid to keep your existing response style
        const { id, ...driverData } = driver;

        return {
          uid,
          name: userData?.name || "Unknown",
          email: userData?.email || "",
          ...driverData,
        };
      }),
    );

    // Filter out busy drivers client-side (Firestore "not-in" is limited to 10 items)
    const finalData = busyDriverIds
      ? enriched.filter((d) => !busyDriverIds!.has(d.uid))
      : enriched;

    res.json({
      ...pageResult,
      data: finalData,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch drivers" });
  }
});

/**
 * POST /drivers/claim-unlinked — admin / dispatcher bootstraps drivers that
 * signed up via the public signup flow before the invite flow existed.
 *
 * Driver docs created via POST /auth/signup carry `orgId: null`, which makes
 * them invisible to every org-scoped listing. This endpoint finds those
 * unlinked drivers and attaches them to the caller's org (also patching the
 * matching users/{uid} doc so the user record stays consistent). Intended as
 * a one-click recovery action; the long-term solution is a proper driver
 * invite flow.
 *
 * Response: { claimed: number, driverIds: string[] }
 */
router.post("/claim-unlinked", requireRole("dispatcher", "admin"), requireOrg, async (req, res) => {
  try {
    const orgId = req.orgId!;

    // Try the indexed query first; fall back to a full scan + in-memory
    // filter if the composite index isn't present (or the query throws for
    // any reason — e.g. older Firestore versions on the emulator).
    let unlinkedDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const snap = await db.collection("drivers").where("orgId", "==", null).get();
      unlinkedDocs = snap.docs;
    } catch {
      const snap = await db.collection("drivers").get();
      unlinkedDocs = snap.docs.filter((d) => {
        const data = d.data();
        return data.orgId === null || data.orgId === undefined;
      });
    }

    if (unlinkedDocs.length === 0) {
      return res.json({ claimed: 0, driverIds: [] });
    }

    const now = new Date().toISOString();
    const driverIds: string[] = [];

    // Batched writes, up to 500 ops/batch. Each driver produces 2 writes
    // (drivers/{uid} + users/{uid}), so cap drivers-per-batch at 250.
    const BATCH_SIZE = 250;
    for (let i = 0; i < unlinkedDocs.length; i += BATCH_SIZE) {
      const slice = unlinkedDocs.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const driverDoc of slice) {
        const uid = driverDoc.id;
        driverIds.push(uid);

        batch.update(driverDoc.ref, { orgId, updatedAt: now });

        // Mirror onto the matching user doc (if it exists and is a driver).
        // We use set-merge so a missing user doc doesn't blow up the batch.
        const userRef = db.collection("users").doc(uid);
        batch.set(userRef, { orgId }, { merge: true });
      }

      await batch.commit();
    }

    return res.json({ claimed: driverIds.length, driverIds });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Internal Error", message: "Failed to claim unlinked drivers" });
  }
});

/**
 * POST /drivers/offline — driver sets themselves offline
 */
router.post("/offline", async (req, res) => {
  if (req.userRole !== "driver") {
    return res.status(403).json({ error: "Forbidden", message: "Only drivers can update status" });
  }

  try {
    await db.collection("drivers").doc(req.uid).set(
      { isOnline: false, updatedAt: new Date().toISOString() },
      { merge: true },
    );

    await db.collection("events").add({
      type: "status_change",
      driverId: req.uid,
      orgId: req.orgId,
      payload: { status: "offline" },
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, isOnline: false });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to go offline" });
  }
});

export default router;
