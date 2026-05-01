import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import NotificationBell from "@/components/NotificationBell";
import { onSnapshot, updateDoc, writeBatch } from "firebase/firestore";

jest.mock("@/lib/firebase", () => ({ firestore: {} }));

jest.mock("@/lib/auth-context", () => {
  const user = { uid: "user-1" };
  return { useAuth: () => ({ user }) };
});

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
  updateDoc: jest.fn(),
  writeBatch: jest.fn(),
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockUpdateDoc = updateDoc as jest.MockedFunction<typeof updateDoc>;
const mockWriteBatch = writeBatch as jest.MockedFunction<typeof writeBatch>;

function makeNotification(overrides: Partial<{
  id: string; type: string; message: string; read: boolean; createdAt: string;
}> = {}) {
  return {
    id: "notif-1",
    type: "trip_assigned",
    message: "Trip assigned to Driver A",
    read: false,
    userId: "user-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function fireListener(notifications: ReturnType<typeof makeNotification>[]) {
  mockOnSnapshot.mockImplementation((_: any, cb: any) => {
    cb({
      docs: notifications.map((n) => ({
        id: n.id,
        data: () => {
          const { id: _id, ...rest } = n;
          return rest;
        },
      })),
    });
    return jest.fn();
  });
}

describe("NotificationBell", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the bell button", () => {
    mockOnSnapshot.mockImplementation(() => jest.fn() as any);
    render(<NotificationBell />);
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("shows no badge when there are no unread notifications", async () => {
    fireListener([makeNotification({ read: true })]);
    render(<NotificationBell />);
    await waitFor(() => expect(screen.queryByText("1")).not.toBeInTheDocument());
  });

  it("shows unread count badge for unread notifications", async () => {
    fireListener([
      makeNotification({ id: "n1", read: false }),
      makeNotification({ id: "n2", read: false }),
    ]);

    render(<NotificationBell />);

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("opens dropdown and shows notifications on bell click", async () => {
    fireListener([makeNotification({ message: "Trip assigned to Driver A" })]);

    render(<NotificationBell />);

    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() =>
      expect(screen.getByText("Trip assigned to Driver A")).toBeInTheDocument(),
    );
    expect(screen.getByText("Trip Assigned")).toBeInTheDocument();
  });

  it("shows empty state when there are no notifications", async () => {
    fireListener([]);

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() =>
      expect(screen.getByText("No notifications")).toBeInTheDocument(),
    );
  });

  it("marks a notification as read when clicked", async () => {
    mockUpdateDoc.mockResolvedValue(undefined);
    fireListener([makeNotification({ id: "notif-1", message: "Trip assigned to Driver A" })]);

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() =>
      expect(screen.getByText("Trip assigned to Driver A")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Trip assigned to Driver A"));

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { read: true });
  });

  it("marks all notifications as read via batch", async () => {
    const mockCommit = jest.fn().mockResolvedValue(undefined);
    const mockBatchUpdate = jest.fn();
    mockWriteBatch.mockReturnValue({ update: mockBatchUpdate, commit: mockCommit } as any);

    fireListener([
      makeNotification({ id: "n1", read: false }),
      makeNotification({ id: "n2", read: false }),
    ]);

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => expect(screen.getByText("Mark all as read")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Mark all as read"));

    await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes from Firestore on unmount", () => {
    const unsub = jest.fn();
    mockOnSnapshot.mockImplementation(() => unsub);

    const { unmount } = render(<NotificationBell />);
    unmount();

    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
