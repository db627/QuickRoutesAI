import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { firestore } from "../config/firebase";
import type { Trip, TripStop } from "@quickroutesai/shared";
import { decodePolyline } from "../utils/polyline";
import type { TripStackScreenProps } from "../types/navigation";

type Props = TripStackScreenProps<"TripMap">;

type Coord = { latitude: number; longitude: number };

export default function TripMapScreen({ route }: Props) {
  const { tripId } = route.params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [driverPos, setDriverPos] = useState<Coord | null>(null);
  const [driverHeading, setDriverHeading] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<MapView | null>(null);
  const didInitialFitRef = useRef(false);

  useEffect(() => {
    const tripRef = doc(firestore, "trips", tripId);
    const unsub = onSnapshot(tripRef, (snap) => {
      setTrip(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Trip, "id">) }) : null);
      setLoading(false);
    });
    return unsub;
  }, [tripId]);

  useEffect(() => {
    const stopsRef = collection(firestore, "trips", tripId, "stops");
    const unsub = onSnapshot(stopsRef, (snap) => {
      const docs = snap.docs.map((d) => ({
        stopId: d.id,
        ...(d.data() as Omit<TripStop, "stopId">),
      }));
      docs.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      setStops(docs);
    });
    return unsub;
  }, [tripId]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }).catch(() => null);
      if (current && !cancelled) {
        setDriverPos({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });
        setDriverHeading(current.coords.heading ?? 0);
      }

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
        (loc) => {
          setDriverPos({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          setDriverHeading(loc.coords.heading ?? 0);
        },
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  const routeCoords = useMemo(
    () => (trip?.route?.polyline ? decodePolyline(trip.route.polyline) : []),
    [trip?.route?.polyline],
  );

  const nextStopId = useMemo(() => {
    if (trip?.status !== "in_progress") return null;
    return stops.find((s) => s.status !== "completed")?.stopId ?? null;
  }, [trip?.status, stops]);

  const fitToRoute = useCallback(() => {
    const coords: Coord[] = [
      ...stops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
      ...routeCoords,
    ];
    if (driverPos) coords.push(driverPos);
    if (coords.length === 0) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 60, bottom: 140, left: 60 },
      animated: true,
    });
  }, [stops, routeCoords, driverPos]);

  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (stops.length === 0 && routeCoords.length === 0) return;
    didInitialFitRef.current = true;
    const timer = setTimeout(fitToRoute, 400);
    return () => clearTimeout(timer);
  }, [stops.length, routeCoords.length, fitToRoute]);

  const initialRegion = useMemo(() => {
    if (stops.length === 0) return undefined;
    return {
      latitude: stops[0].lat,
      longitude: stops[0].lng,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  }, [stops]);

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
      </View>
    );
  }

  return (
    <View className="flex-1">
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsCompass
        showsScale
        rotateEnabled
        pitchEnabled
        zoomEnabled
      >
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeColor="#3b82f6" strokeWidth={4} />
        )}

        {stops.map((stop, i) => (
          <Marker
            key={stop.stopId}
            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
            title={`Stop ${i + 1}`}
            description={stop.address}
            pinColor={pinColorFor(stop, stop.stopId === nextStopId)}
            opacity={stop.status === "completed" ? 0.55 : 1}
          />
        ))}

        {driverPos && (
          <Marker
            coordinate={driverPos}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={driverHeading}
            title="You"
          >
            <View className="h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-blue-600 shadow">
              <View className="h-1.5 w-1.5 rounded-full bg-white" />
            </View>
          </Marker>
        )}
      </MapView>

      {trip.route && (
        <View className="absolute left-4 right-4 top-4 rounded-xl bg-white/95 px-4 py-2 shadow">
          <Text className="text-xs text-gray-500">
            {(trip.route.distanceMeters / 1000).toFixed(1)} km &middot;{" "}
            {Math.round(trip.route.durationSeconds / 60)} min &middot;{" "}
            {stops.filter((s) => s.status === "completed").length}/{stops.length} stops done
          </Text>
        </View>
      )}

      <TouchableOpacity
        onPress={fitToRoute}
        className="absolute bottom-8 right-5 h-12 w-12 items-center justify-center rounded-full bg-white shadow"
        activeOpacity={0.75}
      >
        <Ionicons name="locate" size={22} color="#2563eb" />
      </TouchableOpacity>
    </View>
  );
}

function pinColorFor(stop: TripStop, isNext: boolean): string {
  if (stop.status === "completed") return "#9ca3af";
  if (isNext) return "#16a34a";
  return "#2563eb";
}
