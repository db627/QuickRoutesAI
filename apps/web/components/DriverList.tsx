"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { DriverRecord, UserProfile } from "@quickroutesai/shared";

export default function DriverList() {
  const [drivers, setDrivers] = useState<(DriverRecord & { uid: string })[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  useEffect(() => {
    // Subscribe to online drivers
    const q = query(collection(firestore, "drivers"), where("isOnline", "==", true));
    const unsub = onSnapshot(q, (snapshot) => {
      setDrivers(
        snapshot.docs.map((doc) => ({
          uid: doc.id,
          ...(doc.data() as Omit<DriverRecord, "uid">),
        })),
      );
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Subscribe to all users to get display names
    const unsub = onSnapshot(collection(firestore, "users"), (snapshot) => {
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
  }, []);

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
        {drivers.length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-gray-400">No drivers online</p>
        )}
        {drivers.map((d) => (
          <div key={d.uid} className="flex items-center justify-between px-5 py-3">
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
                  {(d.lastSpeedMps * 3.6).toFixed(0)} km/h
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
          </div>
        ))}
      </div>
    </div>
  );
}
