/**
 * QRA-44 — Render optimized route on Google Map
 *
 * Covers all four acceptance criteria:
 *   1. Route polyline rendered on map
 *   2. Numbered markers at each stop
 *   3. Info windows with stop details on click
 *   4. Auto-fits bounds to show full route
 *
 * Unlike trip-detail.test.tsx (which stubs Map to render nothing), this file
 * configures the Google Maps mock to render its children so the inner
 * components (MapBoundsFitter, AdvancedMarker, InfoWindow) can be exercised.
 */

import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import TripDetailPage from "@/app/dashboard/trips/[id]/page";
import { onSnapshot } from "firebase/firestore";
import { decodePolyline } from "@/lib/utils";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

// ── Firebase ───────────────────────────────────────────────────────────────
jest.mock("@/lib/firebase", () => ({ firestore: {} }));
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

// ── Next.js ────────────────────────────────────────────────────────────────
jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "trip-123" })),
  useRouter: jest.fn(() => ({ replace: jest.fn(), push: jest.fn() })),
}));
jest.mock("next/link", () =>
  function MockLink({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
);

// ── App utilities ──────────────────────────────────────────────────────────
jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn() } }),
}));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(() => Promise.resolve({ data: [] })),
}));

// decodePolyline returns two points by default; tests override per-case.
jest.mock("@/lib/utils", () => ({
  decodePolyline: jest.fn(() => [
    { lat: 40.71, lng: -74.01 },
    { lat: 40.72, lng: -74.02 },
  ]),
  formatDistance: jest.fn(() => "1.5 mi"),
  formatDuration: jest.fn(() => "12 min"),
}));

// ── Google Maps — renders children so inner components are exercisable ─────
jest.mock("@vis.gl/react-google-maps", () => ({
  // APIProvider passes children through (key check in page will be truthy via jest.setup.ts)
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

  // Map renders children so MapBoundsFitter, RoutePolyline, markers, and
  // InfoWindows actually mount in the JSDOM tree.
  Map: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="maps-map">{children}</div>
  ),

  // AdvancedMarker exposes title and onClick so markers can be targeted and clicked.
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

  // Pin exposes background/glyph/borderColor as data-* attributes.
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

  // InfoWindow renders a close button and its children.
  InfoWindow: ({
    children,
    onClose,
  }: {
    children?: React.ReactNode;
    onClose?: () => void;
  }) => (
    <div data-testid="info-window">
      <button onClick={onClose} aria-label="close info window">
        ×
      </button>
      {children}
    </div>
  ),

  useMap: jest.fn(),
  useMapsLibrary: jest.fn(),
}));

// ── Typed mock handles ─────────────────────────────────────────────────────
const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockDecodePolyline = decodePolyline as jest.MockedFunction<
  typeof decodePolyline
>;
const mockUseMap = useMap as jest.MockedFunction<typeof useMap>;
const mockUseMapsLibrary = useMapsLibrary as jest.MockedFunction<
  typeof useMapsLibrary
>;

// ── Bounds mocks (shared across bounds tests) ──────────────────────────────
const mockFitBounds = jest.fn();
const mockExtend = jest.fn();

// ── Helpers ────────────────────────────────────────────────────────────────
let stopIdSeq = 0;

function makeStop(overrides: Record<string, unknown> = {}) {
  return {
    stopId: `stop-${++stopIdSeq}`,
    address: "123 Main St",
    lat: 40.71,
    lng: -74.01,
    sequence: 0,
    notes: "",
    ...overrides,
  };
}

function makeTripData(overrides: Record<string, unknown> = {}) {
  return {
    status: "draft",
    driverId: null,
    notes: "",
    stops: [
      makeStop({ address: "Stop A", sequence: 0, lat: 40.71, lng: -74.01 }),
      makeStop({ address: "Stop B", sequence: 1, lat: 40.72, lng: -74.02 }),
      makeStop({ address: "Stop C", sequence: 2, lat: 40.73, lng: -74.03 }),
    ],
    route: null as null | {
      polyline: string;
      distanceMeters: number;
      durationSeconds: number;
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Converts a stops array into a QuerySnapshot-like object for the subcollection mock.
 */
function makeStopsSnap(stops: ReturnType<typeof makeStop>[]) {
  return {
    docs: stops.map((s) => ({
      id: s.stopId,
      data: () => {
        const { stopId: _id, ...rest } = s;
        return rest;
      },
    })),
  };
}

/**
 * Renders TripDetailPage with a Firestore snapshot that immediately fires
 * with the given trip data. Stops are delivered via the subcollection mock.
 */
function renderWithTrip(tripOverrides: Record<string, unknown> = {}) {
  const tripData = makeTripData(tripOverrides);
  // Extract stops to serve via subcollection; remove from trip doc data
  const stops = (tripData.stops ?? []) as ReturnType<typeof makeStop>[];
  const { stops: _stops, ...tripDocData } = tripData;

  // 1st onSnapshot: trip document
  mockOnSnapshot.mockImplementationOnce(
    (_: unknown, cb: (snap: unknown) => void) => {
      cb({
        exists: () => true,
        id: "trip-123",
        data: () => tripDocData,
      });
      return jest.fn();
    },
  );
  // 2nd onSnapshot: stops subcollection
  mockOnSnapshot.mockImplementationOnce(
    (_: unknown, cb: (snap: unknown) => void) => {
      cb(makeStopsSnap(stops));
      return jest.fn();
    },
  );
  // Any subsequent onSnapshot calls (driver position, etc.) — no-op.
  mockOnSnapshot.mockImplementation(() => jest.fn() as any);
  return render(<TripDetailPage />);
}

// ── Global setup ───────────────────────────────────────────────────────────
beforeEach(() => {
  stopIdSeq = 0;
  mockFitBounds.mockClear();
  mockExtend.mockClear();
  mockDecodePolyline.mockClear();

  // Default map hooks — return mock objects that satisfy MapBoundsFitter and RoutePolyline.
  mockUseMap.mockReturnValue({ fitBounds: mockFitBounds } as any);
  mockUseMapsLibrary.mockImplementation((lib: string) => {
    if (lib === "core")
      return { LatLngBounds: jest.fn(() => ({ extend: mockExtend })) } as any;
    if (lib === "maps")
      return {
        Polyline: jest.fn(() => ({ setMap: jest.fn() })),
      } as any;
    return null;
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 1. Route polyline
// ══════════════════════════════════════════════════════════════════════════
describe("Route polyline", () => {
  it("calls decodePolyline with the trip's encoded polyline string when a route exists", async () => {
    renderWithTrip({
      route: {
        polyline: "abc_encoded_polyline",
        distanceMeters: 3200,
        durationSeconds: 480,
      },
    });

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(mockDecodePolyline).toHaveBeenCalledWith("abc_encoded_polyline");
  });

  it("does not call decodePolyline when the trip has no computed route", async () => {
    renderWithTrip({ route: null });

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(mockDecodePolyline).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Numbered stop markers
// ══════════════════════════════════════════════════════════════════════════
describe("Numbered stop markers", () => {
  it("renders one marker per geocoded stop inside the map", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    // 3 stops → 3 markers (driver is null so no driver marker)
    const markers = within(screen.getByTestId("maps-map")).getAllByTestId(
      "map-marker",
    );
    expect(markers).toHaveLength(3);
  });

  it("titles each marker with its 1-based sequence number and address", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(screen.getByTitle("Stop 1: Stop A")).toBeInTheDocument();
    expect(screen.getByTitle("Stop 2: Stop B")).toBeInTheDocument();
    expect(screen.getByTitle("Stop 3: Stop C")).toBeInTheDocument();
  });

  it("renders the first pending stop with an orange pulsing marker instead of a Pin", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    // With no status on any stop, stop 1 is the next pending stop → orange pulse
    const firstMarker = screen.getByTitle("Stop 1: Stop A");
    expect(within(firstMarker).queryByTestId("pin")).not.toBeInTheDocument();
    expect(firstMarker.querySelector(".animate-ping")).toBeInTheDocument();
  });

  it("renders the last stop with a red pin", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    const lastMarker = screen.getByTitle("Stop 3: Stop C");
    const pin = within(lastMarker).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#ef4444");
    expect(pin).toHaveAttribute("data-border", "#dc2626");
  });

  it("renders remaining stops (after the next stop) with red pins", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    // Stop 2 is remaining (not next, not completed) → red Pin
    const midMarker = screen.getByTitle("Stop 2: Stop B");
    const pin = within(midMarker).getByTestId("pin");
    expect(pin).toHaveAttribute("data-bg", "#ef4444");
    expect(pin).toHaveAttribute("data-border", "#dc2626");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Info windows
// ══════════════════════════════════════════════════════════════════════════
describe("Info windows", () => {
  it("shows no info window before any marker is clicked", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
  });

  it("opens an info window when a stop marker is clicked", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    fireEvent.click(screen.getByTitle("Stop 1: Stop A"));

    expect(screen.getByTestId("info-window")).toBeInTheDocument();
  });

  it("shows the stop number and address inside the info window", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    fireEvent.click(screen.getByTitle("Stop 2: Stop B"));

    const iw = screen.getByTestId("info-window");
    expect(within(iw).getByText("Stop 2")).toBeInTheDocument();
    expect(within(iw).getByText("Stop B")).toBeInTheDocument();
  });

  it("shows stop notes in the info window when the stop has notes", async () => {
    renderWithTrip({
      stops: [
        makeStop({
          address: "Stop A",
          sequence: 0,
          lat: 40.71,
          lng: -74.01,
          notes: "Ring doorbell",
        }),
      ],
    });

    await waitFor(() => screen.getByText("Trip Detail"));

    fireEvent.click(screen.getByTitle("Stop 1: Stop A"));

    const iw = screen.getByTestId("info-window");
    expect(within(iw).getByText("Ring doorbell")).toBeInTheDocument();
  });

  it("shows the delivery time window in the info window when one is set", async () => {
    renderWithTrip({
      stops: [
        makeStop({
          address: "Stop A",
          sequence: 0,
          lat: 40.71,
          lng: -74.01,
          timeWindow: { start: "09:00", end: "12:00" },
        }),
      ],
    });

    await waitFor(() => screen.getByText("Trip Detail"));

    fireEvent.click(screen.getByTitle("Stop 1: Stop A"));

    const iw = screen.getByTestId("info-window");
    expect(within(iw).getByText(/09:00/)).toBeInTheDocument();
    expect(within(iw).getByText(/12:00/)).toBeInTheDocument();
  });

  it("dismisses the info window when the close button is clicked", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    fireEvent.click(screen.getByTitle("Stop 1: Stop A"));
    expect(screen.getByTestId("info-window")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close info window" }));

    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
  });

  it("toggles the info window closed when the same marker is clicked again", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    const marker = screen.getByTitle("Stop 1: Stop A");
    fireEvent.click(marker);
    expect(screen.getByTestId("info-window")).toBeInTheDocument();

    fireEvent.click(marker);
    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
  });

  it("closes the current info window and opens the new one when a different marker is clicked", async () => {
    renderWithTrip();

    await waitFor(() => screen.getByText("Trip Detail"));

    fireEvent.click(screen.getByTitle("Stop 1: Stop A"));
    expect(screen.getAllByTestId("info-window")).toHaveLength(1);
    expect(within(screen.getByTestId("info-window")).getByText("Stop 1")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Stop 2: Stop B"));
    expect(screen.getAllByTestId("info-window")).toHaveLength(1);
    expect(within(screen.getByTestId("info-window")).getByText("Stop 2")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Auto-fit bounds (MapBoundsFitter)
// ══════════════════════════════════════════════════════════════════════════
describe("Auto-fit bounds", () => {
  it("calls fitBounds once the map and stops are available", async () => {
    renderWithTrip();

    await waitFor(() => expect(mockFitBounds).toHaveBeenCalled());

    // Called with the 60px padding constant defined in MapBoundsFitter
    expect(mockFitBounds).toHaveBeenCalledWith(expect.anything(), 60);
  });

  it("extends bounds for every geocoded stop coordinate", async () => {
    renderWithTrip();

    await waitFor(() => expect(mockFitBounds).toHaveBeenCalled());

    // 3 stops with non-zero coords
    expect(mockExtend).toHaveBeenCalledWith({ lat: 40.71, lng: -74.01 });
    expect(mockExtend).toHaveBeenCalledWith({ lat: 40.72, lng: -74.02 });
    expect(mockExtend).toHaveBeenCalledWith({ lat: 40.73, lng: -74.03 });
  });

  it("includes decoded polyline points in the bounds when a route exists", async () => {
    // decodePolyline mock returns [{lat:40.71,lng:-74.01},{lat:40.72,lng:-74.02}]
    renderWithTrip({
      route: {
        polyline: "encoded_string",
        distanceMeters: 1000,
        durationSeconds: 120,
      },
    });

    await waitFor(() => expect(mockFitBounds).toHaveBeenCalled());

    // 3 stop coords + 2 polyline points = 5 extend calls
    expect(mockExtend).toHaveBeenCalledTimes(5);
  });

  it("does not call fitBounds when all stops have zero coordinates and there is no polyline", async () => {
    // Override decodePolyline to return empty (no route in trip data either)
    mockDecodePolyline.mockReturnValue([]);

    renderWithTrip({
      stops: [
        makeStop({ address: "Stop A", sequence: 0, lat: 0, lng: 0 }),
      ],
      route: null,
    });

    await waitFor(() => screen.getByText("Trip Detail"));

    expect(mockFitBounds).not.toHaveBeenCalled();
  });
});
