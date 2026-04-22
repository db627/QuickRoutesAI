import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AnalyticsPage from "@/app/dashboard/analytics/page";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { AnalyticsResponse } from "@quickroutesai/shared";

// Recharts uses SVG + ResizeObserver which JSDOM doesn't support — swap with
// minimal stubs so tests focus on data-fetching and KPI rendering logic.
jest.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    Line: () => null,
    BarChart: Stub,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  };
});

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/toast-context", () => ({ useToast: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseToast = useToast as jest.MockedFunction<typeof useToast>;

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

const EMPTY_RESPONSE: AnalyticsResponse = {
  tripsByDay: [],
  avgDeliveryByDay: [],
  summary: { totalTrips: 0, totalStops: 0, onTimePercentage: null, tripsWithEta: 0 },
};

const FULL_RESPONSE: AnalyticsResponse = {
  tripsByDay: [
    { date: "2026-04-01", count: 3 },
    { date: "2026-04-02", count: 1 },
  ],
  avgDeliveryByDay: [{ date: "2026-04-01", avgMinutes: 90 }],
  summary: { totalTrips: 4, totalStops: 12, onTimePercentage: 75, tripsWithEta: 4 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseToast.mockReturnValue({ toast: mockToast });
});

describe("AnalyticsPage", () => {
  it("shows loading skeletons on mount before data arrives", () => {
    // Never resolve so we stay in loading state
    mockedApiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AnalyticsPage />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders KPI cards with correct values after data loads", async () => {
    mockedApiFetch.mockResolvedValue(FULL_RESPONSE);
    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText("4")).toBeInTheDocument());

    expect(screen.getByText("Total Trips")).toBeInTheDocument();
    expect(screen.getByText("Total Stops")).toBeInTheDocument();
    expect(screen.getByText("On-Time Rate")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("shows N/A for on-time rate when no ETA data is available", async () => {
    mockedApiFetch.mockResolvedValue(EMPTY_RESPONSE);
    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText("N/A")).toBeInTheDocument());
    expect(screen.getByText("no ETA data in range")).toBeInTheDocument();
  });

  it("shows chart empty states when there is no data", async () => {
    mockedApiFetch.mockResolvedValue(EMPTY_RESPONSE);
    render(<AnalyticsPage />);

    await waitFor(() =>
      expect(screen.getByText("No trip data for this range.")).toBeInTheDocument()
    );
    expect(
      screen.getByText(/No completed trips in this range/)
    ).toBeInTheDocument();
  });

  it("calls apiFetch with default 30-day range on mount", async () => {
    mockedApiFetch.mockResolvedValue(FULL_RESPONSE);
    render(<AnalyticsPage />);

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));

    const url: string = (mockedApiFetch.mock.calls[0] as [string])[0];
    expect(url).toMatch(/^\/analytics\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });

  it("re-fetches when a preset button is clicked", async () => {
    mockedApiFetch.mockResolvedValue(FULL_RESPONSE);
    render(<AnalyticsPage />);

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(2));

    const url: string = (mockedApiFetch.mock.calls[1] as [string])[0];
    expect(url).toContain("/analytics?from=");
  });

  it("shows an error toast when the API call fails", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));
    render(<AnalyticsPage />);

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Network error")
    );
  });
});
