import React, { useEffect, useMemo, useState } from "react";
import { View, Text } from "react-native";
import type { Trip } from "@quickroutesai/shared";
import { useCurrentPosition } from "../hooks/useCurrentPosition";
import {
  computeTripETA,
  formatArrivalTime,
  formatDurationShort,
} from "../utils/eta";

interface Props {
  trip: Trip;
  enableLiveLocation?: boolean;
}

export default function TripETA({ trip, enableLiveLocation = true }: Props) {
  const position = useCurrentPosition({
    enabled: enableLiveLocation && trip.status === "in_progress",
  });

  const [clock, setClock] = useState<Date>(new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const eta = useMemo(
    () => computeTripETA(trip, position),
    [trip, position],
  );

  if (!eta.nextStop) {
    return null;
  }

  const hasTiming = eta.secondsToNextStop != null && eta.totalRemainingSeconds != null;

  return (
    <View className="mx-4 mt-3 rounded-xl border border-gray-200 bg-white px-5 py-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Next Stop ETA
      </Text>
      <View className="mt-1 flex-row items-baseline justify-between">
        <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
          {eta.nextStop.address}
        </Text>
        {hasTiming && (
          <Text className="ml-3 text-lg font-bold text-blue-600">
            {formatArrivalTime(eta.secondsToNextStop!, clock)}
          </Text>
        )}
      </View>
      {hasTiming && (
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-xs text-gray-500">
            {formatDurationShort(eta.secondsToNextStop!)} to next stop
          </Text>
          <Text className="text-xs text-gray-500">
            {formatDurationShort(eta.totalRemainingSeconds!)} remaining
          </Text>
        </View>
      )}
      {!hasTiming && (
        <Text className="mt-2 text-xs text-gray-400">
          ETA unavailable — waiting for route data
        </Text>
      )}
    </View>
  );
}
