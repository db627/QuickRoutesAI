/**
 * One-off backfill: stamps a given orgId on every user/{uid}, driver/{uid},
 * and trip/{tripId} document in Firestore. Use this to bulk-link legacy
 * accounts/trips created before the two-path signup flow + org-scoped trips.
 *
 * Run from apps/api with the API's .env loaded:
 *   npx tsx scripts/backfill-orgid.ts
 *
 * Set ORG_ID below or pass via env: ORG_ID=<id> npx tsx scripts/backfill-orgid.ts
 */
import "dotenv/config";
import { db } from "../src/config/firebase";

const ORG_ID = process.env.ORG_ID || "fMUlXX2dX8FQOCLhupeU";
const BATCH_SIZE = 400; // Firestore batch limit is 500; stay under to be safe.
const DRY_RUN = process.env.DRY_RUN === "true";

async function backfillCollection(collectionName: "users" | "drivers" | "trips") {
  const snap = await db.collection(collectionName).get();
  console.log(`[${collectionName}] found ${snap.size} docs`);

  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const doc of snap.docs) {
    const current = doc.data().orgId;
    if (current === ORG_ID) {
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[${collectionName}] would update ${doc.id} (current orgId: ${current ?? "none"})`);
      updated++;
      continue;
    }
    batch.update(doc.ref, { orgId: ORG_ID, updatedAt: new Date().toISOString() });
    opsInBatch++;
    updated++;
    if (opsInBatch >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0 && !DRY_RUN) {
    await batch.commit();
  }

  console.log(`[${collectionName}] ${DRY_RUN ? "would update" : "updated"} ${updated}, skipped ${skipped} (already on ${ORG_ID})`);
}

async function main() {
  console.log(`Backfilling orgId = "${ORG_ID}" ${DRY_RUN ? "(DRY RUN)" : ""}`);
  await backfillCollection("users");
  await backfillCollection("drivers");
  await backfillCollection("trips");
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
