import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { doc, onSnapshot } from "firebase/firestore";
import { firestore } from "../config/firebase";
import { apiFetch } from "../services/api";
import type { Trip } from "@quickroutesai/shared";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { openNavigation } from "../services/navigation";
import { startTracking, stopTracking } from "../services/location";

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

type Props = {
  route: { params: { tripId: string } };
};

export default function TripDetailScreen({ route }: Props) {
  const { tripId } = route.params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const { isConnected } = useNetworkStatus();
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubRef.current?.();
    const docRef = doc(firestore, "trips", tripId);
    unsubRef.current = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        setTrip({ id: snapshot.id, ...(snapshot.data() as Omit<Trip, "id">) });
      } else {
        setTrip(null);
      }
      setLoading(false);
    });
    return () => unsubRef.current?.();
  }, [tripId]);

  const updateStatus = useCallback(
    async (status: "in_progress" | "completed") => {
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
        console.error("Failed to update trip status:", err);
        Alert.alert("Error", "Failed to update trip status. Please try again.");
      }
    },
    [tripId, isConnected],
  );

  const confirmCompleteTrip = useCallback(() => {
    Alert.alert(
      "Complete Trip",
      "Are you sure you want to mark this trip as complete?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Complete", style: "destructive", onPress: () => updateStatus("completed") },
      ],
    );
  }, [updateStatus]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (!trip) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-8">
        <Text className="text-lg font-semibold text-gray-900">Trip Not Found</Text>
        <Text className="mt-2 text-center text-sm text-gray-500">
          This trip may have been cancelled or removed.
        </Text>
      </View>
    );
  }

  const routeCoords = trip.route?.polyline ? decodePolyline(trip.route.polyline) : [];
  const sortedStops = [...trip.stops].sort((a, b) => a.sequence - b.sequence);

  return (
    <View className="flex-1 bg-gray-50">
      {/* Map */}
      <View className="mx-4 mt-2 h-64 overflow-hidden rounded-2xl border border-gray-200">
        <MapView
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          region={
            sortedStops.length > 0
              ? {
                  latitude: sortedStops[0].lat,
                  longitude: sortedStops[0].lng,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }
              : undefined
          }
        >
          {sortedStops.map((stop, i) => (
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
            {trip.stops.length} stop{trip.stops.length !== 1 && "s"}
          </Text>
          <View className={`rounded-full px-3 py-1 ${statusBg(trip.status)}`}>
            <Text className={`text-xs font-medium ${statusText(trip.status)}`}>
              {trip.status.replace("_", " ").toUpperCase()}
            </Text>
          </View>
        </View>
        {trip.route && (
          <Text className="mt-1 text-xs text-gray-500">
            {(trip.route.distanceMeters / 1000).toFixed(1)} km &middot;{" "}
            {Math.round(trip.route.durationSeconds / 60)} min
          </Text>
        )}
      </View>

      {/* Stop list */}
      <FlatList
        data={sortedStops}
        keyExtractor={(item) => item.stopId}
        className="mx-4 mt-3 flex-1"
        renderItem={({ item, index }) => (
          <View className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3">
            <View
              className={`mr-3 h-8 w-8 items-center justify-center rounded-full ${
                index === 0 ? "bg-green-500" : "bg-brand-600"
              }`}
            >
              <Text className="text-sm font-bold text-white">{index + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-900">{item.address}</Text>
              {item.notes ? <Text className="text-xs text-gray-400">{item.notes}</Text> : null}
            </View>
          </View>
        )}
      />

      {/* Actions */}
      <View className="border-t border-gray-200 bg-white px-5 py-4">
        {trip.status === "assigned" && (
          <TouchableOpacity
            onPress={() => updateStatus("in_progress")}
            className="items-center rounded-xl bg-green-500 py-3"
          >
            <Text className="font-semibold text-white">Start Trip</Text>
          </TouchableOpacity>
        )}
        {trip.status === "in_progress" && (
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => openNavigation(trip.stops)}
              disabled={!trip.route}
              className={`flex-1 items-center rounded-xl py-3 ${
                trip.route ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <Text className="font-semibold text-white">Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmCompleteTrip}
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

function statusBg(status: string): string {
  switch (status) {
    case "assigned":
      return "bg-blue-50";
    case "in_progress":
      return "bg-green-50";
    case "completed":
      return "bg-gray-100";
    case "cancelled":
      return "bg-red-50";
    default:
      return "bg-gray-100";
  }
}

function statusText(status: string): string {
  switch (status) {
    case "assigned":
      return "text-blue-600";
    case "in_progress":
      return "text-green-600";
    case "completed":
      return "text-gray-500";
    case "cancelled":
      return "text-red-500";
    default:
      return "text-gray-500";
  }
}
