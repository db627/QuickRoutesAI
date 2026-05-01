import { db } from "../config/firebase";
import type { DailyInsights } from "@quickroutesai/shared";

interface AIInsightsResponse {
  highlights: string[];
  concerns: string[];
  recommendations: string[];
}

interface TripDoc {
  id: string;
  status?: string;
  driverId?: string | null;
  route?: {
    distanceMeters?: number;
    durationSeconds?: number;
  };
  predictedEta?: {
    errorMinutes?: number;
  };
  createdAt?: string;
  updatedAt?: string;
  stops?: Array<{ address?: string }>;
}

/**
 * Generate daily insights for a given date (YYYY-MM-DD, UTC).
 *
 * Computes real stats from Firestore trip data, then asks AI for commentary.
 * On Firestore query failure, logs and returns a zero-stats record.
 */
export async function generateDailyInsights(dateYmd: string): Promise<DailyInsights> {
  const startIso = new Date(`${dateYmd}T00:00:00.000Z`).toISOString();
  const endIso = new Date(`${dateYmd}T00:00:00.000Z`);
  endIso.setUTCDate(endIso.getUTCDate() + 1);
  const endIsoStr = endIso.toISOString();

  const emptyInsights: DailyInsights = {
    date: dateYmd,
    highlights: [],
    concerns: [],
    recommendations: [],
    generatedAt: new Date().toISOString(),
    stats: {
      tripsCompleted: 0,
      tripsCancelled: 0,
      activeDrivers: 0,
    },
  };

  let trips: TripDoc[] = [];
  try {
    const snap = await db
      .collection("trips")
      .where("updatedAt", ">=", startIso)
      .where("updatedAt", "<", endIsoStr)
      .get();

    trips = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to query trips for insights", err);
    return emptyInsights;
  }

  // ── Compute stats ────────────────────────────────────────────────
  const completedTrips = trips.filter((t) => t.status === "completed");
  const cancelledTrips = trips.filter((t) => t.status === "cancelled");
  const driverIds = new Set(
    trips.map((t) => t.driverId).filter((id): id is string => !!id),
  );

  const durations = completedTrips
    .map((t) => t.route?.durationSeconds)
    .filter((d): d is number => typeof d === "number");
  const avgDurationSeconds =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : undefined;

  const etaErrors = trips
    .filter((t) => t.status === "completed" && typeof t.predictedEta?.errorMinutes === "number")
    .map((t) => t.predictedEta!.errorMinutes as number);
  const avgEtaErrorMinutes =
    etaErrors.length > 0
      ? etaErrors.reduce((a, b) => a + b, 0) / etaErrors.length
      : undefined;

  const stats: DailyInsights["stats"] = {
    tripsCompleted: completedTrips.length,
    tripsCancelled: cancelledTrips.length,
    activeDrivers: driverIds.size,
    ...(avgDurationSeconds !== undefined ? { avgDurationSeconds } : {}),
    ...(avgEtaErrorMinutes !== undefined ? { avgEtaErrorMinutes } : {}),
  };

  // ── No trips? return zero-stats record with empty arrays ────────
  if (trips.length === 0) {
    return {
      ...emptyInsights,
      stats,
    };
  }

  // ── Build prompt ────────────────────────────────────────────────
  const sampleTrips = completedTrips.slice(-5).map((t) => ({
    id: t.id.slice(0, 8),
    status: t.status,
    stops: (t.stops || []).length,
    durationSeconds: t.route?.durationSeconds,
    distanceMeters: t.route?.distanceMeters,
  }));

  const prompt = `You are a fleet operations analyst. Given real daily stats for a delivery operation, write concise, actionable insights.

Date: ${dateYmd}

Stats (these are REAL — do NOT make up numbers):
- Trips completed: ${stats.tripsCompleted}
- Trips cancelled: ${stats.tripsCancelled}
- Active drivers: ${stats.activeDrivers}
- Average trip duration: ${stats.avgDurationSeconds ? Math.round(stats.avgDurationSeconds / 60) + " min" : "n/a"}
- Average ETA prediction error: ${stats.avgEtaErrorMinutes !== undefined ? stats.avgEtaErrorMinutes.toFixed(1) + " min" : "n/a"}

Sample completed trips:
${sampleTrips.map((t) => `- Trip ${t.id}: ${t.stops} stops, ${t.durationSeconds ? Math.round(t.durationSeconds / 60) + " min" : "no route"}`).join("\n") || "(none)"}

Return ONLY a JSON object with 1-5 bullet points in each array:
{
  "highlights": ["<positive observation>", ...],
  "concerns": ["<issue or risk to address>", ...],
  "recommendations": ["<actionable improvement>", ...]
}
Each bullet should be a single short sentence.`;

  let commentary: AIInsightsResponse;
  try {
    // Lazy-require so tests that mock "../services/ai" can intercept before
    // OpenAI's module-level client instantiation throws on missing API key.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const aiModule = require("./ai") as typeof import("./ai");
    commentary = await aiModule.aiJson<AIInsightsResponse>(prompt, 600);
  } catch (err) {
    console.error("Failed to generate AI insights", err);
    return {
      ...emptyInsights,
      stats,
    };
  }

  const clampArr = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .slice(0, 5);
  };

  return {
    date: dateYmd,
    highlights: clampArr(commentary.highlights),
    concerns: clampArr(commentary.concerns),
    recommendations: clampArr(commentary.recommendations),
    generatedAt: new Date().toISOString(),
    stats,
  };
}
