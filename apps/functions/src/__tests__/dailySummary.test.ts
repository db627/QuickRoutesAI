import { buildDailySummary } from "../dailySummary";
import type { Firestore } from "firebase-admin/firestore";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: jest.fn(),
}));


// Single shared create mock so the module-level singleton always uses the same fn
const mockCreate = jest.fn();
jest.mock("openai", () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
);

// ── Helpers ────────────────────────────────────────────────────────────────

const DATE = "2026-04-28";

function makeFirestore(trips: object[]): Firestore {
  return {
    collection: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: trips.map((t, i) => ({
          id: `trip-${i}`,
          data: () => t,
        })),
      }),
    }),
  } as unknown as Firestore;
}

function mockOpenAIResponse(content: string) {
  mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });
}

const AI_RESPONSE = JSON.stringify({
  highlights: ["Fleet performed well today"],
  concerns: ["One cancellation noted"],
  recommendations: ["Review cancelled trip root cause"],
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("buildDailySummary", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns zero-stats record when no trips exist", async () => {
    const db = makeFirestore([]);
    const result = await buildDailySummary(db, DATE);

    expect(result.date).toBe(DATE);
    expect(result.stats.tripsCompleted).toBe(0);
    expect(result.stats.tripsCancelled).toBe(0);
    expect(result.stats.activeDrivers).toBe(0);
    expect(result.highlights).toEqual([]);
    expect(result.concerns).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("computes correct stats from trip data", async () => {
    mockOpenAIResponse(AI_RESPONSE);

    const db = makeFirestore([
      {
        status: "completed",
        driverId: "d1",
        route: { durationSeconds: 600, distanceMeters: 5000 },
        predictedEta: { errorMinutes: 2 },
        stops: [{ address: "A" }, { address: "B" }],
      },
      {
        status: "completed",
        driverId: "d2",
        route: { durationSeconds: 1200, distanceMeters: 10000 },
        predictedEta: { errorMinutes: 4 },
        stops: [{ address: "C" }],
      },
      { status: "cancelled", driverId: "d1" },
    ]);

    const result = await buildDailySummary(db, DATE);

    expect(result.stats.tripsCompleted).toBe(2);
    expect(result.stats.tripsCancelled).toBe(1);
    expect(result.stats.activeDrivers).toBe(2);
    expect(result.stats.avgDurationSeconds).toBe(900); // (600 + 1200) / 2
    expect(result.stats.totalDistanceMeters).toBe(15000);
    expect(result.stats.avgEtaErrorMinutes).toBe(3); // (2 + 4) / 2
  });

  it("populates highlights, concerns, recommendations from AI", async () => {
    mockOpenAIResponse(AI_RESPONSE);

    const db = makeFirestore([
      { status: "completed", driverId: "d1", route: { durationSeconds: 600 } },
    ]);

    const result = await buildDailySummary(db, DATE);

    expect(result.highlights).toEqual(["Fleet performed well today"]);
    expect(result.concerns).toEqual(["One cancellation noted"]);
    expect(result.recommendations).toEqual(["Review cancelled trip root cause"]);
  });

  it("strips markdown code fences from AI response", async () => {
    mockOpenAIResponse("```json\n" + AI_RESPONSE + "\n```");

    const db = makeFirestore([
      { status: "completed", driverId: "d1", route: { durationSeconds: 300 } },
    ]);

    const result = await buildDailySummary(db, DATE);
    expect(result.highlights).toEqual(["Fleet performed well today"]);
  });

  it("clamps AI arrays to 5 items", async () => {
    mockOpenAIResponse(
      JSON.stringify({
        highlights: ["a", "b", "c", "d", "e", "f", "g"],
        concerns: [],
        recommendations: [],
      }),
    );

    const db = makeFirestore([
      { status: "completed", driverId: "d1", route: { durationSeconds: 300 } },
    ]);

    const result = await buildDailySummary(db, DATE);
    expect(result.highlights).toHaveLength(5);
  });

  it("returns empty arrays when OpenAI call fails", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI unavailable"));

    const db = makeFirestore([
      { status: "completed", driverId: "d1", route: { durationSeconds: 600 } },
    ]);

    const result = await buildDailySummary(db, DATE);

    expect(result.highlights).toEqual([]);
    expect(result.concerns).toEqual([]);
    expect(result.recommendations).toEqual([]);
    expect(result.stats.tripsCompleted).toBe(1);
  });

  it("returns empty record when Firestore query fails", async () => {
    const db = {
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error("Firestore error")),
      }),
    } as unknown as Firestore;

    const result = await buildDailySummary(db, DATE);

    expect(result.stats.tripsCompleted).toBe(0);
    expect(result.highlights).toEqual([]);
  });

  it("counts unique active drivers correctly", async () => {
    mockOpenAIResponse(AI_RESPONSE);

    const db = makeFirestore([
      { status: "completed", driverId: "d1" },
      { status: "completed", driverId: "d1" }, // same driver, should count once
      { status: "in_progress", driverId: "d2" },
    ]);

    const result = await buildDailySummary(db, DATE);
    expect(result.stats.activeDrivers).toBe(2);
  });

  it("sets generatedAt to a recent ISO timestamp", async () => {
    const db = makeFirestore([]);
    const before = Date.now();
    const result = await buildDailySummary(db, DATE);
    const after = Date.now();

    const ts = new Date(result.generatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
