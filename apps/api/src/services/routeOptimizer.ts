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
  
  const prompt = `You are a route optimization engine. Given a starting point and a list of delivery stops, return the optimal order to visit ALL stops.

${hasTimeWindows ? "IMPORTANT: Some stops have delivery time windows. You MUST respect these constraints — visit those stops within their time windows. Balance time constraints with minimizing total driving distance.\nIf weather information is provided, please consider it in your reasoning when deciding the order.\n" : ""}Starting point (fixed, always first):
  "${origin.address}" (lat: ${origin.lat}, lng: ${origin.lng})

Stops to reorder:
${stopList}

Weather information for stops (if available):
${weatherDataStr}

Return ONLY a JSON object with two keys:
- "order": array of the stop indices in optimal visiting order (e.g. [2, 0, 4, 1, 3])
- "reasoning": one or two sentences explaining why this order minimizes travel time/distance

Example: {"order": [2, 0, 4, 1, 3], "reasoning": "Stops 2 and 0 cluster in the north end, reducing backtracking before heading south."}
No other text — just the JSON object.`;

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
