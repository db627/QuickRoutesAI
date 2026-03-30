import { render, screen, waitFor } from "@testing-library/react";
import DriverList from "@/components/DriverList";
import { onSnapshot } from "firebase/firestore";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;

function makeDriverDoc(uid: string, name?: string) {
  return {
    id: uid,
    data: () => ({
      isOnline: true,
      lastLocation: { lat: 40.71, lng: -74.01 },
      lastSpeedMps: 0,
      lastHeading: 0,
      updatedAt: new Date().toISOString(),
    }),
  };
}

describe("DriverList", () => {
  it("shows 4 skeleton rows while drivers subscription has not fired", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);

    const { container } = render(<DriverList />);

    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);

    // The divide-y list container should have exactly 4 skeleton children
    const list = container.querySelector(".divide-y");
    expect(list?.children).toHaveLength(4);

    // Empty state and real driver rows must not appear
    expect(screen.queryByText("No drivers online")).not.toBeInTheDocument();
  });

  it("shows driver rows after drivers subscription fires", async () => {
    // 1st call = drivers (sets loading=false), 2nd call = userNames (ignored)
    let callCount = 0;
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      callCount++;
      if (callCount === 1) {
        cb({ docs: [makeDriverDoc("uid-abc"), makeDriverDoc("uid-def")] });
      }
      return jest.fn() as any;
    });

    render(<DriverList />);

    await waitFor(() => {
      // Without userNames, component falls back to showing the uid
      expect(screen.getByText("uid-abc")).toBeInTheDocument();
    });

    expect(screen.getByText("uid-def")).toBeInTheDocument();
    expect(screen.queryByText("No drivers online")).not.toBeInTheDocument();
  });

  it("shows empty state when drivers subscription fires with no drivers", async () => {
    let callCount = 0;
    mockOnSnapshot.mockImplementation((_: any, cb: any) => {
      callCount++;
      if (callCount === 1) {
        cb({ docs: [] });
      }
      return jest.fn() as any;
    });

    render(<DriverList />);

    await waitFor(() => {
      expect(screen.getByText("No drivers online")).toBeInTheDocument();
    });
  });
});
