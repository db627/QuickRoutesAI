import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, firestore } from "../config/firebase";
import { startTracking, stopTracking, getCurrentPosition } from "../services/location";
import {
  enqueueWrite,
  setOptimisticOnlineStatus,
  getOptimisticOnlineStatus,
  subscribeQueueSize,
  subscribeOptimisticOnlineStatus,
  flushQueue,
} from "../services/offlineQueue";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function DriverHomeScreen() {
  const { isConnected } = useNetworkStatus();

  const [isOnline, setIsOnline] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [queueSize, setQueueSize] = useState(0);

  const mapRef = useRef<MapView>(null);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;

    setDoc(
      doc(firestore, "drivers", uid),
      {
        isOnline: false,
        lastLocation: null,
        lastSpeedMps: 0,
        lastHeading: 0,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    ).catch(() => {});

    const unsub = onSnapshot(doc(firestore, "drivers", uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const optimistic = getOptimisticOnlineStatus();
      setIsOnline(optimistic !== null ? optimistic : data.isOnline ?? false);
    });

    return unsub;
  }, [uid]);

  useEffect(() => {
    getCurrentPosition().then((pos) => {
      if (pos) {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    });
  }, []);

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

  const toggleOnline = async () => {
    if (!uid) return;

    const newStatus = !isOnline;
    const data = { isOnline: newStatus, updatedAt: new Date().toISOString() };

    try {
      if (!isConnected) {
        enqueueWrite("drivers", uid, data);
        setOptimisticOnlineStatus(newStatus);
        setIsOnline(newStatus);
        return;
      }

      await setDoc(doc(firestore, "drivers", uid), data, { merge: true });

      if (!newStatus && isTracking) {
        await stopTracking();
        setIsTracking(false);
      }
    } catch (err) {
      Alert.alert("Error", "Failed to update status. Please try again.");
    }
  };

  const toggleTracking = async () => {
    if (!isOnline) {
      Alert.alert("Go Online First", "You need to be online to start tracking.");
      return;
    }

    if (isTracking) {
      await stopTracking();
      setIsTracking(false);
    } else {
      const success = await startTracking();
      if (success) setIsTracking(true);
      else Alert.alert("Permission Denied", "Location permission is required to track deliveries.");
    }
  };

  const handleLogout = async () => {
    if (isTracking) await stopTracking();
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
      {/* Status pill */}
      <View className="flex-row items-center justify-center py-2">
        <View className={`flex-row items-center rounded-full px-4 py-1.5 ${isOnline ? "bg-green-50" : "bg-gray-100"}`}>
          <View className={`h-2 w-2 rounded-full mr-2 ${isOnline ? "bg-green-500" : "bg-gray-400"}`} />
          <Text className={`text-xs font-medium ${isOnline ? "text-green-700" : "text-gray-500"}`}>
            {isOnline ? (isTracking ? "Tracking Active" : "Online") : "Offline"}
          </Text>
        </View>
      </View>

      {/* Pending sync indicator */}
      {queueSize > 0 && (
        <View className="bg-orange-100 px-4 py-2 items-center">
          <Text className="text-xs text-orange-700 font-medium">Sync paused, waiting for connection.</Text>
        </View>
      )}

      {/* Map */}
      <View className="flex-1 mx-4 mb-4 overflow-hidden rounded-2xl border border-gray-200">
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          region={
            location
              ? { latitude: location.lat, longitude: location.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }
              : { latitude: 40.7128, longitude: -74.006, latitudeDelta: 0.05, longitudeDelta: 0.05 }
          }
          showsUserLocation
          showsMyLocationButton
        >
          {location && <Marker coordinate={{ latitude: location.lat, longitude: location.lng }} title="You" pinColor="#2563eb" />}
        </MapView>
      </View>

      {/* Controls */}
      <View className="border-t border-gray-200 bg-white px-6 py-4">
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={toggleOnline}
            className={`flex-1 items-center rounded-xl py-3 ${isOnline ? "bg-red-500" : "bg-green-500"}`}
          >
            <Text className="font-semibold text-white">{isOnline ? "Go Offline" : "Go Online"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={toggleTracking}
            className={`flex-1 items-center rounded-xl py-3 ${isTracking ? "bg-yellow-500" : "bg-brand-600"}`}
          >
            <Text className="font-semibold text-white">{isTracking ? "Stop Tracking" : "Start Tracking"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}