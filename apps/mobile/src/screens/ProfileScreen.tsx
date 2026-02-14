import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { doc, onSnapshot, collection, query, where, getDocs, setDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, firestore } from "../config/firebase";
import { stopTracking } from "../services/location";

export default function ProfileScreen() {
  const uid = auth.currentUser?.uid;
  const [profile, setProfile] = useState<{ name: string; email: string; role: string } | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [stats, setStats] = useState({ tripsCompleted: 0, totalDistanceKm: 0 });

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
      if (snap.exists()) setIsOnline(snap.data().isOnline ?? false);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const fetchStats = async () => {
      const q = query(
        collection(firestore, "trips"),
        where("driverId", "==", uid),
        where("status", "==", "completed"),
      );
      const snapshot = await getDocs(q);
      let totalDist = 0;
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (data.route?.distanceMeters) totalDist += data.route.distanceMeters;
      });
      setStats({ tripsCompleted: snapshot.size, totalDistanceKm: Math.round(totalDist / 1000) });
    };
    fetchStats();
  }, [uid]);

  const toggleOnline = async () => {
    if (!uid) return;
    const newStatus = !isOnline;
    await setDoc(
      doc(firestore, "drivers", uid),
      { isOnline: newStatus, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    if (!newStatus) await stopTracking();
  };

  const handleLogout = async () => {
    await stopTracking();
    if (uid) {
      await setDoc(
        doc(firestore, "drivers", uid),
        { isOnline: false, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    }
    await signOut(auth);
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-8">
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
  );
}
