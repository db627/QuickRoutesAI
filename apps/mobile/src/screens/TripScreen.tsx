import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";
import type { Trip } from "@quickroutesai/shared";
import { stopTracking } from "../services/location";

type Props = {
  navigation: { navigate: (screen: string, params: { tripId: string }) => void };
};

export default function TripScreen({ navigation }: Props) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusUpdateInFlight, setStatusUpdateInFlight] = useState(false);
  const uid = auth.currentUser?.uid;
  const unsubRef = useRef<(() => void) | null>(null);
  const prevHadActiveTrip = useRef(false);

  const subscribe = useCallback(() => {
    if (!uid) return;
    unsubRef.current?.();
    const q = query(
      collection(firestore, "trips"),
      where("driverId", "==", uid),
      where("status", "in", ["assigned", "in_progress"]),
    );
    unsubRef.current = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Trip, "id">),
      }));

      // Auto-stop tracking when no more in_progress trips (e.g. cancelled externally)
      const hasActiveTrip = fetched.some((t) => t.status === "in_progress");
      if (prevHadActiveTrip.current && !hasActiveTrip) {
        stopTracking().catch((err) => console.warn("GPS stop unavailable:", err));
      }
      prevHadActiveTrip.current = hasActiveTrip;

      // Sort: in_progress first, then by createdAt descending
      fetched.sort((a, b) => {
        if (a.status === "in_progress" && b.status !== "in_progress") return -1;
        if (b.status === "in_progress" && a.status !== "in_progress") return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setTrips(fetched);
      setLoading(false);
      setRefreshing(false);
    });
  }, [uid]);

  useEffect(() => {
    subscribe();
    return () => unsubRef.current?.();
  }, [subscribe]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    subscribe();
  }, [subscribe]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (trips.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-8">
        <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Text className="text-3xl">🚚</Text>
        </View>
        <Text className="text-lg font-semibold text-gray-900">No Assigned Trips</Text>
        <Text className="mt-2 text-center text-sm text-gray-500">
          When a dispatcher assigns you a trip, it will appear here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={trips}
      keyExtractor={(item) => item.id}
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={["#3b82f6"]}
          tintColor="#3b82f6"
        />
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          onPress={() => navigation.navigate("TripDetail", { tripId: item.id })}
          activeOpacity={0.75}
          className="rounded-xl border border-gray-200 bg-white px-4 py-4"
        >
          <View className="flex-row items-center justify-between">
            <Text className="font-mono text-xs text-gray-400">#{item.id.slice(-8).toUpperCase()}</Text>
            <View className={`rounded-full px-3 py-1 ${statusBg(item.status)}`}>
              <Text className={`text-xs font-semibold ${statusTextColor(item.status)}`}>
                {item.status === "in_progress" ? "IN PROGRESS" : item.status.toUpperCase()}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row items-center gap-4">
            <View className="flex-row items-center gap-1">
              <Text className="text-base font-bold text-gray-900">{item.stops.length}</Text>
              <Text className="text-sm text-gray-500">
                stop{item.stops.length !== 1 ? "s" : ""}
              </Text>
            </View>
            {item.route && (
              <Text className="text-sm text-gray-400">
                {(item.route.distanceMeters / 1000).toFixed(1)} km &middot;{" "}
                {Math.round(item.route.durationSeconds / 60)} min
              </Text>
            )}
          </View>

          <View className="mt-2 flex-row items-center gap-1">
            <Text className="text-xs text-gray-400">Scheduled</Text>
            <Text className="text-xs font-medium text-gray-600">{formatDate(item.createdAt)}</Text>
          </View>

          {item.stops.length > 0 && (
            <Text className="mt-2 text-sm text-gray-500" numberOfLines={1}>
              {[...item.stops].sort((a, b) => a.sequence - b.sequence)[0].address}
            </Text>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

function statusBg(status: string): string {
  switch (status) {
    case "assigned": return "bg-blue-50";
    case "in_progress": return "bg-green-50";
    default: return "bg-gray-100";
  }
}

function statusTextColor(status: string): string {
  switch (status) {
    case "assigned": return "text-blue-600";
    case "in_progress": return "text-green-600";
    default: return "text-gray-500";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
