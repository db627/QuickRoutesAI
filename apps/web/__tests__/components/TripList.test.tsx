import { render, screen, waitFor } from "@testing-library/react";
import TripList from "@/components/TripList";
import { onSnapshot } from "firebase/firestore";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
  query: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("next/link", () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>;
  };
});

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;

function makeTripDoc(
  id: string,
  stops = 2,
  status = "assigned",
  driverId: string | null = null,
  createdAt = new Date().toISOString(),
) {
  return {
    id,
    data: () => ({
      stops: Array.from({ length: stops }, (_, i) => ({
        stopId: `${id}-${i}`,
        address: `${i + 1}00 Main St`,
        sequence: i,
      })),
      status,
      driverId,
      createdAt,
      updatedAt: createdAt,
    }),
  };
}

describe("TripList", () => {
  it("shows skeleton cards while subscription has not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<TripList />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    // Skeleton state still uses the card grid container.
    const grid = container.querySelector('[data-testid="trip-card-grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.children.length).toBeGreaterThan(0);

    expect(screen.queryByText("No trips yet")).not.toBeInTheDocument();
  });

  it("renders a card grid with stop counts and address previews after subscription fires", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [makeTripDoc("trip1", 3), makeTripDoc("trip2", 1, "completed")],
      });
      return jest.fn() as any;
    });

    const { container } = render(<TripList />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    expect(screen.getByText("1 stop")).toBeInTheDocument();
    expect(screen.queryByText("No trips yet")).not.toBeInTheDocument();

    // Grid layout is applied and both trips render as card links.
    const grid = container.querySelector('[data-testid="trip-card-grid"]');
    expect(grid).not.toBeNull();
    const cardLinks = grid!.querySelectorAll('a[href^="/dashboard/trips/"]');
    expect(cardLinks).toHaveLength(2);

    // First stop address preview is shown on each card.
    expect(screen.getAllByText("100 Main St").length).toBeGreaterThan(0);
  });

  it("sorts trips newest-first even if the subscription delivers them out of order", async () => {
    const older = new Date("2025-01-01T00:00:00.000Z").toISOString();
    const newer = new Date("2025-06-01T00:00:00.000Z").toISOString();

    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          // Intentionally out of order (oldest first).
          makeTripDoc("old", 2, "assigned", null, older),
          makeTripDoc("new", 4, "assigned", null, newer),
        ],
      });
      return jest.fn() as any;
    });

    const { container } = render(<TripList />);

    await waitFor(() => {
      expect(screen.getByText("4 stops")).toBeInTheDocument();
    });

    const grid = container.querySelector('[data-testid="trip-card-grid"]');
    const cardLinks = Array.from(
      grid!.querySelectorAll('a[href^="/dashboard/trips/"]'),
    );
    // Newest trip should appear first.
    expect(cardLinks[0].getAttribute("href")).toBe("/dashboard/trips/new");
    expect(cardLinks[1].getAttribute("href")).toBe("/dashboard/trips/old");
  });

  it("shows empty state when subscription fires with no trips", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({ docs: [] });
      return jest.fn() as any;
    });

    render(<TripList />);

    await waitFor(() => {
      expect(screen.getByText("No trips yet")).toBeInTheDocument();
    });
  });
});
