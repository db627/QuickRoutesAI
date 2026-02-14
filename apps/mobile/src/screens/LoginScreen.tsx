import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);

    try {
      if (isRegister) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(firestore, "users", cred.user.uid), {
          email,
          name,
          role: "driver", // Mobile registrations default to driver
          createdAt: new Date().toISOString(),
        });
        // Create initial driver document
        await setDoc(doc(firestore, "drivers", cred.user.uid), {
          isOnline: false,
          lastLocation: null,
          lastSpeedMps: 0,
          lastHeading: 0,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center bg-white px-8">
      <Text className="mb-1 text-3xl font-bold text-gray-900">QuickRoutesAI</Text>
      <Text className="mb-8 text-sm text-gray-500">
        {isRegister ? "Create a driver account" : "Sign in to start driving"}
      </Text>

      {isRegister && (
        <TextInput
          placeholder="Full Name"
          placeholderTextColor="#9ca3af"
          value={name}
          onChangeText={setName}
          className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
        />
      )}

      <TextInput
        placeholder="Email"
        placeholderTextColor="#9ca3af"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
      />

      <TextInput
        placeholder="Password"
        placeholderTextColor="#9ca3af"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
      />

      {error ? <Text className="mb-3 text-sm text-red-500">{error}</Text> : null}

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={loading}
        className="mb-4 items-center rounded-xl bg-brand-600 py-3.5"
        style={{ opacity: loading ? 0.5 : 1 }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-base font-semibold text-white">
            {isRegister ? "Create Account" : "Sign In"}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => { setIsRegister(!isRegister); setError(""); }}>
        <Text className="text-center text-sm text-gray-500">
          {isRegister ? "Already have an account? Sign in" : "Need an account? Register"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
