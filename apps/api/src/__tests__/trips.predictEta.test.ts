import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

// Mock the AI + weather services BEFORE createTestApp so the routes pick them up.
jest.mock("../services/ai", () => ({
  aiJson: jest.fn(),
}));

jest.mock("../services/weather", () => ({
  computeWeather: jest.fn(),
  isWeatherConfigured: true,
}));

const { aiJson } = require("../services/ai");
const { computeWeather } = require("../services/weather");

const app = createTestApp();
const { db } = require("../config/firebase");

const TRIP_ID = "trip-pe-1";
const DISPATCHER_UID = "dispatcher-1";
const DRIVER_UID = "driver-1";

const STOP_A = { stopId: "stop-a", address: "Origin St", lat: 40.0, lng: -74.0, sequence: 0, notes: "" };
const STOP_B = { stopId: "stop-b", address: "Dest Ave", lat: 40.1, lng: -74.1, sequence: 1, notes: "" };

function mockInProgressTrip(overrides: Partial<any> = {}) {
  return {
    driverId: DRIVER_UID,
    createdBy: DISPATCHER_UID,
    status: "in_progress",
    notes: null,
    route: { polyline: "abc", distanceMeters: 5000, durationSeconds: 600 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildHistoricalDoc(hoursAgo: number, baseline: number, actualSeconds: number) {
  const created = new Date(Date.now() - hoursAgo * 3600 * 1000);
  const updated = new Date(created.getTime() + actualSeconds * 1000);
  return {
    data: () => ({
      status: "completed",
      createdAt: created.toISOString(),
      updatedAt: updated.toISOString(),
      route: { durationSeconds: baseline },
    }),
  };
}

describe("POST /trips/:id/predict-eta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.collection = jest.fn();
    (aiJson as jest.Mock).mockReset();
    (computeWeather as jest.Mock).mockReset();

    (aiJson as jest.Mock).mockResolvedValue({
      adjustedSeconds: 720,
      confidence: "high",
      reasoning: "Rain plus historical sample trend add ~2 min.",
    });

    (computeWeather as jest.Mock).mockResolvedValue({
      stops: [
        {
          address: STOP_A.address,
          lat: STOP_A.lat,
          lng: STOP_A.lng,
          current: {
            timestamp: 1,
            main: "Rain",
            description: "light rain",
            icon: "10d",
            temperatureF: 58,
            precipitationChance: 0.4,
            visibilityMiles: 5,
            windSpeedMph: 10,
          },
          forecast: [],
        },
      ],
    });
  });

  function setupPredictMocks({
    tripExists,
    trip,
    stops,
    historicalDocs,
    updateMock,
  }: {
    tripExists: boolean;
    trip?: any;
    stops?: any[];
    historicalDocs?: any[];
    updateMock?: jest.Mock;
  }) {
    const resolvedUpdate = updateMock ?? jest.fn().mockResolvedValue(undefined);
    const docHandle = {
      get: jest.fn().mockResolvedValue(
        tripExists ? { exists: true, id: TRIP_ID, data: () => trip } : { exists: false },
      ),
      update: resolvedUpdate,
      collection: (subcol: string) => {
        if (subcol === "stops") {
          return {
            get: jest.fn().mockResolvedValue({
              empty: false,
              docs: (stops ?? []).map((s) => ({ data: () => s })),
            }),
          };
        }
        return {};
      },
    };

    db.collection.mockImplementation((col: string) => {
      if (col === "trips") {
        return {
          doc: (_id: string) => docHandle,
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: historicalDocs ?? [],
          }),
        };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
        set: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue({ id: "evt-1" }),
      };
    });

    return { updateMock: resolvedUpdate };
  }

  it("returns 403 for driver role", async () => {
    setupMockUser(DRIVER_UID, "driver", "Test Driver");

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/predict-eta`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(aiJson).not.toHaveBeenCalled();
  });

  it("returns 404 when trip does not exist", async () => {
    setupMockUser(DISPATCHER_UID, "dispatcher", "Dispatcher");
    setupPredictMocks({ tripExists: false });

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/predict-eta`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("TRIP_NOT_FOUND");
    expect(aiJson).not.toHaveBeenCalled();
  });

  it("happy path: patches trip with a predictedEta object and returns it", async () => {
    setupMockUser(DISPATCHER_UID, "dispatcher", "Dispatcher");

    const historicalDocs = [
      buildHistoricalDoc(0, 600, 720),
      buildHistoricalDoc(1, 600, 780),
      buildHistoricalDoc(2, 600, 660),
    ];

    const { updateMock } = setupPredictMocks({
      tripExists: true,
      trip: mockInProgressTrip(),
      stops: [STOP_A, STOP_B],
      historicalDocs,
    });

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/predict-eta`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.prediction).toEqual(
      expect.objectContaining({
        predictedArrivalAt: expect.any(String),
        baselineDurationSeconds: 600,
        adjustedDurationSeconds: 720,
        confidence: "high",
        reasoning: expect.stringContaining("Rain"),
        factors: expect.objectContaining({
          dayOfWeek: expect.any(Number),
          timeOfDayHour: expect.any(Number),
          historicalSampleSize: expect.any(Number),
          weatherSummary: expect.stringContaining("Rain"),
        }),
        generatedAt: expect.any(String),
      }),
    );

    expect(aiJson).toHaveBeenCalledTimes(1);
    expect(computeWeather).toHaveBeenCalledTimes(1);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        predictedEta: expect.objectContaining({
          baselineDurationSeconds: 600,
          adjustedDurationSeconds: 720,
          confidence: "high",
        }),
      }),
    );
  });

  it("tolerates missing weather + historical samples (falls back gracefully)", async () => {
    setupMockUser(DISPATCHER_UID, "dispatcher", "Dispatcher");
    (computeWeather as jest.Mock).mockRejectedValue(new Error("weather down"));

    setupPredictMocks({
      tripExists: true,
      trip: mockInProgressTrip(),
      stops: [STOP_A, STOP_B],
      historicalDocs: [],
    });

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/predict-eta`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.prediction.factors.historicalSampleSize).toBe(0);
    expect(res.body.prediction.factors.weatherSummary).toBeUndefined();
  });
});

describe("POST /trips/:id/status — predictive ETA accuracy tracking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.collection = jest.fn();
    (aiJson as jest.Mock).mockReset();
    (computeWeather as jest.Mock).mockReset();
  });

  it("stamps actualArrivalAt + errorMinutes when trip completes with a prior predictedEta", async () => {
    setupMockUser(DRIVER_UID, "driver", "Test Driver");

    const predictedArrivalAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min from now
    const priorPrediction = {
      predictedArrivalAt,
      baselineDurationSeconds: 600,
      adjustedDurationSeconds: 720,
      confidence: "medium" as const,
      reasoning: "Prior guess",
      factors: { dayOfWeek: 1, timeOfDayHour: 10, historicalSampleSize: 3 },
      generatedAt: new Date(Date.now() - 60000).toISOString(),
    };

    const trip = {
      driverId: DRIVER_UID,
      createdBy: DISPATCHER_UID,
      status: "in_progress",
      notes: null,
      route: { polyline: "abc", distanceMeters: 5000, durationSeconds: 600 },
      predictedEta: priorPrediction,
      orgId: "org-test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updateMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((col: string) => {
      if (col === "trips") {
        return {
          doc: (_id: string) => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => trip }),
            update: updateMock,
            collection: (subcol: string) => {
              if (subcol === "stops") {
                return {
                  get: jest.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => STOP_A }, { data: () => STOP_B }],
                  }),
                };
              }
              return {};
            },
          }),
        };
      }
      if (col === "events") {
        return { add: addEventMock };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "driver", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
      };
    });

    const res = await request(app)
      .post(`/trips/${TRIP_ID}/status`)
      .send({ status: "completed" })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        predictedEta: expect.objectContaining({
          predictedArrivalAt,
          adjustedDurationSeconds: 720,
          actualArrivalAt: expect.any(String),
          errorMinutes: expect.any(Number),
        }),
      }),
    );

    // error should be ~5 min since we predicted arrival 5min in the future and completed now
    const call = updateMock.mock.calls[0][0];
    expect(call.predictedEta.errorMinutes).toBeGreaterThanOrEqual(4);
    expect(call.predictedEta.errorMinutes).toBeLessThanOrEqual(6);
  });
});
