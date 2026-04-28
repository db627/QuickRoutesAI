"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Sparkles, AlertTriangle, Lightbulb } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { DailyInsights } from "@quickroutesai/shared";

// ── Date helpers (work in UTC so the date stays stable across tz) ──
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return d.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

// ── UI building blocks ────────────────────────────────────────────

interface InsightCardProps {
  title: string;
  items: string[];
  accent: "green" | "amber" | "blue";
  icon: React.ReactNode;
}

function InsightCard({ title, items, icon }: InsightCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          {icon}
        </span>
        <h3 className="font-semibold text-brand-700">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No items.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="text-gray-400" aria-hidden>
                •
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function InsightsSection() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState<string>(todayYmd);
  const [insights, setInsights] = useState<DailyInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canRefresh = role === "admin" || role === "dispatcher";

  const fetchInsights = useCallback(async (ymd: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<DailyInsights>(`/insights?date=${ymd}`);
      setInsights(data);
    } catch (err) {
      setInsights(null);
      const msg = err instanceof Error ? err.message : "Failed to load insights";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchInsights(date);
  }, [date, fetchInsights]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiFetch<DailyInsights>(`/insights/generate?date=${date}`, {
        method: "POST",
      });
      setInsights(data);
      toast.success("Insights refreshed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to refresh insights";
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  };

  const isToday = date === todayYmd();
  const hasData =
    !!insights &&
    (insights.highlights.length > 0 ||
      insights.concerns.length > 0 ||
      insights.recommendations.length > 0 ||
      insights.stats.tripsCompleted > 0 ||
      insights.stats.tripsCancelled > 0 ||
      insights.stats.activeDrivers > 0);

  const stats = insights?.stats;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-600" />
          <h2 className="text-lg font-semibold text-gray-900">AI Insights</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDate((d) => shiftYmd(d, -1))}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-gray-700">
            {formatYmd(date)}
          </span>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setDate((d) => shiftYmd(d, 1))}
            disabled={isToday}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {canRefresh && (
            <button
              type="button"
              aria-label="Refresh insights"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="ml-2 flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div
          data-testid="insights-loading"
          className="flex items-center justify-center py-10"
        >
          <div
            role="status"
            aria-label="Loading insights"
            className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600"
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasData && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center">
          <p className="text-sm text-gray-500">No data for this day yet.</p>
        </div>
      )}

      {/* Insights content */}
      {!loading && hasData && insights && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <InsightCard
              title="Highlights"
              items={insights.highlights}
              accent="green"
              icon={<Sparkles className="h-4 w-4" />}
            />
            <InsightCard
              title="Concerns"
              items={insights.concerns}
              accent="amber"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <InsightCard
              title="Recommendations"
              items={insights.recommendations}
              accent="blue"
              icon={<Lightbulb className="h-4 w-4" />}
            />
          </div>

          {/* Stats strip */}
          {stats && (
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-center sm:grid-cols-5">
              <StatCell label="Completed" value={String(stats.tripsCompleted)} />
              <StatCell label="Cancelled" value={String(stats.tripsCancelled)} />
              <StatCell label="Active drivers" value={String(stats.activeDrivers)} />
              <StatCell label="Avg duration" value={formatDuration(stats.avgDurationSeconds)} />
              <StatCell
                label="Avg ETA error"
                value={
                  stats.avgEtaErrorMinutes !== undefined
                    ? `${stats.avgEtaErrorMinutes.toFixed(1)} min`
                    : "—"
                }
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
