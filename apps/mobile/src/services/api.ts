import { auth } from "../config/firebase";
import { NativeModules } from "react-native";

const DEFAULT_API_TIMEOUT_MS = 12000;

function getApiTimeoutMs(): number {
  const raw = process.env.EXPO_PUBLIC_API_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_API_TIMEOUT_MS;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function resolveApiUrls(): string[] {
  const urls: string[] = [];

  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configuredUrl) {
    urls.push(normalizeApiUrl(configuredUrl));
  }

  const scriptURL = NativeModules.SourceCode?.scriptURL as string | undefined;
  if (scriptURL) {
    try {
      const hostname = new URL(scriptURL).hostname;
      if (hostname) {
        urls.push(`http://${hostname}:3001`);
      }
    } catch (error) {
      void error;
    }
  }

  urls.push("http://localhost:3001");
  return Array.from(new Set(urls));
}

const API_URLS = resolveApiUrls();

/**
 * Authenticated fetch wrapper for the Express API.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const token = await user.getIdToken();
  const timeoutMs = getApiTimeoutMs();
  console.log("[apiFetch] request start", {
    path,
    method: options.method || "GET",
    candidates: API_URLS,
    timeoutMs,
  });

  let networkErrorMessage = "Network request failed";

  for (const apiUrl of API_URLS) {
    let res: Response;
    try {
      console.log("[apiFetch] trying", { url: `${apiUrl}${path}` });
      res = await fetchWithTimeout(
        `${apiUrl}${path}`,
        {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
        },
        timeoutMs,
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      networkErrorMessage = isTimeout
        ? `Request timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : "Network request failed";
      console.warn("[apiFetch] network failure", {
        url: `${apiUrl}${path}`,
        message: networkErrorMessage,
        timeout: isTimeout,
      });
      continue;
    }

    console.log("[apiFetch] response received", {
      url: `${apiUrl}${path}`,
      status: res.status,
      ok: res.ok,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[apiFetch] non-ok response", {
        url: `${apiUrl}${path}`,
        status: res.status,
        body,
      });
      throw new Error(body.message || `API error: ${res.status}`);
    }

    console.log("[apiFetch] request success", { url: `${apiUrl}${path}` });
    return res.json();
  }

  console.error("[apiFetch] all candidates failed", {
    path,
    candidates: API_URLS,
    networkErrorMessage,
  });
  throw new Error(`Cannot reach API at ${API_URLS.join(", ")}: ${networkErrorMessage}`);
}
