import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Switch,
  Modal,
  Platform,
} from "react-native";
import { doc, onSnapshot, collection, query, where, getDocs, setDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, firestore } from "../config/firebase";
import { stopTracking, getCurrentPosition } from "../services/location";
import {
  enqueueWrite,
  setOptimisticOnlineStatus,
  getOptimisticOnlineStatus,
  subscribeQueueSize,
  subscribeOptimisticOnlineStatus,
  flushQueue,
} from "../services/offlineQueue";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import {
  getNavAppPreference,
  setNavAppPreference,
  type NavAppPreference,
} from "../services/userPreferences";

type Props = {
  navigation: { navigate: (screen: string) => void };
};

type ProfileDoc = {
  name?: string;
  email?: string;
  role?: string;
  organization?: string;
  notificationsEnabled?: boolean;
};

const NAV_OPTIONS: { value: NavAppPreference; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Use the platform default" },
  { value: "google", label: "Google Maps", hint: "Works on iOS and Android" },
  { value: "apple", label: "Apple Maps", hint: "iOS only" },
];

export default function ProfileScreen({ navigation }: Props) {
  const uid = auth.currentUser?.uid;
  const { isConnected } = useNetworkStatus();

  const [profile, setProfile] = useState<ProfileDoc | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [stats, setStats] = useState({ tripsCompleted: 0, totalDistanceMiles: 0 });
  const [queueSize, setQueueSize] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [navPref, setNavPref] = useState<NavAppPreference>("auto");
  const [navModalOpen, setNavModalOpen] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(firestore, "users", uid), (snap) => {
      if (snap.exists()) setProfile(snap.data() as ProfileDoc);
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

  useEffect(() => {
    const unsub = subscribeQueueSize(setQueueSize);
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeOptimisticOnlineStatus((optimistic) => {
      if (optimistic !== null) setIsOnline(optimistic);
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (isConnected) {
      flushQueue().catch(() => {});
    }
  }, [isConnected]);

  useEffect(() => {
    getNavAppPreference().then(setNavPref).catch(() => {});
  }, []);

  const fetchStats = useCallback(async () => {
    if (!uid) return;
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
    setStats({
      tripsCompleted: snapshot.size,
      totalDistanceMiles: Math.round(totalDist / 1609.344),
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
    const data: Record<string, unknown> = { isOnline: newStatus, updatedAt: new Date().toISOString() };

    if (newStatus) {
      const pos = await getCurrentPosition();
      if (pos) {
        data.lastLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    }

    if (!isConnected) {
      enqueueWrite("drivers", uid, data);
      setOptimisticOnlineStatus(newStatus);
      setIsOnline(newStatus);
      return;
    }

    await setDoc(doc(firestore, "drivers", uid), data, { merge: true });

    if (!newStatus) await stopTracking();
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (!uid) return;
    setProfile((prev) => (prev ? { ...prev, notificationsEnabled: enabled } : prev));
    const data = { notificationsEnabled: enabled, updatedAt: new Date().toISOString() };
    if (!isConnected) {
      enqueueWrite("users", uid, data);
      return;
    }
    await setDoc(doc(firestore, "users", uid), data, { merge: true });
  };

  const selectNavApp = async (pref: NavAppPreference) => {
    setNavPref(pref);
    setNavModalOpen(false);
    await setNavAppPreference(pref);
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

  const notificationsEnabled = profile?.notificationsEnabled ?? true;
  const navLabel = NAV_OPTIONS.find((o) => o.value === navPref)?.label ?? "Automatic";

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
          <Text className="text-xs text-gray-400 mt-0.5">
            {profile?.organization || "No organization"}
          </Text>

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
            <Text className="text-2xl font-bold text-brand-600">{stats.totalDistanceMiles}</Text>
            <Text className="text-xs text-gray-500 mt-1">Miles Driven</Text>
          </View>
        </View>

        {/* Settings */}
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Settings
        </Text>
        <View className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <TouchableOpacity
            onPress={() => navigation.navigate("ChangePassword")}
            className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3.5"
            accessibilityRole="button"
          >
            <Text className="text-sm font-medium text-gray-900">Change Password</Text>
            <Text className="text-base text-gray-300">›</Text>
          </TouchableOpacity>

          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-medium text-gray-900">Push Notifications</Text>
              <Text className="text-xs text-gray-500">Get alerts for new trip assignments</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{ true: "#3b82f6", false: "#d1d5db" }}
              thumbColor="#ffffff"
            />
          </View>

          <TouchableOpacity
            onPress={() => setNavModalOpen(true)}
            className="flex-row items-center justify-between px-4 py-3.5"
            accessibilityRole="button"
          >
            <View className="flex-1 pr-3">
              <Text className="text-sm font-medium text-gray-900">Preferred Navigation</Text>
              <Text className="text-xs text-gray-500">{navLabel}</Text>
            </View>
            <Text className="text-base text-gray-300">›</Text>
          </TouchableOpacity>
        </View>

        {/* Actions */}
        <TouchableOpacity
          onPress={toggleOnline}
          className={`items-center rounded-xl py-3.5 mb-3 ${isOnline ? "bg-red-500" : "bg-green-500"}`}
        >
          <Text className="font-semibold text-white">{isOnline ? "Go Offline" : "Go Online"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleLogout} className="items-center rounded-xl border border-gray-200 bg-white py-3.5 mb-8">
          <Text className="font-semibold text-gray-500">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Nav app selector modal */}
      <Modal
        visible={navModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNavModalOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setNavModalOpen(false)}
          className="flex-1 items-center justify-center bg-black/40 px-6"
        >
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-1 text-base font-semibold text-gray-900">Preferred Navigation</Text>
            <Text className="mb-4 text-xs text-gray-500">Choose which app opens when you tap Navigate.</Text>
            {NAV_OPTIONS.map((opt) => {
              const isAppleOnIos = opt.value === "apple" && Platform.OS !== "ios";
              const selected = navPref === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  disabled={isAppleOnIos}
                  onPress={() => selectNavApp(opt.value)}
                  className={`mb-2 flex-row items-center justify-between rounded-lg border px-4 py-3 ${
                    selected ? "border-brand-600 bg-brand-50" : "border-gray-200 bg-white"
                  } ${isAppleOnIos ? "opacity-50" : ""}`}
                >
                  <View className="flex-1 pr-3">
                    <Text className={`text-sm font-medium ${selected ? "text-brand-600" : "text-gray-900"}`}>
                      {opt.label}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {isAppleOnIos ? "Not available on this device" : opt.hint}
                    </Text>
                  </View>
                  {selected && <Text className="text-base font-bold text-brand-600">✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
