"use client";

import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import NoOrgNotice from "@/components/NoOrgNotice";
import NotificationBell from "@/components/NotificationBell";
import { QuickActionsProvider, useQuickActions } from "@/lib/quick-actions-context";
import QuickActionsToolbar from "@/components/QuickActionsToolbar";
import TripForm from "@/components/TripForm";
import MultiDriverOptimizer from "@/components/MultiDriverOptimizer";

const HamburgerIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, role, orgId, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { showTripForm, closeNewTrip, showMultiOptimizer, closeMultiOptimizer } = useQuickActions();

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
      {/* Top bar — hamburger on mobile, bell on all sizes */}
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 md:hidden"
            aria-label="Open navigation menu"
          >
            <HamburgerIcon />
          </button>
          <span className="font-bold text-gray-900 md:hidden">QuickRoutesAI</span>
        </div>
        <NotificationBell />
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

      {/* Floating quick actions toolbar — dispatcher/admin only */}
      <QuickActionsToolbar />

      {/* New Trip modal — triggered from toolbar or any page */}
      {showTripForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 pt-16"
          onClick={(e) => { if (e.target === e.currentTarget) closeNewTrip(); }}
        >
          <div className="w-full max-w-2xl">
            <TripForm onCreated={closeNewTrip} />
          </div>
        </div>
      )}

      {/* Multi-Driver Optimizer modal — triggered from toolbar or dashboard */}
      {showMultiOptimizer && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 pt-16"
          onClick={(e) => { if (e.target === e.currentTarget) closeMultiOptimizer(); }}
        >
          <div className="w-full max-w-3xl">
            <MultiDriverOptimizer onClose={closeMultiOptimizer} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QuickActionsProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </QuickActionsProvider>
  );
}
