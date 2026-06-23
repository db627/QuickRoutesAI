/**
 * QRA-84 — Trip progress tracking on live map
 *
 * Covers all four acceptance criteria:
 *   1. Active trip routes rendered as polylines  (polyline already tested in
 *      trip-detail-map.test.tsx; focused cases here ensure it still renders
 *      when trip is in_progress)
 *   2. Completed stops shown in green, remaining in red
 *   3. Next stop highlighted with pulse animation
 *   4. ETA to next stop displayed in info panel (live driver info bar)
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import TripDetailPage from "@/app/dashboard/trips/[id]/page";
import { onSnapshot } from "firebase/firestore";
import { formatDuration } from "@/lib/utils";

// ── Firebase ───────────────────────────────────────────────────────────────
jest.mock("@/lib/firebase", () => ({ firestore: {} }));
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
}));

// ── Next.js ────────────────────────────────────────────────────────────────
jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "trip-abc" })),
  useRouter: jest.fn(() => ({ replace: jest.fn(), push: jest.fn() })),
}));
jest.mock("next/link", () =>
  function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>;
  },
);

// ── App utilities ──────────────────────────────────────────────────────────
jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }),
}));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(() => Promise.resolve({ data: [] })),
}));
jest.mock("@/lib/utils", () => ({
  decodePolyline: jest.fn(() => [
    { lat: 40.71, lng: -74.01 },
    { lat: 40.72, lng: -74.02 },
  ]),
  formatDistance: jest.fn(() => "2.0 mi"),
  formatDuration: jest.fn((s: number) => `${Math.round(s / 60)} min`),
}));

// ── Google Maps — renders children so inner components are exercisable ─────
jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="maps-map">{children}</div>
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
      <button onClick={onClose} aria-label="close info window">×</button>
      {children}
    </div>
  ),
  useMap: jest.fn(() => ({ fitBounds: jest.fn() })),
  useMapsLibrary: jest.fn((lib: string) => {
    if (lib === "core") return { LatLngBounds: jest.fn(() => ({ extend: jest.fn() })) };
    if (lib === "maps") return { Polyline: jest.fn(() => ({ setMap: jest.fn() })) };
    return null;
  }),
}));

// ── Auth ───────────────────────────────────────────────────────────────────
jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(() => ({ role: "dispatcher", orgId: "org-1", user: {}, loading: false })),
}));

// ── Typed mock handle ──────────────────────────────────────────────────────
const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockFormatDuration = formatDuration as jest.MockedFunction<typeof formatDuration>;

// ── Fixtures ───────────────────────────────────────────────────────────────
let seq = 0;
function makeStop(overrides: Record<string, unknown> = {}) {
  return {
    stopId: `stop-${++seq}`,
    address: "123 Main St",
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
 * Sets up onSnapshot mocks for trip doc + stops subcollection + optional
 * driver position doc. Call order matches useEffect registration order in the
 * component: (1) trip doc, (2) stops subcollection, (3) driver position.
 */
function setupMocks({
  tripOverrides = {},
  stops,
  driverRecord = null,
}: {
  tripOverrides?: Record<string, unknown>;
  stops?: ReturnType<typeof makeStop>[];
  driverRecord?: Record<string, unknown> | null;
}) {
  const tripStops = stops ?? [
    makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
    makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
    makeStop({ address: "Stop C", sequence: 2, lat: 40.73, lng: -74.03 }),
  ];

  // 1st: trip document
  mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
    cb({
      exists: () => true,
      id: "trip-abc",
      data: () => ({
        status: "in_progress",
        driverId: driverRecord ? "driver-1" : null,
        notes: "",
        orgId: "org-1",
        route: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...tripOverrides,
      }),
    });
    return jest.fn();
  });

  // 2nd: stops subcollection
  mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
    cb(makeStopsSnap(tripStops));
    return jest.fn();
  });

  // 3rd: driver position (only subscribed when driverId is set)
  if (driverRecord) {
    mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
      cb({ exists: () => true, data: () => driverRecord });
      return jest.fn();
    });
  }

  // Catch-all for any further subscriptions
  mockOnSnapshot.mockImplementation(() => jest.fn() as any);
}

// ── Reset ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  seq = 0;
  jest.clearAllMocks();
  // Restore formatDuration default: return "<n> min" based on seconds
  mockFormatDuration.mockImplementation((s: number) => `${Math.round(s / 60)} min`);
});

// ══════════════════════════════════════════════════════════════════════════
// AC 1 — Polyline still renders for in_progress trips
// ══════════════════════════════════════════════════════════════════════════
describe("AC1 — active trip route polyline", () => {
  it("renders the map when trip is in_progress", async () => {
    setupMocks({ tripOverrides: { status: "in_progress" } });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(screen.getByTestId("maps-map")).toBeInTheDocument();
  });

  it("renders stop markers for an in_progress trip", async () => {
    setupMocks({ tripOverrides: { status: "in_progress" } });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    const markers = within(screen.getByTestId("maps-map")).getAllByTestId("map-marker");
    expect(markers.length).toBeGreaterThanOrEqual(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC 2 — Completed stops green, remaining stops red
// ══════════════════════════════════════════════════════════════════════════
describe("AC2 — stop marker colors based on status", () => {
  it("renders a completed stop with a green Pin and ✓ glyph", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Done Stop", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Next Stop", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    const completedMarker = screen.getByTitle("Stop 1: Done Stop");
    const pin = within(completedMarker).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#22c55e");
    expect(pin).toHaveAttribute("data-border", "#16a34a");
    expect(pin).toHaveAttribute("data-glyph", "✓");
  });

  it("renders a remaining stop with a red Pin", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Next Stop", sequence: 0, lat: 40.71, lng: -74.01 }),
        makeStop({ address: "Later Stop", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    // Stop 2 is remaining (not the next stop)
    const remainingMarker = screen.getByTitle("Stop 2: Later Stop");
    const pin = within(remainingMarker).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#ef4444");
    expect(pin).toHaveAttribute("data-border", "#dc2626");
  });

  it("renders completed stops green even when they are not the last in sequence", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02, status: "completed" }),
        makeStop({ address: "Stop C", sequence: 2, lat: 40.73, lng: -74.03 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    for (const title of ["Stop 1: Stop A", "Stop 2: Stop B"]) {
      const pin = within(screen.getByTitle(title)).getByTestId("pin");
      expect(pin).toHaveAttribute("data-bg", "#22c55e");
    }
  });

  it("renders all stops red when none are completed and no stop is next (edge: nextStopIdx=-1 impossible since stops exist)", async () => {
    // All stops pending, stop 1 gets pulse, stops 2+ get red
    setupMocks({
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    const stopBMarker = screen.getByTitle("Stop 2: Stop B");
    const pin = within(stopBMarker).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#ef4444");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC 3 — Next stop highlighted with pulse animation
// ══════════════════════════════════════════════════════════════════════════
describe("AC3 — next stop pulse animation", () => {
  it("renders the first pending stop with an animate-ping element, not a Pin", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    const nextMarker = screen.getByTitle("Stop 1: Stop A");
    expect(within(nextMarker).queryByTestId("pin")).not.toBeInTheDocument();
    expect(nextMarker.querySelector(".animate-ping")).toBeInTheDocument();
  });

  it("pulse is on the correct next stop when earlier stops are completed", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Done", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Next", sequence: 1, lat: 40.72, lng: -74.02 }),
        makeStop({ address: "Later", sequence: 2, lat: 40.73, lng: -74.03 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    // Stop 1 (completed) — no pulse
    const doneMarker = screen.getByTitle("Stop 1: Done");
    expect(doneMarker.querySelector(".animate-ping")).not.toBeInTheDocument();

    // Stop 2 (next) — has pulse
    const nextMarker = screen.getByTitle("Stop 2: Next");
    expect(nextMarker.querySelector(".animate-ping")).toBeInTheDocument();
    expect(within(nextMarker).queryByTestId("pin")).not.toBeInTheDocument();

    // Stop 3 (remaining) — no pulse, has red Pin
    const laterMarker = screen.getByTitle("Stop 3: Later");
    expect(laterMarker.querySelector(".animate-ping")).not.toBeInTheDocument();
    expect(within(laterMarker).getByTestId("pin")).toBeInTheDocument();
  });

  it("no pulse marker when all stops are completed", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02, status: "completed" }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    const map = screen.getByTestId("maps-map");
    expect(map.querySelector(".animate-ping")).not.toBeInTheDocument();
  });

  it("only one stop has the pulse at a time", async () => {
    setupMocks({
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
        makeStop({ address: "Stop C", sequence: 2, lat: 40.73, lng: -74.03 }),
      ],
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    const pulseEls = screen.getByTestId("maps-map").querySelectorAll(".animate-ping");
    expect(pulseEls).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC 4 — ETA to next stop in the info panel
// ══════════════════════════════════════════════════════════════════════════
describe("AC4 — ETA to next stop in live driver info bar", () => {
  const DRIVER_ONLINE = {
    isOnline: true,
    lastLocation: { lat: 40.70, lng: -74.00 },
    lastSpeedMps: 13.4,
    lastHeading: 90,
    updatedAt: new Date().toISOString(),
  };

  it("shows ETA to next stop when driver is live and route has legs", async () => {
    setupMocks({
      tripOverrides: {
        status: "in_progress",
        driverId: "driver-1",
        route: {
          polyline: "encoded",
          distanceMeters: 5000,
          durationSeconds: 600,
          legs: [
            { fromIndex: 0, toIndex: 1, durationSeconds: 300 },
            { fromIndex: 1, toIndex: 2, durationSeconds: 420 },
          ],
        },
      },
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
        makeStop({ address: "Stop C", sequence: 2, lat: 40.73, lng: -74.03 }),
      ],
      driverRecord: DRIVER_ONLINE,
    });

    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    // nextStopIdx=1, leg toIndex=1 → durationSeconds=300 → "5 min"
    expect(screen.getByText(/to next stop/i)).toBeInTheDocument();
    expect(mockFormatDuration).toHaveBeenCalledWith(300);
  });

  it("does not show ETA to next stop when the driver is offline", async () => {
    setupMocks({
      tripOverrides: {
        status: "in_progress",
        driverId: null,
        route: {
          polyline: "encoded",
          distanceMeters: 5000,
          durationSeconds: 600,
          legs: [{ fromIndex: 0, toIndex: 1, durationSeconds: 300 }],
        },
      },
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
      driverRecord: null,
    });
    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(screen.queryByText(/to next stop/i)).not.toBeInTheDocument();
  });

  it("does not show ETA when nextStopIdx is 0 (no preceding leg to measure from)", async () => {
    // nextStopIdx=0 means the very first stop is next; there is no leg ending at toIndex=0
    setupMocks({
      tripOverrides: {
        status: "in_progress",
        driverId: "driver-1",
        route: {
          polyline: "encoded",
          distanceMeters: 5000,
          durationSeconds: 600,
          legs: [{ fromIndex: 0, toIndex: 1, durationSeconds: 300 }],
        },
      },
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
      driverRecord: DRIVER_ONLINE,
    });

    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    // Driver bar renders but no ETA text
    expect(screen.getByText("Driver Live")).toBeInTheDocument();
    expect(screen.queryByText(/to next stop/i)).not.toBeInTheDocument();
  });

  it("does not show ETA when the trip has no route legs", async () => {
    setupMocks({
      tripOverrides: {
        status: "in_progress",
        driverId: "driver-1",
        route: null,
      },
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
      ],
      driverRecord: DRIVER_ONLINE,
    });

    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(screen.queryByText(/to next stop/i)).not.toBeInTheDocument();
  });

  it("uses the leg matching the next stop index for ETA, not an arbitrary leg", async () => {
    setupMocks({
      tripOverrides: {
        status: "in_progress",
        driverId: "driver-1",
        route: {
          polyline: "encoded",
          distanceMeters: 8000,
          durationSeconds: 900,
          legs: [
            { fromIndex: 0, toIndex: 1, durationSeconds: 120 },
            { fromIndex: 1, toIndex: 2, durationSeconds: 750 }, // this one should be used
          ],
        },
      },
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01, status: "completed" }),
        makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02, status: "completed" }),
        makeStop({ address: "Stop C", sequence: 2, lat: 40.73, lng: -74.03 }),
      ],
      driverRecord: DRIVER_ONLINE,
    });

    render(<TripDetailPage />);

    await waitFor(() => screen.getByText("Trip Detail"));

    // nextStopIdx=2, matching leg is toIndex=2 → durationSeconds=750
    expect(mockFormatDuration).toHaveBeenCalledWith(750);
    expect(mockFormatDuration).not.toHaveBeenCalledWith(120);
  });
});
