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

beforeEach(() => {
  jest.clearAllMocks();
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
    mockedApiFetch.mockResolvedValueOnce(sampleOrg);

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
    mockedApiFetch
      .mockResolvedValueOnce(sampleOrg) // initial GET
      .mockResolvedValueOnce({ ...sampleOrg, name: "Acme Logistics" }); // PATCH

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
    mockedApiFetch
      .mockResolvedValueOnce(sampleOrg)
      .mockRejectedValueOnce(new Error("Network down"));

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
