import OpenAI from "openai";
import { db } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import { decodePolyline } from "./directions";
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


export async function postTripAnalytics(tripId: string, stops: any[]): Promise<void> {
  const trip = await db.collection("trips").doc(tripId).get();
  
  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);

  const driverId = trip.data()?.driverId;
  const rawStart = sortedStops[0]?.start_time;
  const rawEnd = sortedStops[sortedStops.length - 1]?.end_time;

  if (!driverId || !rawStart || !rawEnd) {
    console.error("Missing driverId, start_time, or end_time");
    return;
  }

  const start_time =
    rawStart instanceof Timestamp ? rawStart : Timestamp.fromDate(new Date(rawStart));

  const end_time =
    rawEnd instanceof Timestamp ? rawEnd : Timestamp.fromDate(new Date(rawEnd));

  const geopointData = await db
    .collection("events")
    .where("type", "==", "location_ping")
    .where("driverId", "==", driverId)
    .where("createdAt", ">=", start_time)
    .where("createdAt", "<=", end_time)
    .orderBy("createdAt")
    .get();

  const gpsData = geopointData.docs.map(doc => {
    const data = doc.data();
    return {
      lat: data.payload.lat,
      lng: data.payload.lng,
      timestamp: data.createdAt.toDate().getTime(),
      speedMps: data.payload.speedMps,
    };
  });

  const route = trip.data()?.route || {};
  const currRoute = route[route.length - 1] || {};
  const legs = currRoute.legs || [];
  let index = 0;

  const etaInputs= [];
  const anomaliesPerLeg = [];
  const legDistances = [];
  const legPoints = [];
  for(const leg of legs) {
    let legStart, legEnd;
    if (leg.fromStopId == "__driver_origin__"){
      legStart = sortedStops[0]?.start_time;
      legEnd = sortedStops[0]?.end_time;

    }else {
      legStart = leg.fromStopId ? sortedStops.find(s => s.stopId === leg.toStopId)?.start_time : null;
      legEnd = leg.toStopId ? sortedStops.find(s => s.stopId === leg.toStopId)?.end_time : null;
    }
    const leg_start =
    rawStart instanceof Timestamp ? legStart : Timestamp.fromDate(new Date(legStart));
    const leg_end =
    rawEnd instanceof Timestamp ? legEnd : Timestamp.fromDate(new Date(legEnd));

    const decodedLegPolyline = decodePolyline(leg.polyline || "");
    const legGpsPoints = gpsData.filter(point => {
      const pointTime = point.timestamp;
      const legStartTime = leg_start instanceof Timestamp ? leg_start.toDate().getTime() : new Date(leg_start).getTime();
      const legEndTime = leg_end instanceof Timestamp ? leg_end.toDate().getTime() : new Date(leg_end).getTime();
      return pointTime >= legStartTime && pointTime <= legEndTime;
    });
    if (index < stops.length - 1) {
      let avglegSpeedMps = legGpsPoints.reduce((sum, p) => sum + p.speedMps, 0) / (legGpsPoints.length || 1);
      if (avglegSpeedMps < 0.1) {
        avglegSpeedMps = 20; // prevent zero or near-zero speed which can break ETA prediction
      }
      if (leg.fromStopId === "__driver_origin__") {
        index = -1;
      }
      const etaLegInput = {
        tripId,
        currentLat: legGpsPoints[0]?.lat || gpsData[0]?.lat || 0,
        currentLng: legGpsPoints[0]?.lng || gpsData[0]?.lng || 0,
        remainingStops: [{address: sortedStops[index+1]?.address || "", lat: sortedStops[index+1]?.lat || 0, lng: sortedStops[index+1]?.lng || 0, sequence: sortedStops[index+1]?.sequence || 0}],
        currentSpeedMps: avglegSpeedMps,
        routeDistanceMeters: leg.distanceMeters,
        routeDurationSeconds: leg.durationSeconds,
        timeOfDay: legStart instanceof Timestamp ? legStart.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "",
        dayOfWeek: legStart instanceof Timestamp ? legStart.toDate().toLocaleDateString([], { weekday: 'long' }) : "",
      }

      const etaPrediction = await predictETA(etaLegInput);
      etaInputs.push({startLat: etaLegInput.currentLat, startLng: etaLegInput.currentLng, avgSpeed: etaLegInput.currentSpeedMps, ...etaPrediction});

      const legDriverActivity: DriverActivity = {
        driverId,
        driverName: "",
        events: legGpsPoints.map(p => ({
          type: "location_ping",
          lat: p.lat,
          lng: p.lng,
          speedMps: p.speedMps,
          timestamp: new Date(p.timestamp).toISOString()
        })),
      };

      const legAnomalies = await detectAnomalies([legDriverActivity]);
      anomaliesPerLeg.push({ legIndex: index + 1, anomalies: legAnomalies });

    }

    const distance = totalDistanceMeters(legGpsPoints);
    legDistances.push({legIndex: index + 1, distance});

    legPoints.push({legIndex: index + 1, points: legGpsPoints, decodedRoute: decodedLegPolyline});
    console.log(distance);
    console.log({...decodedLegPolyline});
    index++;
  }


  console.log(anomaliesPerLeg);
  console.log(legDistances);
  
  const stopsTimeToComplete = sortedStops.map(s => ({
    stopIndex: s.sequence,
    address: s.address,
    etaMinutes: s.end_time ? (s.end_time.seconds - s.start_time.seconds) / 60 : 0
  }));
  console.log("Time to complete each stop:", stopsTimeToComplete);

  const prompt = `Trip Analytics for Trip ID: ${tripId}

1. ETA Predictions per Leg:
${etaInputs.map((input, i) => `Leg ${i} starting at (${input.startLat.toFixed(5)}, ${input.startLng.toFixed(5)}) to ${input.perStopETA[0].address}, with avg speed ${(input.avgSpeed * 2.237).toFixed(0)} mph -- Estimated arrival in ${input.perStopETA[0].etaMinutes} min (confidence: ${(input.confidence * 100).toFixed(1)}%) -- Factors: ${input.factors.join(", ")}`).join("\n")}

2. Anomalies Detected:
${anomaliesPerLeg.map(a => `Leg ${a.legIndex}: ${a.anomalies.length > 0 ? a.anomalies.map(anomaly => `- ${anomaly.type} (${anomaly.severity}): ${anomaly.description}`).join("\n") : "No anomalies detected"}`).join("\n")}

3. Actual time to complete each stop:
${stopsTimeToComplete.map(s => `Stop ${s.stopIndex} at "${s.address}": ${s.etaMinutes.toFixed(1)} min`).join("\n")}

4. Route distance vs actual distance driven per leg:
${legDistances.map(d => `Leg ${d.legIndex}: ${d.distance.toFixed(1)} meters driven`).join("\n")}

5. Route adherence:
${legPoints.map(lp => `Leg ${lp.legIndex}: ${lp.points.length} GPS points recorded, route deviation of ${totalDistanceMeters(lp.points) - totalDistanceMeters(lp.decodedRoute)} meters`).join("\n")}
Analyze the above data and provide insights on:
- How accurate were the ETA predictions? Were there any legs with low confidence that had significant anomalies?
- Were there any patterns in the anomalies detected (e.g. consistent off-route behavior, speeding)?
- How did the actual time to complete stops compare to typical expectations (e.g. 3-5 min per stop)?

Provide a concise analysis of the trip performance based on the ETA predictions, anomalies, and stop completion times.


`;

console.log(prompt);

}