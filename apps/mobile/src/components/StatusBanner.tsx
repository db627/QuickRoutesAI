import React from "react";
import { View, Text } from "react-native";

interface StatusBannerProps {
  isOnline: boolean;
  isTracking: boolean;
}

export default function StatusBanner({ isOnline, isTracking }: StatusBannerProps) {
  if (!isOnline) {
    return (
      <View className="bg-gray-100 px-4 py-2 flex-row items-center justify-center">
        <View className="h-2 w-2 rounded-full bg-gray-400 mr-2" />
        <Text className="text-xs font-medium text-gray-500">Offline</Text>
      </View>
    );
  }

  return (
    <View className={`px-4 py-2 flex-row items-center justify-center ${isTracking ? "bg-blue-50" : "bg-green-50"}`}>
      <View className={`h-2 w-2 rounded-full mr-2 ${isTracking ? "bg-blue-500" : "bg-green-500"}`} />
      <Text className={`text-xs font-medium ${isTracking ? "text-blue-600" : "text-green-600"}`}>
        {isTracking ? "Tracking Active" : "Online"}
      </Text>
    </View>
  );
}
