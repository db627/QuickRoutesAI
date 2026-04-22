"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";
import ToastContainer from "@/components/ToastContainer";

// ── Types ──────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, variant: ToastVariant) => void;
  removeToast: (id: string) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
});

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_TOASTS = 3;
const DISMISS_MS = 5000;

// ── Provider ───────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, variant: ToastVariant) => {
    const id = Math.random().toString(36).slice(2, 9);

    setToasts((prev) => {
      const next = [...prev, { id, message, variant }];
      // If we exceed MAX_TOASTS, drop the oldest entries from the front
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });

    // Auto-dismiss after DISMISS_MS — directly updates state so the timer
    // is harmless if the toast was already manually dismissed beforehand.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * useToast — returns a `toast` object with success / error / info helpers.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast.success("Trip created");
 *   toast.error("Something went wrong");
 *   toast.info("Driver is en route");
 */
export function useToast() {
  const { addToast } = useContext(ToastContext);

  const toast = useMemo(
    () => ({
      success: (message: string) => addToast(message, "success"),
      error: (message: string) => addToast(message, "error"),
      info: (message: string) => addToast(message, "info"),
    }),
    [addToast],
  );

  return { toast };
}
