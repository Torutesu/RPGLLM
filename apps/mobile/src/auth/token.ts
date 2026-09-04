import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "rpgllm.jwt";
let cached: string | null = null;

const hasWindow = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

/** Synchronous read for hot paths (SSE url building, request headers). */
export function getToken(): string | null {
  return cached;
}

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    cached = hasWindow() ? window.localStorage.getItem(KEY) : null;
    return cached;
  }
  try {
    cached = await SecureStore.getItemAsync(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveToken(token: string | null): Promise<void> {
  cached = token;
  if (Platform.OS === "web") {
    if (!hasWindow()) return;
    if (token) window.localStorage.setItem(KEY, token);
    else window.localStorage.removeItem(KEY);
    return;
  }
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* keychain unavailable — keep the in-memory token */
  }
}
