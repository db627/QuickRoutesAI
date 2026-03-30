"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@quickroutesai/shared";

interface SidebarProps {
  role: UserRole | null;
  onLogout: () => void;
  isDrawerOpen: boolean;
  onDrawerClose: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: UserRole[]; // if set, only shown to users with one of these roles
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    label: "Trips",
    href: "/dashboard/trips",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
  },
  {
    label: "Reports",
    href: "/dashboard/reports",
    roles: ["dispatcher", "admin"],
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
      </svg>
    ),
  },
  {
    label: "Users",
    href: "/dashboard/users",
    roles: ["admin"],
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
];

const LogoutIcon = () => (
  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
  </svg>
);

export default function Sidebar({ role, onLogout, isDrawerOpen, onDrawerClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onDrawerClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          "flex flex-col border-r border-gray-200 bg-white",
          // Mobile: fixed overlay drawer, slides in/out
          "fixed inset-y-0 left-0 z-50 w-60",
          "transition-transform duration-200 ease-in-out",
          isDrawerOpen ? "translate-x-0" : "-translate-x-full",
          // Tablet+: back to normal flow, always visible, no animation
          "md:static md:inset-y-auto md:z-auto md:translate-x-0 md:transition-none",
          // Tablet: narrow | Desktop: full
          "md:w-16 lg:w-60",
        ].join(" ")}
      >
        {/* Logo */}
        <div className="p-5 md:px-2 md:py-4 lg:p-5">
          <h2 className="block md:hidden lg:block text-lg font-bold tracking-tight text-gray-900">
            QuickRoutesAI
          </h2>
          <span className="hidden md:block lg:hidden text-center text-lg font-bold text-gray-900">Q</span>
          <p className="block md:hidden lg:block mt-0.5 text-xs text-gray-400">
            {role === "admin" ? "Admin" : "Dispatcher"} Dashboard
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 md:px-1 lg:px-3">
          {navItems.filter((item) => !item.roles || (role !== null && item.roles.includes(role))).map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  "md:justify-center md:px-2 lg:justify-start lg:px-3",
                  active
                    ? "bg-brand-50 font-medium text-brand-600"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
                ].join(" ")}
                title={item.label}
              >
                {item.icon}
                <span className="block md:hidden lg:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="border-t border-gray-200 p-4 md:p-2 lg:p-4">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 md:justify-center md:px-2 lg:justify-start lg:px-3"
            title="Sign Out"
          >
            <LogoutIcon />
            <span className="block md:hidden lg:block">Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
