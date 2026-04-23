"use client";

import { useEffect, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import type { FeedEvent } from "@quickroutesai/shared";

// ── Filter options ────────────────────────────────────────────────────────────

type FilterKey = "all" | "driver" | "trip" | "stop";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "driver", label: "Driver" },
  { key: "trip", label: "Trip" },
  { key: "stop", label: "Stops" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortId(id: string) {
  return id.slice(-6);
}

function relativeTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(createdAt).toLocaleDateString();
}

function formatTimestamp(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Event classification ──────────────────────────────────────────────────────

type EventKind =
  | "driver_online"
  | "driver_offline"
  | "trip_started"
  | "trip_completed"
  | "trip_cancelled"
  | "stop_completed"
  | "other";

function classifyEvent(event: FeedEvent): EventKind {
  if (event.type === "stop_completed") return "stop_completed";
  if (event.type === "status_change") {
    const p = event.payload;
    if (p.status === "online") return "driver_online";
    if (p.status === "offline") return "driver_offline";
    if (p.to === "in_progress") return "trip_started";
    if (p.to === "completed") return "trip_completed";
    if (p.to === "cancelled") return "trip_cancelled";
  }
  return "other";
}

function filterKey(kind: EventKind): FilterKey {
  if (kind === "driver_online" || kind === "driver_offline") return "driver";
  if (kind === "trip_started" || kind === "trip_completed" || kind === "trip_cancelled")
    return "trip";
  if (kind === "stop_completed") return "stop";
  return "all";
}

// ── Per-kind display config ───────────────────────────────────────────────────

const KIND_CONFIG: Record<
  EventKind,
  { icon: string; color: string; label: (e: FeedEvent) => string }
> = {
  driver_online: {
    icon: "●",
    color: "text-green-500",
    label: (e) => `Driver …${shortId(e.driverId ?? "")} came online`,
  },
  driver_offline: {
    icon: "○",
    color: "text-gray-400",
    label: (e) => `Driver …${shortId(e.driverId ?? "")} went offline`,
  },
  trip_started: {
    icon: "▶",
    color: "text-brand-500",
    label: (e) => `Trip …${shortId(String(e.payload.tripId ?? ""))} started`,
  },
  trip_completed: {
    icon: "✓",
    color: "text-green-600",
    label: (e) => `Trip …${shortId(String(e.payload.tripId ?? ""))} completed`,
  },
  trip_cancelled: {
    icon: "✕",
    color: "text-red-500",
    label: (e) => `Trip …${shortId(String(e.payload.tripId ?? ""))} cancelled`,
  },
  stop_completed: {
    icon: "⬤",
    color: "text-brand-400",
    label: (e) =>
      `Stop completed on trip …${shortId(String(e.payload.tripId ?? ""))}`,
  },
  other: {
    icon: "·",
    color: "text-gray-400",
    label: () => "Activity",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ActivityFeed() {
  const { orgId } = useAuth();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, "events"),
      where("orgId", "==", orgId),
      where("type", "in", ["status_change", "stop_completed"]),
      orderBy("createdAt", "asc"),
      limit(100),
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<FeedEvent, "id">),
      })) as FeedEvent[];
      setEvents(docs);
      setLoading(false);
    });

    return unsub;
  }, [orgId]);

  // Auto-scroll to bottom when new events arrive, but only when the user
  // hasn't manually scrolled up.
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  const filtered = events.filter((e) => {
    if (filter === "all") return true;
    const kind = classifyEvent(e);
    return filterKey(kind) === filter;
  });

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Live Activity</h2>
        <span className="flex items-center gap-1.5 text-xs text-green-500 font-medium">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          Live
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200 px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-brand-50 text-brand-700"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        style={{ maxHeight: "320px" }}
      >
        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-gray-200 animate-pulse" />
                <div className="h-3 flex-1 rounded bg-gray-200 animate-pulse" />
                <div className="h-3 w-12 rounded bg-gray-200 animate-pulse" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-400">
            No activity yet
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((event) => {
              const kind = classifyEvent(event);
              const cfg = KIND_CONFIG[kind];
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-3 px-5 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <span className={`mt-0.5 text-xs font-bold ${cfg.color}`}>
                    {cfg.icon}
                  </span>
                  <span className="flex-1 text-sm text-gray-700 leading-snug">
                    {cfg.label(event)}
                  </span>
                  <time
                    dateTime={event.createdAt}
                    title={formatTimestamp(event.createdAt)}
                    className="shrink-0 text-xs text-gray-400 mt-0.5"
                  >
                    {relativeTime(event.createdAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom nudge when user has scrolled up */}
      {!autoScroll && (
        <div className="border-t border-gray-200 px-5 py-2 text-center">
          <button
            onClick={() => {
              setAutoScroll(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            ↓ Jump to latest
          </button>
        </div>
      )}
    </div>
  );
}
