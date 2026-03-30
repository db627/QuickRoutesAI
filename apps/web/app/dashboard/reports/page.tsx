"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";

interface DailySummary {
  overview: string;
  totalTrips: number;
  completedTrips: number;
  totalDistanceMiles: number;
  totalDurationHours: number;
  totalFuelSavedGallons: number;
  highlights: string[];
  recommendations: string[];
}

interface Anomaly {
  driverId: string;
  driverName: string;
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
}

const severityColors = {
  low: "bg-yellow-50 text-yellow-700 border-yellow-200",
  medium: "bg-orange-50 text-orange-700 border-orange-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

export default function ReportsPage() {
  const { toast } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingAnomalies, setLoadingAnomalies] = useState(false);

  const fetchSummary = async () => {
    setLoadingSummary(true);
    try {
      const res = await apiFetch<{ summary: DailySummary }>(`/ai/daily-summary?date=${date}`);
      setSummary(res.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setLoadingSummary(false);
    }
  };

  const fetchAnomalies = async () => {
    setLoadingAnomalies(true);
    try {
      const res = await apiFetch<{ anomalies: Anomaly[] }>("/ai/anomalies");
      setAnomalies(res.anomalies);
      if (res.anomalies.length === 0) toast.success("No anomalies detected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anomaly detection failed");
    } finally {
      setLoadingAnomalies(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Reports</h1>
        <p className="text-sm text-gray-500">AI-powered fleet insights, summaries, and anomaly detection.</p>
      </div>

      {/* Daily Summary Section */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Daily Summary</h2>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900"
            />
            <button
              onClick={fetchSummary}
              disabled={loadingSummary}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loadingSummary ? "Generating..." : "Generate Report"}
            </button>
          </div>
        </div>

        {summary && (
          <div className="p-5 space-y-5">
            {/* Overview */}
            <p className="text-sm text-gray-700 leading-relaxed">{summary.overview}</p>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">Total Trips</p>
                <p className="mt-0.5 text-xl font-bold text-gray-900">{summary.totalTrips}</p>
              </div>
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-xs text-green-600">Completed</p>
                <p className="mt-0.5 text-xl font-bold text-green-700">{summary.completedTrips}</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-xs text-blue-600">Distance</p>
                <p className="mt-0.5 text-xl font-bold text-blue-700">{summary.totalDistanceMiles.toFixed(1)} mi</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                <p className="text-xs text-purple-600">Duration</p>
                <p className="mt-0.5 text-xl font-bold text-purple-700">{summary.totalDurationHours.toFixed(1)} hrs</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs text-emerald-600">Fuel Saved</p>
                <p className="mt-0.5 text-xl font-bold text-emerald-700">{summary.totalFuelSavedGallons.toFixed(2)} gal</p>
              </div>
            </div>

            {/* Highlights */}
            {summary.highlights.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Highlights</h3>
                <ul className="space-y-1.5">
                  {summary.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {summary.recommendations.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">AI Recommendations</h3>
                <ul className="space-y-1.5">
                  {summary.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Anomaly Detection Section */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Anomaly Detection</h2>
            <p className="text-xs text-gray-400">Scans active trips for unusual driver behavior</p>
          </div>
          <button
            onClick={fetchAnomalies}
            disabled={loadingAnomalies}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {loadingAnomalies ? "Scanning..." : "Scan for Anomalies"}
          </button>
        </div>

        {anomalies.length > 0 && (
          <div className="divide-y divide-gray-200">
            {anomalies.map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-4 px-5 py-4 ${severityColors[a.severity].split(" ")[0]}`}
              >
                <div
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${severityColors[a.severity]}`}
                >
                  {a.severity}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {a.driverName} — <span className="capitalize">{a.type.replace("_", " ")}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {anomalies.length === 0 && !loadingAnomalies && (
          <p className="px-5 py-6 text-center text-sm text-gray-400">
            Click &quot;Scan for Anomalies&quot; to check active trips
          </p>
        )}
      </div>
    </div>
  );
}
