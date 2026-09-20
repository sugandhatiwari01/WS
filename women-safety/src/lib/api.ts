import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
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
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export function post<T>(path: string, body: unknown, queueOffline = false) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) }, queueOffline);
}

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
      // Authentication failures cannot be fixed by retrying the same payload.
      // Drop stale requests rather than showing an endless retry counter.
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
