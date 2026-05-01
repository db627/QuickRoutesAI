"use client";

import { useAuth } from "@/lib/auth-context";
import DriverMap from "@/components/DriverMap";
import DriverList from "@/components/DriverList";
import DriverDetailPanel from "@/components/DriverDetailPanel";
import TripList from "@/components/TripList";
import TripForm from "@/components/TripForm";
import StatsCards from "@/components/StatsCards";
import InsightsSection from "@/components/InsightsSection";
import MultiDriverOptimizer from "@/components/MultiDriverOptimizer";
import DriverLeaderboard from "@/components/DriverLeaderboard";
import { useState } from "react";

export default function DashboardPage() {
  const { role } = useAuth();
  const [showTripForm, setShowTripForm] = useState(false);
  const [showMultiOptimizer, setShowMultiOptimizer] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

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
        <div className="flex gap-2">
          <button
            onClick={() => { setShowMultiOptimizer(!showMultiOptimizer); setShowTripForm(false); }}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:border-gray-300"
          >
            {showMultiOptimizer ? "Close" : "Multi-Driver"}
          </button>
          <button
            onClick={() => { setShowTripForm(!showTripForm); setShowMultiOptimizer(false); }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showTripForm ? "Close" : "Create Trip"}
          </button>
        </div>
      </div>

      {showTripForm && (
        <TripForm onCreated={() => setShowTripForm(false)} />
      )}

      {showMultiOptimizer && (
        <MultiDriverOptimizer onClose={() => setShowMultiOptimizer(false)} />
      )}

      {/* AI Insights */}
      <InsightsSection />

      {/* Stats overview */}
      <StatsCards />

      {/* Live driver map */}
      <div className="rounded-xl border border-gray-200 bg-white p-1">
        <DriverMap onSelectDriver={setSelectedDriverId} />
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DriverList onSelectDriver={setSelectedDriverId} />
        <TripList />
      </div>

      {/* Driver leaderboard */}
      <DriverLeaderboard onSelectDriver={setSelectedDriverId} />

      <DriverDetailPanel
        driverId={selectedDriverId}
        onClose={() => setSelectedDriverId(null)}
      />
    </div>
  );
}
