import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getTodayShifts, formatHoursMinutes } from "../services/shifts";

interface Props {
  isOnline: boolean;
  onPress?: () => void;
}

export default function TodayHoursCard({ isOnline, onPress }: Props) {
  const [totalSeconds, setTotalSeconds] = useState<number | null>(null);
  const [openShiftStartedAt, setOpenShiftStartedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getTodayShifts();
      setTotalSeconds(data.totalSeconds);
      const open = data.shifts.find((s) => s.endedAt === null);
      setOpenShiftStartedAt(open ? open.startedAt : null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, isOnline]);

  // Live ticker: when a shift is open, recompute display every 30s
  useEffect(() => {
    if (!openShiftStartedAt) return;
    const interval = setInterval(() => {
      // Force re-render so the elapsed time below recomputes
      setTotalSeconds((prev) => prev);
    }, 30000);
    return () => clearInterval(interval);
  }, [openShiftStartedAt]);

  let displaySeconds = totalSeconds ?? 0;
  if (openShiftStartedAt && totalSeconds != null) {
    // totalSeconds from server includes elapsed at the moment of fetch.
    // For live ticking between fetches, add seconds since that fetch — but
    // we don't track fetch time here, so just compute from openShiftStartedAt
    // each render and let the server total be a baseline floor.
    const elapsed = Math.floor((Date.now() - new Date(openShiftStartedAt).getTime()) / 1000);
    // Use whichever is larger so we don't ever go backwards visually.
    displaySeconds = Math.max(totalSeconds, elapsed);
  }

  const Inner = (
    <View className="mx-4 mt-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 flex-row items-center">
      <View className="h-9 w-9 rounded-full bg-brand-50 items-center justify-center mr-3">
        <Ionicons name="time-outline" size={20} color="#2563eb" />
      </View>
      <View className="flex-1">
        <Text className="text-xs text-gray-500">Today</Text>
        {loading ? (
          <ActivityIndicator size="small" />
        ) : error ? (
          <Text className="text-sm text-gray-400">Hours unavailable</Text>
        ) : (
          <Text className="text-base font-semibold text-gray-900">
            {formatHoursMinutes(displaySeconds)}
            {openShiftStartedAt ? <Text className="text-xs font-normal text-green-600"> · live</Text> : null}
          </Text>
        )}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color="#9ca3af" /> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {Inner}
      </TouchableOpacity>
    );
  }
  return Inner;
}
