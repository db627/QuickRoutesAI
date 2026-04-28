import { render, screen, waitFor, act } from "@testing-library/react";
import StatsCards from "@/components/StatsCards";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("StatsCards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      user: {} as any,
      role: "dispatcher",
      orgId: "org-test",
      loading: false,
      logout: jest.fn(),
      refresh: jest.fn(),
    });
  });

  it("shows skeletons while listeners have not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<StatsCards />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("Active Drivers")).not.toBeInTheDocument();
  });

  it("renders all 4 stat cards with correct counts after listeners fire", async () => {
    // listeners fire in registration order: activeDrivers, totalTrips, inProgress, completedToday
    let call = 0;
    const sizes = [3, 42, 7, 2];
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({ size: sizes[call++] });
      return jest.fn();
    });

    render(<StatsCards />);

    await waitFor(() => expect(screen.getByText("Active Drivers")).toBeInTheDocument());

    expect(screen.getByText("Total Trips")).toBeInTheDocument();
    expect(screen.getByText("In-Progress Trips")).toBeInTheDocument();
    expect(screen.getByText("Completed Today")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("unsubscribes all 4 listeners on unmount", () => {
    const unsubs = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
    let call = 0;
    mockOnSnapshot.mockImplementation(() => unsubs[call++]);

    const { unmount } = render(<StatsCards />);
    unmount();

    unsubs.forEach((unsub) => expect(unsub).toHaveBeenCalledTimes(1));
  });

  it("updates a stat in real time when a listener fires after initial load", async () => {
    const callbacks: ((snap: { size: number }) => void)[] = [];
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      callbacks.push(cb);
      return jest.fn();
    });

    render(<StatsCards />);

    act(() => {
      callbacks[0]?.({ size: 2 }); // activeDrivers
      callbacks[1]?.({ size: 10 }); // totalTrips
      callbacks[2]?.({ size: 1 }); // inProgress
      callbacks[3]?.({ size: 0 }); // completedToday
    });

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());

    act(() => {
      callbacks[0]?.({ size: 5 }); // a new driver comes online
    });

    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
  });
});
