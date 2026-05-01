import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { collection, query, where, orderBy, onSnapshot, limit } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";
import type { Trip } from "@quickroutesai/shared";

export default function HistoryScreen() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const uid = auth.currentUser?.uid;
  const unsubRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    if (!uid) return;
    unsubRef.current?.();
    const q = query(
      collection(firestore, "trips"),
      where("driverId", "==", uid),
      where("status", "==", "completed"),
      orderBy("updatedAt", "desc"),
      limit(50),
    );
    unsubRef.current = onSnapshot(q, (snapshot) => {
      setTrips(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Trip, "id">) })));
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

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#3b82f6"]}
            tintColor="#3b82f6"
          />
        }
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
                {item.stopCount ?? 0} stop{(item.stopCount ?? 0) !== 1 && "s"}
              </Text>
              <Text className="text-xs text-gray-400">
                {new Date(item.updatedAt).toLocaleDateString()}
              </Text>
            </View>
            {item.route && (
              <View className="flex-row">
                <Text className="text-xs text-gray-500">
                  {(item.route.distanceMeters / 1609.344).toFixed(1)} mi
                </Text>
                <Text className="text-xs text-gray-300 mx-2">&middot;</Text>
                <Text className="text-xs text-gray-500">
                  {Math.round(item.route.durationSeconds / 60)} min
                </Text>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}