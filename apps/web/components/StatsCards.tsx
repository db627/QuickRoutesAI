"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { Users, Truck, Loader, CheckCircle } from "lucide-react";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { useAuth } from "@/lib/auth-context";

interface Stats {
  activeDrivers: number;
  totalTrips: number;
  inProgressTrips: number;
  completedToday: number;
}

export default function StatsCards() {
  const { orgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    activeDrivers: 0,
    totalTrips: 0,
    inProgressTrips: 0,
    completedToday: 0,
  });

  useEffect(() => {
    // Without an orgId we have no scope to filter by — show zeros instead of
    // leaking cross-org counts via unscoped subscriptions.
    if (!orgId) {
      setStats({
        activeDrivers: 0,
        totalTrips: 0,
        inProgressTrips: 0,
        completedToday: 0,
      });
      setLoading(false);
      return;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayIso = startOfToday.toISOString();

    let resolved = 0;
    const partial: Partial<Stats> = {};

    function merge(patch: Partial<Stats>) {
      Object.assign(partial, patch);
      resolved += 1;
      if (resolved === 4) {
        setStats({ ...partial } as Stats);
        setLoading(false);
      }
    }

    const unsubActiveDrivers = onSnapshot(
      query(
        collection(firestore, "drivers"),
        where("orgId", "==", orgId),
        where("isOnline", "==", true),
      ),
      (snap) => {
        if (resolved < 4) {
          merge({ activeDrivers: snap.size });
        } else {
          setStats((prev) => ({ ...prev, activeDrivers: snap.size }));
        }
      },
    );

    const unsubTotalTrips = onSnapshot(
      query(collection(firestore, "trips"), where("orgId", "==", orgId)),
      (snap) => {
        if (resolved < 4) {
          merge({ totalTrips: snap.size });
        } else {
          setStats((prev) => ({ ...prev, totalTrips: snap.size }));
        }
      },
    );

    const unsubInProgress = onSnapshot(
      query(
        collection(firestore, "trips"),
        where("orgId", "==", orgId),
        where("status", "in", ["assigned", "in_progress"]),
      ),
      (snap) => {
        if (resolved < 4) {
          merge({ inProgressTrips: snap.size });
        } else {
          setStats((prev) => ({ ...prev, inProgressTrips: snap.size }));
        }
      },
    );

    const unsubCompletedToday = onSnapshot(
      query(
        collection(firestore, "trips"),
        where("orgId", "==", orgId),
        where("status", "==", "completed"),
        where("updatedAt", ">=", todayIso),
      ),
      (snap) => {
        if (resolved < 4) {
          merge({ completedToday: snap.size });
        } else {
          setStats((prev) => ({ ...prev, completedToday: snap.size }));
        }
      },
    );

    return () => {
      unsubActiveDrivers();
      unsubTotalTrips();
      unsubInProgress();
      unsubCompletedToday();
    };
  }, [orgId]);

  const cards = [
    { label: "Active Drivers", value: stats.activeDrivers, color: "text-green-600", icon: Users },
    { label: "Total Trips", value: stats.totalTrips, color: "text-gray-900", icon: Truck },
    { label: "In-Progress Trips", value: stats.inProgressTrips, color: "text-brand-600", icon: Loader },
    { label: "Completed Today", value: stats.completedToday, color: "text-purple-600", icon: CheckCircle },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
            <div className="flex items-center justify-between">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-5 w-5" />
            </div>
            <SkeletonBlock className="mt-3 h-8 w-16" />
          </div>
        ))
      ) : (
        cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">{card.label}</p>
                <Icon className="h-5 w-5 text-gray-400" />
              </div>
              <p className={`mt-1 text-3xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          );
        })
      )}
    </div>
  );
}
