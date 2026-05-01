import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import TripDetailPage from "@/app/dashboard/trips/[id]/page";
import { onSnapshot } from "firebase/firestore";
import { apiFetch } from "@/lib/api";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
  onSnapshot: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({ id: "trip-123" })),
  useRouter: jest.fn(() => ({ replace: jest.fn(), push: jest.fn() })),
}));

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn() } }),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(() => Promise.resolve({ ok: true })),
}));

jest.mock("@/lib/utils", () => ({
  decodePolyline: jest.fn(() => []),
  formatDistance: jest.fn(() => "1.0 km"),
  formatDuration: jest.fn(() => "5 min"),
}));

// Mock useAuth so we can flip the role per-test.
const mockUseAuth = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: () => <div data-testid="maps-provider" />,
  Map: () => <div data-testid="maps-map" />,
  AdvancedMarker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pin: () => null,
  InfoWindow: () => null,
  useMap: jest.fn(() => null),
  useMapsLibrary: jest.fn(() => null),
}));

jest.mock("next/link", () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>;
  };
});

jest.mock("@/components/TripForm", () => ({
  __esModule: true,
  default: () => <div data-testid="trip-form" />,
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function makeTripDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: () => true,
    id: "trip-123",
    data: () => ({
      status: "assigned",
      driverId: null,
      stops: [
        { stopId: "s1", address: "123 Main St", lat: 40.71, lng: -74.01, notes: "", sequence: 0, contactName: "" },
        { stopId: "s2", address: "456 Oak Ave", lat: 40.72, lng: -74.02, notes: "", sequence: 1, contactName: "" },
      ],
      route: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }),
  };
}

describe("TripDetailPage — Predictive ETA", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnSnapshot.mockReset();
  });

  it("shows Predict ETA button for admins and calls /trips/:id/predict-eta when clicked", async () => {
    mockUseAuth.mockReturnValue({ role: "admin", user: {}, loading: false, logout: jest.fn() });
    mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
      cb(makeTripDoc());
      return jest.fn() as any;
    });
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    render(<TripDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Predict ETA/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Predict ETA/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/trips/trip-123/predict-eta",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("renders a prediction but no action buttons inside the Predictive ETA card for drivers", async () => {
    mockUseAuth.mockReturnValue({ role: "driver", user: {}, loading: false, logout: jest.fn() });
    const prediction = {
      predictedArrivalAt: new Date(Date.now() + 600000).toISOString(),
      baselineDurationSeconds: 600,
      adjustedDurationSeconds: 720,
      confidence: "high",
      reasoning: "Rain will slow traffic slightly.",
      factors: { dayOfWeek: 2, timeOfDayHour: 10, historicalSampleSize: 3, weatherSummary: "Rain 58F" },
      generatedAt: new Date().toISOString(),
    };
    // Status=assigned so the legacy ETAPanel (in_progress only) doesn't render.
    mockOnSnapshot.mockImplementationOnce((_: any, cb: any) => {
      cb(makeTripDoc({ predictedEta: prediction, status: "assigned", driverId: "d1" }));
      return jest.fn() as any;
    });
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    render(<TripDetailPage />);

    const heading = await screen.findByText(/Predictive ETA/);
    const card = heading.closest("div.rounded-xl") as HTMLElement;
    expect(card).toBeTruthy();

    // Inside the card specifically there is no action button for drivers.
    expect(card.querySelector("button")).toBeNull();

    expect(screen.getByText("Rain will slow traffic slightly.")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });
});
