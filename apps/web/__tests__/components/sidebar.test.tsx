import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "@/components/Sidebar";
import { usePathname } from "next/navigation";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

jest.mock("next/link", () => {
  return function MockLink({
    href,
    className,
    title,
    children,
  }: {
    href: string;
    className?: string;
    title?: string;
    children: unknown;
  }) {
    return (
      <a href={href} className={className} title={title}>
        {children}
      </a>
    );
  };
});

const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe("Sidebar", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/dashboard");
  });

  it("shows mobile backdrop when drawer is open and closes on backdrop click", async () => {
    const onDrawerClose = jest.fn();
    const user = userEvent.setup();

    const { container } = render(
      <Sidebar
        role="admin"
        onLogout={jest.fn()}
        isDrawerOpen
        onDrawerClose={onDrawerClose}
      />,
    );

    const backdrop = container.querySelector('div[aria-hidden="true"]');
    expect(backdrop).toBeInTheDocument();

    await user.click(backdrop as HTMLElement);
    expect(onDrawerClose).toHaveBeenCalledTimes(1);
  });

  it("highlights trips nav item for nested trip routes", () => {
    mockedUsePathname.mockReturnValue("/dashboard/trips/abc");

    render(
      <Sidebar
        role="admin"
        onLogout={jest.fn()}
        isDrawerOpen={false}
        onDrawerClose={jest.fn()}
      />,
    );

    const dashboardLink = screen.getByTitle("Dashboard");
    const tripsLink = screen.getByTitle("Trips");

    expect(tripsLink.className).toContain("bg-brand-50");
    expect(dashboardLink.className).toContain("text-gray-500");
  });

  it("calls onLogout when sign out is clicked", async () => {
    const onLogout = jest.fn();
    const user = userEvent.setup();

    render(
      <Sidebar
        role="dispatcher"
        onLogout={onLogout}
        isDrawerOpen={false}
        onDrawerClose={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
