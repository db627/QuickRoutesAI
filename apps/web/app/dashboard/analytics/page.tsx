"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { AnalyticsResponse } from "@quickroutesai/shared";

// ── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function fmtAxisDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: "default" | "green" | "blue" | "amber";
  loading: boolean;
}

const colorMap = {
  default: { border: "border-gray-200", bg: "bg-white", text: "text-gray-900", sub: "text-gray-400" },
  green:   { border: "border-green-200",  bg: "bg-green-50",  text: "text-green-700",  sub: "text-green-500"  },
  blue:    { border: "border-blue-200",   bg: "bg-blue-50",   text: "text-blue-700",   sub: "text-blue-400"   },
  amber:   { border: "border-amber-200",  bg: "bg-amber-50",  text: "text-amber-700",  sub: "text-amber-500"  },
};

function KpiCard({ label, value, sub, color = "default", loading }: KpiCardProps) {
  const c = colorMap[color];
  if (loading) {
    return (
      <div className={`animate-pulse rounded-xl border ${c.border} ${c.bg} px-5 py-4`}>
        <p className="text-xs text-gray-400">{label}</p>
        <div className="mt-2 h-8 w-20 rounded bg-gray-200" />
      </div>
    );
  }
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} px-5 py-4`}>
      <p className={`text-xs font-medium ${c.sub}`}>{label}</p>
      <p className={`mt-1 text-3xl font-bold ${c.text}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${c.sub}`}>{sub}</p>}
    </div>
  );
}

// ── Chart skeleton ────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="flex h-56 items-end gap-1 px-2">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse flex-1 rounded-sm bg-gray-200"
          style={{ height: `${20 + Math.sin(i) * 30 + 30}%` }}
        />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { toast } = useToast();

  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true);
    try {
      const result = await apiFetch<AnalyticsResponse>(
        `/analytics?from=${fromDate}&to=${toDate}`
      );
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAnalytics(from, to);
  }, [fetchAnalytics, from, to]);

  const applyPreset = (days: number) => {
    const newFrom = daysAgo(days - 1);
    const newTo = today();
    setFrom(newFrom);
    setTo(newTo);
  };

  const onTimeLabel =
    data?.summary.onTimePercentage != null
      ? `${data.summary.onTimePercentage}%`
      : "N/A";

  const onTimeSub =
    data?.summary.tripsWithEta != null && data.summary.tripsWithEta > 0
      ? `based on ${data.summary.tripsWithEta} trip${data.summary.tripsWithEta !== 1 ? "s" : ""} with ETA`
      : "no ETA data in range";

  return (
    <div className="space-y-6">
      {/* Page header + date range controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">Trip performance overview for your fleet.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Presets */}
          {[
            { label: "7d",  days: 7  },
            { label: "14d", days: 14 },
            { label: "30d", days: 30 },
          ].map(({ label, days }) => (
            <button
              key={label}
              onClick={() => applyPreset(days)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              {label}
            </button>
          ))}

          {/* Custom range */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-900"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today()}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-900"
            />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total Trips"
          value={data ? String(data.summary.totalTrips) : "—"}
          color="blue"
          loading={loading}
        />
        <KpiCard
          label="Total Stops"
          value={data ? String(data.summary.totalStops) : "—"}
          color="default"
          loading={loading}
        />
        <KpiCard
          label="On-Time Rate"
          value={loading ? "—" : onTimeLabel}
          sub={loading ? undefined : onTimeSub}
          color={
            data?.summary.onTimePercentage == null
              ? "default"
              : data.summary.onTimePercentage >= 80
              ? "green"
              : "amber"
          }
          loading={loading}
        />
      </div>

      {/* Line chart — trips per day */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Trips per Day</h2>
          <p className="text-xs text-gray-400">Total trips created each day in the selected range</p>
        </div>
        <div className="px-4 py-5">
          {loading ? (
            <ChartSkeleton />
          ) : data && data.tripsByDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={224}>
              <LineChart data={data.tripsByDay} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtAxisDate}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                  labelFormatter={(v) => `Date: ${v}`}
                  formatter={(v) => [v as number, "Trips"]}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-14 text-center text-sm text-gray-400">No trip data for this range.</p>
          )}
        </div>
      </div>

      {/* Bar chart — avg delivery time by day */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Avg Delivery Time per Day</h2>
          <p className="text-xs text-gray-400">
            Average minutes from trip creation to completion (completed trips only)
          </p>
        </div>
        <div className="px-4 py-5">
          {loading ? (
            <ChartSkeleton />
          ) : data && data.avgDeliveryByDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={224}>
              <BarChart
                data={data.avgDeliveryByDay}
                margin={{ top: 4, right: 16, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtAxisDate}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => fmtMinutes(v)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                  labelFormatter={(v) => `Date: ${v}`}
                  formatter={(v) => [fmtMinutes(v as number), "Avg time"]}
                />
                <Bar dataKey="avgMinutes" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-14 text-center text-sm text-gray-400">
              No completed trips in this range to calculate delivery times.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
