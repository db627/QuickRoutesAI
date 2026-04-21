import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MultiDriverOptimizer from "@/components/MultiDriverOptimizer";
import { onSnapshot } from "firebase/firestore";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn() } }),
}));

const mockApiFetch = jest.fn();
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a>,
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;

function fireDrivers(drivers: { uid: string; isOnline: boolean }[]) {
  mockOnSnapshot.mockImplementation((_: any, cb: any) => {
    cb({ docs: drivers.map((d) => ({ id: d.uid, data: () => d })) });
    return jest.fn();
  });
}

describe("MultiDriverOptimizer", () => {
  const onClose = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it("shows no drivers message when no one is online", async () => {
    fireDrivers([]);
    render(<MultiDriverOptimizer onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("No drivers online")).toBeInTheDocument());
  });

  it("renders driver checkboxes for online drivers", async () => {
    mockApiFetch.mockResolvedValue(null);
    fireDrivers([
      { uid: "d1", isOnline: true },
      { uid: "d2", isOnline: true },
    ]);

    render(<MultiDriverOptimizer onClose={onClose} />);

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  });

  it("calls onClose when the close button is clicked", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);
    render(<MultiDriverOptimizer onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls apiFetch with selected drivers and stop addresses on submit", async () => {
    mockApiFetch.mockResolvedValue(null);
    fireDrivers([{ uid: "d1", isOnline: true }]);

    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/ai/multi-assign") {
        return Promise.resolve({
          plans: [
            {
              driverId: "d1",
              driverName: "Driver One",
              tripId: "trip-abc",
              stops: [{ stopId: "s1", address: "123 Main St", lat: 0, lng: 0, sequence: 0, contactName: "", notes: "" }],
              reasoning: "Only one driver.",
            },
          ],
          overallReasoning: "Clustered nearby stops.",
        });
      }
      return Promise.resolve(null);
    });

    render(<MultiDriverOptimizer onClose={onClose} />);

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "123 Main St, New York" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run Optimization" }));

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/ai/multi-assign",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows per-driver plans after a successful optimization", async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/ai/multi-assign") {
        return Promise.resolve({
          plans: [
            {
              driverId: "d1",
              driverName: "Alice",
              tripId: "trip-1",
              stops: [{ stopId: "s1", address: "100 Oak Ave", lat: 0, lng: 0, sequence: 0, contactName: "", notes: "" }],
              reasoning: "Geographic cluster.",
            },
          ],
          overallReasoning: "Stops distributed by proximity.",
        });
      }
      return Promise.resolve(null);
    });

    fireDrivers([{ uid: "d1", isOnline: true }]);
    render(<MultiDriverOptimizer onClose={onClose} />);

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "100 Oak Ave" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Optimization" }));

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("100 Oak Ave")).toBeInTheDocument();
    expect(screen.getByText("View Trip")).toBeInTheDocument();
    expect(screen.getByText("Stops distributed by proximity.")).toBeInTheDocument();
  });

  it("unsubscribes from Firestore on unmount", () => {
    const unsub = jest.fn();
    mockOnSnapshot.mockImplementation(() => unsub);
    const { unmount } = render(<MultiDriverOptimizer onClose={onClose} />);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
