import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DriverDetailPanel from "@/components/DriverDetailPanel";

// ── Firebase mocks ────────────────────────────────────────────────────────────

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

// Each onSnapshot call immediately invokes its callback with a controlled
// snapshot, then returns an unsubscribe no-op.
type SnapshotCallback = (snap: unknown) => void;

let onSnapshotImpl: (ref: unknown, cb: SnapshotCallback) => () => void;

jest.mock("firebase/firestore", () => ({
  doc: jest.fn((_db: unknown, col: string, id: string) => ({ col, id })),
  collection: jest.fn((_db: unknown, col: string) => ({ col })),
  query: jest.fn((...args: unknown[]) => args),
  where: jest.fn(),
  onSnapshot: jest.fn((...args: unknown[]) => {
    // The real firebase/firestore mock delegates to the per-test implementation
    const cb = args[1] as SnapshotCallback;
    onSnapshotImpl(args[0], cb);
    return () => {};
  }),
}));

jest.mock("next/link", () => {
  return function MockLink({
    href,
    children,
    className,
    "data-testid": testId,
  }: {
    href: string;
    children: unknown;
    className?: string;
    "data-testid"?: string;
  }) {
    return (
      <a href={href} className={className} data-testid={testId}>
        {children}
      </a>
    );
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const DRIVER_UID = "driver-abc-123";

const mockDriverDoc = {
  isOnline: true,
  lastLocation: { lat: 40.7128, lng: -74.006 },
  lastSpeedMps: 10,
  lastHeading: 90,
  updatedAt: new Date("2024-01-15T10:30:00Z").toISOString(),
};

const mockProfileDoc = {
  uid: DRIVER_UID,
  name: "Alice Smith",
  email: "alice@example.com",
  role: "driver",
  createdAt: new Date("2024-01-01").toISOString(),
};

const mockTrip = {
  driverId: DRIVER_UID,
  createdBy: "dispatcher-1",
  status: "in_progress",
  stops: [],
  route: null,
  createdAt: new Date("2024-01-15").toISOString(),
  updatedAt: new Date("2024-01-15").toISOString(),
};

// onSnapshot is called in order: driver doc, user doc, trip query
// Build an impl that returns the provided data for each call in sequence.
function setupOnSnapshot({
  driver = mockDriverDoc,
  profile = mockProfileDoc,
  tripDocs = [{ id: "trip-xyz", data: mockTrip }],
}: {
  driver?: typeof mockDriverDoc | null;
  profile?: typeof mockProfileDoc | null;
  tripDocs?: { id: string; data: typeof mockTrip }[];
} = {}) {
  let callCount = 0;
  onSnapshotImpl = (_ref, cb) => {
    callCount++;
    if (callCount === 1) {
      // drivers/{id} doc
      cb(
        driver
          ? { exists: () => true, id: DRIVER_UID, data: () => driver }
          : { exists: () => false },
      );
    } else if (callCount === 2) {
      // users/{id} doc
      cb(
        profile
          ? { exists: () => true, data: () => profile }
          : { exists: () => false },
      );
    } else {
      // trips query
      cb({
        docs: tripDocs.map((t) => ({
          id: t.id,
          data: () => t.data,
        })),
      });
    }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DriverDetailPanel", () => {
  beforeEach(() => {
    setupOnSnapshot();
  });

  describe("visibility", () => {
    it("is hidden (translate-x-full) when driverId is null", () => {
      render(<DriverDetailPanel driverId={null} onClose={jest.fn()} />);

      const panel = screen.getByRole("dialog", { hidden: true });
      expect(panel.className).toContain("translate-x-full");
    });

    it("is visible (translate-x-0) when driverId is provided", async () => {
      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      const panel = screen.getByRole("dialog");
      expect(panel.className).toContain("translate-x-0");
      expect(panel.className).not.toContain("translate-x-full");
    });

    it("does not render a backdrop when driverId is null", () => {
      render(<DriverDetailPanel driverId={null} onClose={jest.fn()} />);
      expect(screen.queryByTestId("panel-backdrop")).not.toBeInTheDocument();
    });

    it("renders a backdrop when driverId is provided", async () => {
      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });
      expect(screen.getByTestId("panel-backdrop")).toBeInTheDocument();
    });
  });

  describe("close behaviour", () => {
    it("calls onClose when the close button is clicked", async () => {
      const onClose = jest.fn();
      const user = userEvent.setup();

      await act(async () => {
        render(<DriverDetailPanel driverId={DRIVER_UID} onClose={onClose} />);
      });

      await user.click(screen.getByRole("button", { name: "Close panel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when the backdrop is clicked", async () => {
      const onClose = jest.fn();
      const user = userEvent.setup();

      await act(async () => {
        render(<DriverDetailPanel driverId={DRIVER_UID} onClose={onClose} />);
      });

      await user.click(screen.getByTestId("panel-backdrop"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("data display", () => {
    it("shows driver name and email from the user profile", async () => {
      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      expect(screen.getByTestId("driver-name")).toHaveTextContent("Alice Smith");
      expect(screen.getByTestId("driver-email")).toHaveTextContent(
        "alice@example.com",
      );
    });

    it("falls back to driverId when profile has no name", async () => {
      setupOnSnapshot({ profile: null });

      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      expect(screen.getByTestId("driver-name")).toHaveTextContent(DRIVER_UID);
    });

    it("shows a green indicator for an online driver", async () => {
      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      const indicator = screen.getByTestId("online-indicator");
      expect(indicator.className).toContain("bg-green-500");
    });

    it("shows a gray indicator for an offline driver", async () => {
      setupOnSnapshot({ driver: { ...mockDriverDoc, isOnline: false } });

      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      const indicator = screen.getByTestId("online-indicator");
      expect(indicator.className).toContain("bg-gray-300");
    });

    it("shows last known location coordinates", async () => {
      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      expect(screen.getByTestId("driver-location")).toHaveTextContent(
        "40.71280, -74.00600",
      );
    });

    it("shows 'Unknown' when lastLocation is null", async () => {
      setupOnSnapshot({ driver: { ...mockDriverDoc, lastLocation: null } });

      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      expect(screen.getByTestId("driver-location")).toHaveTextContent("Unknown");
    });
  });

  describe("active trip", () => {
    it("shows trip ID as a link when driver has an active trip", async () => {
      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      const link = screen.getByTestId("trip-link");
      expect(link).toHaveTextContent("trip-xyz");
      expect(link).toHaveAttribute("href", "/dashboard/trips/trip-xyz");
    });

    it("shows 'No active trip' when driver has no active trip", async () => {
      setupOnSnapshot({ tripDocs: [] });

      await act(async () => {
        render(
          <DriverDetailPanel driverId={DRIVER_UID} onClose={jest.fn()} />,
        );
      });

      expect(screen.getByTestId("no-trip")).toHaveTextContent("No active trip");
    });
  });
});
