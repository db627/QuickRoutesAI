/**
 * One-off seed: creates 4 demo drivers + ~25-30 NJ trips for an org.
 *
 * Run from apps/api with the API's .env loaded:
 *   npx tsx scripts/seed-nj-data.ts
 *
 * Idempotent: drivers are reused by email (Firebase Auth lookup); trips are
 * tagged with seedTag = "nj-seed-v1" and skipped on re-run unless FORCE=true.
 *
 * Env:
 *   ORG_ID           - org to seed (defaults below)
 *   ORG_OWNER_UID    - createdBy uid for trips. Falls back to org doc ownerUid.
 *   DRY_RUN=true     - print what would happen, write nothing
 *   FORCE=true       - re-seed even if existing seed trips found
 */
import "dotenv/config";
import { auth, db } from "../src/config/firebase";
import { randomUUID } from "crypto";

// ── Config ─────────────────────────────────────────────────────────────────
const ORG_ID = process.env.ORG_ID || "fMUlXX2dX8FQOCLhupeU";
const DRY_RUN = process.env.DRY_RUN === "true";
const FORCE = process.env.FORCE === "true";
const DEFAULT_PASSWORD = "TempPass123!"; // for created drivers; admin tells them to reset
const SEED_TAG = "nj-seed-v1";

const DRIVERS = [
  { name: "Nicole Perez", email: "np744@njit.edu" },
  { name: "Dennis Boguslavskiy", email: "drakb2004@gmail.com" },
  { name: "Caleb", email: "ckhanwald33@gmail.com" },
  { name: "Matthew R. O'Mara", email: "mattomara1234@gmail.com" },
];

// ── Types ──────────────────────────────────────────────────────────────────
type StopStatus = "pending" | "completed";
type TripStatus = "draft" | "assigned" | "in_progress" | "completed" | "cancelled";

interface SeedStop {
  address: string;
  contactName: string;
  lat: number;
  lng: number;
  sequence: number;
  notes: string;
  status: StopStatus;
  completedAt?: string;
}

interface SeedStopInput {
  address: string;
  lat: number;
  lng: number;
  contactName?: string;
}

interface SeedTripInput {
  notes: string;
  status: TripStatus;
  stops: SeedStopInput[];
  driverIndex: number; // 0..3, or -1 for unassigned (drafts/cancelled may be unassigned)
  daysAgo: number; // for createdAt
}

// ── Location library ───────────────────────────────────────────────────────
// Real-ish lat/lng (4 decimals). Sourced from public records.
const LOC = {
  // Supermarkets
  shopRiteEastBrunswick: { address: "ShopRite, 290 NJ-18, East Brunswick, NJ 08816", lat: 40.4279, lng: -74.4029 },
  shopRiteHazlet: { address: "ShopRite, 1320 NJ-36, Hazlet, NJ 07730", lat: 40.4326, lng: -74.1722 },
  shopRiteMarlboro: { address: "ShopRite, 34 US-9, Marlboro, NJ 07746", lat: 40.3157, lng: -74.2469 },
  stopShopHowell: { address: "Stop & Shop, 4855 US-9, Howell, NJ 07731", lat: 40.1860, lng: -74.2240 },
  stopShopManalapan: { address: "Stop & Shop, 55 US-9 S, Manalapan, NJ 07726", lat: 40.2901, lng: -74.3103 },
  wegmansManalapan: { address: "Wegmans, 25 NJ-9, Manalapan, NJ 07726", lat: 40.2916, lng: -74.3081 },
  wholeFoodsMarlboro: { address: "Whole Foods Market, 36 US-9 N, Marlboro, NJ 07746", lat: 40.3162, lng: -74.2455 },
  costcoHolmdel: { address: "Costco, 2150 NJ-35, Holmdel, NJ 07733", lat: 40.3856, lng: -74.1370 },
  costcoBrick: { address: "Costco, 100 Chambers Bridge Rd, Brick, NJ 08723", lat: 40.0762, lng: -74.1086 },
  aldiBrick: { address: "Aldi, 1816 NJ-88, Brick, NJ 08724", lat: 40.0578, lng: -74.1287 },
  traderJoesWestfield: { address: "Trader Joe's, 155 Elm St, Westfield, NJ 07090", lat: 40.6504, lng: -74.3469 },

  // Colleges
  princeton: { address: "Princeton University, Princeton, NJ 08544", lat: 40.3480, lng: -74.6590 },
  rutgersNB: { address: "Rutgers University–New Brunswick, New Brunswick, NJ 08901", lat: 40.5020, lng: -74.4520 },
  njit: { address: "New Jersey Institute of Technology, Newark, NJ 07102", lat: 40.7420, lng: -74.1780 },
  stevens: { address: "Stevens Institute of Technology, Hoboken, NJ 07030", lat: 40.7449, lng: -74.0246 },
  montclairState: { address: "Montclair State University, Montclair, NJ 07043", lat: 40.8625, lng: -74.1980 },
  rowan: { address: "Rowan University, Glassboro, NJ 08028", lat: 39.7100, lng: -75.1180 },
  tcnj: { address: "The College of New Jersey, Ewing, NJ 08628", lat: 40.2710, lng: -74.7780 },
  rider: { address: "Rider University, Lawrenceville, NJ 08648", lat: 40.2820, lng: -74.7400 },
  drew: { address: "Drew University, Madison, NJ 07940", lat: 40.7625, lng: -74.4151 },
  setonHall: { address: "Seton Hall University, South Orange, NJ 07079", lat: 40.7430, lng: -74.2470 },
  kean: { address: "Kean University, Union, NJ 07083", lat: 40.6770, lng: -74.2360 },
  ramapo: { address: "Ramapo College of New Jersey, Mahwah, NJ 07430", lat: 41.0930, lng: -74.1840 },
  williamPaterson: { address: "William Paterson University, Wayne, NJ 07470", lat: 40.9620, lng: -74.2300 },
  fduMadison: { address: "Fairleigh Dickinson University (Florham), Madison, NJ 07940", lat: 40.7770, lng: -74.4250 },

  // Parks (Monmouth + Ocean)
  sandyHook: { address: "Sandy Hook, Highlands, NJ 07732", lat: 40.4322, lng: -73.9803 },
  holmdelPark: { address: "Holmdel Park, 44 Longstreet Rd, Holmdel, NJ 07733", lat: 40.3617, lng: -74.1684 },
  allaire: { address: "Allaire State Park, 4265 Atlantic Ave, Wall Township, NJ 07727", lat: 40.1561, lng: -74.1170 },
  sevenPresidents: { address: "Seven Presidents Oceanfront Park, Long Branch, NJ 07740", lat: 40.2894, lng: -73.9712 },
  asburyBoardwalk: { address: "Asbury Park Boardwalk, Asbury Park, NJ 07712", lat: 40.2206, lng: -74.0007 },
  cattusIsland: { address: "Cattus Island County Park, Toms River, NJ 08753", lat: 39.9930, lng: -74.1410 },
  islandBeach: { address: "Island Beach State Park, Seaside Park, NJ 08752", lat: 39.8090, lng: -74.0920 },
  cheesequake: { address: "Cheesequake State Park, 300 Gordon Rd, Matawan, NJ 07747", lat: 40.4400, lng: -74.2640 },
  manasquanReservoir: { address: "Manasquan Reservoir, 311 Windeler Rd, Howell, NJ 07731", lat: 40.1730, lng: -74.1330 },
  lakeTopanemus: { address: "Lake Topanemus Park, Freehold, NJ 07728", lat: 40.2520, lng: -74.2630 },

  // Generic delivery hubs (residential-ish addresses; real towns + plausible streets)
  freehold: { address: "12 Main St, Freehold, NJ 07728", lat: 40.2604, lng: -74.2738 },
  marlboro: { address: "85 School Rd W, Marlboro, NJ 07746", lat: 40.3157, lng: -74.2466 },
  manalapan: { address: "120 Symmes Dr, Manalapan, NJ 07726", lat: 40.2880, lng: -74.3110 },
  holmdel: { address: "20 Crawfords Corner Rd, Holmdel, NJ 07733", lat: 40.3870, lng: -74.1820 },
  redBank: { address: "55 Broad St, Red Bank, NJ 07701", lat: 40.3471, lng: -74.0640 },
  longBranch: { address: "200 Ocean Blvd, Long Branch, NJ 07740", lat: 40.3043, lng: -73.9924 },
  asburyPark: { address: "601 Bangs Ave, Asbury Park, NJ 07712", lat: 40.2206, lng: -74.0121 },
  tomsRiver: { address: "33 Washington St, Toms River, NJ 08753", lat: 39.9537, lng: -74.1979 },
  brick: { address: "270 Chambers Bridge Rd, Brick, NJ 08723", lat: 40.0760, lng: -74.1090 },
  howell: { address: "4400 US-9, Howell, NJ 07731", lat: 40.1860, lng: -74.2230 },
};

// ── Trip definitions ───────────────────────────────────────────────────────
const TRIPS: SeedTripInput[] = [
  // 1. Supermarket runs (6)
  { notes: "ShopRite East Brunswick weekly run", status: "completed", stops: [LOC.shopRiteEastBrunswick, LOC.shopRiteMarlboro], driverIndex: 0, daysAgo: 12 },
  { notes: "Hazlet ShopRite + Costco Holmdel", status: "completed", stops: [LOC.shopRiteHazlet, LOC.costcoHolmdel], driverIndex: 1, daysAgo: 10 },
  { notes: "Howell Stop & Shop run", status: "assigned", stops: [LOC.stopShopHowell], driverIndex: 2, daysAgo: 1 },
  { notes: "Manalapan Wegmans + Whole Foods Marlboro", status: "in_progress", stops: [LOC.wegmansManalapan, LOC.wholeFoodsMarlboro, LOC.shopRiteMarlboro], driverIndex: 3, daysAgo: 0 },
  { notes: "Brick Costco + Aldi consolidate", status: "completed", stops: [LOC.costcoBrick, LOC.aldiBrick], driverIndex: 0, daysAgo: 7 },
  { notes: "Trader Joe's Westfield specialty pickup", status: "draft", stops: [LOC.traderJoesWestfield], driverIndex: -1, daysAgo: 2 },
  { notes: "Manalapan Stop & Shop refill", status: "assigned", stops: [LOC.stopShopManalapan, LOC.wegmansManalapan], driverIndex: 1, daysAgo: 1 },

  // 2. College tours (2)
  {
    notes: "NJ College Campus Tour (north + central)",
    status: "in_progress",
    stops: [LOC.princeton, LOC.rutgersNB, LOC.njit, LOC.stevens, LOC.montclairState, LOC.drew],
    driverIndex: 1,
    daysAgo: 0,
  },
  {
    notes: "Central NJ College Visit",
    status: "assigned",
    stops: [LOC.tcnj, LOC.rider, LOC.princeton, LOC.rutgersNB],
    driverIndex: 2,
    daysAgo: 3,
  },

  // 3. Parks (4)
  { notes: "Sandy Hook + Seven Presidents shoreline run", status: "completed", stops: [LOC.sandyHook, LOC.sevenPresidents, LOC.asburyBoardwalk], driverIndex: 3, daysAgo: 9 },
  { notes: "Holmdel Park family event prep", status: "completed", stops: [LOC.holmdelPark, LOC.cheesequake], driverIndex: 0, daysAgo: 6 },
  { notes: "Allaire State Park + Manasquan Reservoir survey", status: "assigned", stops: [LOC.allaire, LOC.manasquanReservoir], driverIndex: 1, daysAgo: 2 },
  { notes: "Toms River parks loop", status: "draft", stops: [LOC.cattusIsland, LOC.islandBeach, LOC.lakeTopanemus], driverIndex: -1, daysAgo: 4 },
  { notes: "Asbury Park boardwalk supply drop", status: "cancelled", stops: [LOC.asburyBoardwalk, LOC.sevenPresidents], driverIndex: 2, daysAgo: 8 },

  // 4. Mixed delivery routes (7)
  { notes: "Marlboro residential delivery", status: "completed", stops: [LOC.marlboro, LOC.manalapan, LOC.freehold], driverIndex: 0, daysAgo: 11 },
  { notes: "Red Bank + Long Branch route", status: "completed", stops: [LOC.redBank, LOC.longBranch, LOC.asburyPark], driverIndex: 1, daysAgo: 5 },
  { notes: "Holmdel + Hazlet drops", status: "in_progress", stops: [LOC.holmdel, LOC.shopRiteHazlet, LOC.redBank], driverIndex: 2, daysAgo: 0 },
  { notes: "Toms River + Brick deliveries", status: "assigned", stops: [LOC.tomsRiver, LOC.brick, LOC.howell], driverIndex: 3, daysAgo: 1 },
  { notes: "Howell residential drop", status: "assigned", stops: [LOC.howell, LOC.manasquanReservoir], driverIndex: 0, daysAgo: 2 },
  { notes: "Freehold late afternoon delivery", status: "draft", stops: [LOC.freehold, LOC.lakeTopanemus], driverIndex: -1, daysAgo: 1 },
  { notes: "Long Branch waterfront delivery", status: "cancelled", stops: [LOC.longBranch, LOC.asburyPark], driverIndex: 1, daysAgo: 6 },

  // Padding to land in the 25-30 range with even driver distribution
  { notes: "Marlboro to Manalapan supply transfer", status: "completed", stops: [LOC.marlboro, LOC.manalapan], driverIndex: 2, daysAgo: 13 },
  { notes: "Red Bank office supplies", status: "completed", stops: [LOC.redBank, LOC.holmdel], driverIndex: 3, daysAgo: 4 },
  { notes: "Hazlet to Holmdel express", status: "in_progress", stops: [LOC.shopRiteHazlet, LOC.costcoHolmdel, LOC.holmdel], driverIndex: 0, daysAgo: 0 },
  { notes: "FDU + Drew campus drop", status: "assigned", stops: [LOC.fduMadison, LOC.drew], driverIndex: 2, daysAgo: 2 },
  { notes: "Seton Hall + Kean visit", status: "draft", stops: [LOC.setonHall, LOC.kean], driverIndex: -1, daysAgo: 5 },
  { notes: "Ramapo + William Paterson north tour", status: "assigned", stops: [LOC.ramapo, LOC.williamPaterson], driverIndex: 3, daysAgo: 3 },
  { notes: "Brick to Toms River delivery loop", status: "completed", stops: [LOC.brick, LOC.tomsRiver, LOC.aldiBrick], driverIndex: 1, daysAgo: 7 },
  { notes: "Westfield Trader Joe's + Kean drop", status: "assigned", stops: [LOC.traderJoesWestfield, LOC.kean], driverIndex: 0, daysAgo: 1 },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Spread within day a bit so trips aren't all at midnight.
  d.setHours((days * 7) % 24, (days * 13) % 60, 0, 0);
  return d.toISOString();
}

function recentISO(): string {
  return new Date().toISOString();
}

interface DriverResult {
  uid: string;
  name: string;
  email: string;
  reused: boolean;
}

async function ensureDriver(driver: { name: string; email: string }): Promise<DriverResult> {
  // Try to look up existing Auth user by email
  let uid: string | null = null;
  let reused = false;
  try {
    const existing = await auth.getUserByEmail(driver.email);
    uid = existing.uid;
    reused = true;
    console.log(`[driver] reused existing uid for ${driver.email}: ${uid}`);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      throw err;
    }
  }

  if (!uid) {
    if (DRY_RUN) {
      console.log(`[driver] would create Auth user for ${driver.email}`);
      uid = `dry-run-${randomUUID()}`;
    } else {
      const created = await auth.createUser({
        email: driver.email,
        password: DEFAULT_PASSWORD,
        displayName: driver.name,
        emailVerified: false,
      });
      uid = created.uid;
      console.log(`[driver] created Auth user ${driver.email} -> ${uid}`);
    }
  }

  // Upsert users/{uid}
  if (DRY_RUN) {
    console.log(`[driver] would upsert users/${uid} (role=driver, orgId=${ORG_ID})`);
    console.log(`[driver] would upsert drivers/${uid} (orgId=${ORG_ID}, isOnline=false)`);
  } else {
    const now = recentISO();
    await db.collection("users").doc(uid).set(
      {
        uid,
        email: driver.email,
        name: driver.name,
        role: "driver",
        orgId: ORG_ID,
        updatedAt: now,
      },
      { merge: true },
    );
    await db.collection("drivers").doc(uid).set(
      {
        uid,
        name: driver.name,
        email: driver.email,
        orgId: ORG_ID,
        isOnline: false,
        lastLocation: null,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  return { uid: uid!, name: driver.name, email: driver.email, reused };
}

async function resolveCreatedBy(driverUids: string[]): Promise<string> {
  if (process.env.ORG_OWNER_UID) return process.env.ORG_OWNER_UID;
  // Try the org doc's ownerUid
  try {
    const orgDoc = await db.collection("organizations").doc(ORG_ID).get();
    const ownerUid = orgDoc.data()?.ownerUid as string | undefined;
    if (ownerUid) return ownerUid;
  } catch {
    // ignore
  }
  // Fallback: first driver
  return driverUids[0]!;
}

function buildStops(input: SeedTripInput, status: TripStatus): SeedStop[] {
  const total = input.stops.length;
  // For in_progress: complete the first half, leave the rest pending.
  const completedThrough = status === "completed" ? total : status === "in_progress" ? Math.max(1, Math.floor(total / 2)) : 0;

  return input.stops.map((s, i) => {
    const stopStatus: StopStatus = i < completedThrough ? "completed" : "pending";
    const stop: SeedStop = {
      address: s.address,
      contactName: s.contactName ?? "",
      lat: s.lat,
      lng: s.lng,
      sequence: i,
      notes: "",
      status: stopStatus,
    };
    if (stopStatus === "completed") {
      const completed = new Date();
      completed.setDate(completed.getDate() - input.daysAgo);
      completed.setHours(9 + i, (i * 7) % 60, 0, 0);
      stop.completedAt = completed.toISOString();
    }
    return stop;
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding NJ data into orgId="${ORG_ID}" ${DRY_RUN ? "(DRY RUN)" : ""} ${FORCE ? "(FORCE)" : ""}`);

  // Idempotency: skip if seed trips already exist (unless FORCE).
  if (!FORCE) {
    const existing = await db
      .collection("trips")
      .where("orgId", "==", ORG_ID)
      .where("seedTag", "==", SEED_TAG)
      .limit(1)
      .get();
    if (!existing.empty) {
      console.log(
        `Found existing trips with seedTag="${SEED_TAG}" in org. Skipping. Set FORCE=true to re-seed.`,
      );
      return;
    }
  }

  // 1) Drivers
  const driverResults: DriverResult[] = [];
  for (const driver of DRIVERS) {
    const result = await ensureDriver(driver);
    driverResults.push(result);
  }
  const driverUids = driverResults.map((d) => d.uid);
  const createdBy = await resolveCreatedBy(driverUids);
  console.log(`[meta] createdBy uid for trips: ${createdBy}`);

  // 2) Trips
  let tripsCreated = 0;
  const statusCounts: Record<TripStatus, number> = {
    draft: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };

  for (const input of TRIPS) {
    const status = input.status;
    const stops = buildStops(input, status);
    const driverId = input.driverIndex >= 0 ? driverUids[input.driverIndex] : null;
    // Status rules: drafts have no driver; cancelled may keep its driverId.
    const finalDriverId = status === "draft" ? null : driverId;

    const tripDoc = {
      driverId: finalDriverId,
      createdBy,
      orgId: ORG_ID,
      status,
      route: null,
      notes: input.notes,
      stopCount: stops.length,
      seedTag: SEED_TAG,
      createdAt: isoDaysAgo(input.daysAgo),
      updatedAt: recentISO(),
    };

    if (DRY_RUN) {
      console.log(
        `[trip] would create "${input.notes}" status=${status} stops=${stops.length} driver=${finalDriverId ?? "none"}`,
      );
    } else {
      const tripRef = await db.collection("trips").add(tripDoc);
      const stopsCol = tripRef.collection("stops");
      const batch = db.batch();
      for (const stop of stops) {
        const stopRef = stopsCol.doc();
        const stopRecord: Record<string, unknown> = {
          stopId: stopRef.id,
          address: stop.address,
          contactName: stop.contactName,
          lat: stop.lat,
          lng: stop.lng,
          sequence: stop.sequence,
          notes: stop.notes,
          status: stop.status,
        };
        if (stop.completedAt) stopRecord.completedAt = stop.completedAt;
        batch.set(stopRef, stopRecord);
      }
      await batch.commit();
      console.log(`[trip] created ${tripRef.id} "${input.notes}" status=${status}`);
    }

    tripsCreated++;
    statusCounts[status]++;
  }

  // 3) Summary
  const created = driverResults.filter((d) => !d.reused).length;
  const reused = driverResults.filter((d) => d.reused).length;
  console.log("");
  console.log(`Drivers: ${created} created, ${reused} reused`);
  console.log(
    `Trips: ${tripsCreated} created (${statusCounts.completed} completed, ${statusCounts.in_progress} in_progress, ${statusCounts.assigned} assigned, ${statusCounts.draft} draft, ${statusCounts.cancelled} cancelled)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
