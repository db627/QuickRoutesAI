import type { Trip, TripRoute, TripStop } from "@quickroutesai/shared";
import {
  computeTripETA,
  formatDurationShort,
  formatArrivalTime,
  haversineMeters,
} from "../utils/eta";

function makeStop(overrides: Partial<TripStop> & Pick<TripStop, "stopId" | "sequence">): TripStop {
  return {
    address: `Stop ${overrides.stopId}`,
    contactName: "",
    lat: 0,
    lng: 0,
    notes: "",
    ...overrides,
  };
}

function makeRoute(overrides: Partial<TripRoute> = {}): TripRoute {
  return {
    polyline: "",
    distanceMeters: 10000,
    durationSeconds: 1800,
    legs: [],
    createdAt: "2026-04-19T10:00:00Z",
    ...overrides,
  };
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip1",
    driverId: "d1",
    createdBy: "u1",
    status: "in_progress",
    stops: [],
    route: null,
    notes: null,
    createdAt: "2026-04-19T10:00:00Z",
    updatedAt: "2026-04-19T10:00:00Z",
    ...overrides,
  };
}

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 40.7, lng: -74 }, { lat: 40.7, lng: -74 })).toBeCloseTo(0, 5);
  });

  it("computes approximate distance between two nearby points", () => {
    const d = haversineMeters({ lat: 40.7128, lng: -74.006 }, { lat: 40.72, lng: -74.01 });
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(1200);
  });
});

describe("computeTripETA", () => {
  const stops = [
    makeStop({ stopId: "s1", sequence: 0, lat: 40.0, lng: -74.0 }),
    makeStop({ stopId: "s2", sequence: 1, lat: 40.1, lng: -74.1 }),
    makeStop({ stopId: "s3", sequence: 2, lat: 40.2, lng: -74.2 }),
  ];
  const legs = [
    { fromStopId: "s1", toStopId: "s2", fromIndex: 0, toIndex: 1, distanceMeters: 10000, durationSeconds: 600 },
    { fromStopId: "s2", toStopId: "s3", fromIndex: 1, toIndex: 2, distanceMeters: 15000, durationSeconds: 900 },
  ];

  it("returns nulls when all stops are completed", () => {
    const trip = makeTrip({
      stops: stops.map((s) => ({ ...s, status: "completed" as const })),
      route: makeRoute({ legs }),
    });
    expect(computeTripETA(trip)).toEqual({
      nextStop: null,
      secondsToNextStop: null,
      totalRemainingSeconds: null,
    });
  });

  it("picks the first uncompleted stop as next stop", () => {
    const trip = makeTrip({
      stops: [
        { ...stops[0], status: "completed" as const },
        stops[1],
        stops[2],
      ],
      route: makeRoute({ legs }),
    });
    const result = computeTripETA(trip);
    expect(result.nextStop?.stopId).toBe("s2");
  });

  it("uses full leg duration when no GPS position is provided", () => {
    const trip = makeTrip({
      stops: [
        { ...stops[0], status: "completed" as const },
        stops[1],
        stops[2],
      ],
      route: makeRoute({ legs }),
    });
    const result = computeTripETA(trip);
    expect(result.secondsToNextStop).toBe(600);
    expect(result.totalRemainingSeconds).toBe(600 + 900);
  });

  it("scales next-stop ETA by remaining distance when GPS position is provided", () => {
    const trip = makeTrip({
      stops: [
        { ...stops[0], status: "completed" as const },
        stops[1],
        stops[2],
      ],
      route: makeRoute({ legs }),
    });
    // Position very close to next stop (s2)
    const near = { lat: 40.1, lng: -74.1 };
    const result = computeTripETA(trip, near);
    expect(result.secondsToNextStop).toBeLessThan(100);
    expect(result.totalRemainingSeconds).toBeGreaterThanOrEqual(900);
  });

  it("sums durations for legs beyond the next stop", () => {
    const trip = makeTrip({
      stops: [
        { ...stops[0], status: "completed" as const },
        stops[1],
        stops[2],
      ],
      route: makeRoute({ legs }),
    });
    const result = computeTripETA(trip);
    // next stop is s2 (600s leg), future leg s2→s3 is 900s
    expect(result.totalRemainingSeconds).toBe(600 + 900);
  });

  it("returns null timings when trip has no route", () => {
    const trip = makeTrip({ stops, route: null });
    const result = computeTripETA(trip);
    expect(result.nextStop?.stopId).toBe("s1");
    expect(result.secondsToNextStop).toBeNull();
    expect(result.totalRemainingSeconds).toBeNull();
  });

  it("falls back to proportional estimate when legs are missing", () => {
    const trip = makeTrip({
      stops,
      route: makeRoute({ legs: [], durationSeconds: 1800 }),
    });
    const result = computeTripETA(trip);
    expect(result.secondsToNextStop).toBe(Math.round(1800 / 3));
    expect(result.totalRemainingSeconds).toBe(Math.round(1800 / 3));
  });

  it("normalizes an array-shaped route to its last element", () => {
    const older = makeRoute({ legs, durationSeconds: 9999 });
    const newer = makeRoute({ legs, durationSeconds: 1500 });
    const trip = makeTrip({
      stops: [
        { ...stops[0], status: "completed" as const },
        stops[1],
        stops[2],
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route: [older, newer] as any,
    });
    const result = computeTripETA(trip);
    expect(result.secondsToNextStop).toBe(600);
  });
});

describe("formatDurationShort", () => {
  it("formats minutes under one hour", () => {
    expect(formatDurationShort(300)).toBe("5m");
  });

  it("formats whole hours", () => {
    expect(formatDurationShort(3600)).toBe("1h");
  });

  it("formats hours and minutes", () => {
    expect(formatDurationShort(3900)).toBe("1h 5m");
  });

  it("clamps negatives to zero", () => {
    expect(formatDurationShort(-10)).toBe("0m");
  });
});

describe("formatArrivalTime", () => {
  it("adds seconds to now and formats as a locale time string", () => {
    const now = new Date("2026-04-19T10:00:00Z");
    const result = formatArrivalTime(900, now);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
