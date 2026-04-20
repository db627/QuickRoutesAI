"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TripStop } from "@quickroutesai/shared";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";

interface DraggableStopListProps {
  tripId: string;
  stops: TripStop[];
  /** When false, the list is read-only (no reorder controls shown). */
  canOverride: boolean;
  /** Fires after a successful override save. */
  onSaved?: () => void;
}

/**
 * Interactive stop list for manual route override.
 *
 * - Enter "Reorder manually" mode to rearrange stops via drag-and-drop OR
 *   up/down buttons (up/down buttons are the primary path for keyboard
 *   users + jsdom test coverage; HTML5 DnD is the pointer affordance).
 * - On "Save reordering", prompts the user for a required reason.
 * - Posts to /trips/:id/override with { stopIds, reason }.
 * - Does NOT mutate the server until save.
 */
export default function DraggableStopList({
  tripId,
  stops,
  canOverride,
  onSaved,
}: DraggableStopListProps) {
  const { toast } = useToast();

  const initialOrder = useMemo(
    () => [...stops].sort((a, b) => a.sequence - b.sequence),
    [stops],
  );

  const [reordering, setReordering] = useState(false);
  const [localStops, setLocalStops] = useState<TripStop[]>(initialOrder);
  const [reasonPromptOpen, setReasonPromptOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Sync local order with incoming props when not actively reordering.
  useEffect(() => {
    if (!reordering) setLocalStops(initialOrder);
  }, [initialOrder, reordering]);

  const enterReorderMode = () => {
    setLocalStops(initialOrder);
    setReordering(true);
  };

  const cancelReorder = () => {
    setReordering(false);
    setReasonPromptOpen(false);
    setReason("");
    setLocalStops(initialOrder);
  };

  const move = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    if (toIdx < 0 || toIdx >= localStops.length) return;
    setLocalStops((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const isOrderChanged = useMemo(() => {
    if (localStops.length !== initialOrder.length) return true;
    for (let i = 0; i < localStops.length; i++) {
      if (localStops[i].stopId !== initialOrder[i].stopId) return true;
    }
    return false;
  }, [localStops, initialOrder]);

  const openReasonPrompt = () => {
    if (!isOrderChanged) {
      toast.info?.("Order unchanged — nothing to save");
      return;
    }
    setReasonPromptOpen(true);
  };

  const submitOverride = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Reason is required");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/trips/${tripId}/override`, {
        method: "POST",
        body: JSON.stringify({
          stopIds: localStops.map((s) => s.stopId),
          reason: trimmed,
        }),
      });
      toast.success("Route manually overridden");
      setReasonPromptOpen(false);
      setReordering(false);
      setReason("");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Override failed");
    } finally {
      setSubmitting(false);
    }
  };

  // HTML5 drag handlers
  const onDragStart = (idx: number) => (e: React.DragEvent<HTMLLIElement>) => {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(idx));
    } catch {
      /* jsdom may throw */
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDrop = (idx: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (dragIndex === null) return;
    move(dragIndex, idx);
    setDragIndex(null);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <h2 className="font-semibold text-gray-900">
          Stops ({localStops.length})
        </h2>
        {canOverride && !reordering && (
          <button
            onClick={enterReorderMode}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900"
            aria-label="Reorder manually"
          >
            Reorder manually
          </button>
        )}
        {canOverride && reordering && (
          <div className="flex gap-2">
            <button
              onClick={cancelReorder}
              disabled={submitting}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={openReasonPrompt}
              disabled={submitting || !isOrderChanged}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Save reordering
            </button>
          </div>
        )}
      </div>

      <ul className="divide-y divide-gray-200" aria-label="Trip stops">
        {localStops.map((stop, idx) => (
          <li
            key={stop.stopId}
            data-testid={`stop-row-${stop.stopId}`}
            draggable={reordering}
            onDragStart={reordering ? onDragStart(idx) : undefined}
            onDragOver={reordering ? onDragOver : undefined}
            onDrop={reordering ? onDrop(idx) : undefined}
            className={`flex items-start gap-4 px-5 py-4 ${
              reordering ? "cursor-move hover:bg-gray-50" : ""
            }`}
          >
            <div
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                stop.status === "completed"
                  ? "bg-gray-400"
                  : idx === 0
                    ? "bg-green-600"
                    : idx === localStops.length - 1
                      ? "bg-red-600"
                      : "bg-blue-600"
              }`}
            >
              {stop.status === "completed" ? "✓" : idx + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${
                  stop.status === "completed"
                    ? "text-gray-400 line-through"
                    : "text-gray-900"
                }`}
              >
                {stop.address}
              </p>
              {stop.notes && (
                <p className="mt-1 text-xs text-gray-500">{stop.notes}</p>
              )}
              {stop.timeWindow && (
                <p className="mt-1 text-xs text-amber-600">
                  Deliver: {stop.timeWindow.start} - {stop.timeWindow.end}
                </p>
              )}
            </div>
            {reordering && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => move(idx, idx - 1)}
                  disabled={idx === 0}
                  title="Move up"
                  aria-label={`Move ${stop.address} up`}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:border-gray-300 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, idx + 1)}
                  disabled={idx === localStops.length - 1}
                  title="Move down"
                  aria-label={`Move ${stop.address} down`}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:border-gray-300 disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {reasonPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Override reason prompt"
        >
          <div className="w-96 rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-gray-900">
              Override Reason
            </h3>
            <p className="text-sm text-gray-600">
              Enter a short reason for this manual route change. This is
              recorded on the trip.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested priority on stop #3"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              aria-label="Override reason"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setReasonPromptOpen(false);
                  setReason("");
                }}
                disabled={submitting}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={submitOverride}
                disabled={submitting || !reason.trim()}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Confirm override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
