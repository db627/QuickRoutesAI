/**
 * QRA-86 — Live driver tracking map
 *
 * Tests cover all four acceptance criteria:
 *   1. Google Map renders with driver markers
 *   2. Markers update in real-time via onSnapshot
 *   3. Marker color reflects driver status (green=available, blue=on-trip, gray=offline)
 *   4. Clicking a marker shows an info popup with driver details
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DriverMap from "@/components/DriverMap";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";

// ── Firebase ───────────────────────────────────────────────────────────────

jest.mock("@/lib/firebase", () => ({ firestore: {} }));
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query:      jest.fn(() => ({})),
  where:      jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

// ── Auth ───────────────────────────────────────────────────────────────────

jest.mock("@/lib/auth-context", () => ({ useAuth: jest.fn() }));

// ── Google Maps ────────────────────────────────────────────────────────────

jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="maps-map" onClick={onClick}>{children}</div>
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
    // stopPropagation mirrors real Google Maps behavior: marker clicks do not
    // bubble to the Map's onClick handler.
    <div data-testid="map-marker" title={title} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {children}
    </div>
  ),
  Pin: ({
    background,
    glyphColor,
    borderColor,
  }: {
    background?: string;
    glyphColor?: string;
    borderColor?: string;
  }) => (
    <span
      data-testid="pin"
      data-bg={background}
      data-glyph={glyphColor}
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
}));

// ── Typed mock handles ─────────────────────────────────────────────────────

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockUseAuth    = useAuth    as jest.MockedFunction<typeof useAuth>;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDriver(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    id: uid,
    data: () => ({
      isOnline:     true,
      lastLocation: { lat: 40.71, lng: -74.01 },
      lastSpeedMps: 0,
      lastHeading:  0,
      updatedAt:    new Date().toISOString(),
      orgId:        "org-1",
      ...overrides,
    }),
  };
}

function makeTrip(driverId: string) {
  return {
    id: `trip-${driverId}`,
    data: () => ({ driverId, status: "in_progress", orgId: "org-1" }),
  };
}

function makeUser(uid: string, name: string) {
  return {
    id: uid,
    data: () => ({ uid, name, role: "driver", orgId: "org-1" }),
  };
}

/**
 * Sets up the three onSnapshot subscriptions fired by DriverMap:
 *   call 1 → drivers, call 2 → in_progress trips, call 3 → user profiles
 */
function setupSnapshots({
  driverDocs = [],
  tripDocs   = [],
  userDocs   = [],
}: {
  driverDocs?: ReturnType<typeof makeDriver>[];
  tripDocs?:   ReturnType<typeof makeTrip>[];
  userDocs?:   ReturnType<typeof makeUser>[];
} = {}) {
  let call = 0;
  mockOnSnapshot.mockImplementation((_: any, cb: any) => {
    call++;
    if (call === 1) cb({ docs: driverDocs }); // drivers
    if (call === 2) cb({ docs: tripDocs });   // in_progress trips
    if (call === 3) cb({ docs: userDocs });   // user profiles
    return jest.fn() as any;
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user:    {} as any,
    role:    "dispatcher",
    orgId:   "org-1",
    loading: false,
    logout:  jest.fn(),
    refresh: jest.fn(),
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DriverMap — AC1: Google Map with driver markers", () => {
  it("renders the map container", async () => {
    setupSnapshots();
    render(<DriverMap />);
    expect(screen.getByTestId("maps-map")).toBeInTheDocument();
  });

  it("shows a marker for each driver that has a location", async () => {
    setupSnapshots({
      driverDocs: [makeDriver("d1"), makeDriver("d2")],
    });
    render(<DriverMap />);
    await waitFor(() =>
      expect(screen.getAllByTestId("map-marker")).toHaveLength(2),
    );
  });

  it("does not render a marker for a driver without a location", async () => {
    setupSnapshots({
      driverDocs: [
        makeDriver("d1"),
        makeDriver("d2", { lastLocation: null }),
      ],
    });
    render(<DriverMap />);
    await waitFor(() =>
      expect(screen.getAllByTestId("map-marker")).toHaveLength(1),
    );
  });

  it("renders no markers when there are no drivers", async () => {
    setupSnapshots();
    render(<DriverMap />);
    await waitFor(() =>
      expect(screen.queryAllByTestId("map-marker")).toHaveLength(0),
    );
  });
});

describe("DriverMap — AC2: Real-time updates via onSnapshot", () => {
  it("subscribes to Firestore on mount and unsubscribes on unmount", () => {
    const unsub = jest.fn();
    mockOnSnapshot.mockReturnValue(unsub as any);

    const { unmount } = render(<DriverMap />);
    expect(mockOnSnapshot).toHaveBeenCalled();

    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  it("updates markers when the snapshot fires new data", async () => {
    let driversCallback: (snap: any) => void;
    let call = 0;

    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      call++;
      if (call === 1) driversCallback = cb;
      return jest.fn() as any;
    });

    render(<DriverMap />);

    // No markers initially
    expect(screen.queryAllByTestId("map-marker")).toHaveLength(0);

    // Simulate a real-time update arriving
    driversCallback!({ docs: [makeDriver("d1")] });

    await waitFor(() =>
      expect(screen.getAllByTestId("map-marker")).toHaveLength(1),
    );
  });
});

describe("DriverMap — AC3: Marker color reflects driver status", () => {
  it("uses a green pin for an available driver (online, no active trip)", async () => {
    setupSnapshots({
      driverDocs: [makeDriver("d1")],
      tripDocs:   [],
    });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("pin")).toBeInTheDocument());
    expect(screen.getByTestId("pin").dataset.bg).toBe("#16a34a");
  });

  it("uses a blue pin for a driver who is on an active trip", async () => {
    setupSnapshots({
      driverDocs: [makeDriver("d1")],
      tripDocs:   [makeTrip("d1")],
    });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("pin")).toBeInTheDocument());
    expect(screen.getByTestId("pin").dataset.bg).toBe("#2563eb");
  });

  it("uses a gray pin for an offline driver", async () => {
    setupSnapshots({
      driverDocs: [makeDriver("d1", { isOnline: false })],
      tripDocs:   [],
    });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("pin")).toBeInTheDocument());
    expect(screen.getByTestId("pin").dataset.bg).toBe("#9ca3af");
  });

  it("renders the legend with all three status labels", () => {
    setupSnapshots();
    render(<DriverMap />);
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("On trip")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });
});

describe("DriverMap — AC4: Click marker shows driver info popup", () => {
  it("shows an InfoWindow with the driver name after clicking a marker", async () => {
    setupSnapshots({
      driverDocs: [makeDriver("d1")],
      userDocs:   [makeUser("d1", "Alice")],
    });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("map-marker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("map-marker"));

    expect(screen.getByTestId("info-window")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows status label in the popup", async () => {
    setupSnapshots({
      driverDocs: [makeDriver("d1")],
    });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("map-marker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("map-marker"));

    const popup = screen.getByTestId("info-window");
    expect(popup).toHaveTextContent("Available");
  });

  it("dismisses the popup when the close button is clicked", async () => {
    setupSnapshots({ driverDocs: [makeDriver("d1")] });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("map-marker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("map-marker"));
    expect(screen.getByTestId("info-window")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close info window/i }));
    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
  });

  it("dismisses the popup when the map background is clicked", async () => {
    setupSnapshots({ driverDocs: [makeDriver("d1")] });
    render(<DriverMap />);
    await waitFor(() => expect(screen.getByTestId("map-marker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("map-marker"));
    expect(screen.getByTestId("info-window")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("maps-map"));
    expect(screen.queryByTestId("info-window")).not.toBeInTheDocument();
  });

  it("calls onSelectDriver with the driver uid when a marker is clicked", async () => {
    setupSnapshots({ driverDocs: [makeDriver("d1")] });
    const onSelectDriver = jest.fn();
    render(<DriverMap onSelectDriver={onSelectDriver} />);
    await waitFor(() => expect(screen.getByTestId("map-marker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("map-marker"));
    expect(onSelectDriver).toHaveBeenCalledWith("d1");
  });
});
