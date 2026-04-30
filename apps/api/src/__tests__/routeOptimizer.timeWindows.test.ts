// Mock env and firebase before any service import
jest.mock("../config/env", () => ({ env: { NODE_ENV: "test", GOOGLE_MAPS_SERVER_KEY: "test-key", OPENAI_API_KEY: "test-key" } }));
jest.mock("../config/firebase", () => ({ auth: { verifyIdToken: jest.fn() }, db: {} }));
jest.mock("../services/weather", () => ({ computeWeather: jest.fn().mockResolvedValue(null) }));
jest.mock("@googlemaps/google-maps-services-js", () => ({ Client: jest.fn().mockImplementation(() => ({})), Status: { OK: "OK" } }));

import {
  computeStopArrivalTimes,
  detectTimeWindowViolations,
} from "../services/directions";
import type { RouteLeg, TripStop } from "@quickroutesai/shared";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeStop(overrides: Partial<TripStop> & { stopId: string }): TripStop {
  return {
    address: "123 Main St",
    contactName: "",
    lat: 0,
    lng: 0,
    sequence: 0,
    notes: "",
    ...overrides,
  };
}

function makeLeg(durationSeconds: number): RouteLeg {
  return { fromIndex: 0, toIndex: 1, distanceMeters: 1000, durationSeconds };
}

// ── computeStopArrivalTimes ────────────────────────────────────────────────

describe("computeStopArrivalTimes", () => {
  const departureMs = new Date("2025-06-01T09:00:00.000Z").getTime();

  it("returns empty object when there are no legs", () => {
    const result = computeStopArrivalTimes([], [], departureMs, false);
    expect(result).toEqual({});
  });

  it("computes single leg arrival without origin override", () => {
    const stops = [
      makeStop({ stopId: "s0", sequence: 0 }),
      makeStop({ stopId: "s1", sequence: 1 }),
    ];
    const legs = [makeLeg(3600)]; // 1 hour
    const result = computeStopArrivalTimes(legs, stops, departureMs, false);
    // leg[0] ends at stops[1]
    expect(result["s1"]).toBe(new Date(departureMs + 3600 * 1000).toISOString());
    expect(result["s0"]).toBeUndefined();
  });

  it("accumulates duration across multiple legs", () => {
    const stops = [
      makeStop({ stopId: "s0", sequence: 0 }),
      makeStop({ stopId: "s1", sequence: 1 }),
      makeStop({ stopId: "s2", sequence: 2 }),
    ];
    const legs = [makeLeg(1800), makeLeg(900)];
    const result = computeStopArrivalTimes(legs, stops, departureMs, false);
    expect(result["s1"]).toBe(new Date(departureMs + 1800 * 1000).toISOString());
    expect(result["s2"]).toBe(new Date(departureMs + 2700 * 1000).toISOString());
  });

  it("uses orderedStops[i] (not i+1) when originOverride is true", () => {
    const stops = [
      makeStop({ stopId: "s0", sequence: 0 }),
      makeStop({ stopId: "s1", sequence: 1 }),
    ];
    const legs = [makeLeg(600), makeLeg(600)];
    const result = computeStopArrivalTimes(legs, stops, departureMs, true);
    // leg[0] ends at stops[0], leg[1] ends at stops[1]
    expect(result["s0"]).toBe(new Date(departureMs + 600 * 1000).toISOString());
    expect(result["s1"]).toBe(new Date(departureMs + 1200 * 1000).toISOString());
  });
});

// ── detectTimeWindowViolations ─────────────────────────────────────────────

describe("detectTimeWindowViolations", () => {
  it("returns empty array when no stops have time windows", () => {
    const stops = [makeStop({ stopId: "s0" })];
    expect(detectTimeWindowViolations(stops, { s0: "2025-06-01T10:00:00.000Z" })).toEqual([]);
  });

  it("returns empty array when arrival is within window (UTC hours)", () => {
    // 10:00 UTC arrival, window 09:00-11:00 UTC — should be on-time
    const stops = [
      makeStop({ stopId: "s0", timeWindow: { start: "09:00", end: "11:00" } }),
    ];
    const arrivalTimes = { s0: "2025-06-01T10:00:00.000Z" };
    expect(detectTimeWindowViolations(stops, arrivalTimes)).toEqual([]);
  });

  it("flags 'late' when arrival exceeds window end", () => {
    // Construct an arrival time where hours/minutes clearly exceed window end
    // Use a fixed date and window that will be late regardless of TZ offset within ±12h
    const stops = [
      makeStop({
        stopId: "s0",
        address: "Late Stop",
        timeWindow: { start: "06:00", end: "07:00" },
      }),
    ];
    // arrival at 23:00 UTC — late in virtually any timezone
    const arrivalTimes = { s0: "2025-06-01T23:00:00.000Z" };
    const violations = detectTimeWindowViolations(stops, arrivalTimes);
    expect(violations).toHaveLength(1);
    expect(violations[0].stopId).toBe("s0");
    expect(violations[0].issue).toBe("late");
    expect(violations[0].address).toBe("Late Stop");
    expect(violations[0].estimatedArrivalAt).toBe("2025-06-01T23:00:00.000Z");
  });

  it("returns no violation when arrival is within window (UTC hours)", () => {
    // 13:00 UTC arrival, window 09:00-17:00 — on-time
    const stops = [
      makeStop({ stopId: "s0", timeWindow: { start: "09:00", end: "17:00" } }),
    ];
    const arrivalTimes = { s0: "2025-06-01T13:00:00.000Z" };
    expect(detectTimeWindowViolations(stops, arrivalTimes)).toEqual([]);
  });

  it("skips stops that have no arrival time recorded", () => {
    const stops = [
      makeStop({ stopId: "s0", timeWindow: { start: "09:00", end: "11:00" } }),
    ];
    expect(detectTimeWindowViolations(stops, {})).toEqual([]);
  });

  it("handles multiple stops with mixed results", () => {
    const stops = [
      makeStop({ stopId: "s0", timeWindow: { start: "06:00", end: "07:00" } }), // will be late
      makeStop({ stopId: "s1", timeWindow: { start: "09:00", end: "17:00" } }), // on-time
      makeStop({ stopId: "s2" }), // no window — skipped
    ];
    const arrivalTimes = {
      s0: "2025-06-01T23:00:00.000Z", // 23:00 — late for 06:00-07:00
      s1: "2025-06-01T13:00:00.000Z", // 13:00 — on-time for 09:00-17:00
      s2: "2025-06-01T15:00:00.000Z",
    };
    const violations = detectTimeWindowViolations(stops, arrivalTimes);
    expect(violations.some((v) => v.stopId === "s0" && v.issue === "late")).toBe(true);
    expect(violations.some((v) => v.stopId === "s1")).toBe(false);
    expect(violations.some((v) => v.stopId === "s2")).toBe(false);
  });
});

// ── routeOptimizer violations passthrough ─────────────────────────────────

jest.mock("openai", () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    _mockCreate: mockCreate,
  };
});

describe("optimizeStopOrder violations field", () => {
  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const openaiMod = require("openai");
    mockCreate = openaiMod._mockCreate;
  });

  it("returns violations from AI response", async () => {
    const { optimizeStopOrder } = require("../services/routeOptimizer");

    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            order: [1, 0],
            reasoning: "Stop 1 first to avoid backtracking.",
            violations: [{ stopIndex: 0, window: "09:00-10:00", issue: "late" }],
          }),
        },
      }],
    });

    const stops = [
      makeStop({ stopId: "origin", sequence: 0 }),
      makeStop({ stopId: "s1", sequence: 1, timeWindow: { start: "09:00", end: "10:00" } }),
      makeStop({ stopId: "s2", sequence: 2 }),
    ];

    const result = await optimizeStopOrder(stops);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].issue).toBe("late");
    expect(result.violations[0].window).toBe("09:00-10:00");
  });

  it("returns empty violations array when AI omits the field", async () => {
    const { optimizeStopOrder } = require("../services/routeOptimizer");

    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            order: [0, 1],
            reasoning: "Simple linear route.",
          }),
        },
      }],
    });

    const stops = [
      makeStop({ stopId: "origin", sequence: 0 }),
      makeStop({ stopId: "s1", sequence: 1 }),
      makeStop({ stopId: "s2", sequence: 2 }),
    ];

    const result = await optimizeStopOrder(stops);
    expect(result.violations).toEqual([]);
  });

  it("returns early when stops <= 2", async () => {
    const { optimizeStopOrder } = require("../services/routeOptimizer");
    const stops = [makeStop({ stopId: "s0", sequence: 0 }), makeStop({ stopId: "s1", sequence: 1 })];
    const result = await optimizeStopOrder(stops);
    expect(result.violations).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
