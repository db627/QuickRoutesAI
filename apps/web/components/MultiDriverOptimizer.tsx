"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { DriverRecord, MultiDriverPlan } from "@quickroutesai/shared";

interface OnlineDriver {
  uid: string;
  name: string;
  isOnline: boolean;
}

interface Props {
  onClose: () => void;
}

export default function MultiDriverOptimizer({ onClose }: Props) {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<OnlineDriver[]>([]);
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set());
  const [stopText, setStopText] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [plans, setPlans] = useState<MultiDriverPlan[] | null>(null);
  const [overallReasoning, setOverallReasoning] = useState("");

  // Subscribe to online drivers
  useEffect(() => {
    const q = query(collection(firestore, "drivers"), where("isOnline", "==", true));
    const unsub = onSnapshot(q, async (snap) => {
      const driverDocs = snap.docs.map((d) => ({
        uid: d.id,
        ...(d.data() as Omit<DriverRecord, "uid">),
      }));

      // Resolve names from users collection
      const nameMap: Record<string, string> = {};
      await Promise.all(
        driverDocs.map(async (d) => {
          try {
            const res = await apiFetch<{ name: string }>(`/users/${d.uid}`).catch(() => null);
            nameMap[d.uid] = (res as any)?.name || d.uid.slice(0, 8);
          } catch {
            nameMap[d.uid] = d.uid.slice(0, 8);
          }
        }),
      );

      setDrivers(driverDocs.map((d) => ({ uid: d.uid, name: nameMap[d.uid] || d.uid.slice(0, 8), isOnline: true })));
    });
    return unsub;
  }, []);

  function toggleDriver(uid: string) {
    setSelectedDriverIds((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  async function runOptimization() {
    const addresses = stopText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (selectedDriverIds.size < 1) {
      toast.error("Select at least one driver");
      return;
    }
    if (addresses.length < 1) {
      toast.error("Enter at least one stop address");
      return;
    }
    if (addresses.length < selectedDriverIds.size) {
      toast.error("Must have at least as many stops as drivers");
      return;
    }

    setOptimizing(true);
    setPlans(null);
    try {
      const result = await apiFetch<{ plans: MultiDriverPlan[]; overallReasoning: string }>(
        "/ai/multi-assign",
        {
          method: "POST",
          body: JSON.stringify({
            driverIds: Array.from(selectedDriverIds),
            stops: addresses.map((address) => ({ address })),
          }),
        },
      );
      setPlans(result.plans);
      setOverallReasoning(result.overallReasoning);
      toast.success("Optimization complete — trips created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Optimization failed");
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <div>
          <h2 className="font-semibold text-gray-900">Multi-Driver Optimizer</h2>
          <p className="text-xs text-gray-400">AI distributes stops optimally across selected drivers</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!plans ? (
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          {/* Driver selection */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              Select Drivers ({selectedDriverIds.size} selected)
            </p>
            {drivers.length === 0 ? (
              <p className="text-sm text-gray-400">No drivers online</p>
            ) : (
              <div className="space-y-2">
                {drivers.map((d) => (
                  <label key={d.uid} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedDriverIds.has(d.uid)}
                      onChange={() => toggleDriver(d.uid)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600"
                    />
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="text-sm font-medium text-gray-900">{d.name}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Stop addresses */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              Stop Addresses <span className="font-normal text-gray-400">(one per line)</span>
            </p>
            <textarea
              value={stopText}
              onChange={(e) => setStopText(e.target.value)}
              placeholder={"123 Main St, New York, NY\n456 Oak Ave, Brooklyn, NY\n789 Pine Rd, Queens, NY"}
              rows={8}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              {stopText.split("\n").filter((l) => l.trim()).length} stops entered
            </p>
          </div>
        </div>
      ) : (
        /* Results */
        <div className="p-5 space-y-4">
          {overallReasoning && (
            <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">AI Reasoning</p>
              <p className="mt-1 text-sm text-gray-700">{overallReasoning}</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((plan) => (
              <div key={plan.driverId} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{plan.driverName}</p>
                    <p className="text-xs text-gray-400">{plan.stops.length} stop{plan.stops.length !== 1 && "s"}</p>
                  </div>
                  <Link
                    href={`/dashboard/trips/${plan.tripId}`}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                  >
                    View Trip
                  </Link>
                </div>
                <ol className="space-y-1">
                  {plan.stops.map((stop, i) => (
                    <li key={stop.stopId} className="flex items-start gap-2 text-xs text-gray-600">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                        {i + 1}
                      </span>
                      <span className="truncate">{stop.address}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <button
            onClick={() => { setPlans(null); setStopText(""); setSelectedDriverIds(new Set()); }}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Run another optimization
          </button>
        </div>
      )}

      {!plans && (
        <div className="flex justify-end border-t border-gray-200 px-5 py-3">
          <button
            onClick={runOptimization}
            disabled={optimizing || selectedDriverIds.size === 0}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {optimizing ? "Optimizing..." : "Run Optimization"}
          </button>
        </div>
      )}
    </div>
  );
}
