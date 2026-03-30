import { auth } from "../config/firebase";
import { NativeModules } from "react-native";

function resolveApiUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  const scriptURL = NativeModules.SourceCode?.scriptURL as string | undefined;
  if (scriptURL) {
    try {
      const hostname = new URL(scriptURL).hostname;
      if (hostname) {
        return `http://${hostname}:3001`;
      }
    } catch (error) {
      void error;
    }
  }

  return "http://localhost:3001";
}

const API_URL = resolveApiUrl();

/**
 * Authenticated fetch wrapper for the Express API.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const token = await user.getIdToken();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network request failed";
    throw new Error(`Cannot reach API at ${API_URL}: ${message}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error: ${res.status}`);
  }

  return res.json();
}
