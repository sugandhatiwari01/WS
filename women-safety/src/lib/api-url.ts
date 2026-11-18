import Constants from "expo-constants";
import { Platform } from "react-native";

const configured = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");

/** True for localhost and private LAN addresses (10.x, 172.16–31.x, 192.168.x). */
function isLocalAddress(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(/[:/]/)[0];
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** The machine serving this app during development: the browser's host, or the Metro host Expo Go connected to. */
function devServerHost(): string | null {
  if (Platform.OS === "web") return typeof window !== "undefined" ? window.location.hostname || null : null;
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.5:8081"
  return hostUri ? hostUri.split(":")[0] : null;
}

/**
 * Backend base URL.
 * In development, when EXPO_PUBLIC_API_URL is empty or points at a local/LAN address, the backend
 * is assumed to run on the same computer as the Expo dev server. Its address is detected
 * automatically, so the app keeps working when the laptop's Wi-Fi IP changes.
 * A public URL (e.g. a deployed backend) is always used as-is.
 */
export const API_URL = (() => {
  if (!__DEV__ || (configured && !isLocalAddress(configured))) return configured;
  const host = devServerHost();
  if (!host) return configured;
  const port = configured.match(/:(\d+)$/)?.[1] ?? "3000";
  return `http://${host}:${port}`;
})();
