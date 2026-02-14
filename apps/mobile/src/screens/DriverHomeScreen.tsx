import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, firestore } from "../config/firebase";
import { startTracking, stopTracking, getCurrentPosition } from "../services/location";

export default function DriverHomeScreen() {
  const [isOnline, setIsOnline] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<MapView>(null);

  const uid = auth.currentUser?.uid;

  // Ensure driver doc exists, then subscribe to it for online status
  useEffect(() => {
    if (!uid) return;
    // Create the driver doc if it doesn't exist yet (merge preserves existing data)
    setDoc(
      doc(firestore, "drivers", uid),
      {
        isOnline: false,
        lastLocation: null,
        lastSpeedMps: 0,
        lastHeading: 0,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    ).catch(() => {});
    const unsub = onSnapshot(doc(firestore, "drivers", uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setIsOnline(data.isOnline ?? false);
        if (data.lastLocation) {
          setLocation(data.lastLocation);
        }
      }
    });
    return unsub;
  }, [uid]);

  // Get initial position
  useEffect(() => {
    getCurrentPosition().then((pos) => {
      if (pos) {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    });
  }, []);

  const toggleOnline = async () => {
    if (!uid) return;
    const newStatus = !isOnline;
    try {
      await setDoc(
        doc(firestore, "drivers", uid),
        { isOnline: newStatus, updatedAt: new Date().toISOString() },
        { merge: true },
      );
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
      if (success) {
        setIsTracking(true);
      } else {
        Alert.alert("Permission Denied", "Location permission is required to track deliveries.");
      }
    }
  };

  const handleLogout = async () => {
    if (isTracking) await stopTracking();
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

      {/* Map */}
      <View className="flex-1 mx-4 mb-4 overflow-hidden rounded-2xl border border-gray-200">
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          region={
            location
              ? {
                  latitude: location.lat,
                  longitude: location.lng,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }
              : {
                  latitude: 40.7128,
                  longitude: -74.006,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }
          }
          showsUserLocation
          showsMyLocationButton
        >
          {location && (
            <Marker
              coordinate={{ latitude: location.lat, longitude: location.lng }}
              title="You"
              pinColor="#2563eb"
            />
          )}
        </MapView>
      </View>

      {/* Controls */}
      <View className="border-t border-gray-200 bg-white px-6 py-4">
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={toggleOnline}
            className={`flex-1 items-center rounded-xl py-3 ${
              isOnline ? "bg-red-500" : "bg-green-500"
            }`}
          >
            <Text className="font-semibold text-white">
              {isOnline ? "Go Offline" : "Go Online"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={toggleTracking}
            className={`flex-1 items-center rounded-xl py-3 ${
              isTracking ? "bg-yellow-500" : "bg-brand-600"
            }`}
          >
            <Text className="font-semibold text-white">
              {isTracking ? "Stop Tracking" : "Start Tracking"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
