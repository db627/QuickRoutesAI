"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Trip } from "@quickroutesai/shared";

interface TripFormProps {
  onCreated: () => void;
}

export default function TripForm({ onCreated }: TripFormProps) {
  const [stops, setStops] = useState<string[]>(["", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const updateStop = (index: number, value: string) => {
    setStops((prev) => prev.map((s, i) => (i === index ? value : s)));
  };

  const addStop = () => setStops((prev) => [...prev, ""]);

  const removeStop = (index: number) => {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload = {
        stops: stops.map((address, i) => ({
          address,
          sequence: i,
          notes: "",
        })),
      };

      await apiFetch<Trip>("/trips", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-gray-200 bg-white p-5 space-y-4"
    >
      <h3 className="font-semibold text-gray-900">New Trip</h3>

      {stops.map((address, i) => (
        <div key={i} className="flex gap-2">
          <input
            placeholder={`Stop ${i + 1} address`}
            value={address}
            onChange={(e) => updateStop(i, e.target.value)}
            required
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
          />
          {stops.length > 2 && (
            <button
              type="button"
              onClick={() => removeStop(i)}
              className="rounded-lg px-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
            >
              X
            </button>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={addStop}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900"
        >
          + Add Stop
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Trip"}
        </button>
      </div>
    </form>
  );
}
