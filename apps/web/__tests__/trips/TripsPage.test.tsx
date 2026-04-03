import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TripsPage from "@/app/dashboard/trips/page";
import type { Trip, TripStop } from "@quickroutesai/shared";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

const mockOnSnapshot = jest.fn();
jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  orderBy: jest.fn(),
  query: jest.fn(),
}));

const mockReplace = jest.fn();
const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

// Import after jest.mock so we get mocked versions
import { useSearchParams, useRouter, usePathname } from "next/navigation";

const mockedUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStop(address: string, sequence = 0): TripStop {
  return { stopId: `s-${sequence}`, address, lat: 40.7, lng: -74.0, sequence, notes: "" };
}

function makeTrip(overrides: Partial<Trip> & { id: string }): Trip {
  return {
    driverId: null,
    createdBy: "dispatcher-uid",
    status: "draft",
    stops: [makeStop("123 Main St", 0)],
    route: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupTrips(trips: Trip[]) {
  mockOnSnapshot.mockImplementation((_ref: unknown, callback: (snap: unknown) => void) => {
    callback({
      docs: trips.map((t) => ({
        id: t.id,
        data: () => {
          const { id: _id, ...rest } = t;
          return rest;
        },
      })),
    });
    return jest.fn(); // unsubscribe noop
  });
}

beforeEach(() => {
  mockGet.mockReturnValue(null);
  mockedUseSearchParams.mockReturnValue({
    get: mockGet,
  } as unknown as ReturnType<typeof useSearchParams>);
  mockedUseRouter.mockReturnValue({ replace: mockReplace } as ReturnType<typeof useRouter>);
  mockedUsePathname.mockReturnValue("/dashboard/trips");
});

// ── Suite 1: Initial render ────────────────────────────────────────────────

describe("initial render", () => {
  it("renders search input and status dropdown", async () => {
    setupTrips([]);
    render(<TripsPage />);
    expect(await screen.findByRole("textbox", { name: /search trips/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /filter by status/i })).toBeInTheDocument();
  });

  it("shows all trips when no filters active", async () => {
    setupTrips([
      makeTrip({ id: "t1", stops: [makeStop("123 Main St")] }),
      makeTrip({ id: "t2", status: "assigned", stops: [makeStop("456 Oak Ave")] }),
    ]);
    render(<TripsPage />);
    const links = await screen.findAllByRole("link", { name: /stop/i });
    // 2 trip links + 1 "Create Trip" link
    expect(links.filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"))).toHaveLength(2);
  });
});

// ── Suite 2: Search filter ─────────────────────────────────────────────────

describe("search filter", () => {
  it("filters trips by stop address substring (case-insensitive)", async () => {
    const user = userEvent.setup();
    setupTrips([
      makeTrip({ id: "t1", stops: [makeStop("123 Main St")] }),
      makeTrip({ id: "t2", stops: [makeStop("456 Oak Ave")] }),
    ]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "oak");

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
    expect(tripLinks[0]).toHaveAttribute("href", "/dashboard/trips/t2");
  });

  it("search is case-insensitive", async () => {
    const user = userEvent.setup();
    setupTrips([makeTrip({ id: "t1", stops: [makeStop("123 Main St")] })]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "MAIN");

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
  });

  it("shows empty state when no trips match search", async () => {
    const user = userEvent.setup();
    setupTrips([makeTrip({ id: "t1", stops: [makeStop("123 Main St")] })]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "zzznomatch");

    expect(screen.getByText("No trips found")).toBeInTheDocument();
    expect(screen.getByText(/try adjusting/i)).toBeInTheDocument();
  });

  it("matches a trip if any stop address contains the search term", async () => {
    const user = userEvent.setup();
    setupTrips([
      makeTrip({
        id: "t1",
        stops: [makeStop("123 Main St", 0), makeStop("456 Oak Ave", 1)],
      }),
    ]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "oak");

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
  });
});

// ── Suite 3: Status dropdown ───────────────────────────────────────────────

describe("status dropdown", () => {
  it("filters to only draft trips when Draft selected", async () => {
    setupTrips([
      makeTrip({ id: "t1", status: "draft" }),
      makeTrip({ id: "t2", status: "assigned" }),
      makeTrip({ id: "t3", status: "completed" }),
    ]);
    render(<TripsPage />);
    const select = await screen.findByRole("combobox", { name: /filter by status/i });

    fireEvent.change(select, { target: { value: "draft" } });

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
    expect(tripLinks[0]).toHaveAttribute("href", "/dashboard/trips/t1");
  });

  it("shows all trips when All selected", async () => {
    setupTrips([
      makeTrip({ id: "t1", status: "draft" }),
      makeTrip({ id: "t2", status: "completed" }),
    ]);
    render(<TripsPage />);
    const select = await screen.findByRole("combobox", { name: /filter by status/i });

    fireEvent.change(select, { target: { value: "draft" } });
    fireEvent.change(select, { target: { value: "all" } });

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(2);
  });

  it("calls router.replace with status param when status changes", async () => {
    setupTrips([]);
    render(<TripsPage />);
    const select = await screen.findByRole("combobox", { name: /filter by status/i });

    fireEvent.change(select, { target: { value: "in_progress" } });

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("status=in_progress"),
    );
  });
});

// ── Suite 4: Combined filters ──────────────────────────────────────────────

describe("combined filters", () => {
  it("shows only trips matching BOTH search and status", async () => {
    const user = userEvent.setup();
    setupTrips([
      makeTrip({ id: "t1", status: "draft", stops: [makeStop("456 Oak Ave")] }),
      makeTrip({ id: "t2", status: "completed", stops: [makeStop("456 Oak Ave")] }),
      makeTrip({ id: "t3", status: "draft", stops: [makeStop("123 Main St")] }),
    ]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });
    const select = screen.getByRole("combobox", { name: /filter by status/i });

    fireEvent.change(select, { target: { value: "draft" } });
    await user.type(input, "oak");

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
    expect(tripLinks[0]).toHaveAttribute("href", "/dashboard/trips/t1");
  });
});

// ── Suite 5: Active filter chips ──────────────────────────────────────────

describe("active filter chips", () => {
  it("shows no chips when no filters active", async () => {
    setupTrips([]);
    render(<TripsPage />);
    await screen.findByRole("textbox"); // wait for render
    expect(screen.queryByLabelText("Clear search filter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Clear status filter")).not.toBeInTheDocument();
  });

  it("shows search chip when search term entered", async () => {
    const user = userEvent.setup();
    setupTrips([]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "main");

    expect(screen.getByLabelText("Clear search filter")).toBeInTheDocument();
    expect(screen.queryByLabelText("Clear status filter")).not.toBeInTheDocument();
  });

  it("shows status chip with human-readable label", async () => {
    setupTrips([]);
    render(<TripsPage />);
    const select = await screen.findByRole("combobox", { name: /filter by status/i });

    fireEvent.change(select, { target: { value: "in_progress" } });

    expect(screen.getByLabelText("Clear status filter")).toBeInTheDocument();
    expect(screen.getByText(/Status: In Progress/)).toBeInTheDocument();
  });

  it("shows Clear all only when BOTH filters active", async () => {
    const user = userEvent.setup();
    setupTrips([]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });
    const select = screen.getByRole("combobox", { name: /filter by status/i });

    await user.type(input, "main");
    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "draft" } });
    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
  });

  it("clicking × on search chip clears only search", async () => {
    const user = userEvent.setup();
    setupTrips([]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });
    const select = screen.getByRole("combobox", { name: /filter by status/i });

    await user.type(input, "main");
    fireEvent.change(select, { target: { value: "draft" } });

    await user.click(screen.getByLabelText("Clear search filter"));

    expect(screen.queryByLabelText("Clear search filter")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Clear status filter")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(select).toHaveValue("draft");
  });

  it("clicking × on status chip clears only status", async () => {
    const user = userEvent.setup();
    setupTrips([]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });
    const select = screen.getByRole("combobox", { name: /filter by status/i });

    await user.type(input, "main");
    fireEvent.change(select, { target: { value: "draft" } });

    await user.click(screen.getByLabelText("Clear status filter"));

    expect(screen.getByLabelText("Clear search filter")).toBeInTheDocument();
    expect(screen.queryByLabelText("Clear status filter")).not.toBeInTheDocument();
    expect(input).toHaveValue("main");
    expect(select).toHaveValue("all");
  });

  it("Clear all clears both filters", async () => {
    const user = userEvent.setup();
    setupTrips([]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });
    const select = screen.getByRole("combobox", { name: /filter by status/i });

    await user.type(input, "main");
    fireEvent.change(select, { target: { value: "draft" } });

    await user.click(screen.getByRole("button", { name: /clear all/i }));

    expect(input).toHaveValue("");
    expect(select).toHaveValue("all");
    expect(screen.queryByLabelText("Clear search filter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Clear status filter")).not.toBeInTheDocument();
  });
});

// ── Suite 6: Empty state ──────────────────────────────────────────────────

describe("empty state", () => {
  it("shows 'No trips found' when filtered result is empty", async () => {
    const user = userEvent.setup();
    setupTrips([makeTrip({ id: "t1", stops: [makeStop("123 Main St")] })]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "zzznomatch");

    expect(screen.getByText("No trips found")).toBeInTheDocument();
  });

  it("shows 'Clear filters' sub-text only when filters are active", async () => {
    const user = userEvent.setup();
    setupTrips([makeTrip({ id: "t1" })]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "zzznomatch");

    expect(screen.getByText(/try adjusting your search or filter/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });

  it("does NOT show 'Try adjusting' sub-text when Firestore returns no trips and no filters", async () => {
    setupTrips([]);
    render(<TripsPage />);
    await screen.findByText("No trips found");
    expect(screen.queryByText(/try adjusting/i)).not.toBeInTheDocument();
  });
});

// ── Suite 7: URL params on mount ──────────────────────────────────────────

describe("URL params on mount", () => {
  it("pre-populates search from URL on mount", async () => {
    mockGet.mockImplementation((key: string) => (key === "search" ? "oak" : null));
    setupTrips([
      makeTrip({ id: "t1", stops: [makeStop("456 Oak Ave")] }),
      makeTrip({ id: "t2", stops: [makeStop("123 Main St")] }),
    ]);
    render(<TripsPage />);

    const input = await screen.findByRole("textbox", { name: /search trips/i });
    expect(input).toHaveValue("oak");

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
    expect(tripLinks[0]).toHaveAttribute("href", "/dashboard/trips/t1");
  });

  it("pre-populates status from URL on mount", async () => {
    mockGet.mockImplementation((key: string) => (key === "status" ? "completed" : null));
    setupTrips([
      makeTrip({ id: "t1", status: "draft" }),
      makeTrip({ id: "t2", status: "completed" }),
    ]);
    render(<TripsPage />);

    const select = await screen.findByRole("combobox", { name: /filter by status/i });
    expect(select).toHaveValue("completed");

    const tripLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/dashboard/trips/"));
    expect(tripLinks).toHaveLength(1);
    expect(tripLinks[0]).toHaveAttribute("href", "/dashboard/trips/t2");
  });

  it("calls router.replace with no query string when both filters are default", async () => {
    setupTrips([]);
    render(<TripsPage />);
    const select = await screen.findByRole("combobox", { name: /filter by status/i });

    // Change to draft then back to all — URL should have no query string
    fireEvent.change(select, { target: { value: "draft" } });
    fireEvent.change(select, { target: { value: "all" } });

    expect(mockReplace).toHaveBeenLastCalledWith("/dashboard/trips");
  });

  it("updates URL with search param when typing", async () => {
    const user = userEvent.setup();
    setupTrips([]);
    render(<TripsPage />);
    const input = await screen.findByRole("textbox", { name: /search trips/i });

    await user.type(input, "m");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("search=m"),
      );
    });
  });
});
