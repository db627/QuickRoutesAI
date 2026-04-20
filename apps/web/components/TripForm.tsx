"use client";

import { useState, useEffect, useRef } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { Trip, TripStop } from "@quickroutesai/shared";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

// ── Per-stop form state ────────────────────────────────────────────────────

interface StopField {
  address: string;
  contactName: string;
  timeWindowStart: string; // HH:mm or ""
  timeWindowEnd: string;   // HH:mm or ""
  lat?: number;
  lng?: number;
}

function emptyStop(): StopField {
  return { address: "", contactName: "", timeWindowStart: "", timeWindowEnd: "" };
}

function stopFromTripStop(s: TripStop): StopField {
  return {
    address: s.address,
    contactName: s.contactName ?? "",
    timeWindowStart: s.timeWindow?.start ?? "",
    timeWindowEnd: s.timeWindow?.end ?? "",
    lat: s.lat,
    lng: s.lng,
  };
}

// ── Types ──────────────────────────────────────────────────────────────────

interface TripFormProps {
  onCreated: () => void;
  tripId?: string;
  initialStops?: TripStop[];
}

interface AddressCorrection {
  original: string;
  corrected: string;
  confidence: number;
  changed: boolean;
}

// ── Google Places autocomplete input ──────────────────────────────────────
// Only rendered inside an APIProvider — calls useMapsLibrary safely.

interface PlacesInputProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (address: string, lat: number, lng: number) => void;
  placeholder?: string;
  className?: string;
}

function PlacesInput({ value, onChange, onPlaceSelect, placeholder, className }: PlacesInputProps) {
  const placesLib = useMapsLibrary("places");
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;

    autocompleteRef.current = new placesLib.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "geometry"],
    });

    const listener = autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current?.getPlace();
      if (place?.formatted_address) {
        onChange(place.formatted_address);
        if (place.geometry?.location) {
          onPlaceSelect(
            place.formatted_address,
            place.geometry.location.lat(),
            place.geometry.location.lng(),
          );
        }
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [placesLib]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

// ── Inner form ─────────────────────────────────────────────────────────────

function TripFormInner({
  onCreated,
  tripId,
  initialStops,
  hasPlaces,
}: TripFormProps & { hasPlaces: boolean }) {
  const { toast } = useToast();
  const isEditMode = !!tripId;

  const [stops, setStops] = useState<StopField[]>(() =>
    initialStops && initialStops.length >= 2
      ? initialStops.map(stopFromTripStop)
      : [emptyStop(), emptyStop()],
  );
  const [loading, setLoading] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [corrections, setCorrections] = useState<(AddressCorrection | null)[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const updateStop = (index: number, partial: Partial<StopField>) => {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...partial } : s)));
    if (partial.address !== undefined) {
      setCorrections((prev) => prev.map((c, i) => (i === index ? null : c)));
    }
    if (errors.length) setErrors([]);
  };

  const addStop = () => {
    setStops((prev) => [...prev, emptyStop()]);
    setCorrections((prev) => [...prev, null]);
  };

  const removeStop = (index: number) => {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((_, i) => i !== index));
    setCorrections((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    setStops((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setCorrections((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    stops.forEach((s, i) => {
      const label = `Stop ${i + 1}`;
      if (!s.address.trim()) errs.push(`${label}: address is required`);
      if (!s.contactName.trim()) errs.push(`${label}: contact name is required`);
      const hasStart = !!s.timeWindowStart;
      const hasEnd = !!s.timeWindowEnd;
      if (hasStart !== hasEnd) {
        errs.push(`${label}: both time window fields must be filled`);
      } else if (hasStart && hasEnd && s.timeWindowStart >= s.timeWindowEnd) {
        errs.push(`${label}: time window start must be before end`);
      }
    });
    return errs;
  };

  const checkAddresses = async () => {
    const nonEmpty = stops.filter((s) => s.address.trim());
    if (nonEmpty.length === 0) return;

    setCorrecting(true);
    try {
      const res = await apiFetch<{ corrections: AddressCorrection[] }>("/ai/correct-addresses", {
        method: "POST",
        body: JSON.stringify({ addresses: stops.map((s) => s.address) }),
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
    if (!correction?.changed) return;
    updateStop(index, { address: correction.corrected, lat: undefined, lng: undefined });
    setCorrections((prev) => prev.map((c, i) => (i === index ? null : c)));
  };

  const applyAllCorrections = () => {
    setStops((prev) =>
      prev.map((s, i) => {
        const c = corrections[i];
        return c?.changed ? { ...s, address: c.corrected, lat: undefined, lng: undefined } : s;
      }),
    );
    setCorrections([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const payload = {
        stops: stops.map((s, i) => ({
          address: s.address,
          contactName: s.contactName,
          lat: s.lat,
          lng: s.lng,
          sequence: i,
          notes: "",
          ...(s.timeWindowStart && s.timeWindowEnd
            ? { timeWindow: { start: s.timeWindowStart, end: s.timeWindowEnd } }
            : {}),
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

      toast.success(isEditMode ? "Trip updated successfully" : "Trip created successfully");
      onCreated();
    } catch (err) {
      // Surface the real error to the console so it's debuggable — the toast
      // only shows err.message, which loses stack + any response details.
      console.error(
        isEditMode ? "Failed to update trip:" : "Failed to create trip:",
        err,
      );
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

  const addressInputClass = (i: number) =>
    `w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none ${
      corrections[i]?.changed ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
    }`;

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <h3 className="font-semibold text-gray-900">{isEditMode ? "Edit Trip" : "New Trip"}</h3>

      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-1">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {stops.map((stop, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          {/* Stop header with reorder + remove controls */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Stop {i + 1}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveStop(i, -1)}
                disabled={i === 0}
                title="Move up"
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveStop(i, 1)}
                disabled={i === stops.length - 1}
                title="Move down"
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30"
              >
                ↓
              </button>
              {stops.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  title="Remove stop"
                  className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-red-500"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Address with optional Places autocomplete */}
          <div className="space-y-1">
            {hasPlaces ? (
              <PlacesInput
                value={stop.address}
                onChange={(v) => updateStop(i, { address: v, lat: undefined, lng: undefined })}
                onPlaceSelect={(addr, lat, lng) => updateStop(i, { address: addr, lat, lng })}
                placeholder="Address"
                className={addressInputClass(i)}
              />
            ) : (
              <input
                value={stop.address}
                onChange={(e) =>
                  updateStop(i, { address: e.target.value, lat: undefined, lng: undefined })
                }
                placeholder="Address"
                className={addressInputClass(i)}
              />
            )}
            {corrections[i]?.changed && (
              <div className="flex items-center gap-2 pl-1">
                <span className="text-xs text-amber-600">
                  Suggested:{" "}
                  <span className="font-medium">{corrections[i]!.corrected}</span>
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

          {/* Contact name */}
          <input
            value={stop.contactName}
            onChange={(e) => updateStop(i, { contactName: e.target.value })}
            placeholder="Contact name"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
          />

          {/* Time window */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-gray-500">Time window</span>
            <input
              type="time"
              value={stop.timeWindowStart}
              onChange={(e) => updateStop(i, { timeWindowStart: e.target.value })}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="time"
              value={stop.timeWindowEnd}
              onChange={(e) => updateStop(i, { timeWindowEnd: e.target.value })}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
            />
          </div>
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
          disabled={correcting || stops.every((s) => !s.address.trim())}
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

// ── Thin bridge: loads Maps context then renders inner form ────────────────

function TripFormWithPlaces(props: TripFormProps) {
  // useMapsLibrary triggers the places library load; PlacesInput components
  // inside TripFormInner each call it too — both are safe inside APIProvider.
  const placesLib = useMapsLibrary("places");
  return <TripFormInner {...props} hasPlaces={!!placesLib} />;
}

// ── Public export ──────────────────────────────────────────────────────────

export default function TripForm(props: TripFormProps) {
  if (!MAPS_KEY) {
    return <TripFormInner {...props} hasPlaces={false} />;
  }
  return (
    <APIProvider apiKey={MAPS_KEY}>
      <TripFormWithPlaces {...props} />
    </APIProvider>
  );
}
