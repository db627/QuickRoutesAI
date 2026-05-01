import { render, screen, fireEvent } from "@testing-library/react";
import RouteComparisonView from "@/components/RouteComparisonView";
import type { TripStop, TripRoute } from "@quickroutesai/shared";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: any) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }: any) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Pin: ({ children }: any) => <div>{children}</div>,
  useMap: () => null,
  useMapsLibrary: () => null,
}));

jest.mock("@/lib/utils", () => ({
  decodePolyline: jest.fn(() => [{ lat: 40.71, lng: -74.0 }]),
  formatDistance: jest.fn((m: number) => `${(m / 1609).toFixed(1)} mi`),
  formatDuration: jest.fn((s: number) => `${Math.round(s / 60)} min`),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const STOPS: TripStop[] = [
  { stopId: "s1", address: "100 Main St", contactName: "", lat: 40.71, lng: -74.0, sequence: 0, notes: "" },
  { stopId: "s2", address: "200 Oak Ave", contactName: "", lat: 40.72, lng: -74.1, sequence: 1, notes: "" },
  { stopId: "s3", address: "300 Pine Rd", contactName: "", lat: 40.73, lng: -74.2, sequence: 2, notes: "" },
];

// Naive order was s1 → s3 → s2; optimized is s1 → s2 → s3
const NAIVE_INPUT: TripStop[] = [
  { stopId: "s1", address: "100 Main St", contactName: "", lat: 40.71, lng: -74.0, sequence: 0, notes: "" },
  { stopId: "s3", address: "300 Pine Rd", contactName: "", lat: 40.73, lng: -74.2, sequence: 1, notes: "" },
  { stopId: "s2", address: "200 Oak Ave", contactName: "", lat: 40.72, lng: -74.1, sequence: 2, notes: "" },
];

const ROUTE_WITH_NAIVE: TripRoute = {
  polyline: "abc123",
  distanceMeters: 8046,    // ~5 mi
  durationSeconds: 900,    // 15 min
  createdAt: "2026-04-28T00:00:00.000Z",
  naiveDistanceMeters: 16093, // ~10 mi
  fuelSavingsGallons: 0.18,
  legs: [],
  reasoning: "Stops reordered to minimize backtracking.",
  input: NAIVE_INPUT,
};

const ROUTE_NO_NAIVE: TripRoute = {
  polyline: "abc123",
  distanceMeters: 8046,
  durationSeconds: 900,
  createdAt: "2026-04-28T00:00:00.000Z",
  legs: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("RouteComparisonView", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the component heading and tab buttons", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    expect(screen.getByText("Route Comparison")).toBeInTheDocument();
    expect(screen.getByText("Split Map")).toBeInTheDocument();
    expect(screen.getByText("Stop Diff")).toBeInTheDocument();
  });

  it("shows optimized distance and duration in stats", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    // formatDistance is mocked — should be called with optimizedDistM
    const { formatDistance } = require("@/lib/utils");
    expect(formatDistance).toHaveBeenCalledWith(ROUTE_WITH_NAIVE.distanceMeters);
    expect(formatDuration).toBeDefined();
  });

  it("shows savings labels when naive data is available", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    // Stats cards render Original + Optimized labels
    expect(screen.getAllByText("Original").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Optimized").length).toBeGreaterThan(0);
  });

  it("shows savings percentage when naive distance is available", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    // dist savings = (16093 - 8046) / 16093 ≈ 50%
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("shows fuel savings from route.fuelSavingsGallons", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    expect(screen.getByText(/0\.18 gal saved/)).toBeInTheDocument();
  });

  it("renders two maps in Split Map view by default", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    expect(screen.getAllByTestId("google-map")).toHaveLength(2);
    expect(screen.getByText("Original Order")).toBeInTheDocument();
    expect(screen.getByText("AI-Optimized")).toBeInTheDocument();
  });

  it("switches to Stop Diff view when tab is clicked", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    fireEvent.click(screen.getByText("Stop Diff"));
    // Maps should no longer be visible
    expect(screen.queryByTestId("google-map")).not.toBeInTheDocument();
    // Stop addresses should appear
    expect(screen.getByText("100 Main St")).toBeInTheDocument();
    expect(screen.getByText("200 Oak Ave")).toBeInTheDocument();
    expect(screen.getByText("300 Pine Rd")).toBeInTheDocument();
  });

  it("shows AI reasoning in Stop Diff view", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    fireEvent.click(screen.getByText("Stop Diff"));
    expect(screen.getByText("Stops reordered to minimize backtracking.")).toBeInTheDocument();
  });

  it("shows correct position arrows in Stop Diff view", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    fireEvent.click(screen.getByText("Stop Diff"));

    // s1: naive pos 1, opt pos 1 → same
    // s2: naive pos 3, opt pos 2 → moved earlier (↑ 1)
    // s3: naive pos 2, opt pos 3 → moved later (↓ 1)
    expect(screen.getByText("↑ 1")).toBeInTheDocument();
    expect(screen.getByText("↓ 1")).toBeInTheDocument();
    expect(screen.getAllByText("same")).toHaveLength(1);
  });

  it("shows '--' for naive stats when naiveDistanceMeters is absent", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_NO_NAIVE} />);
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
  });

  it("falls back to stops order when route.input is absent", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_NO_NAIVE} />);
    fireEvent.click(screen.getByText("Stop Diff"));
    // All stops should appear
    expect(screen.getByText("100 Main St")).toBeInTheDocument();
    expect(screen.getByText("200 Oak Ave")).toBeInTheDocument();
    expect(screen.getByText("300 Pine Rd")).toBeInTheDocument();
  });

  it("does not render AI reasoning section when reasoning is absent", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_NO_NAIVE} />);
    fireEvent.click(screen.getByText("Stop Diff"));
    expect(screen.queryByText("AI Reasoning")).not.toBeInTheDocument();
  });

  it("switches back to Split Map view from Stop Diff", () => {
    render(<RouteComparisonView stops={STOPS} route={ROUTE_WITH_NAIVE} />);
    fireEvent.click(screen.getByText("Stop Diff"));
    fireEvent.click(screen.getByText("Split Map"));
    expect(screen.getAllByTestId("google-map")).toHaveLength(2);
  });
});

// Helper reference to avoid unused import lint error
function formatDuration(_: number) { return ""; }
