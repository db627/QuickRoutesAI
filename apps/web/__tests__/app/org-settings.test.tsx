import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OrganizationSettingsPage from "@/app/dashboard/settings/organization/page";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({
    toast: {
      success: (m: string) => mockToastSuccess(m),
      error: (m: string) => mockToastError(m),
      info: (m: string) => mockToastInfo(m),
    },
  }),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const sampleOrg = {
  id: "org-1",
  name: "Acme Delivery",
  industry: "delivery",
  fleetSize: "6-20",
  address: {
    street: "1 Main St",
    city: "Boston",
    state: "MA",
    zip: "02101",
    country: "US",
  },
  ownerUid: "admin-1",
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
};

function setAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    user: { uid: "admin-1" } as never,
    role: "admin",
    orgId: "org-1",
    loading: false,
    logout: jest.fn(),
    refresh: jest.fn(),
    ...overrides,
  } as any);
}

/**
 * Build a path-routing apiFetch mock. The OrganizationSettingsPage now hosts
 * an InviteTeamSection that fetches `/invites` on mount, so the previous
 * sequential `mockResolvedValueOnce` chain is racy (its position depends on
 * which useEffect resolves first). Routing by URL is order-independent.
 */
function setupApiMock(handlers: {
  org?: any | (() => any);
  patch?: any | ((body: string) => any);
  invitesList?: any[];
} = {}) {
  let invitesList = handlers.invitesList ?? [];
  mockedApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/invites" && (!init || init.method !== "POST")) {
      return { data: invitesList } as any;
    }
    if (path.startsWith("/invites") && init?.method === "POST") {
      return undefined as any;
    }
    if (path.startsWith("/invites/") && init?.method === "DELETE") {
      return undefined as any;
    }
    if (path === "/orgs/org-1") {
      if (init?.method === "PATCH") {
        if (typeof handlers.patch === "function") {
          return (handlers.patch as any)(init.body);
        }
        if (handlers.patch !== undefined) return handlers.patch;
        throw new Error("PATCH not configured");
      }
      if (typeof handlers.org === "function") return handlers.org();
      return handlers.org;
    }
    return undefined as any;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupApiMock();
});

describe("OrganizationSettingsPage", () => {
  it("shows access denied for non-admins", () => {
    setAuth({ role: "driver", orgId: null });
    render(<OrganizationSettingsPage />);
    expect(screen.getByText(/Access denied/i)).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("shows no-org message when admin has no orgId", () => {
    setAuth({ role: "admin", orgId: null });
    render(<OrganizationSettingsPage />);
    expect(screen.getByText(/No organization linked/i)).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("loads and displays org data for admin", async () => {
    setAuth();
    setupApiMock({ org: sampleOrg });

    render(<OrganizationSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Organization name/i)).toHaveValue("Acme Delivery");
    });
    expect(screen.getByLabelText(/Street/i)).toHaveValue("1 Main St");
    expect(screen.getByLabelText(/City/i)).toHaveValue("Boston");
    expect(mockedApiFetch).toHaveBeenCalledWith("/orgs/org-1");
  });

  it("saves changes via PATCH and shows success toast", async () => {
    setAuth();
    setupApiMock({
      org: sampleOrg,
      patch: { ...sampleOrg, name: "Acme Logistics" },
    });

    render(<OrganizationSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Organization name/i)).toHaveValue("Acme Delivery");
    });

    fireEvent.change(screen.getByLabelText(/Organization name/i), {
      target: { value: "Acme Logistics" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/orgs/org-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("Acme Logistics"),
        }),
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Organization updated");
    });
  });

  it("shows error toast when save fails", async () => {
    setAuth();
    setupApiMock({
      org: sampleOrg,
      patch: () => {
        throw new Error("Network down");
      },
    });

    render(<OrganizationSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Organization name/i)).toHaveValue("Acme Delivery");
    });

    fireEvent.change(screen.getByLabelText(/Organization name/i), {
      target: { value: "Something else" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Network down");
    });
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
