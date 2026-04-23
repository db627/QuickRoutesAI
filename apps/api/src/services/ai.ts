import OpenAI from "openai";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "test-placeholder" });
  }
  return _client;
}

/**
 * Shared OpenAI helper — sends a prompt and parses JSON from the response.
 */
export async function aiJson<T>(prompt: string, maxTokens = 1000): Promise<T> {
  const response = await client().chat.completions.create({
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
  const response = await client().chat.completions.create({
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

// ─── Feature: Multi-Driver Stop Distribution ─────────────────────────

interface MultiAssignDriver {
  uid: string;
  name: string;
  lat: number;
  lng: number;
}

interface MultiAssignStop {
  address: string;
  lat: number;
  lng: number;
  timeWindow?: { start: string; end: string };
  notes?: string;
}

interface MultiAssignResult {
  assignments: { driverIndex: number; stopIndices: number[] }[];
  reasoning: string;
}

export async function distributeStopsAcrossDrivers(
  drivers: MultiAssignDriver[],
  stops: MultiAssignStop[],
): Promise<MultiAssignResult> {
  if (drivers.length === 1) {
    return {
      assignments: [{ driverIndex: 0, stopIndices: stops.map((_, i) => i) }],
      reasoning: "All stops assigned to the only available driver.",
    };
  }

  const driverList = drivers
    .map((d, i) => `  ${i}: "${d.name}" (uid: ${d.uid}, location: ${d.lat.toFixed(5)},${d.lng.toFixed(5)})`)
    .join("\n");

  const stopList = stops
    .map((s, i) => {
      let line = `  ${i}: "${s.address}" (lat: ${s.lat.toFixed(5)}, lng: ${s.lng.toFixed(5)})`;
      if (s.timeWindow) line += ` [DELIVER BETWEEN ${s.timeWindow.start}–${s.timeWindow.end}]`;
      return line;
    })
    .join("\n");

  const prompt = `You are a multi-driver delivery dispatch optimizer. Distribute the following stops across available drivers for maximum efficiency.

Optimization goals (in order of priority):
1. Geographic clustering — assign nearby stops to the same driver to minimize driving
2. Load balancing — distribute stops roughly evenly unless geography strongly dictates otherwise
3. Time window compliance — stops with overlapping time windows should go to the same driver when possible
4. Driver proximity — prefer assigning stops near each driver's current location

Available drivers:
${driverList}

Stops to distribute (${stops.length} total):
${stopList}

Return ONLY a JSON object:
{
  "assignments": [
    { "driverIndex": <0-based driver index>, "stopIndices": [<0-based stop indices assigned to this driver>] }
  ],
  "reasoning": "<2-3 sentences explaining the distribution strategy>"
}
Rules: every stop index must appear exactly once across all assignments. Only include drivers that receive at least one stop.`;

  const result = await aiJson<MultiAssignResult>(prompt, 800);

  // Validate every stop is assigned exactly once
  const assigned = result.assignments.flatMap((a) => a.stopIndices).sort((a, b) => a - b);
  if (assigned.length !== stops.length) {
    throw new Error(`AI assigned ${assigned.length} stops but expected ${stops.length}`);
  }
  const uniqueAssigned = new Set(assigned);
  if (uniqueAssigned.size !== stops.length || assigned.some((i) => i < 0 || i >= stops.length)) {
    throw new Error(`AI produced invalid stop indices: ${JSON.stringify(assigned)}`);
  }

  return result;
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
