import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, RefreshControl } from "react-native";
import { doc, onSnapshot, collection, query, where, getDocs, setDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, firestore } from "../config/firebase";
import { stopTracking } from "../services/location";
import {
  enqueueWrite,
  setOptimisticOnlineStatus,
  getOptimisticOnlineStatus,
  subscribeQueueSize,
  subscribeOptimisticOnlineStatus,
  flushQueue,
} from "../services/offlineQueue";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function ProfileScreen() {
  const uid = auth.currentUser?.uid;
  const { isConnected } = useNetworkStatus();

  const [profile, setProfile] = useState<{ name: string; email: string; role: string } | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [stats, setStats] = useState({ tripsCompleted: 0, totalDistanceKm: 0 });
  const [queueSize, setQueueSize] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(firestore, "users", uid), (snap) => {
      if (snap.exists()) setProfile(snap.data() as any);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(firestore, "drivers", uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const optimistic = getOptimisticOnlineStatus();
      setIsOnline(optimistic !== null ? optimistic : data.isOnline ?? false);
    });
    return unsub;
  }, [uid]);

  // Sync queue size everywhere
  useEffect(() => {
    const unsub = subscribeQueueSize(setQueueSize);
    return () => {
      unsub();
    };
  }, []);

  // Sync optimistic online status everywhere
  useEffect(() => {
    const unsub = subscribeOptimisticOnlineStatus((optimistic) => {
      if (optimistic !== null) setIsOnline(optimistic);
    });
    return () => {
      unsub();
    };
  }, []);

  // Flush queued writes on reconnect
  useEffect(() => {
    if (isConnected) {
      flushQueue().catch(() => {});
    }
  }, [isConnected]);

  const fetchStats = useCallback(async () => {
    if (!uid) return;
    const q = query(
      collection(firestore, "trips"),
      where("driverId", "==", uid),
      where("status", "==", "completed")
    );
    const snapshot = await getDocs(q);
    let totalDist = 0;
    snapshot.docs.forEach((d) => {
      const data = d.data();
      if (data.route?.distanceMeters) totalDist += data.route.distanceMeters;
    });
    setStats({
      tripsCompleted: snapshot.size,
      totalDistanceKm: Math.round(totalDist / 1000),
    });
    setRefreshing(false);
  }, [uid]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStats();
  }, [fetchStats]);

  const toggleOnline = async () => {
    if (!uid) return;

    const newStatus = !isOnline;
    const data = { isOnline: newStatus, updatedAt: new Date().toISOString() };

    if (!isConnected) {
      enqueueWrite("drivers", uid, data);
      setOptimisticOnlineStatus(newStatus);
      setIsOnline(newStatus);
      return;
    }

    await setDoc(doc(firestore, "drivers", uid), data, { merge: true });

    if (!newStatus) await stopTracking();
  };

  const handleLogout = async () => {
    await stopTracking();
    if (uid) {
      await setDoc(
        doc(firestore, "drivers", uid),
        { isOnline: false, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }
    await signOut(auth);
  };

  return (
    <View className="flex-1 bg-gray-50">
      {queueSize > 0 && (
        <View className="bg-orange-100 px-4 py-2 items-center">
          <Text className="text-xs text-orange-700 font-medium">Sync paused, waiting for connection.</Text>
        </View>
      )}

      <ScrollView
        className="flex-1 px-6 pt-8"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#3b82f6"]}
            tintColor="#3b82f6"
          />
        }
      >
        {/* Avatar */}
        <View className="items-center mb-6">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-brand-600 mb-3">
            <Text className="text-3xl font-bold text-white">
              {profile?.name?.charAt(0)?.toUpperCase() || "?"}
            </Text>
          </View>

          <Text className="text-xl font-bold text-gray-900">{profile?.name || "Driver"}</Text>
          <Text className="text-sm text-gray-500">{profile?.email}</Text>

          <View className="mt-2 flex-row items-center">
            <View className={`h-2.5 w-2.5 rounded-full mr-2 ${isOnline ? "bg-green-500" : "bg-gray-300"}`} />
            <Text className="text-sm text-gray-500">{isOnline ? "Online" : "Offline"}</Text>
          </View>
        </View>

        {/* Stats */}
        <View className="flex-row mb-6">
          <View className="flex-1 items-center rounded-xl border border-gray-200 bg-white py-4 mr-2">
            <Text className="text-2xl font-bold text-brand-600">{stats.tripsCompleted}</Text>
            <Text className="text-xs text-gray-500 mt-1">Trips Done</Text>
          </View>

          <View className="flex-1 items-center rounded-xl border border-gray-200 bg-white py-4 ml-2">
            <Text className="text-2xl font-bold text-brand-600">{stats.totalDistanceKm}</Text>
            <Text className="text-xs text-gray-500 mt-1">km Driven</Text>
          </View>
        </View>

        {/* Actions */}
        <TouchableOpacity
          onPress={toggleOnline}
          className={`items-center rounded-xl py-3.5 mb-3 ${isOnline ? "bg-red-500" : "bg-green-500"}`}
        >
          <Text className="font-semibold text-white">{isOnline ? "Go Offline" : "Go Online"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleLogout} className="items-center rounded-xl border border-gray-200 bg-white py-3.5">
          <Text className="font-semibold text-gray-500">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}