"use client";

import { useAuth } from "@/lib/auth-context";
import DriverMap from "@/components/DriverMap";
import DriverList from "@/components/DriverList";
import TripList from "@/components/TripList";
import TripForm from "@/components/TripForm";
import StatsCards from "@/components/StatsCards";
import { useState } from "react";

export default function DashboardPage() {
  const { role } = useAuth();
  const [showTripForm, setShowTripForm] = useState(false);

  if (role === "driver") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Driver Account</h1>
          <p className="mt-2 text-gray-500">
            Please use the QuickRoutesAI mobile app for driver features.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Monitor drivers and manage routes in real time.</p>
        </div>
        <button
          onClick={() => setShowTripForm(!showTripForm)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showTripForm ? "Close" : "Create Trip"}
        </button>
      </div>

      {showTripForm && (
        <TripForm onCreated={() => setShowTripForm(false)} />
      )}

      {/* Stats overview */}
      <StatsCards />

      {/* Live driver map */}
      <div className="rounded-xl border border-gray-200 bg-white p-1">
        <DriverMap />
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DriverList />
        <TripList />
      </div>
    </div>
  );
}
