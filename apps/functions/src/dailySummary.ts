import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailySummaryStats {
  tripsCompleted: number;
  tripsCancelled: number;
  activeDrivers: number;
  avgDurationSeconds?: number;
  avgEtaErrorMinutes?: number;
  totalDistanceMeters?: number;
}

export interface DailyInsightsSummary {
  date: string;
  highlights: string[];
  concerns: string[];
  recommendations: string[];
  generatedAt: string;
  stats: DailySummaryStats;
}

interface TripDoc {
  id: string;
  status?: string;
  driverId?: string | null;
  route?: { distanceMeters?: number; durationSeconds?: number };
  predictedEta?: { errorMinutes?: number };
  stops?: Array<{ address?: string }>;
}

interface AIResponse {
  highlights: string[];
  concerns: string[];
  recommendations: string[];
}

// ─── Configurable schedule ────────────────────────────────────────────────────
// Set DAILY_SUMMARY_SCHEDULE env var to override (e.g. "0 18 * * *" for 6 PM UTC).
// Defaults to 11 PM UTC every day.
export const DAILY_SUMMARY_SCHEDULE =
  process.env.DAILY_SUMMARY_SCHEDULE ?? "0 23 * * *";

// ─── Core logic (exported for testing) ───────────────────────────────────────

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  }
  return _openai;
}

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampArr(arr: unknown, max = 5): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, max);
}

/**
 * Fetch and aggregate trip data for the given UTC date, call OpenAI for
 * highlights/concerns/recommendations, and return a structured summary.
 * Exported for unit testing without the Cloud Function wrapper.
 */
export async function buildDailySummary(
  db: admin.firestore.Firestore,
  dateYmd: string,
): Promise<DailyInsightsSummary> {
  const startIso = new Date(`${dateYmd}T00:00:00.000Z`).toISOString();
  const endDate = new Date(`${dateYmd}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endIso = endDate.toISOString();

  const emptyResult: DailyInsightsSummary = {
    date: dateYmd,
    highlights: [],
    concerns: [],
    recommendations: [],
    generatedAt: new Date().toISOString(),
    stats: { tripsCompleted: 0, tripsCancelled: 0, activeDrivers: 0 },
  };

  // ── Query trips updated during this UTC day ──────────────────────────────
  let trips: TripDoc[] = [];
  try {
    const snap = await db
      .collection("trips")
      .where("updatedAt", ">=", startIso)
      .where("updatedAt", "<", endIso)
      .get();
    trips = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TripDoc, "id">) }));
  } catch (err) {
    console.error("[dailySummary] Firestore query failed", err);
    return emptyResult;
  }

  // ── Compute stats ────────────────────────────────────────────────────────
  const completed = trips.filter((t) => t.status === "completed");
  const cancelled = trips.filter((t) => t.status === "cancelled");
  const driverIds = new Set(trips.map((t) => t.driverId).filter((id): id is string => !!id));

  const durations = completed
    .map((t) => t.route?.durationSeconds)
    .filter((d): d is number => typeof d === "number");
  const avgDurationSeconds =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined;

  const distances = completed
    .map((t) => t.route?.distanceMeters)
    .filter((d): d is number => typeof d === "number");
  const totalDistanceMeters =
    distances.length > 0 ? distances.reduce((a, b) => a + b, 0) : undefined;

  const etaErrors = completed
    .filter((t) => typeof t.predictedEta?.errorMinutes === "number")
    .map((t) => t.predictedEta!.errorMinutes as number);
  const avgEtaErrorMinutes =
    etaErrors.length > 0 ? etaErrors.reduce((a, b) => a + b, 0) / etaErrors.length : undefined;

  const stats: DailySummaryStats = {
    tripsCompleted: completed.length,
    tripsCancelled: cancelled.length,
    activeDrivers: driverIds.size,
    ...(avgDurationSeconds !== undefined && { avgDurationSeconds }),
    ...(totalDistanceMeters !== undefined && { totalDistanceMeters }),
    ...(avgEtaErrorMinutes !== undefined && { avgEtaErrorMinutes }),
  };

  if (trips.length === 0) {
    return { ...emptyResult, stats };
  }

  // ── Build OpenAI prompt ──────────────────────────────────────────────────
  const sampleTrips = completed.slice(-5).map((t) => ({
    stops: (t.stops ?? []).length,
    durationMin: t.route?.durationSeconds ? Math.round(t.route.durationSeconds / 60) : null,
    distanceKm: t.route?.distanceMeters ? (t.route.distanceMeters / 1000).toFixed(1) : null,
  }));

  const prompt = `You are a fleet operations analyst. Given real daily stats for a delivery fleet, write concise, actionable insights.

Date: ${dateYmd}

Stats (these are REAL — do NOT fabricate numbers):
- Trips completed: ${stats.tripsCompleted}
- Trips cancelled: ${stats.tripsCancelled}
- Active drivers: ${stats.activeDrivers}
- Avg trip duration: ${avgDurationSeconds !== undefined ? Math.round(avgDurationSeconds / 60) + " min" : "n/a"}
- Total distance: ${totalDistanceMeters !== undefined ? (totalDistanceMeters / 1000).toFixed(1) + " km" : "n/a"}
- Avg ETA error: ${avgEtaErrorMinutes !== undefined ? avgEtaErrorMinutes.toFixed(1) + " min" : "n/a"}

Sample completed trips:
${sampleTrips.map((t) => `- ${t.stops} stops, ${t.durationMin ?? "?"} min, ${t.distanceKm ?? "?"} km`).join("\n") || "(none)"}

Return ONLY a JSON object with 1-5 items per array:
{
  "highlights": ["<positive observation>"],
  "concerns": ["<issue or risk>"],
  "recommendations": ["<actionable improvement>"]
}`;

  let commentary: AIResponse;
  try {
    const response = await openaiClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 600,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    commentary = JSON.parse(cleaned) as AIResponse;
  } catch (err) {
    console.error("[dailySummary] OpenAI call failed", err);
    return { ...emptyResult, stats };
  }

  return {
    date: dateYmd,
    highlights: clampArr(commentary.highlights),
    concerns: clampArr(commentary.concerns),
    recommendations: clampArr(commentary.recommendations),
    generatedAt: new Date().toISOString(),
    stats,
  };
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const scheduledDailySummary = onSchedule(
  {
    schedule: DAILY_SUMMARY_SCHEDULE,
    timeZone: "UTC",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async (_event) => {
    if (!admin.apps.length) {
      admin.initializeApp();
    }

    const db = admin.firestore();
    const date = todayUtcYmd();

    console.log(`[dailySummary] Generating summary for ${date}`);
    const summary = await buildDailySummary(db, date);

    await db.collection("insights").doc(date).set(summary, { merge: true });
    console.log(
      `[dailySummary] Stored insights/${date} — ` +
        `${summary.stats.tripsCompleted} completed, ${summary.stats.activeDrivers} drivers, ` +
        `${summary.highlights.length} highlights, ${summary.concerns.length} concerns`,
    );
  },
);
