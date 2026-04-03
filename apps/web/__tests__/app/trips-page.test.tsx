import { render, screen, waitFor } from "@testing-library/react";
import TripsPage from "@/app/dashboard/trips/page";
import { onSnapshot } from "firebase/firestore";

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

describe("TripsPage", () => {
  it("shows 5 skeleton rows while subscription has not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<TripsPage />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    const list = container.querySelector(".divide-y");
    expect(list?.children).toHaveLength(5);

    expect(screen.queryByText("No trips found")).not.toBeInTheDocument();
  });

  it("shows trip rows after subscription fires", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({
        docs: [
          makeTripDoc("t1", 3, "assigned"),
          makeTripDoc("t2", 2, "completed"),
          makeTripDoc("t3", 1, "draft"),
        ],
      });
      return jest.fn() as any;
    });

    render(<TripsPage />);

    await waitFor(() => {
      expect(screen.getByText("3 stops")).toBeInTheDocument();
    });

    expect(screen.getByText("2 stops")).toBeInTheDocument();
    expect(screen.getByText("1 stop")).toBeInTheDocument();
    expect(screen.queryByText("No trips found")).not.toBeInTheDocument();
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
});
