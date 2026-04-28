"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { DriverRecord, UserProfile } from "@quickroutesai/shared";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { useAuth } from "@/lib/auth-context";

interface Props {
  onSelectDriver?: (uid: string) => void;
}

export default function DriverList({ onSelectDriver }: Props) {
  const { orgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<(DriverRecord & { uid: string })[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  useEffect(() => {
    // Without an orgId we have no scope to filter by — bail rather than
    // subscribing to the entire cross-org drivers collection.
    if (!orgId) {
      setDrivers([]);
      setLoading(false);
      return;
    }
    // Subscribe to online drivers in the current org
    const q = query(
      collection(firestore, "drivers"),
      where("orgId", "==", orgId),
      where("isOnline", "==", true),
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setDrivers(
        snapshot.docs.map((doc) => ({
          uid: doc.id,
          ...(doc.data() as Omit<DriverRecord, "uid">),
        })),
      );
      setLoading(false);
    });
    return unsub;
  }, [orgId]);

  useEffect(() => {
    if (!orgId) {
      setUserNames({});
      return;
    }
    // Subscribe to org users to get display names
    const q = query(collection(firestore, "users"), where("orgId", "==", orgId));
    const unsub = onSnapshot(q, (snapshot) => {
      const names: Record<string, string> = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data() as UserProfile;
        if (data.name) {
          names[doc.id] = data.name;
        }
      });
      setUserNames(names);
    });
    return unsub;
  }, [orgId]);

  const isStale = (updatedAt: string) => {
    const diff = Date.now() - new Date(updatedAt).getTime();
    return diff > 5 * 60 * 1000; // 5 minutes
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-3">
        <h2 className="font-semibold text-gray-900">Active Drivers</h2>
      </div>
      <div className="divide-y divide-gray-200">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3">
              <div className="space-y-1.5">
                <SkeletonBlock className="h-3.5 w-32" />
                <SkeletonBlock className="h-3 w-24" />
              </div>
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-5 w-12 rounded-full" />
                <SkeletonBlock className="h-5 w-10 rounded-full" />
              </div>
            </div>
          ))
        ) : drivers.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-400">No drivers online</p>
        ) : (
          drivers.map((d) => (
            <button
              key={d.uid}
              onClick={() => onSelectDriver?.(d.uid)}
              className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {userNames[d.uid] || d.uid}
                </p>
                <p className="text-xs text-gray-400">
                  {d.lastLocation
                    ? `${d.lastLocation.lat.toFixed(4)}, ${d.lastLocation.lng.toFixed(4)}`
                    : "No location"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {d.lastSpeedMps > 0 && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                    {(d.lastSpeedMps * 2.237).toFixed(0)} mph
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isStale(d.updatedAt)
                      ? "bg-yellow-50 text-yellow-600"
                      : "bg-green-50 text-green-600"
                  }`}
                >
                  {isStale(d.updatedAt) ? "Stale" : "Live"}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
