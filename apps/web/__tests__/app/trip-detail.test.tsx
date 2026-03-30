import { render, screen, waitFor } from "@testing-library/react";
import TripDetailPage from "@/app/dashboard/trips/[id]/page";
import { onSnapshot } from "firebase/firestore";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "trip-123" })),
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
}));

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn() } }),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(() => Promise.resolve([])),
}));

jest.mock("@/lib/utils", () => ({
  decodePolyline: jest.fn(() => []),
  formatDistance: jest.fn(() => "1.0 km"),
  formatDuration: jest.fn(() => "5 min"),
}));

jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="maps-provider">{children}</div>,
  Map: () => <div data-testid="maps-map" />,
  AdvancedMarker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pin: () => null,
  useMap: jest.fn(() => null),
  useMapsLibrary: jest.fn(() => null),
}));

jest.mock("next/link", () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>;
  };
});

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;

function makeTripDoc(overrides = {}) {
  return {
    exists: () => true,
    id: "trip-123",
    data: () => ({
      status: "assigned",
      driverId: null,
      stops: [
        { address: "123 Main St", lat: 40.71, lng: -74.01, notes: "" },
        { address: "456 Oak Ave", lat: 40.72, lng: -74.02, notes: "" },
      ],
      route: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }),
  };
}

describe("TripDetailPage", () => {
  it("shows skeleton sections while trip subscription has not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<TripDetailPage />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    // Metadata cards skeleton: grid with 4 children
    const metadataGrid = container.querySelector(".grid-cols-2");
    expect(metadataGrid?.children).toHaveLength(4);

    // Stop list skeleton: 3 skeleton rows
    const stopList = container.querySelector(".divide-y");
    expect(stopList?.children).toHaveLength(3);

    // No spinner — spinner replaced by skeleton
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("does not show a spinner at any point during loading", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<TripDetailPage />);

    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("shows trip-not-found state when the document does not exist", async () => {
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      cb({ exists: () => false, id: "trip-123", data: () => ({}) });
      return jest.fn() as any;
    });

    render(<TripDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Trip not found.")).toBeInTheDocument();
    });
  });

  it("shows trip content after the trip document is loaded", async () => {
    // 1st onSnapshot = trip doc (sets loading=false)
    // 2nd onSnapshot = driver pos (only fires if driverId is set — skipped here)
    mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
      cb(makeTripDoc());
      return jest.fn() as any;
    });
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    render(<TripDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Trip Detail")).toBeInTheDocument();
    });

    expect(screen.getByText("123 Main St")).toBeInTheDocument();
    expect(screen.getByText("456 Oak Ave")).toBeInTheDocument();
  });
});
