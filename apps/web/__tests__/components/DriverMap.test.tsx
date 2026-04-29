/**
 * QRA-84 — DriverMap active trip overlays
 *
 * Covers the dashboard live-map portion of the ticket:
 *   1. Active trip routes rendered as polylines
 *   2. Completed stops shown in green, remaining in red
 *   3. Next stop highlighted with pulse animation
 *   4. ETA to next stop shown in InfoWindow on click
 */

import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import DriverMap from "@/components/DriverMap";
import { onSnapshot } from "firebase/firestore";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

// ── Firebase ───────────────────────────────────────────────────────────────
jest.mock("@/lib/firebase", () => ({ firestore: {} }));
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

// ── Auth ───────────────────────────────────────────────────────────────────
jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(() => ({ orgId: "org-1" })),
}));

// ── Utils ──────────────────────────────────────────────────────────────────
jest.mock("@/lib/utils", () => ({
  decodePolyline: jest.fn(() => [
    { lat: 40.71, lng: -74.01 },
    { lat: 40.72, lng: -74.02 },
  ]),
  formatDuration: jest.fn((s: number) => `${Math.round(s / 60)} min`),
}));

// ── Google Maps — children-rendering mock ─────────────────────────────────
jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="driver-map">{children}</div>
  ),
  AdvancedMarker: ({
    children,
    title,
    onClick,
  }: {
    children?: React.ReactNode;
    title?: string;
    onClick?: () => void;
  }) => (
    <div data-testid="map-marker" title={title} onClick={onClick}>
      {children}
    </div>
  ),
  Pin: ({
    background,
    glyph,
    borderColor,
  }: {
    background?: string;
    glyph?: string;
    borderColor?: string;
  }) => (
    <span
      data-testid="pin"
      data-bg={background}
      data-glyph={glyph}
      data-border={borderColor}
    />
  ),
  InfoWindow: ({
    children,
    onClose,
  }: {
    children?: React.ReactNode;
    onClose?: () => void;
  }) => (
    <div data-testid="info-window">
      <button onClick={onClose} aria-label="close">×</button>
      {children}
    </div>
  ),
  useMap: jest.fn(),
  useMapsLibrary: jest.fn(),
}));

// ── Typed mock handles ─────────────────────────────────────────────────────
const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockUseMap = useMap as jest.MockedFunction<typeof useMap>;
const mockUseMapsLibrary = useMapsLibrary as jest.MockedFunction<typeof useMapsLibrary>;

// Shared Polyline constructor — all RoutePolyline instances share the same
// mock so we can count total constructor calls across multiple trips.
const mockPolylineSetMap = jest.fn();
const mockPolylineConstructor = jest.fn(() => ({ setMap: mockPolylineSetMap }));

// ── Helpers ────────────────────────────────────────────────────────────────
let stopSeq = 0;
function makeStop(overrides: Record<string, unknown> = {}) {
  return {
    stopId: `stop-${++stopSeq}`,
    address: "100 Test Ave",
    lat: 40.71,
    lng: -74.01,
    sequence: 0,
    notes: "",
    contactName: "",
    ...overrides,
  };
}

function makeStopsSnap(stops: ReturnType<typeof makeStop>[]) {
  return {
    docs: stops.map((s) => ({
      id: s.stopId,
      data: () => { const { stopId: _id, ...rest } = s; return rest; },
    })),
  };
}

/**
 * Sets up onSnapshot mocks in call order matching React's effect firing
 * sequence (children before parents):
 *   1. in_progress trips — ActiveTripOverlays is a child of DriverMap,
 *      so its useEffect fires before DriverMap's own useEffect
 *   2. drivers (isOnline=true) — DriverMap's own useEffect fires second
 *   3. stops subcollection for each trip — TripRouteOverlay mounts after
 *      trips state updates and its useEffect fires next
 */
function setupMocks({
  drivers = [],
  trips = [],
  stopsByTripId = {} as Record<string, ReturnType<typeof makeStop>[]>,
}: {
  drivers?: { uid: string; isOnline: boolean; lastLocation: { lat: number; lng: number } | null }[];
  trips?: { id: string; route: Record<string, unknown> | null }[];
  stopsByTripId?: Record<string, ReturnType<typeof makeStop>[]>;
}) {
  // 1. In-progress trips subscription (ActiveTripOverlays — child fires first)
  mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
    cb({ docs: trips.map((t) => ({ id: t.id, data: () => ({ route: t.route }) })) });
    return jest.fn();
  });

  // 2. Drivers subscription (DriverMap — parent fires second)
  mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
    cb({ docs: drivers.map((d) => ({ id: d.uid, data: () => d })) });
    return jest.fn();
  });

  // 3. Stops subcollection for each trip (TripRouteOverlay mounts after trips update)
  for (const trip of trips) {
    const stops = stopsByTripId[trip.id] ?? [];
    mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
      cb(makeStopsSnap(stops));
      return jest.fn();
    });
  }

  // Catch-all
  mockOnSnapshot.mockImplementation(() => jest.fn() as any);
}

// ── Global setup ───────────────────────────────────────────────────────────
beforeEach(() => {
  stopSeq = 0;
  // Only reset onSnapshot — clears its mockImplementationOnce queue between
  // tests without wiping implementations on other mocks (useAuth, decodePolyline…)
  mockOnSnapshot.mockReset();
  jest.clearAllMocks();

  mockUseMap.mockReturnValue({ fitBounds: jest.fn() } as any);
  mockPolylineConstructor.mockClear();
  mockUseMapsLibrary.mockImplementation((lib: string) => {
    if (lib === "maps")
      return { Polyline: mockPolylineConstructor } as any;
    if (lib === "core")
      return { LatLngBounds: jest.fn(() => ({ extend: jest.fn() })) } as any;
    return null;
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 1. Active trip route polylines
// ══════════════════════════════════════════════════════════════════════════
describe("AC1 — active trip route polylines", () => {
  it("renders the map container", () => {
    setupMocks({});
    render(<DriverMap />);
    expect(screen.getByTestId("driver-map")).toBeInTheDocument();
  });

  it("creates a Polyline for each in_progress trip that has a route", async () => {
    setupMocks({
      trips: [
        { id: "trip-1", route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 120, legs: [] } },
        { id: "trip-2", route: { polyline: "def", distanceMeters: 2000, durationSeconds: 240, legs: [] } },
      ],
      stopsByTripId: {
        "trip-1": [makeStop({ address: "A1", sequence: 0 })],
        "trip-2": [makeStop({ address: "A2", sequence: 0 })],
      },
    });

    render(<DriverMap />);

    // At least one Polyline instance created per trip with a route
    await waitFor(() =>
      expect(mockPolylineConstructor.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("does not create a Polyline for in_progress trips without a route", async () => {
    setupMocks({
      trips: [{ id: "trip-1", route: null }],
      stopsByTripId: { "trip-1": [makeStop({ sequence: 0 })] },
    });

    render(<DriverMap />);
    await waitFor(() => screen.getByTestId("driver-map"));

    // Trip filtered out before TripRouteOverlay mounts — no Polyline created
    expect(mockPolylineConstructor).not.toHaveBeenCalled();
  });

  it("renders driver position markers alongside trip overlays", async () => {
    setupMocks({
      drivers: [
        { uid: "d1", isOnline: true, lastLocation: { lat: 40.70, lng: -74.00 } },
      ],
      trips: [
        { id: "trip-1", route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 120, legs: [] } },
      ],
      stopsByTripId: {
        "trip-1": [makeStop({ address: "Stop A", sequence: 0 })],
      },
    });

    render(<DriverMap />);

    await waitFor(() => {
      // Driver marker is rendered (title = driver uid)
      expect(screen.getByTitle("d1")).toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Completed stops shown in green, remaining in red
// ══════════════════════════════════════════════════════════════════════════
describe("AC2 — stop marker colors on the live map", () => {
  const TRIP_WITH_ROUTE = {
    id: "trip-1",
    route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 120, legs: [] },
  };

  it("renders a completed stop with a green Pin and ✓ glyph", async () => {
    setupMocks({
      trips: [TRIP_WITH_ROUTE],
      stopsByTripId: {
        "trip-1": [
          makeStop({ address: "Done", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
          makeStop({ address: "Next", sequence: 1, lat: 40.72, lng: -74.02 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 1: Done"));

    const pin = within(screen.getByTitle("Stop 1: Done")).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#22c55e");
    expect(pin).toHaveAttribute("data-border", "#16a34a");
    expect(pin).toHaveAttribute("data-glyph", "✓");
  });

  it("renders a remaining stop with a red Pin", async () => {
    setupMocks({
      trips: [TRIP_WITH_ROUTE],
      stopsByTripId: {
        "trip-1": [
          makeStop({ address: "Next", sequence: 0, lat: 40.71, lng: -74.01 }),
          makeStop({ address: "Later", sequence: 1, lat: 40.72, lng: -74.02 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 2: Later"));

    const pin = within(screen.getByTitle("Stop 2: Later")).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#ef4444");
    expect(pin).toHaveAttribute("data-border", "#dc2626");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Next stop pulse animation
// ══════════════════════════════════════════════════════════════════════════
describe("AC3 — next stop pulse on the live map", () => {
  const TRIP_WITH_ROUTE = {
    id: "trip-1",
    route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 120, legs: [] },
  };

  it("renders the first pending stop with animate-ping, not a Pin", async () => {
    setupMocks({
      trips: [TRIP_WITH_ROUTE],
      stopsByTripId: {
        "trip-1": [
          makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
          makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 1: Stop A"));

    const nextMarker = screen.getByTitle("Stop 1: Stop A");
    expect(nextMarker.querySelector(".animate-ping")).toBeInTheDocument();
    expect(within(nextMarker).queryByTestId("pin")).not.toBeInTheDocument();
  });

  it("advances the pulse to the correct stop after earlier stops are completed", async () => {
    setupMocks({
      trips: [TRIP_WITH_ROUTE],
      stopsByTripId: {
        "trip-1": [
          makeStop({ address: "Done", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
          makeStop({ address: "Next", sequence: 1, lat: 40.72, lng: -74.02 }),
          makeStop({ address: "Later", sequence: 2, lat: 40.73, lng: -74.03 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 2: Next"));

    // Done: no pulse
    expect(screen.getByTitle("Stop 1: Done").querySelector(".animate-ping")).not.toBeInTheDocument();
    // Next: has pulse
    expect(screen.getByTitle("Stop 2: Next").querySelector(".animate-ping")).toBeInTheDocument();
    // Later: no pulse
    expect(screen.getByTitle("Stop 3: Later").querySelector(".animate-ping")).not.toBeInTheDocument();
  });

  it("only one stop has the pulse across all markers", async () => {
    setupMocks({
      trips: [TRIP_WITH_ROUTE],
      stopsByTripId: {
        "trip-1": [
          makeStop({ address: "A", sequence: 0, lat: 40.71, lng: -74.01 }),
          makeStop({ address: "B", sequence: 1, lat: 40.72, lng: -74.02 }),
          makeStop({ address: "C", sequence: 2, lat: 40.73, lng: -74.03 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 1: A"));

    const pingEls = screen.getByTestId("driver-map").querySelectorAll(".animate-ping");
    expect(pingEls).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. ETA to next stop in InfoWindow
// ══════════════════════════════════════════════════════════════════════════
describe("AC4 — ETA to next stop shown in InfoWindow", () => {
  it("shows ETA in InfoWindow when next-stop marker is clicked", async () => {
    setupMocks({
      trips: [
        {
          id: "trip-1",
          route: {
            polyline: "abc",
            distanceMeters: 5000,
            durationSeconds: 900,
            legs: [
              { fromIndex: 0, toIndex: 1, durationSeconds: 480 },
            ],
          },
        },
      ],
      stopsByTripId: {
        "trip-1": [
          makeStop({ address: "Done", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
          makeStop({ address: "Next Stop", sequence: 1, lat: 40.72, lng: -74.02 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 2: Next Stop"));

    fireEvent.click(screen.getByTitle("Stop 2: Next Stop"));

    const iw = screen.getByTestId("info-window");
    expect(within(iw).getByText(/ETA/i)).toBeInTheDocument();
    // formatDuration(480) → "8 min"
    expect(within(iw).getByText(/8 min/)).toBeInTheDocument();
  });

  it("shows completed-at time in InfoWindow for a completed stop", async () => {
    const completedAt = new Date("2024-01-15T14:30:00Z").toISOString();
    setupMocks({
      trips: [
        {
          id: "trip-1",
          route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 120, legs: [] },
        },
      ],
      stopsByTripId: {
        "trip-1": [
          makeStop({
            address: "Done Stop",
            sequence: 0,
            lat: 40.71,
            lng: -74.01,
            status: "completed",
            completedAt,
          }),
          makeStop({ address: "Next", sequence: 1, lat: 40.72, lng: -74.02 }),
        ],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 1: Done Stop"));

    fireEvent.click(screen.getByTitle("Stop 1: Done Stop"));

    const iw = screen.getByTestId("info-window");
    expect(within(iw).getByText(/Completed/i)).toBeInTheDocument();
  });

  it("closes InfoWindow when close button is clicked", async () => {
    setupMocks({
      trips: [
        {
          id: "trip-1",
          route: { polyline: "abc", distanceMeters: 1000, durationSeconds: 120, legs: [] },
        },
      ],
      stopsByTripId: {
        "trip-1": [makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 })],
      },
    });

    render(<DriverMap />);

    await waitFor(() => screen.getByTitle("Stop 1: Stop A"));

    fireEvent.click(screen.getByTitle("Stop 1: Stop A"));
    expect(screen.getByTestId("info-window")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
  });
});
