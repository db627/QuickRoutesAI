import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { getWeeklyShifts, formatHoursMinutes, type WeeklyShiftsResponse } from "../services/shifts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return WEEKDAYS[date.getDay()];
}

function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}/${d}`;
}

export default function WeeklyHoursScreen() {
  const [data, setData] = useState<WeeklyShiftsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getWeeklyShifts();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hours");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-base text-gray-700 text-center">{error ?? "No data available"}</Text>
      </View>
    );
  }

  const maxSeconds = Math.max(1, ...data.days.map((d) => d.totalSeconds));

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View className="rounded-2xl bg-white border border-gray-200 p-4 mb-4">
        <Text className="text-xs text-gray-500">Last 7 days</Text>
        <Text className="text-3xl font-semibold text-gray-900 mt-1">
          {formatHoursMinutes(data.totalSeconds)}
        </Text>
        <Text className="text-xs text-gray-500 mt-0.5">
          {data.days.reduce((sum, d) => sum + d.shiftCount, 0)} shifts
        </Text>
      </View>

      <View className="rounded-2xl bg-white border border-gray-200 p-4">
        {data.days.map((day, i) => {
          const widthPct = (day.totalSeconds / maxSeconds) * 100;
          const isLast = i === data.days.length - 1;
          return (
            <View key={day.date} className={`${isLast ? "" : "mb-3"}`}>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm text-gray-700 w-20">
                  {dayLabel(day.date)} <Text className="text-gray-400">{shortDate(day.date)}</Text>
                </Text>
                <Text className="text-sm font-medium text-gray-900">
                  {day.totalSeconds === 0 ? "—" : formatHoursMinutes(day.totalSeconds)}
                </Text>
              </View>
              <View className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <View
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: `${widthPct}%` }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
