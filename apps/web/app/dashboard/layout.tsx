"use client";

import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import NoOrgNotice from "@/components/NoOrgNotice";

const HamburgerIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, orgId, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (role === "admin" && !orgId) {
      router.replace("/onboarding");
    }
  }, [user, role, orgId, loading, router]);

  // Close drawer whenever the route changes
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) return null;
  if (role === "admin" && !orgId) return null; // redirecting
  if (role !== "admin" && !orgId) return <NoOrgNotice />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          aria-label="Open navigation menu"
        >
          <HamburgerIcon />
        </button>
        <span className="font-bold text-gray-900">QuickRoutesAI</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          role={role}
          onLogout={logout}
          isDrawerOpen={drawerOpen}
          onDrawerClose={() => setDrawerOpen(false)}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
