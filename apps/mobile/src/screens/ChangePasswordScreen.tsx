import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from "react-native";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { auth } from "../config/firebase";

type Props = {
  navigation: { goBack: () => void };
};

export default function ChangePasswordScreen({ navigation }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from current password.");
      return;
    }

    const user = auth.currentUser;
    if (!user?.email) {
      setError("You must be signed in to change your password.");
      return;
    }

    setSubmitting(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      Alert.alert("Success", "Your password has been updated.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("Current password is incorrect.");
      } else if (code === "auth/weak-password") {
        setError("New password is too weak.");
      } else if (code === "auth/requires-recent-login") {
        setError("Please sign out and sign back in, then try again.");
      } else {
        setError("Failed to update password. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text className="mb-1 text-lg font-semibold text-gray-900">Change Password</Text>
      <Text className="mb-6 text-sm text-gray-500">
        Enter your current password, then choose a new one.
      </Text>

      <View className="mb-4">
        <Text className="mb-1 text-xs font-medium text-gray-600">Current Password</Text>
        <TextInput
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
          placeholderTextColor="#9ca3af"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
        />
      </View>

      <View className="mb-4">
        <Text className="mb-1 text-xs font-medium text-gray-600">New Password</Text>
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="At least 8 characters"
          placeholderTextColor="#9ca3af"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
        />
      </View>

      <View className="mb-6">
        <Text className="mb-1 text-xs font-medium text-gray-600">Confirm New Password</Text>
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="Re-enter new password"
          placeholderTextColor="#9ca3af"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
        />
      </View>

      {error && (
        <View className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      )}

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={submitting}
        className={`items-center rounded-xl py-3.5 ${submitting ? "bg-brand-400" : "bg-brand-600"}`}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">Update Password</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => navigation.goBack()}
        disabled={submitting}
        className="mt-3 items-center rounded-xl border border-gray-200 bg-white py-3.5"
      >
        <Text className="font-semibold text-gray-500">Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
