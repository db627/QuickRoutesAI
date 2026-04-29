"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatDuration } from "@/lib/utils";
import type { DriverPerformance, DriverTrend } from "@quickroutesai/shared";

type SortKey = "tripCount" | "onTimePct" | "avgCompletionTimeSeconds";
type SortDir = "asc" | "desc";

interface Props {
  onSelectDriver?: (uid: string) => void;
}

const TREND_ICONS: Record<DriverTrend, { icon: string; className: string }> = {
  up:   { icon: "↑", className: "text-green-600" },
  down: { icon: "↓", className: "text-red-500" },
  same: { icon: "→", className: "text-gray-400" },
  new:  { icon: "★", className: "text-brand-500" },
};

const RANK_MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function DriverLeaderboard({ onSelectDriver }: Props) {
  const [drivers, setDrivers] = useState<DriverPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("tripCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ drivers: DriverPerformance[] }>(
        `/drivers/performance?days=${days}`,
      );
      setDrivers(res.drivers);
    } catch {
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...drivers].sort((a, b) => {
    const av = a[sortKey] ?? -1;
    const bv = b[sortKey] ?? -1;
    return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  function SortHeader({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <th
        className="cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900"
        onClick={() => handleSort(col)}
      >
        {label}
        <span className="ml-1 text-gray-300">
          {active ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </th>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <div>
          <h2 className="font-semibold text-gray-900">Driver Leaderboard</h2>
          <p className="text-xs text-gray-400">Ranked by performance metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={load}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 w-12">
                Rank
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Driver
              </th>
              <SortHeader label="Trips" col="tripCount" />
              <SortHeader label="On-Time %" col="onTimePct" />
              <SortHeader label="Avg Time" col="avgCompletionTimeSeconds" />
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Trend
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3.5 w-full animate-pulse rounded bg-gray-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-400">
                  No completed trips in this period
                </td>
              </tr>
            ) : (
              sorted.map((driver, idx) => {
                const rank = idx + 1;
                const trend = TREND_ICONS[driver.trend];
                return (
                  <tr
                    key={driver.driverId}
                    onClick={() => onSelectDriver?.(driver.driverId)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    {/* Rank */}
                    <td className="px-4 py-3 text-center">
                      {RANK_MEDALS[rank] ? (
                        <span title={`#${rank}`}>{RANK_MEDALS[rank]}</span>
                      ) : (
                        <span className="text-sm font-semibold text-gray-400">#{rank}</span>
                      )}
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{driver.name}</p>
                      <p className="text-xs text-gray-400">{driver.driverId.slice(0, 8)}…</p>
                    </td>

                    {/* Trip count */}
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {driver.tripCount}
                    </td>

                    {/* On-time % */}
                    <td className="px-4 py-3">
                      {driver.onTimePct !== null ? (
                        <span
                          className={`font-medium ${
                            driver.onTimePct >= 80
                              ? "text-green-600"
                              : driver.onTimePct >= 60
                                ? "text-amber-500"
                                : "text-red-500"
                          }`}
                        >
                          {driver.onTimePct}%
                        </span>
                      ) : (
                        <span className="text-gray-300">--</span>
                      )}
                    </td>

                    {/* Avg completion time */}
                    <td className="px-4 py-3 text-gray-700">
                      {driver.avgCompletionTimeSeconds !== null
                        ? formatDuration(driver.avgCompletionTimeSeconds)
                        : <span className="text-gray-300">--</span>}
                    </td>

                    {/* Trend */}
                    <td className="px-4 py-3">
                      <span
                        className={`text-base font-bold ${trend.className}`}
                        title={
                          driver.prevTripCount !== null
                            ? `Previous period: ${driver.prevTripCount} trips`
                            : "New this period"
                        }
                      >
                        {trend.icon}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
