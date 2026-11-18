import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { blobFromLocalUri, readLocalFileBase64 } from "@/lib/native-file";

import { API_URL } from "@/lib/api-url";
const TOKEN_KEY = "women-safety-token";
const QUEUE_KEY = "women-safety-api-queue";

export type ApiResult<T> = {
  data?: T;
  error?: string;
  offline: boolean;
  status?: number;
};

type QueuedRequest = { id: string; path: string; method: string; body?: unknown };

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string | null) {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

async function queueRequest(path: string, method: string, body?: unknown) {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const queue: QueuedRequest[] = raw ? JSON.parse(raw) : [];
  let normalizedBody = body;
  if (typeof body === "string") {
    try { normalizedBody = JSON.parse(body); } catch { normalizedBody = body; }
  }
  queue.push({ id: `${Date.now()}-${Math.random()}`, path, method, body: normalizedBody });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueuedRequestCount() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedRequest[]).length : 0;
}

export async function clearQueuedRequests() {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  queueOffline = false,
): Promise<ApiResult<T>> {
  if (!API_URL) {
    if (queueOffline) await queueRequest(path, options.method || "GET", options.body);
    return { offline: true, error: "Backend URL is not configured." };
  }
  try {
    const token = await getToken();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      return { offline: false, status: response.status, error: payload?.error || `Request failed (${response.status})` };
    }
    return { offline: false, status: response.status, data: payload as T };
  } catch {
    if (queueOffline) await queueRequest(path, options.method || "GET", options.body);
    return { offline: true, error: "Unable to reach the backend. The action was queued for retry." };
  }
}

/** POST helper */
export function post<T>(path: string, body: unknown, queueOffline = false) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) }, queueOffline);
}

/** PATCH helper */
export function patch<T>(path: string, body: unknown) {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

/** DELETE helper */
export function del<T>(path: string) {
  return api<T>(path, { method: "DELETE" });
}

/** Multipart upload of a local file (native file:// URI) or a web blob:/data: URI. */
async function uploadFile<T>(
  path: string,
  uri: string,
  field: string,
  filename: string,
  failureMessage: string,
): Promise<ApiResult<T>> {
  if (!API_URL) return { offline: true, error: "Backend URL is not configured." };
  const token = await getToken();
  const isLocalFile = !(Platform.OS === "web" || uri.startsWith("blob:") || uri.startsWith("data:") || uri.startsWith("http"));
  const send = async (body: FormData | string, json: boolean) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) return { offline: false, status: response.status, error: payload?.error || `Upload failed (${response.status})` } as ApiResult<T>;
    return { offline: false, status: response.status, data: payload as T } as ApiResult<T>;
  };

  // 1) Multipart upload.
  let multipartError: unknown;
  try {
    const form = new FormData();
    if (isLocalFile) form.append(field, blobFromLocalUri(uri), filename);
    else form.append(field, await (await fetch(uri)).blob(), filename);
    return await send(form, false);
  } catch (err) {
    multipartError = err;
    console.warn(`Multipart ${field} upload failed:`, err);
  }

  // 2) On the phone, fall back to a plain JSON request with the file as base64 —
  //    the same kind of request that location updates use.
  if (isLocalFile) {
    try {
      const fileBase64 = await readLocalFileBase64(uri);
      return await send(JSON.stringify({ fileBase64, filename }), true);
    } catch (err) {
      console.warn(`Base64 ${field} upload failed:`, err);
      return { offline: true, error: `${failureMessage} (${err instanceof Error ? err.message : String(err)})` };
    }
  }
  return { offline: true, error: `${failureMessage} (${multipartError instanceof Error ? multipartError.message : String(multipartError)})` };
}

/** Multipart audio upload */
export function uploadAudio<T>(path: string, uri: string) {
  const ext = uri.match(/\.(m4a|mp4|aac|3gp|webm|ogg|wav|caf)$/i)?.[1]?.toLowerCase() ?? "m4a";
  return uploadFile<T>(path, uri, "audio", `evidence-${Date.now()}.${ext}`, "Unable to upload the recording.");
}

/** Multipart photo upload */
export function uploadPhoto<T>(path: string, uri: string) {
  return uploadFile<T>(path, uri, "photo", `photo-${Date.now()}.jpg`, "Unable to upload the photo.");
}

/** Retry queued offline requests */
export async function flushQueue() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const queue: QueuedRequest[] = raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  if (!queue.length) return { synced: 0, remaining: 0 };
  let synced = 0;
  const remaining: QueuedRequest[] = [];
  for (const request of queue) {
    const result = await api(request.path, {
      method: request.method,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
    if (result.offline) {
      remaining.push(request);
    } else if (result.status === 401 || result.status === 403) {
      // Drop stale auth-failed requests
      continue;
    } else if (result.status && result.status >= 400) {
      remaining.push(request);
    } else {
      synced += 1;
    }
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, remaining: remaining.length };
}
