import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { firestore } from "../config/firebase";
import type { Trip, TripStop } from "@quickroutesai/shared";
import type { TripStackScreenProps } from "../types/navigation";

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

type Props = TripStackScreenProps<"TripCompletion">;

export default function TripCompletionScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tripSnap, stopsSnap] = await Promise.all([
          getDoc(doc(firestore, "trips", tripId)),
          getDocs(collection(firestore, "trips", tripId, "stops")),
        ]);
        if (cancelled) return;
        if (tripSnap.exists()) {
          const stops: TripStop[] = stopsSnap.docs.map((d) => ({
            stopId: d.id,
            ...(d.data() as Omit<TripStop, "stopId">),
          }));
          setTrip({
            id: tripSnap.id,
            ...(tripSnap.data() as Omit<Trip, "id">),
            stops,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  const sortedStops = trip ? [...(trip.stops ?? [])].sort((a, b) => a.sequence - b.sequence) : [];
  const routeCoords = trip?.route?.polyline ? decodePolyline(trip.route.polyline) : [];
  const distanceKm = trip?.route ? (trip.route.distanceMeters / 1000).toFixed(1) : null;
  const durationMin = trip?.route ? Math.round(trip.route.durationSeconds / 60) : null;
  const stopCountDisplay = trip?.stopCount ?? sortedStops.length;

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 24 }}>
      {/* Header */}
      <View className="mb-6 items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <Text className="text-3xl">✓</Text>
        </View>
        <Text className="text-2xl font-bold text-gray-900">Trip Complete</Text>
        <Text className="mt-1 text-sm text-gray-500">Great work! Here's your summary.</Text>
      </View>

      {/* Stats */}
      <View className="mb-5 flex-row gap-3">
        <View className="flex-1 items-center rounded-xl border border-gray-200 bg-white py-4">
          <Text className="text-2xl font-bold text-gray-900">{stopCountDisplay}</Text>
          <Text className="mt-1 text-xs text-gray-500">Stops</Text>
        </View>
        <View className="flex-1 items-center rounded-xl border border-gray-200 bg-white py-4">
          <Text className="text-2xl font-bold text-gray-900">{distanceKm ?? "—"}</Text>
          <Text className="mt-1 text-xs text-gray-500">km</Text>
        </View>
        <View className="flex-1 items-center rounded-xl border border-gray-200 bg-white py-4">
          <Text className="text-2xl font-bold text-gray-900">{durationMin ?? "—"}</Text>
          <Text className="mt-1 text-xs text-gray-500">min</Text>
        </View>
      </View>

      {/* Map thumbnail */}
      {sortedStops.length > 0 && (
        <View className="mb-5 h-52 overflow-hidden rounded-2xl border border-gray-200">
          <MapView
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            region={{
              latitude: sortedStops[Math.floor(sortedStops.length / 2)].lat,
              longitude: sortedStops[Math.floor(sortedStops.length / 2)].lng,
              latitudeDelta: 0.08,
              longitudeDelta: 0.08,
            }}
          >
            {sortedStops.map((stop, i) => (
              <Marker
                key={stop.stopId}
                coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                pinColor={i === 0 ? "#16a34a" : i === sortedStops.length - 1 ? "#2563eb" : "#9ca3af"}
              />
            ))}
            {routeCoords.length > 0 && (
              <Polyline coordinates={routeCoords} strokeColor="#3b82f6" strokeWidth={3} />
            )}
          </MapView>
        </View>
      )}

      {/* Done button */}
      <TouchableOpacity
        onPress={() => navigation.popToTop()}
        className="items-center rounded-xl bg-brand-600 py-4"
      >
        <Text className="font-semibold text-white">Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

