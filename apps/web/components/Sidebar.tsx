"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@quickroutesai/shared";

interface SidebarProps {
  role: UserRole | null;
  onLogout: () => void;
}

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Trips", href: "/dashboard/trips" },
];

export default function Sidebar({ role, onLogout }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
      <div className="p-5">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">QuickRoutesAI</h2>
        <p className="mt-0.5 text-xs text-gray-400">
          {role === "admin" ? "Admin" : "Dispatcher"} Dashboard
        </p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-brand-50 font-medium text-brand-600"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <button
          onClick={onLogout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
