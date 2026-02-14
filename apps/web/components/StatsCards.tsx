"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";

interface Stats {
  activeDrivers: number;
  totalTrips: number;
  inProgressTrips: number;
  completedToday: number;
}

export default function StatsCards() {
  const [stats, setStats] = useState<Stats>({
    activeDrivers: 0,
    totalTrips: 0,
    inProgressTrips: 0,
    completedToday: 0,
  });

  useEffect(() => {
    // Subscribe to online drivers
    const driversQuery = query(
      collection(firestore, "drivers"),
      where("isOnline", "==", true),
    );
    const unsubDrivers = onSnapshot(driversQuery, (snapshot) => {
      setStats((prev) => ({ ...prev, activeDrivers: snapshot.size }));
    });

    // Subscribe to all trips
    const tripsQuery = query(collection(firestore, "trips"));
    const unsubTrips = onSnapshot(tripsQuery, (snapshot) => {
      let total = 0;
      let inProgress = 0;
      let completedToday = 0;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      snapshot.docs.forEach((doc) => {
        total++;
        const data = doc.data();
        if (data.status === "in_progress") inProgress++;
        if (data.status === "completed" && data.updatedAt) {
          const updatedAt = new Date(data.updatedAt);
          if (updatedAt >= todayStart) completedToday++;
        }
      });

      setStats((prev) => ({
        ...prev,
        totalTrips: total,
        inProgressTrips: inProgress,
        completedToday,
      }));
    });

    return () => {
      unsubDrivers();
      unsubTrips();
    };
  }, []);

  const cards = [
    { label: "Active Drivers", value: stats.activeDrivers, color: "text-green-600" },
    { label: "Total Trips", value: stats.totalTrips, color: "text-gray-900" },
    { label: "In-Progress Trips", value: stats.inProgressTrips, color: "text-brand-600" },
    { label: "Completed Today", value: stats.completedToday, color: "text-purple-600" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4"
        >
          <p className="text-sm text-gray-500">{card.label}</p>
          <p className={`mt-1 text-3xl font-bold ${card.color}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
