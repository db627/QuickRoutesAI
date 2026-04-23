import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ActivityFeed from "@/components/ActivityFeed";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function authWith(orgId: string | undefined) {
  mockedUseAuth.mockReturnValue({
    user: {} as any,
    role: "dispatcher",
    orgId,
    loading: false,
    logout: jest.fn(),
    refresh: jest.fn(),
  });
}

type EventOverrides = {
  id?: string;
  type?: string;
  orgId?: string;
  driverId?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

function makeEvent(overrides: EventOverrides = {}) {
  return {
    id: overrides.id ?? "evt-1",
    type: overrides.type ?? "status_change",
    orgId: overrides.orgId ?? "org-test",
    driverId: overrides.driverId ?? "driver-abcdef",
    payload: overrides.payload ?? {},
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function fireListener(events: ReturnType<typeof makeEvent>[]) {
  mockOnSnapshot.mockImplementation((_: any, cb: any) => {
    cb({
      docs: events.map((e) => ({
        id: e.id,
        data: () => {
          const { id: _id, ...rest } = e;
          return rest;
        },
      })),
    });
    return jest.fn();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ActivityFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authWith("org-test"); // default org for all tests
  });

  // ── Loading & empty states ──────────────────────────────────────────────────

  it("shows skeleton rows while waiting for the snapshot to fire", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<ActivityFeed />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  });

  it("shows empty state when snapshot fires with no events", async () => {
    fireListener([]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText("No activity yet")).toBeInTheDocument(),
    );
  });

  it("shows empty state immediately (no loading hang) when orgId is absent", async () => {
    authWith(undefined);
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    render(<ActivityFeed />);

    // The effect short-circuits on missing orgId and calls setLoading(false),
    // so the component must not be stuck in the skeleton state.
    await waitFor(() =>
      expect(screen.getByText("No activity yet")).toBeInTheDocument(),
    );
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  // ── Event rendering ─────────────────────────────────────────────────────────

  it("renders a driver-online event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "status_change",
        driverId: "driver-abcdef",
        payload: { status: "online" },
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/driver …abcdef came online/i)).toBeInTheDocument(),
    );
  });

  it("renders a driver-offline event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "status_change",
        driverId: "driver-zzzzzz",
        payload: { status: "offline" },
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/driver …zzzzzz went offline/i)).toBeInTheDocument(),
    );
  });

  it("renders a trip-started event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "status_change",
        payload: { tripId: "trip-112233", from: "assigned", to: "in_progress" },
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/trip …112233 started/i)).toBeInTheDocument(),
    );
  });

  it("renders a trip-completed event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "status_change",
        payload: { tripId: "trip-aabbcc", from: "in_progress", to: "completed" },
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/trip …aabbcc completed/i)).toBeInTheDocument(),
    );
  });

  it("renders a trip-cancelled event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "status_change",
        // last 6 chars of "trip-cncld1" = "cncld1"
        payload: { tripId: "trip-cncld1", from: "assigned", to: "cancelled" },
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/trip …cncld1 cancelled/i)).toBeInTheDocument(),
    );
  });

  it("renders a stop-completed event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "stop_completed",
        driverId: "driver-abc",
        payload: { tripId: "trip-xxyyzz", stopId: "stop-001" },
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/stop completed on trip …xxyyzz/i)).toBeInTheDocument(),
    );
  });

  it("renders a relative timestamp on each event", async () => {
    fireListener([
      makeEvent({
        id: "e1",
        type: "status_change",
        payload: { status: "online" },
        createdAt: new Date().toISOString(),
      }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      // "0s ago" or similar short relative time
      expect(screen.getByText(/ago/i)).toBeInTheDocument(),
    );
  });

  // ── Filter tabs ─────────────────────────────────────────────────────────────

  it("shows all events under the 'All' filter by default", async () => {
    fireListener([
      makeEvent({ id: "e1", type: "status_change", driverId: "driver-aaaaaa", payload: { status: "online" } }),
      // "trip-str001" → last 6 = "tr001" ... use "tripstr001" → last 6 = "r001"
      // Simplest: use an ID whose last 6 chars are the label we want: "str001"
      makeEvent({ id: "e2", type: "status_change", driverId: "driver-bbbbbb", payload: { tripId: "tripstr001", from: "assigned", to: "in_progress" } }),
      makeEvent({ id: "e3", type: "stop_completed", driverId: "driver-aaaaaa", payload: { tripId: "tripstr001", stopId: "stop-1" } }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/driver …aaaaaa came online/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/trip …str001 started/i)).toBeInTheDocument();
    expect(screen.getByText(/stop completed on trip …str001/i)).toBeInTheDocument();
  });

  it("filters to only driver events when 'Driver' tab is active", async () => {
    fireListener([
      makeEvent({ id: "e1", type: "status_change", driverId: "driver-aaaaaa", payload: { status: "online" } }),
      // "trip-112233" → last 6 = "112233" ✓
      makeEvent({ id: "e2", type: "status_change", payload: { tripId: "trip-112233", to: "in_progress" } }),
      makeEvent({ id: "e3", type: "stop_completed", payload: { tripId: "trip-112233" } }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/driver …aaaaaa came online/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Driver" }));

    expect(screen.getByText(/driver …aaaaaa came online/i)).toBeInTheDocument();
    expect(screen.queryByText(/trip …112233 started/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stop completed/i)).not.toBeInTheDocument();
  });

  it("filters to only trip events when 'Trip' tab is active", async () => {
    fireListener([
      makeEvent({ id: "e1", type: "status_change", driverId: "driver-aaaaaa", payload: { status: "online" } }),
      // "trip-aabbcc" → last 6 = "aabbcc" ✓
      makeEvent({ id: "e2", type: "status_change", payload: { tripId: "trip-aabbcc", to: "in_progress" } }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/trip …aabbcc started/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Trip" }));

    expect(screen.getByText(/trip …aabbcc started/i)).toBeInTheDocument();
    expect(screen.queryByText(/driver …aaaaaa came online/i)).not.toBeInTheDocument();
  });

  it("filters to only stop events when 'Stops' tab is active", async () => {
    fireListener([
      makeEvent({ id: "e1", type: "status_change", driverId: "driver-aaaaaa", payload: { status: "online" } }),
      // "trip-xxyyzz" → last 6 = "xxyyzz" ✓
      makeEvent({ id: "e2", type: "stop_completed", payload: { tripId: "trip-xxyyzz", stopId: "stop-1" } }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/stop completed on trip …xxyyzz/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stops" }));

    expect(screen.getByText(/stop completed on trip …xxyyzz/i)).toBeInTheDocument();
    expect(screen.queryByText(/driver …aaaaaa came online/i)).not.toBeInTheDocument();
  });

  it("shows empty state when the active filter matches no events", async () => {
    fireListener([
      makeEvent({ id: "e1", type: "stop_completed", payload: { tripId: "trip-001" } }),
    ]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText(/stop completed/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Driver" }));

    await waitFor(() =>
      expect(screen.getByText("No activity yet")).toBeInTheDocument(),
    );
  });

  // ── Live indicator ──────────────────────────────────────────────────────────

  it("shows the 'Live' indicator in the header", async () => {
    fireListener([]);

    render(<ActivityFeed />);

    await waitFor(() =>
      expect(screen.getByText("Live")).toBeInTheDocument(),
    );
  });

  // ── Subscription lifecycle ──────────────────────────────────────────────────

  it("unsubscribes from Firestore when unmounted", () => {
    const unsub = jest.fn();
    mockOnSnapshot.mockImplementation(() => unsub as any);

    const { unmount } = render(<ActivityFeed />);
    unmount();

    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("does not call onSnapshot when orgId is undefined", () => {
    authWith(undefined);

    render(<ActivityFeed />);

    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });
});
