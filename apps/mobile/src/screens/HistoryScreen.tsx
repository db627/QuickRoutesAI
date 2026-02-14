import React, { useEffect, useState } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { collection, query, where, orderBy, onSnapshot, limit } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";
import type { Trip } from "@quickroutesai/shared";

export default function HistoryScreen() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(firestore, "trips"),
      where("driverId", "==", uid),
      where("status", "==", "completed"),
      orderBy("updatedAt", "desc"),
      limit(50),
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setTrips(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Trip, "id">) })));
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-lg font-semibold text-gray-900">No Completed Trips</Text>
            <Text className="mt-2 text-sm text-gray-500">Your completed deliveries will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="mb-3 rounded-xl border border-gray-200 bg-white p-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="font-semibold text-gray-900">
                {item.stops.length} stop{item.stops.length !== 1 && "s"}
              </Text>
              <Text className="text-xs text-gray-400">
                {new Date(item.updatedAt).toLocaleDateString()}
              </Text>
            </View>
            {item.route && (
              <View className="flex-row">
                <Text className="text-xs text-gray-500">
                  {(item.route.distanceMeters / 1000).toFixed(1)} km
                </Text>
                <Text className="text-xs text-gray-300 mx-2">&middot;</Text>
                <Text className="text-xs text-gray-500">
                  {Math.round(item.route.durationSeconds / 60)} min
                </Text>
              </View>
            )}
            <Text className="text-xs text-gray-400 mt-1" numberOfLines={1}>
              {item.stops[0]?.address || "Unknown"} &rarr; {item.stops[item.stops.length - 1]?.address || "Unknown"}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
