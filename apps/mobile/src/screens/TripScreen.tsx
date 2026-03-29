import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";
import { apiFetch } from "../services/api";
import type { Trip, TripStop } from "@quickroutesai/shared";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { openNavigation } from "../services/navigation";
import { startTracking, stopTracking } from "../services/location";

// Decode Google Maps encoded polyline
function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

export default function TripScreen() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const uid = auth.currentUser?.uid;
  const { isConnected } = useNetworkStatus();
  const unsubRef = useRef<(() => void) | null>(null);

  const prevHadActiveTrip = useRef(false);

  const fetchTrips = useCallback(() => {
    if (!uid) return;
    unsubRef.current?.();
    const q = query(
      collection(firestore, "trips"),
      where("driverId", "==", uid),
      where("status", "in", ["assigned", "in_progress"]),
    );
    unsubRef.current = onSnapshot(q, (snapshot) => {
      const current = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Trip, "id">) }));
      const hasActiveTrip = current.some((t) => t.status === "in_progress");

      // Auto-stop tracking when no more in_progress trips (e.g. cancelled externally)
      if (prevHadActiveTrip.current && !hasActiveTrip) {
        stopTracking().catch((err) => console.warn("GPS stop unavailable:", err));
      }
      prevHadActiveTrip.current = hasActiveTrip;

      setTrips(current);
      setLoading(false);
      setRefreshing(false);
    });
  }, [uid]);

  useEffect(() => {
    fetchTrips();
    return () => unsubRef.current?.();
  }, [fetchTrips]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTrips();
  }, [fetchTrips]);

  const updateStatus = async (tripId: string, status: "in_progress" | "completed") => {
    if (!isConnected) {
      Alert.alert("No Connection", "Trip status cannot be updated while offline.");
      return;
    }
    try {
      await apiFetch(`/trips/${tripId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      if (status === "in_progress") {
        startTracking().catch((err) => console.warn("GPS tracking unavailable:", err));
      } else if (status === "completed") {
        stopTracking().catch((err) => console.warn("GPS stop unavailable:", err));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("Failed to update trip status:", msg);
      Alert.alert("Error", `Failed to update trip status: ${msg}`);
    }
  };

  const confirmCompleteTrip = (tripId: string) => {
    Alert.alert(
      "Complete Trip",
      "Are you sure you want to mark this trip as complete?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          style: "destructive",
          onPress: () => updateStatus(tripId, "completed"),
        },
      ],
    );
  };

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
        <Text className="text-lg font-semibold text-gray-900">No Active Trips</Text>
        <Text className="mt-2 text-center text-sm text-gray-500">
          When a dispatcher assigns you a trip, it will appear here.
        </Text>
      </View>
    );
  }

  const trip = trips[0]; // Show the first active trip
  const stops = trip.stops ?? [];
  const routeCoords = trip.route?.polyline ? decodePolyline(trip.route.polyline) : [];

  return (
    <View className="flex-1 bg-gray-50">
      {/* Map with route */}
      <View className="h-64 mx-4 mt-2 overflow-hidden rounded-2xl border border-gray-200">
        <MapView
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          region={
            stops.length > 0
              ? {
                  latitude: stops[0].lat,
                  longitude: stops[0].lng,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }
              : undefined
          }
        >
          {stops.map((stop, i) => (
            <Marker
              key={stop.stopId}
              coordinate={{ latitude: stop.lat, longitude: stop.lng }}
              title={`Stop ${i + 1}`}
              description={stop.address}
              pinColor={i === 0 ? "#16a34a" : "#2563eb"}
            />
          ))}
          {routeCoords.length > 0 && (
            <Polyline coordinates={routeCoords} strokeColor="#3b82f6" strokeWidth={4} />
          )}
        </MapView>
      </View>

      {/* Trip info */}
      <View className="mx-4 mt-3 rounded-xl border border-gray-200 bg-white px-5 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-gray-900">
            {stops.length} stop{stops.length !== 1 && "s"}
          </Text>
          <Text className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
            {trip.status.replace("_", " ").toUpperCase()}
          </Text>
        </View>
        {trip.route && (
          <Text className="mt-1 text-xs text-gray-500">
            {(trip.route.distanceMeters / 1609.344).toFixed(1)} mi &middot;{" "}
            {Math.round(trip.route.durationSeconds / 60)} min
          </Text>
        )}
      </View>

      {/* Stop list */}
      <FlatList
        data={stops.sort((a, b) => a.sequence - b.sequence)}
        keyExtractor={(item) => item.stopId}
        className="flex-1 mx-4 mt-3"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#3b82f6"]}
            tintColor="#3b82f6"
          />
        }
        renderItem={({ item, index }) => (
          <View className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3 first:rounded-t-xl last:rounded-b-xl">
            <View className={`mr-3 h-8 w-8 items-center justify-center rounded-full ${
              index === 0 ? "bg-green-500" : "bg-brand-600"
            }`}>
              <Text className="text-sm font-bold text-white">{index + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-900">{item.address}</Text>
              {item.notes ? (
                <Text className="text-xs text-gray-400">{item.notes}</Text>
              ) : null}
            </View>
          </View>
        )}
      />

      {/* Action buttons */}
      <View className="border-t border-gray-200 bg-white px-5 py-4">
        {trip.status === "assigned" && (
          <TouchableOpacity
            onPress={() => updateStatus(trip.id, "in_progress")}
            className="items-center rounded-xl bg-green-500 py-3"
          >
            <Text className="font-semibold text-white">Start Trip</Text>
          </TouchableOpacity>
        )}
        {trip.status === "in_progress" && (
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => openNavigation(stops)}
              disabled={!trip.route}
              className={`flex-1 items-center rounded-xl py-3 ${
                trip.route ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <Text className="font-semibold text-white">Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => confirmCompleteTrip(trip.id)}
              className="flex-1 items-center rounded-xl bg-brand-600 py-3"
            >
              <Text className="font-semibold text-white">Complete Trip</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}