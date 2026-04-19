import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DashboardLayout from "@/app/dashboard/layout";
import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock("@/components/Sidebar", () => ({
  __esModule: true,
  default: ({
    isDrawerOpen,
    onDrawerClose,
  }: {
    isDrawerOpen: boolean;
    onDrawerClose: () => void;
  }) => (
    <div data-testid="sidebar" data-open={String(isDrawerOpen)}>
      <button onClick={onDrawerClose}>Close drawer</button>
    </div>
  ),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

describe("DashboardLayout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({ replace: jest.fn() } as any);
    mockedUsePathname.mockReturnValue("/dashboard");
    mockedUseAuth.mockReturnValue({
      user: { uid: "u1" } as never,
      role: "admin",
      orgId: null,
      loading: false,
      logout: jest.fn(),
      refresh: jest.fn(),
    });
  });

  it("opens drawer from hamburger button and closes on route change", async () => {
    const { rerender } = render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "true");

    mockedUsePathname.mockReturnValue("/dashboard/trips");
    rerender(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "false");
    });
  });

  it("uses overflow-safe container and mobile-only hamburger header classes", () => {
    const { container } = render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    const header = container.querySelector("header");
    expect(header?.className).toContain("md:hidden");

    const overflowRow = container.querySelector("div.flex.flex-1.overflow-hidden");
    expect(overflowRow).toBeInTheDocument();
  });
});
