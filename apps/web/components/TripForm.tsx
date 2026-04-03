"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { Trip } from "@quickroutesai/shared";

interface TripFormProps {
  onCreated: () => void;
  tripId?: string;
  initialStops?: string[];
}

interface AddressCorrection {
  original: string;
  corrected: string;
  confidence: number;
  changed: boolean;
}

export default function TripForm({ onCreated, tripId, initialStops }: TripFormProps) {
  const { toast } = useToast();
  const [stops, setStops] = useState<string[]>(initialStops ?? ["", ""]);
  const [loading, setLoading] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [corrections, setCorrections] = useState<(AddressCorrection | null)[]>([]);

  const isEditMode = !!tripId;

  const updateStop = (index: number, value: string) => {
    setStops((prev) => prev.map((s, i) => (i === index ? value : s)));
    // Clear correction for this stop when user edits
    setCorrections((prev) => prev.map((c, i) => (i === index ? null : c)));
  };

  const addStop = () => {
    setStops((prev) => [...prev, ""]);
    setCorrections((prev) => [...prev, null]);
  };

  const removeStop = (index: number) => {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((_, i) => i !== index));
    setCorrections((prev) => prev.filter((_, i) => i !== index));
  };

  const checkAddresses = async () => {
    const nonEmpty = stops.filter((s) => s.trim());
    if (nonEmpty.length === 0) return;

    setCorrecting(true);
    try {
      const res = await apiFetch<{ corrections: AddressCorrection[] }>("/ai/correct-addresses", {
        method: "POST",
        body: JSON.stringify({ addresses: stops }),
      });

      setCorrections(res.corrections);
      const changedCount = res.corrections.filter((c) => c.changed).length;
      if (changedCount > 0) {
        toast.info(`AI found ${changedCount} address correction${changedCount > 1 ? "s" : ""}`);
      } else {
        toast.success("All addresses look good!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Address check failed");
    } finally {
      setCorrecting(false);
    }
  };

  const applyCorrection = (index: number) => {
    const correction = corrections[index];
    if (!correction || !correction.changed) return;
    setStops((prev) => prev.map((s, i) => (i === index ? correction.corrected : s)));
    setCorrections((prev) => prev.map((c, i) => (i === index ? null : c)));
  };

  const applyAllCorrections = () => {
    setStops((prev) =>
      prev.map((s, i) => {
        const c = corrections[i];
        return c?.changed ? c.corrected : s;
      }),
    );
    setCorrections([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        stops: stops.map((address, i) => ({
          address,
          sequence: i,
          notes: "",
        })),
      };

      if (isEditMode) {
        await apiFetch<Trip>(`/trips/${tripId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch<Trip>("/trips", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      toast.success("Trip created successfully");
      onCreated();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isEditMode
            ? "Failed to update trip"
            : "Failed to create trip",
      );
    } finally {
      setLoading(false);
    }
  };

  const hasCorrections = corrections.some((c) => c?.changed);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-gray-200 bg-white p-5 space-y-4"
    >
      <h3 className="font-semibold text-gray-900">
        {isEditMode ? "Edit Trip" : "New Trip"}
      </h3>

      {stops.map((address, i) => (
        <div key={i} className="space-y-1">
          <div className="flex gap-2">
            <input
              placeholder={`Stop ${i + 1} address`}
              value={address}
              onChange={(e) => updateStop(i, e.target.value)}
              required
              className={`flex-1 rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none ${
                corrections[i]?.changed
                  ? "border-amber-300 bg-amber-50"
                  : "border-gray-200 bg-gray-50"
              }`}
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
          {corrections[i]?.changed && (
            <div className="flex items-center gap-2 pl-1">
              <span className="text-xs text-amber-600">
                Suggested: <span className="font-medium">{corrections[i]!.corrected}</span>
                <span className="ml-1 text-amber-400">
                  ({Math.round(corrections[i]!.confidence * 100)}% confident)
                </span>
              </span>
              <button
                type="button"
                onClick={() => applyCorrection(i)}
                className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={addStop}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900"
        >
          + Add Stop
        </button>
        <button
          type="button"
          onClick={checkAddresses}
          disabled={correcting || stops.every((s) => !s.trim())}
          className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-600 hover:bg-purple-100 disabled:opacity-50"
        >
          {correcting ? "Checking..." : "AI Check Addresses"}
        </button>
        {hasCorrections && (
          <button
            type="button"
            onClick={applyAllCorrections}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Apply All Corrections
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading
            ? isEditMode
              ? "Saving..."
              : "Creating..."
            : isEditMode
              ? "Save Changes"
              : "Create Trip"}
        </button>
      </div>
    </form>
  );
}
