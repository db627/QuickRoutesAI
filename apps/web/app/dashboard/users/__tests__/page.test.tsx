import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onSnapshot } from "firebase/firestore";
import UsersPage from "../page";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockUseAuth = jest.fn();

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

// firebase/firestore: onSnapshot calls callback synchronously so the table
// renders immediately without needing waitFor.
const MOCK_USERS = [
  {
    uid: "user-1",
    email: "alice@example.com",
    name: "Alice Smith",
    role: "admin" as const,
    status: "active" as const,
    createdAt: "2024-01-15T00:00:00.000Z",
  },
  {
    uid: "user-2",
    email: "bob@example.com",
    name: "Bob Jones",
    role: "dispatcher" as const,
    status: "active" as const,
    createdAt: "2024-02-10T00:00:00.000Z",
  },
  {
    uid: "user-3",
    email: "carol@example.com",
    name: "Carol Williams",
    role: "driver" as const,
    status: "deactivated" as const,
    createdAt: "2024-03-01T00:00:00.000Z",
  },
];

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  onSnapshot: jest.fn((_query, callback) => {
    callback({
      docs: MOCK_USERS.map((u) => ({
        id: u.uid,
        data: () => ({
          email: u.email,
          name: u.name,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
        }),
      })),
    });
    return jest.fn(); // unsubscribe
  }),
}));

jest.mock("@/lib/firebase", () => ({
  firestore: {},
  auth: { currentUser: null },
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function setupAdmin(uid = "user-1") {
  mockUseAuth.mockReturnValue({ user: { uid }, role: "admin", loading: false });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("UsersPage", () => {
  // ── Role gate redirect ───────────────────────────────────────────────────────

  describe("role gate redirect", () => {
    it("redirects a dispatcher to /dashboard", () => {
      mockUseAuth.mockReturnValue({ user: { uid: "u1" }, role: "dispatcher", loading: false });
      render(<UsersPage />);
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });

    it("redirects a driver to /dashboard", () => {
      mockUseAuth.mockReturnValue({ user: { uid: "u1" }, role: "driver", loading: false });
      render(<UsersPage />);
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });

    it("does not redirect an admin", () => {
      setupAdmin();
      render(<UsersPage />);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // ── Table rendering ──────────────────────────────────────────────────────────

  describe("table rendering", () => {
    it("shows a loading skeleton while data fetches", () => {
      setupAdmin();
      // Override: onSnapshot registers the listener but never fires the callback,
      // so dataLoading stays true and the skeleton renders.
      (onSnapshot as jest.Mock).mockImplementationOnce(() => jest.fn());

      const { container } = render(<UsersPage />);
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });

    it("renders a row for every user", () => {
      setupAdmin();
      render(<UsersPage />);
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
      expect(screen.getByText("Carol Williams")).toBeInTheDocument();
    });

    it("renders email addresses", () => {
      setupAdmin();
      render(<UsersPage />);
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
      expect(screen.getByText("bob@example.com")).toBeInTheDocument();
      expect(screen.getByText("carol@example.com")).toBeInTheDocument();
    });

    it("renders a colored role badge in each row", () => {
      setupAdmin();
      render(<UsersPage />);

      const aliceRow = screen.getByText("Alice Smith").closest("tr")!;
      const bobRow = screen.getByText("Bob Jones").closest("tr")!;
      const carolRow = screen.getByText("Carol Williams").closest("tr")!;

      // Each row's badge cell should contain the role text
      expect(aliceRow).toHaveTextContent("admin");
      expect(bobRow).toHaveTextContent("dispatcher");
      expect(carolRow).toHaveTextContent("driver");
    });

    it("renders Active and Deactivated status badges correctly", () => {
      setupAdmin();
      render(<UsersPage />);

      const activeStatuses = screen.getAllByText("Active");
      expect(activeStatuses).toHaveLength(2); // Alice + Bob

      expect(screen.getByText("Deactivated")).toBeInTheDocument(); // Carol
    });

    it("renders the created date for each user", () => {
      setupAdmin();
      render(<UsersPage />);
      // Dates are formatted with toLocaleDateString — just assert they're non-empty
      const createdCells = document
        .querySelectorAll("td:nth-child(5)");
      createdCells.forEach((cell) => {
        expect(cell.textContent).not.toBe("—");
      });
    });

    it("marks the logged-in admin's row with a 'you' badge", () => {
      setupAdmin("user-1"); // user-1 is Alice
      render(<UsersPage />);
      expect(screen.getByText("you")).toBeInTheDocument();
    });

    it("disables the role dropdown on the logged-in user's own row", () => {
      setupAdmin("user-1");
      render(<UsersPage />);
      const aliceRow = screen.getByText("Alice Smith").closest("tr")!;
      const roleSelect = aliceRow.querySelector("select");
      expect(roleSelect).toBeDisabled();
    });

    it("disables the deactivate button on the logged-in user's own row", () => {
      setupAdmin("user-1");
      render(<UsersPage />);
      const aliceRow = screen.getByText("Alice Smith").closest("tr")!;
      const deactivateBtn = aliceRow.querySelector("button");
      expect(deactivateBtn).toBeDisabled();
    });

    it("shows Reactivate instead of Deactivate for a deactivated user", () => {
      setupAdmin();
      render(<UsersPage />);
      const carolRow = screen.getByText("Carol Williams").closest("tr")!;
      expect(carolRow).toHaveTextContent("Reactivate");
    });
  });

  // ── Search filtering ─────────────────────────────────────────────────────────

  describe("search filtering", () => {
    it("filters rows by name", async () => {
      setupAdmin();
      render(<UsersPage />);

      await userEvent.type(screen.getByPlaceholderText("Search by name or email..."), "Alice");

      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.queryByText("Bob Jones")).not.toBeInTheDocument();
      expect(screen.queryByText("Carol Williams")).not.toBeInTheDocument();
    });

    it("filters rows by email", async () => {
      setupAdmin();
      render(<UsersPage />);

      await userEvent.type(screen.getByPlaceholderText("Search by name or email..."), "bob@");

      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
      expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
      expect(screen.queryByText("Carol Williams")).not.toBeInTheDocument();
    });

    it("is case-insensitive", async () => {
      setupAdmin();
      render(<UsersPage />);

      await userEvent.type(screen.getByPlaceholderText("Search by name or email..."), "CAROL");

      expect(screen.getByText("Carol Williams")).toBeInTheDocument();
      expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
    });

    it("shows an empty state when no users match the search", async () => {
      setupAdmin();
      render(<UsersPage />);

      await userEvent.type(
        screen.getByPlaceholderText("Search by name or email..."),
        "zzznomatch",
      );

      expect(screen.getByText("No users match your search.")).toBeInTheDocument();
    });
  });
});
