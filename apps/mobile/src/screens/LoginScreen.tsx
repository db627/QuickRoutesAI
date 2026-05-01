import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../config/firebase";

type RegisterMode = "join" | "create";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

/**
 * Mobile login + two-path register screen.
 *
 * - Sign in: existing flow (signInWithEmailAndPassword) — unchanged.
 * - Register: two sub-modes that mirror the web's /signup flow.
 *   - "Join existing business" (default): driver supplies an org code; we
 *     POST /auth/signup so the API stamps orgId server-side. Without this,
 *     drivers were invisible to their dispatcher.
 *   - "Create new business": admin signup with no org code; finishes setup
 *     on the web dashboard.
 *
 * After a successful POST /auth/signup we run signInWithEmailAndPassword
 * to populate local Firebase auth state (so onAuthStateChanged fires the
 * same way as a normal sign-in).
 */
export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [registerMode, setRegisterMode] = useState<RegisterMode>("join");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const resetMessages = () => {
    setError("");
    setInfo("");
  };

  const handleSubmit = async () => {
    resetMessages();
    setLoading(true);

    try {
      if (!isRegister) {
        await signInWithEmailAndPassword(auth, email, password);
        return;
      }

      // Client-side guard for join mode.
      if (registerMode === "join" && !orgCode.trim()) {
        throw new Error("Organization code is required to join a business");
      }

      const body =
        registerMode === "create"
          ? { email, password, name, role: "admin" as const }
          : {
              email,
              password,
              name,
              role: "driver" as const,
              orgCode: orgCode.trim(),
            };

      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          responseBody.error || responseBody.message || `Signup failed (${res.status})`,
        );
      }

      // API has already created the Firebase user — sync local auth state.
      await signInWithEmailAndPassword(auth, email, password);

      if (registerMode === "create") {
        setInfo(
          "Account created. Finish setup on the web dashboard to create your organization.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const onTopToggle = (next: boolean) => {
    setIsRegister(next);
    resetMessages();
  };

  const onRegisterModeChange = (mode: RegisterMode) => {
    setRegisterMode(mode);
    resetMessages();
  };

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
      className="flex-1 bg-white"
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-8 py-12">
        <Text className="mb-1 text-3xl font-bold text-gray-900">QuickRoutesAI</Text>
        <Text className="mb-6 text-sm text-gray-500">
          {isRegister
            ? registerMode === "join"
              ? "Join your team using the code your admin shared."
              : "Create a new business and finish setup on the web."
            : "Sign in to start driving"}
        </Text>

        {/* Top toggle: Sign in / Register */}
        <View className="mb-6 flex-row rounded-lg bg-gray-100 p-1">
          <TouchableOpacity
            onPress={() => onTopToggle(false)}
            accessibilityRole="tab"
            accessibilityState={{ selected: !isRegister }}
            className={`flex-1 items-center rounded-md py-2 ${
              !isRegister ? "bg-white" : ""
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                !isRegister ? "text-gray-900" : "text-gray-500"
              }`}
            >
              Sign in
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onTopToggle(true)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isRegister }}
            className={`flex-1 items-center rounded-md py-2 ${
              isRegister ? "bg-white" : ""
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                isRegister ? "text-gray-900" : "text-gray-500"
              }`}
            >
              Register
            </Text>
          </TouchableOpacity>
        </View>

        {/* Sub-toggle: Join existing / Create new business (only in Register) */}
        {isRegister && (
          <View className="mb-4 flex-row rounded-lg border border-gray-200 p-1">
            <TouchableOpacity
              onPress={() => onRegisterModeChange("join")}
              accessibilityRole="tab"
              accessibilityState={{ selected: registerMode === "join" }}
              className={`flex-1 items-center rounded-md py-2 ${
                registerMode === "join" ? "bg-brand-600" : ""
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  registerMode === "join" ? "text-white" : "text-gray-700"
                }`}
              >
                Join existing
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onRegisterModeChange("create")}
              accessibilityRole="tab"
              accessibilityState={{ selected: registerMode === "create" }}
              className={`flex-1 items-center rounded-md py-2 ${
                registerMode === "create" ? "bg-brand-600" : ""
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  registerMode === "create" ? "text-white" : "text-gray-700"
                }`}
              >
                Create new business
              </Text>
            </TouchableOpacity>
          </View>
        )}

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
          className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
        />

        {isRegister && registerMode === "join" && (
          <View className="mb-1">
            <TextInput
              placeholder="Organization code"
              placeholderTextColor="#9ca3af"
              value={orgCode}
              onChangeText={setOrgCode}
              autoCapitalize="none"
              className="mb-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
            />
            <Text className="mb-3 text-xs text-gray-500">
              Get this from your admin.
            </Text>
          </View>
        )}

        {error ? <Text className="mb-3 text-sm text-red-500">{error}</Text> : null}
        {info ? <Text className="mb-3 text-sm text-brand-600">{info}</Text> : null}

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
              {isRegister
                ? registerMode === "create"
                  ? "Create business"
                  : "Join business"
                : "Sign In"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
