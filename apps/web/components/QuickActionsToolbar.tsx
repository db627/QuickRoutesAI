"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useQuickActions } from "@/lib/quick-actions-context";

// ── Icons ─────────────────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const MapIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
  </svg>
);

const SparklesIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

// ── Action button ─────────────────────────────────────────────────────────────

interface Action {
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}

function ActionButton({ action }: { action: Action }) {
  return (
    <button
      onClick={action.onClick}
      title={`${action.label} (${action.shortcut})`}
      className={[
        "group flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
        action.primary
          ? "bg-brand-600 text-white hover:bg-brand-700"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
      ].join(" ")}
    >
      {action.icon}
      <span className="hidden sm:inline">{action.label}</span>
      <kbd
        className={[
          "hidden rounded px-1 py-0.5 text-[10px] font-semibold leading-none sm:inline-block",
          action.primary
            ? "bg-brand-500 text-brand-100"
            : "bg-gray-200 text-gray-500 group-hover:bg-gray-300",
        ].join(" ")}
      >
        {action.shortcut}
      </kbd>
    </button>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

export default function QuickActionsToolbar() {
  const { role } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const {
    showTripForm,
    openNewTrip,
    closeNewTrip,
    showMultiOptimizer,
    openMultiOptimizer,
    closeMultiOptimizer,
  } = useQuickActions();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "n":
          openNewTrip();
          break;
        case "m":
          router.push("/dashboard");
          break;
        case "s":
          router.push("/dashboard/reports");
          break;
        case "d":
          if (pathname === "/dashboard") openMultiOptimizer();
          break;
        case "b":
          if (pathname.startsWith("/dashboard/trips/") && pathname !== "/dashboard/trips") {
            router.push("/dashboard/trips");
          }
          break;
        case "escape":
          if (showTripForm) closeNewTrip();
          if (showMultiOptimizer) closeMultiOptimizer();
          break;
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [
    pathname,
    showTripForm,
    showMultiOptimizer,
    openNewTrip,
    closeNewTrip,
    openMultiOptimizer,
    closeMultiOptimizer,
    router,
  ]);

  if (role !== "dispatcher" && role !== "admin") return null;

  const mainActions: Action[] = [
    {
      label: "New Trip",
      shortcut: "N",
      icon: <PlusIcon />,
      onClick: openNewTrip,
      primary: true,
    },
    {
      label: "View Map",
      shortcut: "M",
      icon: <MapIcon />,
      onClick: () => router.push("/dashboard"),
    },
    {
      label: "Today's Summary",
      shortcut: "S",
      icon: <SparklesIcon />,
      onClick: () => router.push("/dashboard/reports"),
    },
  ];

  // Contextual actions change based on the current page.
  const contextualActions: Action[] = [];

  if (pathname === "/dashboard") {
    contextualActions.push({
      label: "Multi-Driver",
      shortcut: "D",
      icon: <UsersIcon />,
      onClick: openMultiOptimizer,
    });
  }

  if (
    pathname.startsWith("/dashboard/trips/") &&
    pathname !== "/dashboard/trips"
  ) {
    contextualActions.push({
      label: "All Trips",
      shortcut: "B",
      icon: <ArrowLeftIcon />,
      onClick: () => router.push("/dashboard/trips"),
    });
  }

  return (
    <div
      role="toolbar"
      aria-label="Quick actions"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-0.5 rounded-2xl border border-gray-200 bg-white px-2 py-1.5 shadow-lg shadow-gray-300/40"
    >
      {mainActions.map((action) => (
        <ActionButton key={action.label} action={action} />
      ))}

      {contextualActions.length > 0 && (
        <>
          <div className="mx-1.5 h-5 w-px bg-gray-200" aria-hidden />
          {contextualActions.map((action) => (
            <ActionButton key={action.label} action={action} />
          ))}
        </>
      )}
    </div>
  );
}
