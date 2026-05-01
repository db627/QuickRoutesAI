import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OnboardingPage from "@/app/onboarding/page";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
  }),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const validOrgBasics = { name: "Acme", industry: "delivery" as const, fleetSize: "1-5" as const };
const validAddress = {
  street: "1 Main St",
  city: "Boston",
  state: "MA",
  zip: "02101",
  country: "US",
};
const validProfile = { name: "Alice", phone: "5551234567", timezone: "America/New_York" };

function setupAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    user: { uid: "u1" } as never,
    role: "admin",
    orgId: null,
    loading: false,
    logout: jest.fn(),
    refresh: jest.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push: jest.fn(), replace: jest.fn() } as any);
});

describe("OnboardingPage", () => {
  it("starts at step 1 when no saved progress", async () => {
    setupAuth();
    mockedApiFetch.mockResolvedValueOnce({ wizardProgress: null });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Organization name/i)).toBeInTheDocument();
    });
  });

  it("resumes at step 2 when progress has currentStep=2", async () => {
    setupAuth();
    mockedApiFetch.mockResolvedValueOnce({
      wizardProgress: {
        currentStep: 2,
        data: { orgBasics: validOrgBasics },
        updatedAt: "2026-04-19T00:00:00.000Z",
      },
    });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Street/i)).toBeInTheDocument();
    });
  });

  it("PATCHes wizard-progress on Next and advances", async () => {
    setupAuth();
    mockedApiFetch
      .mockResolvedValueOnce({ wizardProgress: null }) // initial GET
      .mockResolvedValueOnce(undefined); // PATCH

    render(<OnboardingPage />);

    await waitFor(() => screen.getByLabelText(/Organization name/i));

    fireEvent.change(screen.getByLabelText(/Organization name/i), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText(/Industry/i), {
      target: { value: "delivery" },
    });
    fireEvent.change(screen.getByLabelText(/Fleet size/i), {
      target: { value: "1-5" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/me/wizard-progress",
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(screen.getByLabelText(/Street/i)).toBeInTheDocument();
    });
  });

  it("submits POST /orgs on final Next and shows success screen", async () => {
    const refresh = jest.fn();
    setupAuth({ refresh });
    mockedApiFetch
      .mockResolvedValueOnce({
        wizardProgress: {
          currentStep: 3,
          data: { orgBasics: validOrgBasics, address: validAddress },
          updatedAt: "2026-04-19T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        org: { id: "org-1", name: "Acme" },
        user: { uid: "u1", orgId: "org-1" },
      });

    render(<OnboardingPage />);

    await waitFor(() => screen.getByLabelText(/Your name/i));

    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: validProfile.name } });
    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: validProfile.phone } });
    fireEvent.change(screen.getByLabelText(/Timezone/i), { target: { value: validProfile.timezone } });

    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/orgs",
        expect.objectContaining({ method: "POST" }),
      );
      expect(refresh).toHaveBeenCalled();
      expect(screen.getByText(/You're all set/i)).toBeInTheDocument();
    });
  });

  it("non-admin is redirected to /dashboard", async () => {
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ push: jest.fn(), replace } as any);
    setupAuth({ role: "driver" });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
  });
});
