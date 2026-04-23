import OpenAI from "openai";
import { db } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import { decodePolyline } from "./directions";
import { computeHistoricalWeather } from "./weather";
import { start } from "repl";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Shared OpenAI helper — sends a prompt and parses JSON from the response.
 */
export async function aiJson<T>(prompt: string, maxTokens = 1000): Promise<T> {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: maxTokens,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from OpenAI");

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse OpenAI JSON response: ${content}`);
  }
}

/**
 * Shared OpenAI helper — returns plain text.
 */
export async function aiText(prompt: string, maxTokens = 2000): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from OpenAI");
  return content;
}

// ─── Feature: Smart Auto-Assign Driver ───────────────────────────────

interface DriverCandidate {
  uid: string;
  name: string;
  lat: number;
  lng: number;
  currentTripCount: number;
}

interface AutoAssignResult {
  driverId: string;
  reason: string;
}

export async function pickBestDriver(
  candidates: DriverCandidate[],
  tripStops: { address: string; lat: number; lng: number }[],
): Promise<AutoAssignResult> {
  if (candidates.length === 0) throw new Error("No available drivers");
  if (candidates.length === 1) {
    return { driverId: candidates[0].uid, reason: "Only available driver" };
  }

  const driverList = candidates
    .map(
      (d, i) =>
        `  ${i}: "${d.name}" (uid: ${d.uid}, location: ${d.lat.toFixed(5)},${d.lng.toFixed(5)}, active trips: ${d.currentTripCount})`,
    )
    .join("\n");

  const stopList = tripStops
    .map((s, i) => `  ${i}: "${s.address}" (${s.lat.toFixed(5)}, ${s.lng.toFixed(5)})`)
    .join("\n");

  const prompt = `You are a delivery dispatch optimizer. Pick the BEST driver for this trip.

Factors to consider (in order of importance):
1. Distance from driver's current location to the first stop (closest is better)
2. Current workload — fewer active trips is better
3. Overall efficiency — driver already in the area is better

Available drivers:
${driverList}

Trip stops:
${stopList}

Return ONLY a JSON object: { "driverIndex": <number>, "reason": "<short explanation>" }`;

  const result = await aiJson<{ driverIndex: number; reason: string }>(prompt, 200);

  if (result.driverIndex < 0 || result.driverIndex >= candidates.length) {
    throw new Error(`Invalid driver index from AI: ${result.driverIndex}`);
  }

  return {
    driverId: candidates[result.driverIndex].uid,
    reason: result.reason,
  };
}

// ─── Feature: Address Autocorrect ────────────────────────────────────

interface AddressCorrection {
  original: string;
  corrected: string;
  confidence: number; // 0-1
  changed: boolean;
}

export async function correctAddresses(addresses: string[]): Promise<AddressCorrection[]> {
  const prompt = `You are an address validation and autocorrect engine for US delivery addresses.

For each address below, correct any typos, abbreviations, or formatting issues. Return a properly formatted US address. If the address is already correct, return it as-is.

Addresses:
${addresses.map((a, i) => `  ${i}: "${a}"`).join("\n")}

Return ONLY a JSON array of objects: [{ "original": "...", "corrected": "...", "confidence": 0.0-1.0, "changed": true/false }]
- confidence: how confident you are the corrected address is valid (1.0 = very confident)
- changed: whether you modified the address at all`;

  return aiJson<AddressCorrection[]>(prompt, 500);
}

// ─── Feature: Trip Summary / Reports ─────────────────────────────────

interface TripData {
  id: string;
  status: string;
  stops: number;
  distanceMeters?: number;
  durationSeconds?: number;
  fuelSavingsGallons?: number;
  driverName?: string;
  createdAt: string;
  completedAt?: string;
}

interface DailySummaryStats {
  totalTrips: number;
  completedTrips: number;
  totalDistanceMiles: number;
  totalDurationHours: number;
  totalFuelSavedGallons: number;
}

interface AICommentary {
  overview: string;
  highlights: string[];
  recommendations: string[];
}

export interface DailySummary extends DailySummaryStats {
  overview: string;
  highlights: string[];
  recommendations: string[];
}

/**
 * Compute stats from real DB data, then ask AI only for commentary.
 */
export async function generateDailySummary(
  trips: TripData[],
  date: string,
): Promise<DailySummary> {
  // ── Compute accurate stats from DB data ──
  const stats: DailySummaryStats = {
    totalTrips: trips.length,
    completedTrips: trips.filter((t) => t.status === "completed").length,
    totalDistanceMiles: trips.reduce(
      (sum, t) => sum + (t.distanceMeters ? t.distanceMeters / 1609.344 : 0),
      0,
    ),
    totalDurationHours: trips.reduce(
      (sum, t) => sum + (t.durationSeconds ? t.durationSeconds / 3600 : 0),
      0,
    ),
    totalFuelSavedGallons: trips.reduce(
      (sum, t) => sum + (t.fuelSavingsGallons ?? 0),
      0,
    ),
  };

  // ── Build context for AI commentary ──
  const tripList = trips
    .map(
      (t) =>
        `- Trip ${t.id.slice(0, 8)}: ${t.status}, ${t.stops} stops, ${t.distanceMeters ? (t.distanceMeters / 1609.344).toFixed(1) + " mi" : "no route"}, driver: ${t.driverName || "unassigned"}, fuel saved: ${t.fuelSavingsGallons?.toFixed(2) || "0"} gal`,
    )
    .join("\n");

  const prompt = `You are a fleet analytics commentator. Given the following REAL data for a delivery company, write insightful commentary. Do NOT make up any numbers — the stats are already computed.

Date: ${date}
Computed stats: ${stats.totalTrips} total trips, ${stats.completedTrips} completed, ${stats.totalDistanceMiles.toFixed(1)} miles driven, ${stats.totalDurationHours.toFixed(1)} hours, ${stats.totalFuelSavedGallons.toFixed(2)} gallons saved.

Individual trips:
${tripList || "(no trips)"}

Return ONLY a JSON object:
{
  "overview": "<2-3 sentence summary commenting on the day's operations — reference the real numbers above>",
  "highlights": ["<key positive observation>", ...],
  "recommendations": ["<actionable improvement suggestion>", ...]
}
Do NOT include any numeric stats fields — only overview, highlights, and recommendations.`;

  const commentary = await aiJson<AICommentary>(prompt, 600);

  // Destructure only the fields we expect from AI — never let AI overwrite real stats
  return {
    ...stats,
    overview: commentary.overview ?? "",
    highlights: Array.isArray(commentary.highlights) ? commentary.highlights : [],
    recommendations: Array.isArray(commentary.recommendations) ? commentary.recommendations : [],
  };
}

// ─── Feature: Anomaly Detection ──────────────────────────────────────

interface DriverActivity {
  driverId: string;
  driverName: string;
  events: {
    type: string;
    lat?: number;
    lng?: number;
    speedMps?: number;
    timestamp: string;
  }[];
  tripStatus?: string;
  tripStops?: { lat: number; lng: number; address: string }[];
}

interface Anomaly {
  driverId: string;
  driverName: string;
  type: "idle" | "off_route" | "speeding" | "slow" | "unusual_pattern";
  severity: "low" | "medium" | "high";
  description: string;
}

export async function detectAnomalies(
  activities: DriverActivity[],
): Promise<Anomaly[]> {
  if (activities.length === 0) return [];

  const activityList = activities
    .map((a) => {
      const eventSummary = a.events.slice(-20).map(
        (e) =>
          `    ${e.type} at ${e.timestamp}${e.lat ? ` (${e.lat.toFixed(4)},${e.lng?.toFixed(4)})` : ""}${e.speedMps ? ` speed: ${(e.speedMps * 2.237).toFixed(0)} mph` : ""}`,
      ).join("\n");
      return `Driver: ${a.driverName} (${a.driverId})\n  Trip status: ${a.tripStatus || "none"}\n  Route stops: ${a.tripStops?.map((s) => s.address).join(" → ") || "none"}\n  Recent events:\n${eventSummary}`;
    })
    .join("\n\n");

  const prompt = `You are a fleet safety and anomaly detection system. Analyze driver activities and flag any concerns.

Flag these types of anomalies:
- "idle": Driver stopped for too long during an active trip (>15 min without movement)
- "off_route": Driver significantly far from their assigned route
- "speeding": Driver consistently above 75 mph
- "slow": Trip taking much longer than expected
- "unusual_pattern": Any other suspicious behavior

Driver Activities:
${activityList}

Return ONLY a JSON array of anomalies found (empty array if none):
[{ "driverId": "...", "driverName": "...", "type": "idle|off_route|speeding|slow|unusual_pattern", "severity": "low|medium|high", "description": "..." }]`;

  return aiJson<Anomaly[]>(prompt, 800);
}

// ─── Feature: Smart ETA Prediction ───────────────────────────────────

interface ETAInput {
  tripId: string;
  currentLat: number;
  currentLng: number;
  remainingStops: { address: string; lat: number; lng: number; sequence: number }[];
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  currentSpeedMps: number;
  timeOfDay: string; // e.g. "14:30"
  dayOfWeek: string; // e.g. "Monday"
}

interface ETAPrediction {
  estimatedArrivalMinutes: number;
  confidence: number;
  factors: string[];
  perStopETA: { stopIndex: number; address: string; etaMinutes: number }[];
}

type Point = {
  lat: number;
  lng: number;
};

function haversineMeters(a: Point, b: Point): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => deg * Math.PI / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDistanceMeters(points: Point[]): number {
  if (points.length < 2) return 0;

  let total = 0;

  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }

  return total;
}

export async function predictETA(input: ETAInput): Promise<ETAPrediction> {
  const stopList = input.remainingStops
    .map(
      (s) =>
        `  ${s.sequence}: "${s.address}" (${s.lat.toFixed(5)}, ${s.lng.toFixed(5)})`,
    )
    .join("\n");

  const prompt = `You are a delivery ETA prediction engine. Predict accurate arrival times considering real-world factors.

Current state:
- Driver position: (${input.currentLat.toFixed(5)}, ${input.currentLng.toFixed(5)})
- Current speed: ${(input.currentSpeedMps * 2.237).toFixed(0)} mph
- Time: ${input.timeOfDay} on ${input.dayOfWeek}
- Route distance remaining: ${input.routeDistanceMeters ? (input.routeDistanceMeters / 1609.344).toFixed(1) + " mi" : "unknown"}
- Google estimated duration: ${input.routeDurationSeconds ? Math.round(input.routeDurationSeconds / 60) + " min" : "unknown"}

Remaining stops to visit:
${stopList}

Consider factors like:
- Time of day (rush hour traffic: 7-9am, 4-7pm)
- Day of week (weekday vs weekend traffic)
- Current speed vs expected speed
- Stop time at each delivery (~3-5 min per stop)
- Urban vs suburban areas

Return ONLY a JSON object:
{
  "estimatedArrivalMinutes": <total minutes to complete all remaining stops>,
  "confidence": <0.0-1.0>,
  "factors": ["<factor affecting the estimate>", ...],
  "perStopETA": [{ "stopIndex": <number>, "address": "...", "etaMinutes": <minutes from now> }, ...]
}`;

  return aiJson<ETAPrediction>(prompt, 600);
}

// ─── Feature: AI-Powered Route Optimization ─────────────────────────

type PrimaryDelayCause =
  | "traffic"
  | "weather"
  | "dwell_time"
  | "route_inefficiency"
  | "normal_operations";

interface DelayAnalysisResult {
  delayCause: PrimaryDelayCause;
  confidence: number;
  summary: string;
  factors: string[];
  estimatedDelayMinutes: number;
  recommendations: string[];
}

interface RouteLeg {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
}

interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: number; // ms
  speedMps: number;
}

interface TripTimeWindow {
  startTime: Timestamp;
  endTime: Timestamp;
}

interface RouteStopLike {
  stopId: string;
  address: string;
  lat: number;
  lng: number;
  sequence: number;
  start_time?: Timestamp | string | Date;
  end_time?: Timestamp | string | Date;
}

interface EtaInputSummary {
  startLat: number;
  startLng: number;
  avgSpeed: number;
  stopSequence: number;
  estimatedArrivalMinutes: number;
  confidence: number;
  factors: string[];
  perStopETA: { stopIndex: number; address: string; etaMinutes: number }[];
}

interface LegAnomalySummary {
  legIndex: number;
  anomalies: Anomaly[];
}

interface LegDistanceSummary {
  legIndex: number;
  distance: number;
}

interface LegPointSummary {
  legIndex: number;
  points: GpsPoint[];
  decodedRoute: { lat: number; lng: number }[];
}

interface LegTimingSummary {
  legIndex: number;
  minutes: number;
}

interface BuiltRouteContext {
  routeStops: RouteStopLike[];
  route: any;
  currentRoute: any;
  legs: RouteLeg[];
}

function fallbackDelayResult(): DelayAnalysisResult[] {
  return [
    {
      delayCause: "normal_operations",
      confidence: -1,
      summary: "-1",
      factors: [],
      estimatedDelayMinutes: -1,
      recommendations: ["-1"],
    },
  ];
}

function toTimestamp(value: Timestamp | string | Date): Timestamp {
  return value instanceof Timestamp
    ? value
    : Timestamp.fromDate(new Date(value));
}

function toUnixSeconds(value: Timestamp | string | Date): number {
  return value instanceof Timestamp
    ? value.seconds
    : Math.floor(new Date(value).getTime() / 1000);
}

function sortStops(stops: any[]): RouteStopLike[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}

function getTripTimeWindow(sortedStops: RouteStopLike[]): TripTimeWindow | null {
  const rawStart = sortedStops[0]?.start_time;
  const rawEnd = sortedStops[sortedStops.length - 1]?.end_time;

  if (!rawStart || !rawEnd) return null;

  return {
    startTime: toTimestamp(rawStart),
    endTime: toTimestamp(rawEnd),
  };
}

async function fetchTripDoc(tripId: string) {
  return db.collection("trips").doc(tripId).get();
}

async function fetchGpsData(
  driverId: string,
  window: TripTimeWindow
): Promise<GpsPoint[]> {
  const geopointData = await db
    .collection("events")
    .where("type", "==", "location_ping")
    .where("driverId", "==", driverId)
    .where("createdAt", ">=", window.startTime)
    .where("createdAt", "<=", window.endTime)
    .orderBy("createdAt")
    .get();

  return geopointData.docs.map((doc) => {
    const data = doc.data();
    return {
      lat: data.payload.lat,
      lng: data.payload.lng,
      timestamp: data.createdAt.toDate().getTime(),
      speedMps: data.payload.speedMps,
    } satisfies GpsPoint;
  });
}

function buildRouteContext(
  tripData: any,
  sortedStops: RouteStopLike[],
  gpsData: GpsPoint[]
): BuiltRouteContext {
  const route = tripData?.route || [];
  const currentRoute = route[route.length - 1] || {};
  const legs: RouteLeg[] = currentRoute.legs ?? [];

  const needsDriverOrigin =
    legs.length > 0 && legs[0]?.fromStopId === "__driver_origin__";

  const routeStops: RouteStopLike[] = needsDriverOrigin
    ? [
        {
          stopId: "__driver_origin__",
          address: "Driver's starting location",
          lat: gpsData[0]?.lat || 0,
          lng: gpsData[0]?.lng || 0,
          sequence: -1,
        },
        ...sortedStops,
      ]
    : sortedStops;

  return {
    routeStops,
    route,
    currentRoute,
    legs,
  };
}

function getStopById(routeStops: RouteStopLike[], stopId?: string | null) {
  if (!stopId) return undefined;
  return routeStops.find((s) => s.stopId === stopId);
}

function getLegTimeWindow(
  leg: RouteLeg,
  routeStops: RouteStopLike[]
): TripTimeWindow | null {
  const toStop = getStopById(routeStops, leg.toStopId);

  if (!toStop?.start_time || !toStop?.end_time) return null;

  return {
    startTime: toTimestamp(toStop.start_time),
    endTime: toTimestamp(toStop.end_time),
  };
}

function getGpsPointsForLeg(
  gpsData: GpsPoint[],
  legWindow: TripTimeWindow
): GpsPoint[] {
  const startMs = legWindow.startTime.toDate().getTime();
  const endMs = legWindow.endTime.toDate().getTime();

  return gpsData.filter((point) => {
    return point.timestamp >= startMs && point.timestamp <= endMs;
  });
}

function averageLegSpeedMps(points: GpsPoint[]): number {
  const avg = points.reduce((sum, p) => sum + p.speedMps, 0) / (points.length || 1);
  return avg < 0.1 ? 20 : avg;
}

async function buildEtaSummaryForLeg(
  tripId: string,
  leg: RouteLeg,
  routeStops: RouteStopLike[],
  legGpsPoints: GpsPoint[]
): Promise<EtaInputSummary | null> {
  const toStop = getStopById(routeStops, leg.toStopId);
  const fromStop = getStopById(routeStops, leg.fromStopId);

  if (!toStop) return null;

  const currentLat = legGpsPoints[0]?.lat ?? fromStop?.lat ?? 0;
  const currentLng = legGpsPoints[0]?.lng ?? fromStop?.lng ?? 0;
  const avgSpeed = averageLegSpeedMps(legGpsPoints);

  const legStartRaw = toStop.start_time;
  const legStartTs =
    legStartRaw instanceof Timestamp ? legStartRaw : legStartRaw ? toTimestamp(legStartRaw) : null;

  const etaLegInput = {
    tripId,
    currentLat,
    currentLng,
    remainingStops: [
      {
        address: toStop.address,
        lat: toStop.lat,
        lng: toStop.lng,
        sequence: toStop.sequence,
      },
    ],
    currentSpeedMps: avgSpeed,
    routeDistanceMeters: leg.distanceMeters,
    routeDurationSeconds: leg.durationSeconds,
    timeOfDay: legStartTs
      ? legStartTs.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "",
    dayOfWeek: legStartTs
      ? legStartTs.toDate().toLocaleDateString([], { weekday: "long" })
      : "",
  };

  const etaPrediction = await predictETA(etaLegInput);

  return {
    startLat: etaLegInput.currentLat,
    startLng: etaLegInput.currentLng,
    avgSpeed: etaLegInput.currentSpeedMps,
    stopSequence: toStop.sequence,
    estimatedArrivalMinutes: etaPrediction.estimatedArrivalMinutes,
    confidence: etaPrediction.confidence,
    factors: etaPrediction.factors,
    perStopETA: etaPrediction.perStopETA,
  };
}

async function buildLegAnomalies(
  driverId: string,
  legIndex: number,
  legGpsPoints: GpsPoint[]
): Promise<LegAnomalySummary> {
  const legDriverActivity: DriverActivity = {
    driverId,
    driverName: "",
    events: legGpsPoints.map((p) => ({
      type: "location_ping",
      lat: p.lat,
      lng: p.lng,
      speedMps: p.speedMps,
      timestamp: new Date(p.timestamp).toISOString(),
    })),
  };

  const anomalies = await detectAnomalies([legDriverActivity]);

  return {
    legIndex,
    anomalies,
  };
}

function buildLegDistanceSummary(
  legIndex: number,
  legGpsPoints: GpsPoint[]
): LegDistanceSummary {
  return {
    legIndex,
    distance: totalDistanceMeters(legGpsPoints),
  };
}

function buildLegPointSummary(
  legIndex: number,
  leg: RouteLeg,
  legGpsPoints: GpsPoint[]
): LegPointSummary {
  return {
    legIndex,
    points: legGpsPoints,
    decodedRoute: decodePolyline(leg.polyline || ""),
  };
}

function buildLegCompletionTimes(routeStops: RouteStopLike[]): LegTimingSummary[] {
  return routeStops
    .filter((s) => s.stopId !== "__driver_origin__")
    .map((s) => {
      const start = s.start_time instanceof Timestamp ? s.start_time : s.start_time ? toTimestamp(s.start_time) : null;
      const end = s.end_time instanceof Timestamp ? s.end_time : s.end_time ? toTimestamp(s.end_time) : null;

      return {
        legIndex: s.sequence,
        minutes: start && end ? (end.seconds - start.seconds) / 60 : 0,
      };
    })
    .sort((a, b) => a.legIndex - b.legIndex);
}

async function fetchHistoricalWeatherForTrip(
  stops: RouteStopLike[],
  window: TripTimeWindow
) {
  return computeHistoricalWeather(
    stops as any[],
    window.startTime.seconds,
    window.endTime.seconds
  );
}

function buildDelayAnalysisPrompt(input: {
  currentRoute: any;
  gpsData: GpsPoint[];
  timeWindow: TripTimeWindow;
  routeStops: RouteStopLike[];
  legs: RouteLeg[];
  legPoints: LegPointSummary[];
  anomaliesPerLeg: LegAnomalySummary[];
  etaInputs: EtaInputSummary[];
  legCompletionTimes: LegTimingSummary[];
  weatherAtStops: any;
}): string {
  const {
    currentRoute,
    gpsData,
    timeWindow,
    routeStops,
    legs,
    legPoints,
    anomaliesPerLeg,
    etaInputs,
    legCompletionTimes,
    weatherAtStops,
  } = input;

  return `You are a fleet operations delay analysis engine.

Analyze this completed delivery trip and identify the most likely causes of delay compared to the planned route.

Important definitions:
- Leg travel time = time spent driving between stops.
- Dwell time = time spent stationary at or very near a stop location after arrival.
- Do NOT treat long leg travel time between stops as dwell time.
- Only classify a delay as dwell_time if there is evidence the driver remained stationary near the stop itself.
- If there is no clear evidence of stationary time at the stop, prefer traffic, weather, route_inefficiency, or normal_operations instead.

Trip Context:
- Planned route distance: ${currentRoute.distanceMeters ? (currentRoute.distanceMeters / 1609.344).toFixed(1) + " mi" : "unknown"}
- Planned route duration: ${currentRoute.durationSeconds ? Math.round(currentRoute.durationSeconds / 60) + " min" : "unknown"}
- Actual average speed: ${gpsData.length > 0 ? (gpsData.reduce((sum, p) => sum + p.speedMps, 0) / gpsData.length * 2.237).toFixed(1) + " mph" : "unknown"}
- Trip time window: ${timeWindow.startTime.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to ${timeWindow.endTime.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} on ${timeWindow.startTime.toDate().toLocaleDateString([], { weekday: "long" })}

Stops:
${routeStops.map(s => `  ${s.sequence}: "${s.address}" (${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}) - StopId: ${s.stopId}`).join("\n")}

Legs:
${legs.map((leg, i) => `  Leg ${i}: from ${leg.fromStopId} to ${leg.toStopId}, planned distance: ${leg.distanceMeters ? (leg.distanceMeters / 1609.344).toFixed(3) + " mi" : "unknown"}, planned duration: ${leg.durationSeconds ? (leg.durationSeconds / 60.0).toFixed(2) + " min" : "unknown"}`).join("\n")}

Observed GPS and route evidence:
${legPoints.map(lp => `  Leg ${lp.legIndex}:
    GPS points:
${lp.points.map(p => `      (${p.lat.toFixed(4)},${p.lng.toFixed(4)}) speed: ${(p.speedMps * 2.237).toFixed(0)} mph timestamp: ${new Date(p.timestamp).toLocaleTimeString()}`).join("\n")}
    Expected route points:
${lp.decodedRoute.map(p => `      (${p.lat.toFixed(4)},${p.lng.toFixed(4)})`).join("\n")}`).join("\n\n")}

Anomalies:
${anomaliesPerLeg.map(ap => `  Leg ${ap.legIndex}:
    ${ap.anomalies.length > 0 ? ap.anomalies.map(a => `- ${a.type} (${a.severity}): ${a.description}`).join("\n    ") : "No anomalies detected"}`).join("\n\n")}

ETA predictions:
${etaInputs.map((eta, i) => `  Leg ${i}: ETA to ${eta.perStopETA[0]?.address}: ${eta.perStopETA[0]?.etaMinutes} min; confidence ${eta.confidence}; factors: ${eta.factors.join(", ")}`).join("\n")}

Actual Leg Completion Times:
${legCompletionTimes.map(s => `  Leg ${s.legIndex}: ${s.minutes} mins`).join("\n")}

Weather during trip:
${weatherAtStops.stops.map((s: any) => `  Stop ${s.stopId} (${s.address}):
${s.forecast.map((f: any) => `      At ${f.actualTime}: ${f.main}, ${f.description}, temp: ${f.temperatureF}F, precip chance: ${f.precipitationChance}%, visibility: ${f.visibilityMiles} mi, wind: ${f.windSpeedMph} mph`).join("\n")}`).join("\n\n")}

Select from:
1. traffic
2. weather
3. dwell_time
4. route_inefficiency
5. normal_operations

Decision rules:
- Use traffic when travel time is longer than planned and speeds are low while driving.
- Use weather when poor weather likely explains slower movement or reduced visibility.
- Use dwell_time only when there is evidence of time spent stationary at/near a stop.
- Use route_inefficiency when there is off-route movement, backtracking, or extra travel distance.
- Use normal_operations when there is no meaningful abnormal delay.
- Do NOT use dwell_time based only on long leg travel time.

Return ONLY a JSON array:
[
  {
    "delayCause": "traffic|weather|dwell_time|route_inefficiency|normal_operations",
    "confidence": <0.0-1.0>,
    "summary": "<1-2 sentence explanation>",
    "factors": ["<supporting observation>", "<supporting observation>"],
    "estimatedDelayMinutes": <number>,
    "recommendations": ["<operational improvement>", "<operational improvement>"]
  }
]`;
}

async function buildLegAnalytics(params: {
  tripId: string;
  driverId: string;
  routeStops: RouteStopLike[];
  legs: RouteLeg[];
  gpsData: GpsPoint[];
}) {
  const { tripId, driverId, routeStops, legs, gpsData } = params;

  const etaInputs: EtaInputSummary[] = [];
  const anomaliesPerLeg: LegAnomalySummary[] = [];
  const legDistances: LegDistanceSummary[] = [];
  const legPoints: LegPointSummary[] = [];

  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index];
    const legWindow = getLegTimeWindow(leg, routeStops);
    if (!legWindow) continue;

    const legGpsPoints = getGpsPointsForLeg(gpsData, legWindow);

    const etaSummary = await buildEtaSummaryForLeg(
      tripId,
      leg,
      routeStops,
      legGpsPoints
    );
    if (etaSummary) etaInputs.push(etaSummary);

    const anomalySummary = await buildLegAnomalies(
      driverId,
      index,
      legGpsPoints
    );
    anomaliesPerLeg.push(anomalySummary);

    legDistances.push(buildLegDistanceSummary(index, legGpsPoints));
    legPoints.push(buildLegPointSummary(index, leg, legGpsPoints));
  }

  return {
    etaInputs,
    anomaliesPerLeg,
    legDistances,
    legPoints,
  };
}

export async function delayTripAnalytics(
  tripId: string,
  stops: any[]
): Promise<DelayAnalysisResult[]> {
  const trip = await fetchTripDoc(tripId);
  const tripData = trip.data();

  const sortedStops = sortStops(stops);
  const driverId = tripData?.driverId;
  const timeWindow = getTripTimeWindow(sortedStops);

  if (!driverId || !timeWindow) {
    console.error("Missing driverId, start_time, or end_time");
    return fallbackDelayResult();
  }

  const gpsData = await fetchGpsData(driverId, timeWindow);
  const routeContext = buildRouteContext(tripData, sortedStops, gpsData);

  const {
    etaInputs,
    anomaliesPerLeg,
    legDistances,
    legPoints,
  } = await buildLegAnalytics({
    tripId,
    driverId,
    routeStops: routeContext.routeStops,
    legs: routeContext.legs,
    gpsData,
  });

  console.log(anomaliesPerLeg);
  console.log(legDistances);

  const legCompletionTimes = buildLegCompletionTimes(routeContext.routeStops);
  console.log("Actual leg completion times:", legCompletionTimes);

  const weatherAtStops = await fetchHistoricalWeatherForTrip(
    sortedStops,
    timeWindow
  );

  const prompt = buildDelayAnalysisPrompt({
    currentRoute: routeContext.currentRoute,
    gpsData,
    timeWindow,
    routeStops: routeContext.routeStops,
    legs: routeContext.legs,
    legPoints,
    anomaliesPerLeg,
    etaInputs,
    legCompletionTimes,
    weatherAtStops,
  });

  console.log(prompt);
  return aiJson<DelayAnalysisResult[]>(prompt, 800);
}

// ───  AI-powered Routing Feedback Loop ─────────────────────────

interface LegPredictionFeedback {
  legIndex: number;
  fromStopId: string;
  toStopId: string;
  predictedMinutes: number;
  actualMinutes: number;
  absoluteErrorMinutes: number;
  errorPercent: number;
  accuracyPercent: number;
}

interface RouteAccuracyFeedback {
  tripId: string;
  driverId: string;
  createdAt: string;
  plannedRouteId?: string;
  overallPredictedMinutes: number;
  overallActualMinutes: number;
  overallAbsoluteErrorMinutes: number;
  routeAccuracyPercent: number;
  legFeedback: LegPredictionFeedback[];
  promptContextFeedback: {
    avgLegErrorMinutes: number;
    underPredictedLegs: number;
    overPredictedLegs: number;
    likelyBias: "optimistic" | "pessimistic" | "balanced";
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeLegAccuracyPercent(predictedMinutes: number, actualMinutes: number): number {
  const errorPercent =
    Math.abs(predictedMinutes - actualMinutes) / Math.max(actualMinutes, 1) * 100;
  return Math.max(0, round2(100 - errorPercent));
}

function buildLegFeedback(params: {
  legs: RouteLeg[];
  legCompletionTimes: LegTimingSummary[];
  etaInputs: EtaInputSummary[];
}): LegPredictionFeedback[] {
  const { legs, legCompletionTimes, etaInputs } = params;

  return legs.map((leg, index) => {
    const predictedMinutes =
      etaInputs[index]?.perStopETA?.[0]?.etaMinutes ??
      etaInputs[index]?.estimatedArrivalMinutes ??
      0;

    const actualMinutes =
      legCompletionTimes.find((t) => t.legIndex === index)?.minutes ?? 0;

    const absoluteErrorMinutes = round2(Math.abs(predictedMinutes - actualMinutes));
    const errorPercent = round2(
      (absoluteErrorMinutes / Math.max(actualMinutes, 1)) * 100
    );
    const accuracyPercent = computeLegAccuracyPercent(
      predictedMinutes,
      actualMinutes
    );

    return {
      legIndex: index,
      fromStopId: leg.fromStopId,
      toStopId: leg.toStopId,
      predictedMinutes: round2(predictedMinutes),
      actualMinutes: round2(actualMinutes),
      absoluteErrorMinutes,
      errorPercent,
      accuracyPercent,
    };
  });
}

function buildPromptContextFeedback(
  legFeedback: LegPredictionFeedback[]
): RouteAccuracyFeedback["promptContextFeedback"] {
  const avgLegErrorMinutes = round2(
    legFeedback.reduce((sum, leg) => sum + leg.absoluteErrorMinutes, 0) /
      Math.max(legFeedback.length, 1)
  );

  const underPredictedLegs = legFeedback.filter(
    (l) => l.predictedMinutes < l.actualMinutes
  ).length;

  const overPredictedLegs = legFeedback.filter(
    (l) => l.predictedMinutes > l.actualMinutes
  ).length;

  let likelyBias: "optimistic" | "pessimistic" | "balanced" = "balanced";
  if (underPredictedLegs > overPredictedLegs) likelyBias = "optimistic";
  if (overPredictedLegs > underPredictedLegs) likelyBias = "pessimistic";

  return {
    avgLegErrorMinutes,
    underPredictedLegs,
    overPredictedLegs,
    likelyBias,
  };
}

function buildRouteAccuracyFeedback(params: {
  tripId: string;
  driverId: string;
  currentRoute: any;
  legs: RouteLeg[];
  legCompletionTimes: LegTimingSummary[];
  etaInputs: EtaInputSummary[];
}): RouteAccuracyFeedback {
  const { tripId, driverId, currentRoute, legs, legCompletionTimes, etaInputs } =
    params;

  const legFeedback = buildLegFeedback({
    legs,
    legCompletionTimes,
    etaInputs,
  });

  const overallPredictedMinutes = round2(
    legFeedback.reduce((sum, leg) => sum + leg.predictedMinutes, 0)
  );

  const overallActualMinutes = round2(
    legFeedback.reduce((sum, leg) => sum + leg.actualMinutes, 0)
  );

  const overallAbsoluteErrorMinutes = round2(
    Math.abs(overallPredictedMinutes - overallActualMinutes)
  );

  const routeAccuracyPercent = computeLegAccuracyPercent(
    overallPredictedMinutes,
    overallActualMinutes
  );

  return {
    tripId,
    driverId,
    createdAt: new Date().toISOString(),
    plannedRouteId: currentRoute?.createdAt,
    overallPredictedMinutes,
    overallActualMinutes,
    overallAbsoluteErrorMinutes,
    routeAccuracyPercent,
    legFeedback,
    promptContextFeedback: buildPromptContextFeedback(legFeedback),
  };
}

export async function postTripAnalytic(
  tripId: string,
  stops: any[]
): Promise<RouteAccuracyFeedback | null> {
  const trip = await fetchTripDoc(tripId);
  const tripData = trip.data();

  if (!trip.exists || !tripData) {
    console.error(`Trip not found: ${tripId}`);
    return null;
  }

  const sortedStops = sortStops(stops);
  const driverId = tripData?.driverId;
  const timeWindow = getTripTimeWindow(sortedStops);

  if (!driverId || !timeWindow) {
    console.error("Missing driverId, start_time, or end_time");
    return null;
  }

  const gpsData = await fetchGpsData(driverId, timeWindow);
  const routeContext = buildRouteContext(tripData, sortedStops, gpsData);

  const { etaInputs } = await buildLegAnalytics({
    tripId,
    driverId,
    routeStops: routeContext.routeStops,
    legs: routeContext.legs,
    gpsData,
  });

  const legCompletionTimes = buildLegCompletionTimes(routeContext.routeStops);

  const feedback = buildRouteAccuracyFeedback({
    tripId,
    driverId,
    currentRoute: routeContext.currentRoute,
    legs: routeContext.legs,
    legCompletionTimes,
    etaInputs,
  });


  return feedback;
}


type PredictionBias = "optimistic" | "pessimistic" | "balanced";

interface TripDelayReason {
  reason: string;
}

interface TripDelayReasonSummary {
  tripId: string;
  delayReasons: TripDelayReason[];
}

interface DriverHistorySummary {
  completedTrips: number;
  avgRouteAccuracyPercent: number;
  avgLegErrorMinutes: number;
  predictionBias: PredictionBias;
  avgPredictedMinutes: number;
  avgActualMinutes: number;
  dominantDelayCauses: {
    traffic: number;
    weather: number;
    dwell_time: number;
    route_inefficiency: number;
    normal_operations: number;
  };
  tripDelayReasoning: TripDelayReasonSummary[];
}

function summarizeDriverHistory(trips: any[]): DriverHistorySummary {
  const feedbacks = trips
    .map((t) => t.feedbackAnalysis)
    .filter(Boolean);

  const delays = trips.flatMap((t) =>
    Array.isArray(t.delayAnalysis) ? t.delayAnalysis : []
  );

  const avg = (nums: number[]) =>
    nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

  const avgRouteAccuracyPercent = avg(
    feedbacks.map((f: any) => f.routeAccuracyPercent ?? 0)
  );

  const avgLegErrorMinutes = avg(
    feedbacks.map((f: any) => f.promptContextFeedback?.avgLegErrorMinutes ?? 0)
  );

  const avgPredictedMinutes = avg(
    feedbacks.map((f: any) => f.overallPredictedMinutes ?? 0)
  );

  const avgActualMinutes = avg(
    feedbacks.map((f: any) => f.overallActualMinutes ?? 0)
  );

  const biasCounts: Record<PredictionBias, number> = {
    optimistic: 0,
    pessimistic: 0,
    balanced: 0,
  };

  for (const f of feedbacks) {
    const bias =
      f.promptContextFeedback?.likelyBias as PredictionBias | undefined;

    if (bias && bias in biasCounts) {
      biasCounts[bias]++;
    }
  }

  const predictionBias =
    (Object.entries(biasCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as PredictionBias) ||
    "balanced";

  const dominantDelayCauses = {
    traffic: 0,
    weather: 0,
    dwell_time: 0,
    route_inefficiency: 0,
    normal_operations: 0,
  };

  for (const d of delays) {
    if (d?.delayCause && d.delayCause in dominantDelayCauses) {
      dominantDelayCauses[
        d.delayCause as keyof typeof dominantDelayCauses
      ]++;
    }
  }

  
  const tripDelayReasoning: TripDelayReasonSummary[] = trips.map((trip) => {
    const delayReasons =
      Array.isArray(trip.delayAnalysis)
        ? trip.delayAnalysis
            .map((d: any) => d?.summary || d?.reasoning)
            .filter(Boolean)
            .map((text: string) => ({
              reason: text,
            }))
        : [];

    return {
      tripId: trip.id ?? trip.tripId ?? "",
      delayReasons,
    };
  });

  return {
    completedTrips: trips.length,
    avgRouteAccuracyPercent: Number(avgRouteAccuracyPercent.toFixed(2)),
    avgLegErrorMinutes: Number(avgLegErrorMinutes.toFixed(2)),
    predictionBias,
    avgPredictedMinutes: Number(avgPredictedMinutes.toFixed(2)),
    avgActualMinutes: Number(avgActualMinutes.toFixed(2)),
    dominantDelayCauses,
    tripDelayReasoning,
  };
}

export async function retrieveRouteFeedback(
  todaysDate: Timestamp,
  driverId: string
): Promise<DriverHistorySummary> {
  const endDate = todaysDate.toDate();
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 30);
  startDate.setHours(0, 0, 0, 0);

  console.log(startDate, endDate);
  console.log(driverId);

  const tripsSnapshot = await db
  .collection("trips")
  .where("status", "==", "completed")
  .where("driverId", "==", driverId)
  .where("updatedAt", ">=", startDate.toISOString())
  .where("updatedAt", "<=", endDate.toISOString())
  .get();

  const trips = tripsSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  console.log(trips);

  const driver30days = summarizeDriverHistory(trips);

  return driver30days;
}