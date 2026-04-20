import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InsightsSection from "@/components/InsightsSection";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({
    toast: {
      success: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    },
  }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function makeInsights(overrides: Partial<any> = {}) {
  return {
    date: "2026-04-19",
    highlights: ["Great on-time rate", "High driver utilization"],
    concerns: ["Two cancellations flagged"],
    recommendations: ["Schedule a second driver during peak hours"],
    generatedAt: "2026-04-19T12:00:00.000Z",
    stats: {
      tripsCompleted: 12,
      tripsCancelled: 2,
      activeDrivers: 4,
      avgDurationSeconds: 1800,
      avgEtaErrorMinutes: 3.2,
    },
    ...overrides,
  };
}

function mockAdmin() {
  mockedUseAuth.mockReturnValue({
    user: { uid: "u1" } as never,
    role: "admin",
    loading: false,
    logout: jest.fn(),
  });
}

function mockDriver() {
  mockedUseAuth.mockReturnValue({
    user: { uid: "u2" } as never,
    role: "driver",
    loading: false,
    logout: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("InsightsSection", () => {
  it("renders a loading spinner while the initial fetch is pending", async () => {
    mockAdmin();
    // Never-resolving promise keeps the component in its loading state
    mockedApiFetch.mockReturnValue(new Promise(() => {}));

    render(<InsightsSection />);

    expect(screen.getByTestId("insights-loading")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /loading insights/i })).toBeInTheDocument();
  });

  it("renders all 3 cards with content after the fetch resolves", async () => {
    mockAdmin();
    mockedApiFetch.mockResolvedValueOnce(makeInsights());

    render(<InsightsSection />);

    await waitFor(() => expect(screen.getByText("Highlights")).toBeInTheDocument());

    expect(screen.getByText("Concerns")).toBeInTheDocument();
    expect(screen.getByText("Recommendations")).toBeInTheDocument();

    expect(screen.getByText("Great on-time rate")).toBeInTheDocument();
    expect(screen.getByText("Two cancellations flagged")).toBeInTheDocument();
    expect(screen.getByText("Schedule a second driver during peak hours")).toBeInTheDocument();

    // Stats strip appears
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("navigates to the previous day and refetches when the prev button is clicked", async () => {
    mockAdmin();
    const todayYmd = new Date().toISOString().slice(0, 10);
    const prior = new Date(`${todayYmd}T00:00:00.000Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    const priorYmd = prior.toISOString().slice(0, 10);

    mockedApiFetch.mockImplementation((path: string) => {
      if (path === `/insights?date=${todayYmd}`) return Promise.resolve(makeInsights({ date: todayYmd }));
      if (path === `/insights?date=${priorYmd}`) return Promise.resolve(makeInsights({ date: priorYmd }));
      return Promise.resolve(makeInsights());
    });

    render(<InsightsSection />);
    await waitFor(() => expect(screen.getByText("Highlights")).toBeInTheDocument());

    // First render did /insights?date=<today>
    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, `/insights?date=${todayYmd}`);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Previous day"));
    });

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith(`/insights?date=${priorYmd}`),
    );
  });

  it("navigates to the next day when enabled and the button is clicked", async () => {
    mockAdmin();
    const todayYmd = new Date().toISOString().slice(0, 10);
    const prior = new Date(`${todayYmd}T00:00:00.000Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    const priorYmd = prior.toISOString().slice(0, 10);

    mockedApiFetch.mockResolvedValue(makeInsights());

    render(<InsightsSection />);
    await waitFor(() => expect(screen.getByText("Highlights")).toBeInTheDocument());

    // Move to yesterday first (next is disabled on today)
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Previous day"));
    });
    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith(`/insights?date=${priorYmd}`),
    );

    // Now next should be enabled
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Next day"));
    });
    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith(`/insights?date=${todayYmd}`),
    );
  });

  it("shows the Refresh button for admin", async () => {
    mockAdmin();
    mockedApiFetch.mockResolvedValueOnce(makeInsights());

    render(<InsightsSection />);
    await waitFor(() => expect(screen.getByText("Highlights")).toBeInTheDocument());
    expect(screen.getByLabelText("Refresh insights")).toBeInTheDocument();
  });

  it("hides the Refresh button for driver", async () => {
    mockDriver();
    mockedApiFetch.mockResolvedValueOnce(makeInsights());

    render(<InsightsSection />);
    await waitFor(() => expect(screen.getByText("Highlights")).toBeInTheDocument());
    expect(screen.queryByLabelText("Refresh insights")).not.toBeInTheDocument();
  });

  it("clicking Refresh triggers POST /insights/generate for admin", async () => {
    mockAdmin();
    const todayYmd = new Date().toISOString().slice(0, 10);

    mockedApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        return Promise.resolve(makeInsights({ highlights: ["refreshed highlight"] }));
      }
      return Promise.resolve(makeInsights());
    });

    render(<InsightsSection />);
    await waitFor(() => expect(screen.getByText("Highlights")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Refresh insights"));
    });

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith(
        `/insights/generate?date=${todayYmd}`,
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // The newly returned insights should replace the old content
    await waitFor(() =>
      expect(screen.getByText("refreshed highlight")).toBeInTheDocument(),
    );
  });

  it("shows an empty state when stats are zero and all arrays are empty", async () => {
    mockAdmin();
    mockedApiFetch.mockResolvedValueOnce(
      makeInsights({
        highlights: [],
        concerns: [],
        recommendations: [],
        stats: { tripsCompleted: 0, tripsCancelled: 0, activeDrivers: 0 },
      }),
    );

    render(<InsightsSection />);
    await waitFor(() =>
      expect(screen.getByText(/no data for this day yet/i)).toBeInTheDocument(),
    );

    // 3-card layout should NOT render
    expect(screen.queryByText("Highlights")).not.toBeInTheDocument();
  });
});
