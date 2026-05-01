import { db } from "../config/firebase";
import { aiJson } from "./ai";
import { computeRoute } from "./directions";
import { computeWeather, isWeatherConfigured } from "./weather";
import type { PredictedEta, Trip, TripStop } from "@quickroutesai/shared";

/**
 * Predictive ETA Engine.
 *
 * Pipeline:
 *   1. Establish a baseline duration from the trip's computed route (or
 *      compute one fresh if missing).
 *   2. Pull up to 50 recently-completed trips and filter in memory for
 *      samples whose creation timestamp shares the same day-of-week and
 *      is within ±2 hours of the current hour-of-day. Keep the top 20.
 *   3. Fetch a weather summary for the origin stop (best-effort).
 *   4. Ask OpenAI to produce an adjusted duration + confidence + reasoning.
 *
 * Limitations (intentional, single-pass scope):
 *   - Historical matching is approximate: we do NOT geohash or match origin /
 *     destination. Two trips that happen on the same day-of-week at the same
 *     hour are considered "similar" regardless of where they went.
 *   - We approximate "actual duration" as (updatedAt - createdAt). This is
 *     only tight if the trip was both created and completed in the same
 *     session. A future iteration should add explicit start/complete
 *     timestamps to the Trip schema.
 */

const HISTORICAL_QUERY_LIMIT = 50;
const HISTORICAL_SAMPLE_CAP = 20;
const TIME_OF_DAY_WINDOW_HOURS = 2;

export interface HistoricalSample {
  baselineSeconds: number;
  actualSeconds: number;
}

interface AiAdjustment {
  adjustedSeconds: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
}

function hourDistance(aHour: number, bHour: number): number {
  const diff = Math.abs(aHour - bHour);
  return Math.min(diff, 24 - diff);
}

async function fetchHistoricalSamples(nowHour: number, nowDow: number): Promise<HistoricalSample[]> {
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const snap = await db
      .collection("trips")
      .where("status", "==", "completed")
      .orderBy("updatedAt", "desc")
      .limit(HISTORICAL_QUERY_LIMIT)
      .get();
    docs = snap.docs;
  } catch (err) {
    // If the composite index isn't available in tests/dev, fall back to empty samples
    console.warn("fetchHistoricalSamples: query failed, continuing without samples:", err);
    return [];
  }

  const samples: HistoricalSample[] = [];
  for (const doc of docs) {
    const data = doc.data() as Partial<Trip> | undefined;
    if (!data?.createdAt || !data.updatedAt) continue;

    const created = new Date(data.createdAt);
    if (isNaN(created.getTime())) continue;
    if (created.getDay() !== nowDow) continue;
    if (hourDistance(created.getHours(), nowHour) > TIME_OF_DAY_WINDOW_HOURS) continue;

    // Proxy for actual duration: updatedAt - createdAt.
    // NOTE: in the current schema we don't have explicit in_progress / completion
    // timestamps, so we use the full lifecycle as an approximation.
    const actualMs = new Date(data.updatedAt).getTime() - created.getTime();
    if (!Number.isFinite(actualMs) || actualMs <= 0) continue;

    const baseline = data.route?.durationSeconds;
    if (!baseline || baseline <= 0) continue;

    samples.push({
      baselineSeconds: baseline,
      actualSeconds: Math.round(actualMs / 1000),
    });
    if (samples.length >= HISTORICAL_SAMPLE_CAP) break;
  }
  return samples;
}

async function fetchWeatherSummary(originStop: TripStop | undefined): Promise<string | undefined> {
  if (!originStop || !isWeatherConfigured) return undefined;
  try {
    const result = await computeWeather([originStop], 1);
    const current = result.stops[0]?.current;
    if (!current) return undefined;
    return `${current.main} (${current.description}), ${current.temperatureF.toFixed(0)}°F, ${current.windSpeedMph.toFixed(0)} mph wind`;
  } catch (err) {
    console.warn("fetchWeatherSummary: weather unavailable:", err);
    return undefined;
  }
}

export async function predictEta(trip: Trip): Promise<PredictedEta> {
  // 1. Baseline duration — prefer what's already stored on the trip.
  let baselineDurationSeconds: number | undefined = trip.route?.durationSeconds;
  if (!baselineDurationSeconds) {
    const stops = trip.stops ?? [];
    if (stops.length < 2) {
      throw new Error("Cannot predict ETA: trip has no route and fewer than 2 stops");
    }
    const { route } = await computeRoute(stops);
    baselineDurationSeconds = route.durationSeconds;
  }

  // 2. Expected departure = now (scope compromise; a future iteration could use
  //    an explicit scheduled departure field).
  const now = new Date();
  const dayOfWeek = now.getDay();
  const timeOfDayHour = now.getHours();

  // 3. Historical samples (same DoW + within ±2h of current hour).
  const samples = await fetchHistoricalSamples(timeOfDayHour, dayOfWeek);

  // 4. Weather for the origin stop (stop with lowest sequence).
  const originStop = [...(trip.stops ?? [])].sort((a, b) => a.sequence - b.sequence)[0];
  const weatherSummary = await fetchWeatherSummary(originStop);

  // 5. Ask OpenAI to produce the adjusted ETA.
  const prompt = `You are a logistics ETA predictor. Given a baseline duration, historical samples, and weather, adjust the ETA.
Baseline duration (seconds): ${baselineDurationSeconds}
Day of week: ${dayOfWeek} (0=Sunday)
Hour of day: ${timeOfDayHour}
Weather: ${weatherSummary ?? "unknown"}
Historical samples (baseline seconds, actual seconds): ${JSON.stringify(samples.map((s) => [s.baselineSeconds, s.actualSeconds]))}

Return JSON: { "adjustedSeconds": number, "confidence": "low"|"medium"|"high", "reasoning": string }
Your JSON only. No markdown. Reasoning must be under 300 characters.`;

  let adjustment: AiAdjustment;
  try {
    adjustment = await aiJson<AiAdjustment>(prompt, 400);
  } catch (err) {
    // If AI is unreachable, fall back to baseline with low confidence so the
    // endpoint still returns something useful.
    console.warn("predictEta: AI call failed, falling back to baseline:", err);
    adjustment = {
      adjustedSeconds: baselineDurationSeconds,
      confidence: "low",
      reasoning: "AI adjustment unavailable; using baseline duration",
    };
  }

  const adjusted = Number.isFinite(adjustment.adjustedSeconds) && adjustment.adjustedSeconds > 0
    ? Math.round(adjustment.adjustedSeconds)
    : baselineDurationSeconds;

  const confidence: "low" | "medium" | "high" =
    adjustment.confidence === "high" || adjustment.confidence === "medium" || adjustment.confidence === "low"
      ? adjustment.confidence
      : "low";

  const reasoning = (adjustment.reasoning ?? "").slice(0, 500);

  const predictedArrivalAt = new Date(now.getTime() + adjusted * 1000).toISOString();

  return {
    predictedArrivalAt,
    baselineDurationSeconds,
    adjustedDurationSeconds: adjusted,
    confidence,
    reasoning,
    factors: {
      dayOfWeek,
      timeOfDayHour,
      historicalSampleSize: samples.length,
      weatherSummary,
    },
    generatedAt: now.toISOString(),
  };
}
