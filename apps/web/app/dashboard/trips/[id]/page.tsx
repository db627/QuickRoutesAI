"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
} from "firebase/firestore";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { firestore } from "@/lib/firebase";
import { apiFetch } from "@/lib/api";
import { decodePolyline, formatDistance, formatDuration } from "@/lib/utils";
import TripForm from "@/components/TripForm";
import DraggableStopList from "@/components/DraggableStopList";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import type { Trip, TripStop, DriverRecord, PredictedEta } from "@quickroutesai/shared";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
const DEFAULT_CENTER = { lat: 40.7128, lng: -74.006 };

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  assigned: "bg-blue-50 text-blue-600",
  in_progress: "bg-green-50 text-green-600",
  completed: "bg-purple-50 text-purple-600",
  cancelled: "bg-red-50 text-red-600",
};

/* ------------------------------------------------------------------ */
/*  Route polyline rendered via the Maps JS Polyline class             */
/* ------------------------------------------------------------------ */
function RoutePolyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");

  useEffect(() => {
    if (!map || !mapsLib || path.length === 0) return;
    const polyline = new mapsLib.Polyline({
      path,
      strokeColor: "#3b82f6",
      strokeWeight: 4,
      strokeOpacity: 0.8,
      map,
    });
    return () => {
      polyline.setMap(null);
    };
  }, [map, mapsLib, path]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Auto-fits map bounds to show all stops and the route polyline     */
/* ------------------------------------------------------------------ */
function MapBoundsFitter({
  stops,
  polylinePath,
}: {
  stops: TripStop[];
  polylinePath: { lat: number; lng: number }[];
}) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !coreLib) return;
    const points = [
      ...stops
        .filter((s) => s.lat !== 0 || s.lng !== 0)
        .map((s) => ({ lat: s.lat, lng: s.lng })),
      ...polylinePath,
    ];
    if (points.length === 0) return;
    const bounds = new coreLib.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 60);
  }, [map, coreLib, stops, polylinePath]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Driver selector dropdown                                           */
/* ------------------------------------------------------------------ */
interface DriverOption {
  uid: string;
  name?: string;
  isOnline: boolean;
}

function AssignDriverDropdown({
  tripId,
  currentDriverId,
  tripStatus,
  onAssigned,
}: {
  tripId: string;
  currentDriverId: string | null;
  tripStatus: string;
  onAssigned: () => void;
}) {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);

  useEffect(() => {
    apiFetch<{ data: DriverOption[] }>("/drivers")
      .then((res) => setDrivers(res.data))
      .catch(() => {
        const q = query(collection(firestore, "drivers"));
        const unsub = onSnapshot(q, (snap) => {
          setDrivers(
            snap.docs.map((d) => ({
              uid: d.id,
              isOnline: (d.data() as DriverRecord).isOnline,
            })),
          );
        });
        return unsub;
      });
  }, []);

  const assign = async (driverId: string) => {
    setAssigning(true);
    try {
      await apiFetch(`/trips/${tripId}/assign`, {
        method: "POST",
        body: JSON.stringify({ driverId }),
      });
      toast.success("Driver assigned successfully");
      onAssigned();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign driver");
    } finally {
      setAssigning(false);
    }
  };

  const autoAssign = async () => {
    setAutoAssigning(true);
    try {
      const result = await apiFetch<{ driverId: string; reason: string }>("/ai/auto-assign", {
        method: "POST",
        body: JSON.stringify({ tripId }),
      });
      toast.success(`AI assigned driver: ${result.reason}`);
      onAssigned();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-assign failed");
    } finally {
      setAutoAssigning(false);
    }
  };

  return (
    <div className="relative flex gap-2">
      {tripStatus === "draft" && (
        <button
          onClick={autoAssign}
          disabled={autoAssigning}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {autoAssigning ? "AI Picking..." : "Smart Assign"}
        </button>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:border-gray-300"
      >
        {currentDriverId ? "Reassign Driver" : "Assign Driver"}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-10 w-64 rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="max-h-60 overflow-y-auto divide-y divide-gray-200">
            {drivers.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400">No drivers found</p>
            )}
            {drivers.map((d) => (
              <button
                key={d.uid}
                onClick={() => assign(d.uid)}
                disabled={assigning}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50"
              >
                <span className="truncate">{d.name || d.uid.slice(0, 16) + "..."}</span>
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                    d.isOnline
                      ? "bg-green-50 text-green-600"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {d.isOnline ? "Online" : "Offline"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline stop editor (add / remove stops on ongoing trips)           */
/* ------------------------------------------------------------------ */
function StopEditor({
  tripId,
  currentStops,
  editable,
}: {
  tripId: string;
  currentStops: TripStop[];
  editable: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [newAddress, setNewAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local state when props change and not editing
  useEffect(() => {
    if (!editing) {
      setStops([...currentStops].sort((a, b) => a.sequence - b.sequence));
    }
  }, [currentStops, editing]);

  const startEditing = () => {
    setStops([...currentStops].sort((a, b) => a.sequence - b.sequence));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const cancel = () => {
    setEditing(false);
    setNewAddress("");
  };

  const addStop = () => {
    const addr = newAddress.trim();
    if (!addr) return;
    setStops((prev) => [
      ...prev,
      {
        stopId: crypto.randomUUID(),
        address: addr,
        contactName: "",
        lat: 0,
        lng: 0,
        sequence: prev.length,
        notes: "",
      },
    ]);
    setNewAddress("");
    inputRef.current?.focus();
  };

  const removeStop = (stopId: string) => {
    setStops((prev) =>
      prev
        .filter((s) => s.stopId !== stopId)
        .map((s, i) => ({ ...s, sequence: i })),
    );
  };

  const save = async () => {
    if (stops.length < 1) {
      toast.error("A trip must have at least one stop");
      return;
    }
    setSaving(true);
    try {
      // Send stops — server will geocode any with lat=0/lng=0 and recompute route
      const payload = stops.map((s, i) => ({
        stopId: s.stopId,
        address: s.address,
        lat: s.lat || undefined,
        lng: s.lng || undefined,
        sequence: i,
        notes: s.notes,
        ...(s.timeWindow?.start && s.timeWindow?.end ? { timeWindow: s.timeWindow } : {}),
      }));
      await apiFetch(`/trips/${tripId}`, {
        method: "PATCH",
        body: JSON.stringify({ stops: payload }),
      });
      toast.success("Stops updated & route recalculated");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update stops");
    } finally {
      setSaving(false);
    }
  };

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <h2 className="font-semibold text-gray-900">
          Stops ({sorted.length})
        </h2>
        {editable && !editing && (
          <button
            onClick={startEditing}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900"
          >
            Edit Stops
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button
              onClick={cancel}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save & Recalculate"}
            </button>
          </div>
        )}
      </div>

      <div className="divide-y divide-gray-200">
        {sorted.map((stop, idx) => (
          <div key={stop.stopId} className="flex items-start gap-4 px-5 py-4">
            <div
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                stop.status === "completed"
                  ? "bg-gray-400"
                  : idx === 0
                    ? "bg-green-600"
                    : idx === sorted.length - 1
                      ? "bg-red-600"
                      : "bg-blue-600"
              }`}
            >
              {stop.status === "completed" ? "✓" : idx + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${stop.status === "completed" ? "text-gray-400 line-through" : "text-gray-900"}`}>
                {stop.address}
              </p>
              {stop.completedAt && (
                <p className="text-xs text-green-600">
                  Completed {new Date(stop.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
              {stop.lat !== 0 && stop.lng !== 0 && (
                <p className="text-xs text-gray-400">
                  {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                </p>
              )}
              {stop.notes && (
                <p className="mt-1 text-xs text-gray-500">{stop.notes}</p>
              )}
              {stop.timeWindow && !editing && (
                <p className="mt-1 text-xs text-amber-600">
                  Deliver: {stop.timeWindow.start} - {stop.timeWindow.end}
                </p>
              )}
              {editing && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-gray-400">Window:</span>
                  <input
                    type="time"
                    value={stop.timeWindow?.start || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStops((prev) =>
                        prev.map((s) =>
                          s.stopId === stop.stopId
                            ? { ...s, timeWindow: val ? { start: val, end: s.timeWindow?.end || "" } : undefined }
                            : s,
                        ),
                      );
                    }}
                    className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700"
                  />
                  <span className="text-xs text-gray-400">to</span>
                  <input
                    type="time"
                    value={stop.timeWindow?.end || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStops((prev) =>
                        prev.map((s) =>
                          s.stopId === stop.stopId
                            ? { ...s, timeWindow: val ? { start: s.timeWindow?.start || "", end: val } : undefined }
                            : s,
                        ),
                      );
                    }}
                    className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700"
                  />
                </div>
              )}
            </div>
            {editing && (
              <button
                onClick={() => removeStop(stop.stopId)}
                className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                title="Remove stop"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add stop input */}
      {editing && (
        <div className="border-t border-gray-200 px-5 py-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addStop()}
              placeholder="Enter address to add..."
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button
              onClick={addStop}
              disabled={!newAddress.trim()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-30"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI ETA Prediction panel                                            */
/* ------------------------------------------------------------------ */
function ETAPanel({ tripId }: { tripId: string }) {
  const { toast } = useToast();
  const [prediction, setPrediction] = useState<{
    estimatedArrivalMinutes: number;
    confidence: number;
    factors: string[];
    perStopETA: { stopIndex: number; address: string; etaMinutes: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchETA = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ prediction: typeof prediction }>("/ai/eta", {
        method: "POST",
        body: JSON.stringify({ tripId }),
      });
      setPrediction(res.prediction);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ETA prediction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50">
      <div className="flex items-center justify-between border-b border-indigo-200 px-5 py-3">
        <h2 className="font-semibold text-indigo-900">AI ETA Prediction</h2>
        <button
          onClick={fetchETA}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Predicting..." : prediction ? "Refresh ETA" : "Predict ETA"}
        </button>
      </div>
      {prediction && (
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-xs text-indigo-600">Total ETA</p>
              <p className="text-2xl font-bold text-indigo-900">
                {prediction.estimatedArrivalMinutes} min
              </p>
            </div>
            <div>
              <p className="text-xs text-indigo-600">Confidence</p>
              <p className="text-lg font-semibold text-indigo-900">
                {Math.round(prediction.confidence * 100)}%
              </p>
            </div>
          </div>
          {prediction.factors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {prediction.factors.map((f, i) => (
                <span key={i} className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs text-indigo-700">
                  {f}
                </span>
              ))}
            </div>
          )}
          {prediction.perStopETA.length > 0 && (
            <div className="space-y-1">
              {prediction.perStopETA.map((s) => (
                <div key={s.stopIndex} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 truncate max-w-[200px]">{s.address}</span>
                  <span className="font-medium text-indigo-700">{s.etaMinutes} min</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Predictive ETA Engine card                                         */
/* ------------------------------------------------------------------ */
function PredictedEtaCard({
  tripId,
  prediction,
  canPredict,
}: {
  tripId: string;
  prediction: PredictedEta | undefined;
  canPredict: boolean;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/predict-eta`, { method: "POST" });
      toast.success("ETA prediction generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to predict ETA");
    } finally {
      setLoading(false);
    }
  };

  const confidenceColors: Record<string, string> = {
    low: "bg-gray-100 text-gray-700",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-green-100 text-green-800",
  };

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50">
      <div className="flex items-center justify-between border-b border-violet-200 px-5 py-3">
        <h2 className="font-semibold text-violet-900">Predictive ETA</h2>
        {canPredict && (
          <button
            onClick={run}
            disabled={loading}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? "Predicting..." : prediction ? "Re-run Prediction" : "Predict ETA"}
          </button>
        )}
      </div>
      {prediction ? (
        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-violet-700">Predicted Arrival</p>
              <p className="text-lg font-semibold text-violet-900">
                {new Date(prediction.predictedArrivalAt).toLocaleString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <div>
              <p className="text-xs text-violet-700">Confidence</p>
              <span
                className={`mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${confidenceColors[prediction.confidence] || ""}`}
              >
                {prediction.confidence}
              </span>
            </div>
            <div>
              <p className="text-xs text-violet-700">Baseline / Adjusted</p>
              <p className="text-sm font-medium text-violet-900">
                {Math.round(prediction.baselineDurationSeconds / 60)} /{" "}
                {Math.round(prediction.adjustedDurationSeconds / 60)} min
              </p>
            </div>
            {prediction.actualArrivalAt && typeof prediction.errorMinutes === "number" && (
              <div>
                <p className="text-xs text-violet-700">Actual (error)</p>
                <p className="text-sm font-medium text-violet-900">
                  {new Date(prediction.actualArrivalAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  (±{prediction.errorMinutes.toFixed(1)} min)
                </p>
              </div>
            )}
          </div>
          {prediction.reasoning && (
            <p className="text-sm text-gray-700">{prediction.reasoning}</p>
          )}
          <p className="text-xs text-violet-600">
            Factors: DoW {prediction.factors.dayOfWeek}, hour {prediction.factors.timeOfDayHour},{" "}
            {prediction.factors.historicalSampleSize} historical samples
            {prediction.factors.weatherSummary ? `; weather: ${prediction.factors.weatherSummary}` : ""}
          </p>
        </div>
      ) : (
        <div className="px-5 py-4 text-sm text-violet-700">
          No prediction yet. {canPredict ? "Click Predict ETA to generate one." : ""}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status history timeline                                            */
/* ------------------------------------------------------------------ */
const STATUS_STEPS = ["draft", "assigned", "in_progress", "completed"] as const;

const stepLabel: Record<string, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function StatusTimeline({ status }: { status: string }) {
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">✕</div>
        <span className="text-sm font-medium text-red-700">Trip Cancelled</span>
      </div>
    );
  }

  const currentIdx = STATUS_STEPS.indexOf(status as typeof STATUS_STEPS[number]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Status Timeline</p>
      <div className="flex items-center gap-0">
        {STATUS_STEPS.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    done
                      ? "bg-brand-600 text-white"
                      : active
                        ? "border-2 border-brand-600 bg-brand-50 text-brand-600"
                        : "border-2 border-gray-200 bg-white text-gray-300"
                  }`}
                >
                  {done ? "✓" : idx + 1}
                </div>
                <span
                  className={`text-xs font-medium ${
                    active ? "text-brand-600" : done ? "text-gray-700" : "text-gray-300"
                  }`}
                >
                  {stepLabel[step]}
                </span>
              </div>
              {idx < STATUS_STEPS.length - 1 && (
                <div
                  className={`mb-4 h-0.5 flex-1 ${idx < currentIdx ? "bg-brand-600" : "bg-gray-200"}`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Assignment info panel                                              */
/* ------------------------------------------------------------------ */
function AssignmentInfoPanel({
  driverId,
  driverName,
  driverPos,
  tripStatus,
}: {
  driverId: string | null;
  driverName: string | null;
  driverPos: { lat: number; lng: number; speedMps: number; heading: number; updatedAt: string | null } | null;
  tripStatus: string;
}) {
  if (!driverId) return null;

  const isOnline = driverPos !== null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Assigned Driver</p>
      </div>
      <div className="flex flex-wrap items-center gap-6 px-5 py-4">
        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {(driverName || driverId).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{driverName || driverId.slice(0, 12) + "..."}</p>
            <p className="text-xs text-gray-400">UID: {driverId.slice(0, 10)}…</p>
          </div>
        </div>

        {/* Online status */}
        <div>
          <p className="text-xs text-gray-400">Status</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${isOnline ? "animate-pulse bg-green-500" : "bg-gray-300"}`} />
            <span className={`text-sm font-medium ${isOnline ? "text-green-600" : "text-gray-400"}`}>
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
        </div>

        {/* Speed */}
        {driverPos && (
          <div>
            <p className="text-xs text-gray-400">Speed</p>
            <p className="mt-0.5 text-sm font-medium text-gray-900">
              {(driverPos.speedMps * 2.237).toFixed(0)} mph
            </p>
          </div>
        )}

        {/* Heading */}
        {driverPos && (
          <div>
            <p className="text-xs text-gray-400">Heading</p>
            <p className="mt-0.5 text-sm font-medium text-gray-900">{driverPos.heading.toFixed(0)}°</p>
          </div>
        )}

        {/* Trip status */}
        <div>
          <p className="text-xs text-gray-400">Trip Status</p>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[tripStatus] || ""}`}>
            {tripStatus.replace("_", " ")}
          </span>
        </div>

        {/* Last update */}
        {driverPos?.updatedAt && (
          <div>
            <p className="text-xs text-gray-400">Last Update</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {new Date(driverPos.updatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */
export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { role } = useAuth();
  const [rawTrip, setRawTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [driverPos, setDriverPos] = useState<{
    lat: number;
    lng: number;
    speedMps: number;
    heading: number;
    updatedAt: string | null;
  } | null>(null);
  const [computing, setComputing] = useState(false);
  const [driverName, setDriverName] = useState<string | null>(null);

  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  // Edit / Cancel UI state
  const [editing, setEditing] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // Subscribe to trip document in real-time
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(firestore, "trips", id), (snap) => {
      if (snap.exists()) {
        setRawTrip({ id: snap.id, ...(snap.data() as Omit<Trip, "id">) });
      } else {
        setRawTrip(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [id]);

  // Subscribe to stops subcollection in real-time
  useEffect(() => {
    if (!id) return;
    const stopsRef = collection(firestore, "trips", id, "stops");
    const unsub = onSnapshot(stopsRef, (snap) => {
      const docs = snap.docs.map((d) => ({
        stopId: d.id,
        ...(d.data() as Omit<TripStop, "stopId">),
      }));
      docs.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      setStops(docs);
    });
    return unsub;
  }, [id]);

  // Merge rawTrip with live stops from subcollection
  const trip = useMemo(
    () => (rawTrip ? { ...rawTrip, stops } : null),
    [rawTrip, stops],
  );

  // Subscribe to driver's live position when driver is assigned
  useEffect(() => {
    if (!trip?.driverId) {
      setDriverPos(null);
      return;
    }
    const unsub = onSnapshot(doc(firestore, "drivers", trip.driverId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as DriverRecord;
        if (data.isOnline && data.lastLocation) {
          setDriverPos({
            lat: data.lastLocation.lat,
            lng: data.lastLocation.lng,
            speedMps: data.lastSpeedMps ?? 0,
            heading: data.lastHeading ?? 0,
            updatedAt: data.updatedAt ?? null,
          });
        } else {
          setDriverPos(null);
        }
      }
    });
    return unsub;
  }, [trip?.driverId]);

  // Resolve driver name from users collection
  useEffect(() => {
    if (!trip?.driverId) {
      setDriverName(null);
      return;
    }
    getDoc(doc(firestore, "users", trip.driverId)).then((snap) => {
      if (snap.exists()) {
        setDriverName(snap.data()?.name || null);
      }
    });
  }, [trip?.driverId]);

  const computeRoute = useCallback(async () => {
    if (!id) return;
    setComputing(true);
    try {
      await apiFetch(`/trips/${id}/route`, { method: "POST" });
      toast.success("Route computed successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to compute route");
    } finally {
      setComputing(false);
    }
  }, [id, toast]);

  const cancelTrip = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await apiFetch(`/trips/${id}/cancel`, { method: "POST" });
      setShowCancelModal(false);
      toast.success("Trip cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel trip");
      setShowCancelModal(false);
    } finally {
      setCancelling(false);
    }
  };

  const duplicateTrip = async () => {
    if (!id) return;
    setDuplicating(true);
    try {
      const duplicated = await apiFetch<{ id: string }>(`/trips/${id}/duplicate`, { method: "POST" });
      toast.success("Trip duplicated");
      router.push(`/dashboard/trips/${duplicated.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate trip");
    } finally {
      setDuplicating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <SkeletonBlock className="h-8 w-16 rounded-lg" />
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <SkeletonBlock className="h-7 w-28" />
                <SkeletonBlock className="h-5 w-20 rounded-full" />
              </div>
              <SkeletonBlock className="h-3 w-36" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-9 w-32 rounded-lg" />
            <SkeletonBlock className="h-9 w-32 rounded-lg" />
          </div>
        </div>

        {/* Metadata cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-1.5">
              <SkeletonBlock className="h-3 w-12" />
              <SkeletonBlock className="h-4 w-20" />
            </div>
          ))}
        </div>

        {/* Map */}
        <SkeletonBlock className="h-[280px] sm:h-[400px] lg:h-[500px] rounded-xl" />

        {/* Stop list */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-3">
            <SkeletonBlock className="h-4 w-24" />
          </div>
          <div className="divide-y divide-gray-200">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-4 px-5 py-4">
                <SkeletonBlock className="h-7 w-7 flex-shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <SkeletonBlock className="h-3.5 w-48" />
                  <SkeletonBlock className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <p className="text-gray-500">Trip not found.</p>
        <Link
          href="/dashboard/trips"
          className="text-sm text-brand-600 hover:underline"
        >
          Back to trips
        </Link>
      </div>
    );
  }

  // Decode route polyline if available
  const polylinePath = trip.route?.polyline ? decodePolyline(trip.route.polyline) : [];

  // Determine map center from first stop or default
  const mapCenter =
    stops.length > 0
      ? { lat: stops[0].lat, lng: stops[0].lng }
      : DEFAULT_CENTER;

  // Stop marker color helper
  const stopPinColors = (index: number, total: number) => {
    if (index === 0) return { bg: "#22c55e", glyph: "#fff", border: "#16a34a" }; // green
    if (index === total - 1) return { bg: "#ef4444", glyph: "#fff", border: "#dc2626" }; // red
    return { bg: "#3b82f6", glyph: "#fff", border: "#2563eb" }; // blue
  };

  const canEdit = trip.status === "draft";
  const canCancel = trip.status === "draft" || trip.status === "assigned";
  const canDuplicate = true;

  // Pre-fill stops sorted by sequence
  const initialStops = stops.slice().sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/trips"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900"
          >
            &larr; Back
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Trip Detail</h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[trip.status] || ""}`}
              >
                {trip.status.replace("_", " ")}
              </span>
              {trip.routeOverride?.active && (
                <span
                  className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                  title={trip.routeOverride.reason}
                >
                  Manually overridden
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-400">ID: {trip.id}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canDuplicate && (
            <button
              onClick={duplicateTrip}
              disabled={duplicating}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:border-gray-300 disabled:opacity-50"
            >
              {duplicating ? "Duplicating..." : "Duplicate Trip"}
            </button>
          )}
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:border-gray-300"
            >
              Edit
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:border-red-300 hover:bg-red-50"
            >
              Cancel Trip
            </button>
          )}
          {!trip.route && !editing && trip.status !== "cancelled" && (
            <button
              onClick={computeRoute}
              disabled={computing}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {computing ? "Computing..." : "Compute Route"}
            </button>
          )}
          {!editing && trip.status !== "cancelled" && (
            <AssignDriverDropdown
              tripId={trip.id}
              currentDriverId={trip.driverId}
              tripStatus={trip.status}
              onAssigned={() => {}}
            />
          )}
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="space-y-3">
          <TripForm
            tripId={trip.id}
            initialStops={initialStops}
            onCreated={() => {
              setEditing(false);
              toast.success("Trip updated successfully");
            }}
          />
          <button
            onClick={() => setEditing(false)}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Discard changes
          </button>
        </div>
      )}


      {/* Metadata cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Status</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900 capitalize">
            {trip.status.replace("_", " ")}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Driver</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">
            {trip.driverId ? (driverName || trip.driverId.slice(0, 12) + "...") : "Unassigned"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Distance</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">
            {trip.route ? formatDistance(trip.route.distanceMeters) : "--"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Duration</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">
            {trip.route ? formatDuration(trip.route.durationSeconds) : "--"}
          </p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-xs text-green-600">Fuel Savings</p>
          <p className="mt-0.5 text-sm font-bold text-green-700">
            {trip.route?.fuelSavingsGallons != null
              ? `${trip.route.fuelSavingsGallons.toFixed(2)} gal`
              : "--"}
          </p>
          {trip.route?.naiveDistanceMeters != null && trip.route.naiveDistanceMeters > 0 && (
            <p className="text-xs text-green-500">
              vs {formatDistance(trip.route.naiveDistanceMeters)} unoptimized
            </p>
          )}
        </div>
      </div>

      {/* Status timeline */}
      <StatusTimeline status={trip.status} />

      {/* Assignment info panel */}
      <AssignmentInfoPanel
        driverId={trip.driverId}
        driverName={driverName}
        driverPos={driverPos}
        tripStatus={trip.status}
      />

      {/* AI Route Reasoning */}
      {trip.route?.reasoning && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-5 py-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
            AI Route Reasoning
          </p>
          <p className="text-sm text-gray-700">{trip.route.reasoning}</p>
        </div>
      )}

      {/* Map */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {MAPS_KEY ? (
          <APIProvider apiKey={MAPS_KEY}>
            <div className="h-[280px] sm:h-[400px] lg:h-[500px]">
            <Map
              defaultCenter={mapCenter}
              defaultZoom={13}
              style={{ width: "100%", height: "100%" }}
              mapId="quickroutesai-trip-detail"
              gestureHandling="greedy"
              disableDefaultUI
            >
              {/* Auto-fit bounds to all stops + polyline */}
              <MapBoundsFitter stops={stops} polylinePath={polylinePath} />

              {/* Route polyline */}
              {polylinePath.length > 0 && <RoutePolyline path={polylinePath} />}

              {/* Stop markers */}
              {stops
                .slice()
                .sort((a, b) => a.sequence - b.sequence)
                .filter((stop) => stop.lat != null && stop.lng != null)
                .map((stop, idx) => {
                  const colors = stopPinColors(idx, stops.length);
                  return (
                    <React.Fragment key={stop.stopId}>
                      <AdvancedMarker
                        key={stop.stopId}
                        position={{ lat: stop.lat, lng: stop.lng }}
                        title={`Stop ${idx + 1}: ${stop.address}`}
                        onClick={() =>
                          setSelectedStopId((prev) =>
                            prev === stop.stopId ? null : stop.stopId
                          )
                        }
                      >
                        <Pin
                          background={colors.bg}
                          glyphColor={colors.glyph}
                          borderColor={colors.border}
                          glyph={String(idx + 1)}
                        />
                      </AdvancedMarker>
                      {selectedStopId === stop.stopId && (
                        <InfoWindow
                          key={`iw-${stop.stopId}`}
                          position={{ lat: stop.lat, lng: stop.lng }}
                          onClose={() => setSelectedStopId(null)}
                          pixelOffset={[0, -40]}
                        >
                          <div className="min-w-[160px] space-y-1 text-sm">
                            <p className="font-semibold text-gray-900">
                              Stop {idx + 1}
                            </p>
                            <p className="text-gray-600">{stop.address}</p>
                            {stop.notes && (
                              <p className="text-xs text-gray-500">{stop.notes}</p>
                            )}
                            {stop.timeWindow && (
                              <p className="text-xs text-amber-600">
                                Window: {stop.timeWindow.start}–{stop.timeWindow.end}
                              </p>
                            )}
                          </div>
                        </InfoWindow>
                      )}
                    </React.Fragment>
                  );
                })}

              {/* Driver live position */}
              {driverPos && (
                <AdvancedMarker
                  position={driverPos}
                  title="Driver (live)"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand-600 shadow-lg">
                    <svg
                      className="h-4 w-4 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616L18 10.804V17a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3H8v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-6.196l1.786-3.293-1.233-.616a1 1 0 01.894-1.79l1.599.8L9 4.323V3a1 1 0 011-1z" />
                    </svg>
                  </div>
                </AdvancedMarker>
              )}
            </Map>
            </div>
          </APIProvider>
        ) : (
          <div className="flex h-[280px] items-center justify-center text-gray-400 sm:h-[400px] lg:h-[500px]">
            Set NEXT_PUBLIC_GOOGLE_MAPS_KEY to enable the map
          </div>
        )}
      </div>

      {/* Live driver info */}
      {driverPos && (
        <div className="flex items-center gap-6 rounded-xl border border-brand-200 bg-brand-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-900">Driver Live</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>
              {(driverPos.speedMps * 2.237).toFixed(0)} mph
            </span>
            <span>
              {driverPos.heading.toFixed(0)}&deg; heading
            </span>
            {driverPos.updatedAt && (
              <span className="text-xs text-gray-400">
                Updated {new Date(driverPos.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* AI ETA Prediction */}
      {trip.status === "in_progress" && (
        <ETAPanel tripId={trip.id} />
      )}

      {/* Predictive ETA Engine (historical + weather-adjusted) */}
      {trip.status !== "cancelled" && (
        <PredictedEtaCard
          tripId={trip.id}
          prediction={trip.predictedEta}
          canPredict={role === "dispatcher" || role === "admin"}
        />
      )}

      {/* Stops (editable for non-terminal trips) */}
      <StopEditor
        tripId={trip.id}
        currentStops={stops}
        editable={trip.status !== "completed" && trip.status !== "cancelled"}
      />

      {/* Manual route override (drag-and-drop reorder + reason) */}
      {stops.length >= 2 && (
        <DraggableStopList
          tripId={trip.id}
          stops={stops}
          canOverride={trip.status !== "completed" && trip.status !== "cancelled"}
        />
      )}

      {/* Created / Updated */}
      <div className="flex gap-6 text-xs text-gray-400">
        <span>Created: {new Date(trip.createdAt).toLocaleString()}</span>
        <span>Updated: {new Date(trip.updatedAt).toLocaleString()}</span>
      </div>

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Cancel Trip</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to cancel this trip? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50"
              >
                Keep Trip
              </button>
              <button
                onClick={cancelTrip}
                disabled={cancelling}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? "Cancelling..." : "Cancel Trip"}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
