import { render, screen, waitFor } from "@testing-library/react";
import StatsCards from "@/components/StatsCards";
import { apiFetch } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("StatsCards", () => {
  it("shows 4 skeleton cards while the fetch has not resolved", () => {
    // Never-resolving promise keeps the component in loading state
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    const { container } = render(<StatsCards />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    // Real card labels must not appear
    expect(screen.queryByText("Active Drivers")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Trips")).not.toBeInTheDocument();

    // Grid should have exactly 4 skeleton cards
    const grid = container.querySelector(".grid");
    expect(grid?.children).toHaveLength(4);
  });

  it("shows real stat cards after the fetch resolves", async () => {
    // First call: /drivers/active, second call: /trips/stats
    mockApiFetch
      .mockResolvedValueOnce([{ uid: "d1" }, { uid: "d2" }] as any) // 2 active drivers
      .mockResolvedValueOnce({ totalTrips: 5, inProgressTrips: 1, completedToday: 3 } as any);

    render(<StatsCards />);

    await waitFor(() => {
      expect(screen.getByText("Active Drivers")).toBeInTheDocument();
    });

    expect(screen.getByText("Total Trips")).toBeInTheDocument();
    expect(screen.getByText("In-Progress Trips")).toBeInTheDocument();
    expect(screen.getByText("Completed Today")).toBeInTheDocument();

    // All four values are unique — safe to assert individually
    expect(screen.getByText("2")).toBeInTheDocument(); // activeDrivers
    expect(screen.getByText("5")).toBeInTheDocument(); // totalTrips
    expect(screen.getByText("1")).toBeInTheDocument(); // inProgressTrips
    expect(screen.getByText("3")).toBeInTheDocument(); // completedToday
  });

  it("shows zeros and hides skeletons when the fetch fails", async () => {
    mockApiFetch.mockRejectedValue(new Error("Network error"));

    render(<StatsCards />);

    await waitFor(() => {
      expect(screen.getByText("Active Drivers")).toBeInTheDocument();
    });

    // All values should be 0 (graceful degradation)
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(4);
  });
});
