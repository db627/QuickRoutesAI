"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { DriverRecord } from "@quickroutesai/shared";
import { Users, Truck, Loader, CheckCircle } from "lucide-react";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

interface TripStats {
  totalTrips: number;
  inProgressTrips: number;
  completedToday: number;
}

interface Stats {
  activeDrivers: number;
  totalTrips: number;
  inProgressTrips: number;
  completedToday: number;
}

export default function StatsCards() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    activeDrivers: 0,
    totalTrips: 0,
    inProgressTrips: 0,
    completedToday: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [activeDrivers, tripStats] = await Promise.all([
          apiFetch<DriverRecord[]>("/drivers/active"),
          apiFetch<TripStats>("/trips/stats"),
        ]);

        setStats({
          activeDrivers: activeDrivers.length,
          totalTrips: tripStats.totalTrips,
          inProgressTrips: tripStats.inProgressTrips,
          completedToday: tripStats.completedToday,
        });
      } catch {
        // Keep zeros on error — display degrades gracefully
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

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
