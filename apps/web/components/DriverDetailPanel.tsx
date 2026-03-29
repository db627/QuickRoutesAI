"use client";

import { useEffect, useState } from "react";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { firestore } from "@/lib/firebase";
import type { DriverRecord, UserProfile, Trip } from "@quickroutesai/shared";

interface Props {
  driverId: string | null;
  onClose: () => void;
}

export default function DriverDetailPanel({ driverId, onClose }: Props) {
  const [driver, setDriver] = useState<(DriverRecord & { uid: string }) | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);

  useEffect(() => {
    if (!driverId) {
      setDriver(null);
      setProfile(null);
      setActiveTrip(null);
      return;
    }

    const unsubDriver = onSnapshot(doc(firestore, "drivers", driverId), (snap) => {
      if (snap.exists()) {
        setDriver({ uid: snap.id, ...(snap.data() as Omit<DriverRecord, "uid">) });
      } else {
        setDriver(null);
      }
    });

    const unsubProfile = onSnapshot(doc(firestore, "users", driverId), (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      } else {
        setProfile(null);
      }
    });

    const tripQ = query(
      collection(firestore, "trips"),
      where("driverId", "==", driverId),
      where("status", "in", ["assigned", "in_progress"]),
    );
    const unsubTrip = onSnapshot(tripQ, (snap) => {
      setActiveTrip(
        snap.docs.length > 0
          ? { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<Trip, "id">) }
          : null,
      );
    });

    return () => {
      unsubDriver();
      unsubProfile();
      unsubTrip();
    };
  }, [driverId]);

  const isOpen = driverId !== null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={onClose}
          aria-hidden="true"
          data-testid="panel-backdrop"
        />
      )}

      {/* Slide-out panel */}
      <div
        role="dialog"
        aria-label="Driver detail panel"
        aria-modal="true"
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto bg-white shadow-2xl transition-transform duration-300 ease-in-out sm:w-96 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900">Driver Details</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close panel"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Loading spinner while driver doc arrives */}
        {isOpen && !driver && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        )}

        {/* Content */}
        {driver && (
          <div className="space-y-6 px-5 py-5">
            {/* Name + online indicator */}
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 flex-shrink-0 rounded-full ${
                  driver.isOnline ? "bg-green-500" : "bg-gray-300"
                }`}
                aria-label={driver.isOnline ? "Online" : "Offline"}
                data-testid="online-indicator"
              />
              <div className="min-w-0">
                <p className="truncate font-semibold text-gray-900" data-testid="driver-name">
                  {profile?.name || driverId}
                </p>
                {profile?.email && (
                  <p className="truncate text-sm text-gray-500" data-testid="driver-email">
                    {profile.email}
                  </p>
                )}
              </div>
            </div>

            {/* Online status row */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Status
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    driver.isOnline ? "bg-green-500" : "bg-gray-300"
                  }`}
                />
                <span className="text-sm text-gray-700">
                  {driver.isOnline ? "Online" : "Offline"}
                </span>
              </div>
            </div>

            {/* Last known location */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Last Location
              </p>
              <p className="mt-1 text-sm text-gray-700" data-testid="driver-location">
                {driver.lastLocation
                  ? `${driver.lastLocation.lat.toFixed(5)}, ${driver.lastLocation.lng.toFixed(5)}`
                  : "Unknown"}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                Updated {new Date(driver.updatedAt).toLocaleString()}
              </p>
            </div>

            {/* Current trip */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Current Trip
              </p>
              {activeTrip ? (
                <div className="mt-1 flex items-center gap-2">
                  <Link
                    href={`/dashboard/trips/${activeTrip.id}`}
                    className="text-sm font-medium text-brand-600 hover:underline"
                    data-testid="trip-link"
                  >
                    {activeTrip.id}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      activeTrip.status === "in_progress"
                        ? "bg-green-50 text-green-600"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    {activeTrip.status.replace("_", " ")}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-400" data-testid="no-trip">
                  No active trip
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
