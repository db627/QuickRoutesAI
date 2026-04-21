import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TripDetailPage from "@/app/dashboard/trips/[id]/page";
import type { Trip } from "@quickroutesai/shared";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

const mockOnSnapshot = jest.fn();
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

const mockApiFetch = jest.fn();
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockRouterPush = jest.fn();

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "test-trip-id" }),
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AdvancedMarker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pin: () => null,
  useMap: () => null,
  useMapsLibrary: () => null,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTripData(status: Trip["status"]): Omit<Trip, "id"> {
  return {
    driverId: null,
    createdBy: "dispatcher-uid",
    status,
    stops: [
      { stopId: "s1", address: "123 Main St", contactName: "", lat: 40.7, lng: -74.0, sequence: 0, notes: "" },
      { stopId: "s2", address: "456 Oak Ave", contactName: "", lat: 40.8, lng: -74.1, sequence: 1, notes: "" },
    ],
    route: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function setupOnSnapshot(status: Trip["status"]) {
  const tripData = makeTripData(status);
  const stops = tripData.stops ?? [];

  // 1st call: trip document subscription
  mockOnSnapshot.mockImplementationOnce((_ref: unknown, callback: (snap: unknown) => void) => {
    callback({
      exists: () => true,
      id: "test-trip-id",
      data: () => ({ ...tripData, stops: undefined }),
    });
    return jest.fn(); // unsubscribe
  });

  // 2nd call: stops subcollection subscription
  mockOnSnapshot.mockImplementationOnce((_ref: unknown, callback: (snap: unknown) => void) => {
    callback({
      docs: stops.map((s) => ({
        id: s.stopId,
        data: () => {
          const { stopId: _id, ...rest } = s;
          return rest;
        },
      })),
    });
    return jest.fn(); // unsubscribe
  });

  // Subsequent calls (driver position etc.) — no-op
  mockOnSnapshot.mockImplementation(() => jest.fn());
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // AssignDriverDropdown calls apiFetch("/drivers") — return empty list by default
  mockApiFetch.mockResolvedValue({ data: [] });
});

describe("Duplicate Trip button", () => {
  it("shows Duplicate Trip button for completed trips", async () => {
    setupOnSnapshot("completed");
    render(<TripDetailPage />);
    expect(await screen.findByRole("button", { name: "Duplicate Trip" })).toBeInTheDocument();
  });

  it.each(["draft", "assigned", "in_progress", "cancelled"] as Trip["status"][])(
    "hides Duplicate Trip button for %s trips",
    async (status) => {
      setupOnSnapshot(status);
      render(<TripDetailPage />);
      await screen.findByText("Trip Detail");
      expect(screen.queryByRole("button", { name: "Duplicate Trip" })).not.toBeInTheDocument();
    },
  );

  it("calls duplicate endpoint and routes to duplicated trip", async () => {
    setupOnSnapshot("completed");
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/drivers") return Promise.resolve({ data: [] });
      if (path === "/trips/test-trip-id/duplicate") return Promise.resolve({ id: "duplicated-999" });
      return Promise.resolve({});
    });

    render(<TripDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate Trip" }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/trips/test-trip-id/duplicate", { method: "POST" });
      expect(mockRouterPush).toHaveBeenCalledWith("/dashboard/trips/duplicated-999");
    });
  });
});

describe("Edit button visibility", () => {
  it("shows Edit button for draft trips", async () => {
    setupOnSnapshot("draft");
    render(<TripDetailPage />);
    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it.each(["assigned", "in_progress", "completed", "cancelled"] as Trip["status"][])(
    "hides Edit button for %s trips",
    async (status) => {
      setupOnSnapshot(status);
      render(<TripDetailPage />);
      await screen.findByText("Trip Detail"); // wait for load
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    },
  );
});

describe("Cancel Trip button visibility", () => {
  it.each(["draft", "assigned"] as Trip["status"][])(
    "shows Cancel Trip button for %s trips",
    async (status) => {
      setupOnSnapshot(status);
      render(<TripDetailPage />);
      expect(await screen.findByRole("button", { name: "Cancel Trip" })).toBeInTheDocument();
    },
  );

  it.each(["in_progress", "completed", "cancelled"] as Trip["status"][])(
    "hides Cancel Trip button for %s trips",
    async (status) => {
      setupOnSnapshot(status);
      render(<TripDetailPage />);
      await screen.findByText("Trip Detail");
      expect(screen.queryByRole("button", { name: "Cancel Trip" })).not.toBeInTheDocument();
    },
  );
});

describe("Cancel confirmation modal", () => {
  it("shows confirmation modal when Cancel Trip is clicked", async () => {
    setupOnSnapshot("draft");
    render(<TripDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Trip" }));

    expect(screen.getByText("Are you sure you want to cancel this trip? This cannot be undone.")).toBeInTheDocument();
  });

  it("closes modal without calling API when Keep Trip is clicked", async () => {
    setupOnSnapshot("draft");
    render(<TripDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Trip" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Trip" }));

    expect(screen.queryByText("Are you sure you want to cancel this trip? This cannot be undone.")).not.toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalledWith("/trips/test-trip-id/cancel", expect.anything());
  });

  it("calls POST /trips/:id/cancel when confirm button is clicked", async () => {
    setupOnSnapshot("draft");
    mockApiFetch.mockResolvedValueOnce({ ok: true, status: "cancelled" });

    render(<TripDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Trip" }));

    // There are two "Cancel Trip" buttons now: the header one (hidden by modal) and the modal confirm
    // The modal confirm button is the one inside the modal
    const confirmButton = screen.getAllByRole("button", { name: "Cancel Trip" }).at(-1)!;
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/trips/test-trip-id/cancel",
        { method: "POST" },
      );
    });
  });
});

describe("Cancelled trip — action buttons hidden", () => {
  it("hides Compute Route button for cancelled trips", async () => {
    setupOnSnapshot("cancelled");
    render(<TripDetailPage />);
    await screen.findByText("Trip Detail");
    expect(screen.queryByRole("button", { name: "Compute Route" })).not.toBeInTheDocument();
  });

  it("hides Assign Driver button for cancelled trips", async () => {
    setupOnSnapshot("cancelled");
    render(<TripDetailPage />);
    await screen.findByText("Trip Detail");
    expect(screen.queryByRole("button", { name: /assign driver/i })).not.toBeInTheDocument();
  });
});
