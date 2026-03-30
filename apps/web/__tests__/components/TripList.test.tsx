import { render, screen, waitFor } from "@testing-library/react";
import TripList from "@/components/TripList";
import { onSnapshot } from "firebase/firestore";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
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

function makeTripDoc(id: string, stops = 2, status = "assigned", driverId: string | null = null) {
  return {
    id,
    data: () => ({
      stops: Array.from({ length: stops }, (_, i) => ({ address: `Stop ${i}` })),
      status,
      driverId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };
}

describe("TripList", () => {
  it("shows 4 skeleton rows while subscription has not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<TripList />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    const list = container.querySelector(".divide-y");
    expect(list?.children).toHaveLength(4);

    expect(screen.queryByText("No trips yet")).not.toBeInTheDocument();
  });

  it("shows trip rows after subscription fires", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({ docs: [makeTripDoc("trip1", 3), makeTripDoc("trip2", 1, "completed")] });
      return jest.fn() as any;
    });

    render(<TripList />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    expect(screen.getByText("1 stop")).toBeInTheDocument();
    expect(screen.queryByText("No trips yet")).not.toBeInTheDocument();
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
