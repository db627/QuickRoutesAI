import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TripsPage from "@/app/dashboard/trips/page";
import { onSnapshot } from "firebase/firestore";
import { useSearchParams, useRouter } from "next/navigation";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(() => ({ get: () => null })),
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
  usePathname: jest.fn(() => "/dashboard/trips"),
}));

jest.mock("next/link", () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>;
  };
});

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

function makeTripDoc(id: string, stops = 2, status = "assigned") {
  return {
    id,
    data: () => ({
      stops: Array.from({ length: stops }, (_, i) => ({ address: `Stop ${i}` })),
      status,
      driverId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      route: null,
    }),
  };
}

function mockSearchParams(params: Record<string, string> = {}) {
  mockUseSearchParams.mockReturnValue({
    get: (k: string) => params[k] ?? null,
  } as any);
}

describe("TripsPage", () => {
  beforeEach(() => {
    mockSearchParams();
    mockUseRouter.mockReturnValue({ replace: jest.fn() } as any);
  });

  it("shows 5 skeleton cards while subscription has not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<TripsPage />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    const grid = container.querySelector('[data-testid="trip-card-grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.children).toHaveLength(5);

    expect(screen.queryByText("No trips found")).not.toBeInTheDocument();
  });

  it("shows trip cards with stop counts after subscription fires (active statuses)", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      // All three statuses below are "active" (not completed/cancelled) so
      // they render on the default Active tab.
      cb({
        docs: [
          makeTripDoc("t1", 3, "assigned"),
          makeTripDoc("t2", 2, "in_progress"),
          makeTripDoc("t3", 1, "draft"),
        ],
      });
      return jest.fn() as any;
    });

    const { container } = render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    expect(screen.getByText("2 stops")).toBeInTheDocument();
    expect(screen.getByText("1 stop")).toBeInTheDocument();
    expect(screen.queryByText("No trips found")).not.toBeInTheDocument();

    const grid = container.querySelector('[data-testid="trip-card-grid"]');
    expect(grid).not.toBeNull();
    const cardLinks = grid!.querySelectorAll('a[href^="/dashboard/trips/"]');
    expect(cardLinks).toHaveLength(3);
  });

  it("default Active tab hides completed and cancelled trips", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          makeTripDoc("t1", 3, "assigned"),
          makeTripDoc("done", 2, "completed"),
          makeTripDoc("cxl", 4, "cancelled"),
        ],
      });
      return jest.fn() as any;
    });

    const { container } = render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    // Only the assigned trip shows; completed/cancelled are hidden.
    expect(screen.queryByText("2 stops")).not.toBeInTheDocument();
    expect(screen.queryByText("4 stops")).not.toBeInTheDocument();

    const grid = container.querySelector('[data-testid="trip-card-grid"]');
    const cardLinks = grid!.querySelectorAll('a[href^="/dashboard/trips/"]');
    expect(cardLinks).toHaveLength(1);

    // Active tab is the selected one.
    const activeTab = screen.getByRole("tab", { name: "Active" });
    expect(activeTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking Completed tab shows only completed trips and updates the URL", async () => {
    const replaceMock = jest.fn();
    mockUseRouter.mockReturnValue({ replace: replaceMock } as any);

    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          makeTripDoc("t1", 3, "assigned"),
          makeTripDoc("done", 2, "completed"),
          makeTripDoc("cxl", 4, "cancelled"),
        ],
      });
      return jest.fn() as any;
    });

    render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("tab", { name: "Completed" }));

    await waitFor(() => {
      expect(screen.getByText("2 stops")).toBeInTheDocument();
    });
    expect(screen.queryByText("3 stops")).not.toBeInTheDocument();
    expect(screen.queryByText("4 stops")).not.toBeInTheDocument();

    // URL reflects tab=completed.
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/trips?tab=completed");
  });

  it("clicking All tab shows every trip regardless of status", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          makeTripDoc("t1", 3, "assigned"),
          makeTripDoc("done", 2, "completed"),
          makeTripDoc("cxl", 4, "cancelled"),
        ],
      });
      return jest.fn() as any;
    });

    render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("tab", { name: "All" }));

    await waitFor(() => {
      expect(screen.getByText("2 stops")).toBeInTheDocument();
    });
    expect(screen.getByText("3 stops")).toBeInTheDocument();
    expect(screen.getByText("4 stops")).toBeInTheDocument();
  });

  it("respects ?tab=cancelled in the URL on initial render", async () => {
    mockSearchParams({ tab: "cancelled" });

    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          makeTripDoc("t1", 3, "assigned"),
          makeTripDoc("cxl", 4, "cancelled"),
        ],
      });
      return jest.fn() as any;
    });

    render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("4 stops")).toBeInTheDocument();
    });
    expect(screen.queryByText("3 stops")).not.toBeInTheDocument();

    const cancelledTab = screen.getByRole("tab", { name: "Cancelled" });
    expect(cancelledTab).toHaveAttribute("aria-selected", "true");
  });

  it("shows empty state when subscription fires with no trips", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({ docs: [] });
      return jest.fn() as any;
    });

    render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("No trips found")).toBeInTheDocument();
    });
  });

  it("renders stop count from denormalized stopCount field when no stops array is present", async () => {
    // List views subscribe to the `trips` collection without reading the
    // `stops` subcollection, so `trip.stops` is undefined. The TripCard must
    // use the denormalized `stopCount` field on the trip doc.
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          {
            id: "legacy-trip",
            data: () => ({
              status: "assigned",
              driverId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              route: null,
              stopCount: 6,
            }),
          },
        ],
      });
      return jest.fn() as any;
    });

    render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("6 stops")).toBeInTheDocument();
    });
  });
});
