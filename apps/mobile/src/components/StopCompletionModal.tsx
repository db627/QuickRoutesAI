import React, { useState, useCallback, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

export const MAX_PHOTOS = 5;

interface Props {
  visible: boolean;
  stopNumber: number;
  stopAddress: string;
  submitting: boolean;
  uploadProgress?: { uploaded: number; total: number } | null;
  onCancel: () => void;
  onSubmit: (data: { notes: string; localPhotoUris: string[] }) => void;
}

export default function StopCompletionModal({
  visible,
  stopNumber,
  stopAddress,
  submitting,
  uploadProgress,
  onCancel,
  onSubmit,
}: Props) {
  const [notes, setNotes] = useState("");
  const [photoUris, setPhotoUris] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setNotes("");
      setPhotoUris([]);
    }
  }, [visible]);

  const addFromCamera = useCallback(async () => {
    if (photoUris.length >= MAX_PHOTOS) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Camera permission denied", "Enable camera access in Settings to capture photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUris((prev) => [...prev, result.assets[0].uri]);
    }
  }, [photoUris.length]);

  const addFromLibrary = useCallback(async () => {
    const remaining = MAX_PHOTOS - photoUris.length;
    if (remaining <= 0) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Photo access denied", "Enable photo library access in Settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.7,
    });
    if (!result.canceled) {
      const newUris = result.assets.map((a) => a.uri);
      setPhotoUris((prev) => [...prev, ...newUris].slice(0, MAX_PHOTOS));
    }
  }, [photoUris.length]);

  const removePhoto = useCallback((uri: string) => {
    setPhotoUris((prev) => prev.filter((p) => p !== uri));
  }, []);

  const canAddMore = photoUris.length < MAX_PHOTOS && !submitting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View className="flex-1 justify-end bg-black/40">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: "90%" }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-gray-100 px-5 py-4">
            <View className="flex-1">
              <Text className="text-lg font-semibold text-gray-900">
                Complete Stop {stopNumber}
              </Text>
              <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
                {stopAddress}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onCancel}
              disabled={submitting}
              className="h-8 w-8 items-center justify-center"
            >
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-5 py-4" keyboardShouldPersistTaps="handled">
            {/* Notes */}
            <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Notes (optional)
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              editable={!submitting}
              placeholder="Left at front door, rang bell twice, etc."
              placeholderTextColor="#9ca3af"
              className="min-h-[88px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900"
              textAlignVertical="top"
            />

            {/* Photos */}
            <View className="mt-5">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Text className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Proof Photos
                </Text>
                <Text className="text-xs text-gray-400">
                  {photoUris.length}/{MAX_PHOTOS}
                </Text>
              </View>

              {photoUris.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
                  <View className="flex-row gap-2">
                    {photoUris.map((uri) => (
                      <View key={uri} className="relative">
                        <Image
                          source={{ uri }}
                          className="h-20 w-20 rounded-lg bg-gray-100"
                        />
                        <TouchableOpacity
                          onPress={() => removePhoto(uri)}
                          disabled={submitting}
                          className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-gray-900"
                        >
                          <Ionicons name="close" size={14} color="#ffffff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}

              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={addFromCamera}
                  disabled={!canAddMore}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-lg border py-2.5 ${
                    canAddMore ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-gray-100"
                  }`}
                >
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    color={canAddMore ? "#2563eb" : "#9ca3af"}
                  />
                  <Text
                    className={`text-sm font-medium ${
                      canAddMore ? "text-blue-600" : "text-gray-400"
                    }`}
                  >
                    Camera
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={addFromLibrary}
                  disabled={!canAddMore}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-lg border py-2.5 ${
                    canAddMore ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-gray-100"
                  }`}
                >
                  <Ionicons
                    name="images-outline"
                    size={18}
                    color={canAddMore ? "#2563eb" : "#9ca3af"}
                  />
                  <Text
                    className={`text-sm font-medium ${
                      canAddMore ? "text-blue-600" : "text-gray-400"
                    }`}
                  >
                    Library
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>

          {/* Submit */}
          <View className="border-t border-gray-100 px-5 py-4">
            {uploadProgress && uploadProgress.total > 0 && (
              <Text className="mb-2 text-center text-xs text-gray-500">
                Uploading photo {uploadProgress.uploaded} of {uploadProgress.total}…
              </Text>
            )}
            <TouchableOpacity
              onPress={() => onSubmit({ notes: notes.trim(), localPhotoUris: photoUris })}
              disabled={submitting}
              className={`items-center rounded-xl py-3 ${
                submitting ? "bg-green-300" : "bg-green-500"
              }`}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text className="font-semibold text-white">Mark Complete</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
