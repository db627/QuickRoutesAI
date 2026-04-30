import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersPage from "@/app/dashboard/users/page";
import { onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { ToastProvider } from "@/lib/toast-context";

jest.mock("@/lib/firebase", () => ({ firestore: {}, auth: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  onSnapshot: jest.fn(),
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
}));

const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

const adminOrg = "org-alpha";
const adminUid = "admin-1";

function makeUserDoc(uid: string, data: Record<string, unknown>) {
  return { id: uid, data: () => data };
}

function renderPage() {
  return render(
    <ToastProvider>
      <UsersPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace: jest.fn() } as any);
  mockedUseAuth.mockReturnValue({
    user: { uid: adminUid } as any,
    role: "admin",
    orgId: adminOrg,
    loading: false,
    logout: jest.fn(),
    refresh: jest.fn(),
  });
});

describe("UsersPage — unassigned users section", () => {
  it("renders unassigned users fetched from /users/unassigned", async () => {
    // onSnapshot fires once with one in-org user (admin themselves).
    mockOnSnapshot.mockImplementation((_ref: any, cb: any) => {
      cb({
        docs: [
          makeUserDoc(adminUid, {
            email: "admin@x.com",
            name: "Admin Person",
            role: "admin",
            orgId: adminOrg,
            createdAt: new Date().toISOString(),
          }),
        ],
      });
      return jest.fn();
    });

    mockedApiFetch.mockResolvedValueOnce({
      data: [
        {
          uid: "u-driver",
          name: "New Driver",
          email: "driver@x.com",
          role: "driver",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: /unassigned users/i })).toBeInTheDocument();
    expect(await screen.findByText("New Driver")).toBeInTheDocument();
    expect(screen.getByText("driver@x.com")).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith("/users/unassigned");
  });

  it("clicks 'Add to my organization' and PATCHes /users/:id with the admin's orgId", async () => {
    const user = userEvent.setup();

    mockOnSnapshot.mockImplementation((_ref: any, cb: any) => {
      cb({ docs: [] });
      return jest.fn();
    });

    mockedApiFetch.mockImplementation(async (path: string, init?: any) => {
      if (path === "/users/unassigned" && !init) {
        return {
          data: [
            {
              uid: "u-driver",
              name: "New Driver",
              email: "driver@x.com",
              role: "driver",
              createdAt: new Date().toISOString(),
            },
          ],
        } as any;
      }
      return { ok: true } as any;
    });

    renderPage();

    const button = await screen.findByRole("button", { name: /add to my organization/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/users/u-driver",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ orgId: adminOrg }),
        }),
      );
    });
  });
});
