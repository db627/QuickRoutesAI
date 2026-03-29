import { render, screen, waitFor } from "@testing-library/react";
import StatsCards from "@/components/StatsCards";
import { apiFetch } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

// lucide-react renders SVGs which jsdom handles fine — no mock needed.

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDriver(uid = "d1") {
  return { uid, isOnline: true, lastLocation: null, lastSpeedMps: 0, lastHeading: 0, updatedAt: "" };
}

function makeTripStats(overrides: Partial<{ totalTrips: number; inProgressTrips: number; completedToday: number }> = {}) {
  return { totalTrips: 0, inProgressTrips: 0, completedToday: 0, ...overrides };
}

/**
 * Sets up apiFetch mock for the two parallel calls made by StatsCards:
 *   GET /drivers/active  →  DriverRecord[]
 *   GET /trips/stats     →  { totalTrips, inProgressTrips, completedToday }
 */
function mockSuccessfulFetch({
  drivers = [] as object[],
  tripStats = makeTripStats(),
} = {}) {
  mockedApiFetch.mockImplementation((path: string) => {
    if (path === "/drivers/active") return Promise.resolve(drivers);
    if (path === "/trips/stats") return Promise.resolve(tripStats);
    return Promise.resolve({});
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StatsCards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  it("renders 4 loading skeletons before data resolves", () => {
    // Never-resolving promise keeps the component in the loading state
    mockedApiFetch.mockReturnValue(new Promise(() => {}));

    render(<StatsCards />);

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons).toHaveLength(4);

    // No card labels should be visible yet
    expect(screen.queryByText("Active Drivers")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Trips")).not.toBeInTheDocument();
  });

  // ── Card rendering ─────────────────────────────────────────────────────────

  it("renders all 4 stat cards with correct labels after data loads", async () => {
    mockSuccessfulFetch();

    render(<StatsCards />);

    await waitFor(() => {
      expect(screen.getByText("Active Drivers")).toBeInTheDocument();
      expect(screen.getByText("Total Trips")).toBeInTheDocument();
      expect(screen.getByText("In-Progress Trips")).toBeInTheDocument();
      expect(screen.getByText("Completed Today")).toBeInTheDocument();
    });

    // Skeletons are gone
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  // ── Data display ───────────────────────────────────────────────────────────

  it("displays the correct count for each stat card", async () => {
    mockSuccessfulFetch({
      drivers: [makeDriver("d1"), makeDriver("d2"), makeDriver("d3")],
      tripStats: makeTripStats({ totalTrips: 42, inProgressTrips: 7, completedToday: 2 }),
    });

    render(<StatsCards />);

    await waitFor(() => expect(screen.getByText("Active Drivers")).toBeInTheDocument());

    expect(screen.getByText("3")).toBeInTheDocument();  // active drivers
    expect(screen.getByText("42")).toBeInTheDocument(); // total trips
    expect(screen.getByText("7")).toBeInTheDocument();  // in-progress
    expect(screen.getByText("2")).toBeInTheDocument();  // completed today
  });

  it("shows zero completed today when the API returns zero", async () => {
    mockSuccessfulFetch({
      tripStats: makeTripStats({ completedToday: 0 }),
    });

    render(<StatsCards />);

    await waitFor(() => expect(screen.getByText("Completed Today")).toBeInTheDocument());

    const completedTodayLabel = screen.getByText("Completed Today");
    const card = completedTodayLabel.closest("div.rounded-xl") as HTMLElement;
    expect(card.querySelector("p.text-3xl")?.textContent).toBe("0");
  });

  // ── API calls ──────────────────────────────────────────────────────────────

  it("fetches from the correct API endpoints", async () => {
    mockSuccessfulFetch();

    render(<StatsCards />);

    await waitFor(() => expect(screen.getByText("Active Drivers")).toBeInTheDocument());

    const calledPaths = mockedApiFetch.mock.calls.map(([path]) => path);
    expect(calledPaths).toContain("/drivers/active");
    expect(calledPaths).toContain("/trips/stats");
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it("still renders all 4 cards showing zeros when the API calls fail", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    render(<StatsCards />);

    await waitFor(() => expect(screen.getByText("Active Drivers")).toBeInTheDocument());

    expect(screen.getByText("Total Trips")).toBeInTheDocument();
    expect(screen.getByText("In-Progress Trips")).toBeInTheDocument();
    expect(screen.getByText("Completed Today")).toBeInTheDocument();

    const zeros = screen.getAllByText("0");
    expect(zeros).toHaveLength(4);
  });

  // ── Responsive grid ────────────────────────────────────────────────────────

  it("renders the responsive grid container with correct Tailwind classes", () => {
    mockedApiFetch.mockReturnValue(new Promise(() => {}));

    const { container } = render(<StatsCards />);

    const grid = container.firstElementChild;
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-4");
  });
});
