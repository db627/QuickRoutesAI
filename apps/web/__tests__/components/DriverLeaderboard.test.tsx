import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DriverLeaderboard from "@/components/DriverLeaderboard";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockApiFetch = jest.fn();
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

jest.mock("@/lib/utils", () => ({
  formatDuration: jest.fn((s: number) => `${Math.round(s / 60)} min`),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const DRIVERS = [
  {
    driverId: "d1",
    name: "Alice",
    tripCount: 10,
    avgCompletionTimeSeconds: 1800,
    onTimePct: 90,
    prevTripCount: 7,
    trend: "up" as const,
  },
  {
    driverId: "d2",
    name: "Bob",
    tripCount: 6,
    avgCompletionTimeSeconds: 2400,
    onTimePct: 60,
    prevTripCount: 8,
    trend: "down" as const,
  },
  {
    driverId: "d3",
    name: "Carol",
    tripCount: 4,
    avgCompletionTimeSeconds: null,
    onTimePct: null,
    prevTripCount: null,
    trend: "new" as const,
  },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DriverLeaderboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiFetch.mockResolvedValue({ drivers: DRIVERS });
  });

  it("renders the heading and column headers", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Driver Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Trips")).toBeInTheDocument();
    expect(screen.getByText(/On-Time/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg Time/i)).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("renders a row for each driver", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("shows medal for top 3 ranks", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
  });

  it("shows green color for on-time >= 80%", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("90%")).toBeInTheDocument());
    expect(screen.getByText("90%").className).toContain("text-green-600");
  });

  it("shows amber color for on-time 60-79%", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("60%")).toBeInTheDocument());
    expect(screen.getByText("60%").className).toContain("text-amber-500");
  });

  it("shows '--' for null onTimePct and avgCompletionTimeSeconds", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("Carol")).toBeInTheDocument());
    expect(screen.getAllByText("--").length).toBeGreaterThanOrEqual(2);
  });

  it("shows trend arrows correctly", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("↑")).toBeInTheDocument(); // Alice: up
    expect(screen.getAllByText("↓").length).toBeGreaterThanOrEqual(1); // Bob: down (+ sort indicator)
    expect(screen.getByText("★")).toBeInTheDocument(); // Carol: new
  });

  it("calls onSelectDriver when a row is clicked", async () => {
    const onSelectDriver = jest.fn();
    render(<DriverLeaderboard onSelectDriver={onSelectDriver} />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Alice").closest("tr")!);
    expect(onSelectDriver).toHaveBeenCalledWith("d1");
  });

  it("sorts by trips descending by default (Alice first)", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows[0]).toHaveTextContent("Alice");
  });

  it("re-fetches when period selector changes", async () => {
    render(<DriverLeaderboard />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "14" } });
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    expect(mockApiFetch).toHaveBeenLastCalledWith("/drivers/performance?days=14");
  });

  it("shows empty state when no drivers returned", async () => {
    mockApiFetch.mockResolvedValue({ drivers: [] });
    render(<DriverLeaderboard />);
    await waitFor(() =>
      expect(screen.getByText("No completed trips in this period")).toBeInTheDocument(),
    );
  });

  it("shows loading skeleton then drivers", async () => {
    render(<DriverLeaderboard />);
    // Skeleton rows visible immediately (no text content yet)
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });
});
