import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, firestore } from "../config/firebase";
import type { Notification } from "@quickroutesai/shared";

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    getParent: () => {
      navigate: (screen: string, params?: Record<string, unknown>) => void;
    } | undefined;
  };
}

const typeLabel: Record<Notification["type"], string> = {
  trip_assigned: "Trip Assigned",
  trip_completed: "Trip Completed",
  driver_offline: "Driver Offline",
};

const typeIcon: Record<Notification["type"], keyof typeof Ionicons.glyphMap> = {
  trip_assigned: "navigate-outline",
  trip_completed: "checkmark-done-outline",
  driver_offline: "alert-circle-outline",
};

function dateBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const ts = d.getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfYesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  return `${day}d ago`;
}

export default function NotificationsScreen({ navigation }: Props) {
  const uid = auth.currentUser?.uid;
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(firestore, "notifications"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notification, "id">) })),
        );
      },
      () => setItems([]),
    );
    return unsub;
  }, [uid]);

  const groups = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, Notification[]>();
    items.forEach((n) => {
      const key = dateBucket(n.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [items]);

  const unreadCount = items?.filter((n) => !n.read).length ?? 0;

  async function handleTap(n: Notification) {
    if (!n.read) {
      try {
        await updateDoc(doc(firestore, "notifications", n.id), { read: true });
      } catch {
        // optimistic — listener will reconcile
      }
    }
    if (n.tripId) {
      // TripDetail lives in the Trip tab's stack, not Profile's. Hop up to the
      // tab navigator and target the Trip tab explicitly.
      navigation.getParent()?.navigate("Trip", {
        screen: "TripDetail",
        params: { tripId: n.tripId },
      });
    }
  }

  async function markAllRead() {
    if (!items) return;
    const unread = items.filter((n) => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(firestore);
    unread.forEach((n) => batch.update(doc(firestore, "notifications", n.id), { read: true }));
    try {
      await batch.commit();
    } catch {
      // ignore
    }
  }

  if (items === null) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-8">
        <Ionicons name="notifications-off-outline" size={48} color="#9ca3af" />
        <Text className="mt-3 text-base font-medium text-gray-700">No notifications yet</Text>
        <Text className="mt-1 text-center text-sm text-gray-500">
          You'll see trip updates and alerts here.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50">
      {unreadCount > 0 && (
        <View className="flex-row items-center justify-between bg-white px-4 py-3 border-b border-gray-200">
          <Text className="text-sm text-gray-600">
            {unreadCount} unread
          </Text>
          <TouchableOpacity onPress={markAllRead}>
            <Text className="text-sm font-medium text-brand-600">Mark all as read</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView className="flex-1">
        {groups.map(([label, group]) => (
          <View key={label} className="mt-4">
            <Text className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {label}
            </Text>
            <View className="mx-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {group.map((n, idx) => (
                <TouchableOpacity
                  key={n.id}
                  onPress={() => handleTap(n)}
                  className={`flex-row items-start px-4 py-3 ${
                    idx > 0 ? "border-t border-gray-100" : ""
                  } ${!n.read ? "bg-blue-50/60" : ""}`}
                >
                  <View className="mr-3 mt-0.5">
                    <Ionicons name={typeIcon[n.type]} size={20} color="#3b82f6" />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-medium text-gray-500">
                        {typeLabel[n.type]}
                      </Text>
                      {!n.read && <View className="h-2 w-2 rounded-full bg-blue-500" />}
                    </View>
                    <Text className="mt-0.5 text-sm text-gray-900">{n.message}</Text>
                    <Text className="mt-1 text-xs text-gray-400">{relativeTime(n.createdAt)}</Text>
                  </View>
                  {n.tripId && (
                    <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <View className="h-6" />
      </ScrollView>
    </View>
  );
}
