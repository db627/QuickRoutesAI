import OpenAI from "openai";
import type { TripStop } from "@quickroutesai/shared";
import { retrieveRouteFeedback } from "./ai";
import { Timestamp } from "firebase-admin/firestore";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Uses OpenAI to determine the optimal ordering of stops to minimize
 * total driving distance/time while respecting delivery time windows.
 * The first stop (origin) stays fixed; all other stops are reordered.
 */
export async function optimizeStopOrder(stops: TripStop[], weatherInfo?: any, driverId?: string): Promise<{ stops: TripStop[]; reasoning: string }> {
  if (stops.length <= 2) return { stops, reasoning: "" };

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const origin = sorted[0];
  const rest = sorted.slice(1);
  
  const retrievedRouteFeedback = await retrieveRouteFeedback(Timestamp.now(), driverId || ""); 
  console.log("Test \n", retrievedRouteFeedback);
  const stopList = rest
    .map((s, i) => {
      let line = `  ${i}: "${s.address}" (lat: ${s.lat}, lng: ${s.lng})`;
      if (s.timeWindow) {
        line += ` [DELIVER BETWEEN ${s.timeWindow.start} - ${s.timeWindow.end}]`;
      }
      return line;
    })
    .join("\n");

  const hasTimeWindows = rest.some((s) => s.timeWindow);
  
  let weatherDataStr = "No weather data available";
  if (weatherInfo !== undefined) {
    weatherDataStr = weatherInfo.stops.map((w: any) => `Stop ${w.address} -- Current: ${w.current.main}, Temperature: ${w.current.temperatureF}°F, Precipitation Chance: ${w.current.precipitationChance}%, Visibility: ${w.current.visibilityMiles} miles, Wind Speed: ${w.current.windSpeedMph} mph, -- Forecast: ${w.forecast.map((f: any) => `${new Date(f.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} Time: ${f.main}, Temperature: ${f.temperatureF}°F, Wind Speed: ${f.windSpeedMph} mph, Precipitation Chance: ${f.precipitationChance}%`).join("; ")}`).join("\n\n");
  }
  let driverFeedbackStr = "No driver historical feedback available for the last 30 days.";
  if (retrievedRouteFeedback.completedTrips > 0) {
  driverFeedbackStr = JSON.stringify(retrievedRouteFeedback, null, 2);
}
  
  const prompt = `You are an intelligent delivery route optimization engine.

Your job is to determine the best visiting order for ALL stops.

Optimization priorities (highest to lowest):
1. Respect required delivery time windows.
2. Minimize total driving distance and backtracking.
3. Reduce expected delay risk from weather or traffic.
4. Use historical driver performance only to improve ETA realism and robustness.
5. Keep route practical and geographically efficient.

Starting point (fixed, always first):
"${origin.address}" (lat: ${origin.lat}, lng: ${origin.lng})

Stops to reorder:
${stopList}

Weather conditions by stop:
${weatherDataStr}

Driver historical performance context (last 30 days):
${driverFeedbackStr}

How to use driver history:
- If historical ETA accuracy was low, choose simpler/more robust routes.
- If driver often has long dwell times, prefer clustered stops.
- If traffic is the most common historical delay, favor routes with less cross-city movement.
- If weather delays are common and current weather is poor, favor safer/tighter sequencing.
- Do NOT ignore geography because of driver history.

How to use weather:
- Heavy rain / low visibility / wind may slow travel.
- If multiple stops are similar distance, prefer the lower-risk weather order.
- Weather should adjust route timing realism, not replace geography.

Return ONLY valid JSON:

{
  "order": [2,0,4,1,3],
  "reasoning": "Stops 2 and 0 cluster geographically, reducing backtracking. Rain and lower visibility in the western segment make it better to service eastern stops first. Driver history showed longer dwell times, so tighter clustering improves schedule reliability."
}

No markdown. No extra text.`;
  
  console.log("Route Optimization Prompt:\n", prompt);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 200,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  let parsed: { order: number[]; reasoning: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse OpenAI response: ${content}`);
  }

  const { order: indices, reasoning } = parsed;

  if (!Array.isArray(indices) || indices.length !== rest.length) {
    throw new Error(`Invalid indices from OpenAI: expected ${rest.length} items, got ${JSON.stringify(indices)}`);
  }

  // Validate all indices are present exactly once
  const indexSet = new Set(indices);
  if (indexSet.size !== rest.length || indices.some((i) => i < 0 || i >= rest.length)) {
    throw new Error(`Invalid index values from OpenAI: ${JSON.stringify(indices)}`);
  }

  // Reorder stops and assign new sequence numbers
  const optimized: TripStop[] = [{ ...origin, sequence: 0 }];
  indices.forEach((idx, seq) => {
    optimized.push({ ...rest[idx], sequence: seq + 1 });
  });

  return { stops: optimized, reasoning: reasoning ?? "" };
}
