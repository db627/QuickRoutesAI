"use client";

import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import type { Toast, ToastVariant } from "@/lib/toast-context";

// ── Variant config ─────────────────────────────────────────────────────────

const variantConfig: Record<
  ToastVariant,
  {
    stripClass: string;
    iconClass: string;
    Icon: React.ComponentType<{ className?: string }>;
    label: string;
  }
> = {
  success: {
    stripClass: "bg-green-500",
    iconClass: "text-green-500",
    Icon: CheckCircle2,
    label: "Success",
  },
  error: {
    stripClass: "bg-red-500",
    iconClass: "text-red-500",
    Icon: XCircle,
    label: "Error",
  },
  info: {
    stripClass: "bg-blue-500",
    iconClass: "text-blue-500",
    Icon: Info,
    label: "Info",
  },
};

// ── Props ──────────────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * ToastContainer — fixed top-right overlay that stacks toast notifications.
 * Rendered directly inside ToastProvider; receives toasts and remove callback as props.
 */
export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed right-4 top-4 z-[9999] flex flex-col gap-3 pointer-events-none"
    >
      {toasts.map((toast) => {
        const { stripClass, iconClass, Icon, label } = variantConfig[toast.variant];

        return (
          <div
            key={toast.id}
            role="alert"
            aria-label={`${label}: ${toast.message}`}
            className="pointer-events-auto flex w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            {/* Colored left accent strip */}
            <div className={`w-1 shrink-0 ${stripClass}`} aria-hidden="true" />

            {/* Content */}
            <div className="flex flex-1 items-start gap-3 px-4 py-3">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
              <p className="flex-1 text-sm text-gray-800">{toast.message}</p>
              <button
                onClick={() => onRemove(toast.id)}
                className="shrink-0 rounded text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
