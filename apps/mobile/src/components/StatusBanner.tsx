import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function StatusBanner() {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const insets = useSafeAreaInsets();

  const isOffline =
    !isConnected || isInternetReachable === false;

  if (!isOffline) return null;

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="bg-yellow-400 px-4 pb-2 flex-row items-center justify-center"
    >
      <Text className="text-xs font-semibold text-yellow-900">
        ⚠ No internet connection
      </Text>
    </View>
  );
}