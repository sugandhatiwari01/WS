/**
 * useWalkSafe — Walk With Me route-deviation alert hook
 *
 * Tracks the user's GPS position every 10 seconds during a walk.
 * Posts each update to the backend which checks for:
 *   • Deviation  > 300 m from the straight-line path (150 m in high-risk mode)
 *   • Stopped    > 3 min without moving 10 m (90 s in high-risk mode)
 *
 * When an alert fires the backend emits a socket event; this hook reacts to
 * those events and can escalate to SOS via the callback provided.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as Location from "expo-location";
import { api, post } from "@/lib/api";

export type WalkState = "idle" | "active" | "deviation" | "stopped" | "arrived";

export type WalkSession = {
  id: string;
  destinationName: string;
  destLat: number;
  destLng: number;
  estimatedMinutes: number;
  highRiskMode: boolean;
  startedAt: string;
};

type UseWalkSafeOptions = {
  /** Called when the user has been stopped too long — should escalate SOS */
  onStoppedEscalate?: () => void;
};

const UPDATE_INTERVAL_MS = 10_000;

export function useWalkSafe({ onStoppedEscalate }: UseWalkSafeOptions = {}) {
  const [walkState, setWalkState] = useState<WalkState>("idle");
  const [session, setSession] = useState<WalkSession | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [distanceToDestM, setDistanceToDestM] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);

  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  /* ─── Distance helper ───────────────────────────────────── */
  function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  /* ─── Post single location update ─────────────────────── */
  const postLocationUpdate = useCallback(
    async (lat: number, lng: number, accuracy?: number) => {
      const id = sessionIdRef.current;
      if (!id) return;
      await post(`/api/walksafe/${id}/update`, { latitude: lat, longitude: lng, accuracy });
    },
    []
  );

  /* ─── Stop walk internals ───────────────────────────────── */
  const stopTracking = useCallback(() => {
    watcherRef.current?.remove();
    watcherRef.current = null;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  }, []);

  /* ─── Start walk ────────────────────────────────────────── */
  const startWalk = useCallback(
    async (params: {
      destinationName: string;
      destinationLat: number;
      destinationLng: number;
      estimatedMinutes?: number;
      highRiskMode?: boolean;
    }) => {
      setLoading(true);
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Location required", "Allow location access to use Walk With Me.");
          return;
        }

        // Get current position for start coords
        let startLat: number | undefined;
        let startLng: number | undefined;
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          startLat = pos.coords.latitude;
          startLng = pos.coords.longitude;
          setCurrentCoords({ latitude: startLat, longitude: startLng });
        } catch (_) {}

        const result = await post<WalkSession>("/api/walksafe/start", {
          destinationName: params.destinationName,
          destinationLat: params.destinationLat,
          destinationLng: params.destinationLng,
          startLat,
          startLng,
          estimatedMinutes: params.estimatedMinutes ?? 20,
          highRiskMode: params.highRiskMode ?? false,
        });

        if (result.error || !result.data) {
          Alert.alert("Walk could not start", result.error || "Server did not confirm the session.");
          return;
        }

        const sess = result.data;
        sessionIdRef.current = sess.id;
        setSession(sess);
        setWalkState("active");
        setElapsedSeconds(0);

        // Start elapsed timer
        elapsedTimerRef.current = setInterval(() => {
          setElapsedSeconds((s) => s + 1);
        }, 1000);

        // Live GPS watcher
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            setCurrentCoords({ latitude, longitude });
            const dest = { lat: sess.destLat, lng: sess.destLng };
            setDistanceToDestM(Math.round(haversineM({ lat: latitude, lng: longitude }, dest)));
            void postLocationUpdate(latitude, longitude, accuracy ?? undefined);
          }
        );
        watcherRef.current = sub;

        // Fallback interval
        intervalRef.current = setInterval(async () => {
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const { latitude, longitude, accuracy } = pos.coords;
            setCurrentCoords({ latitude, longitude });
            const dest = { lat: sess.destLat, lng: sess.destLng };
            setDistanceToDestM(Math.round(haversineM({ lat: latitude, lng: longitude }, dest)));
            await postLocationUpdate(latitude, longitude, accuracy ?? undefined);
          } catch (_) {}
        }, UPDATE_INTERVAL_MS);
      } catch (e) {
        Alert.alert("Walk could not start", e instanceof Error ? e.message : "An error occurred.");
      } finally {
        setLoading(false);
      }
    },
    [postLocationUpdate]
  );

  /* ─── Mark arrived ──────────────────────────────────────── */
  const markArrived = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    setLoading(true);
    try {
      await post(`/api/walksafe/${id}/arrived`, {});
      stopTracking();
      setWalkState("arrived");
      setSession(null);
      sessionIdRef.current = null;
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not mark arrival.");
    } finally {
      setLoading(false);
    }
  }, [stopTracking]);

  /* ─── Cancel walk ───────────────────────────────────────── */
  const cancelWalk = useCallback(async () => {
    const id = sessionIdRef.current;
    if (id) {
      try {
        await post(`/api/walksafe/${id}/cancel`, {});
      } catch (_) {}
    }
    stopTracking();
    setWalkState("idle");
    setSession(null);
    setElapsedSeconds(0);
    sessionIdRef.current = null;
  }, [stopTracking]);

  /* ─── Handle incoming socket events ────────────────────── */
  const handleSocketEvent = useCallback(
    (event: string, data: unknown) => {
      const payload = data as { sessionId?: string; destinationName?: string; stoppedForSeconds?: number; deviationMetres?: number };
      const id = sessionIdRef.current;
      if (!id || payload.sessionId !== id) return;

      if (event === "walksafe:deviation") {
        setWalkState("deviation");
        Alert.alert(
          "⚠️ Route Deviation Detected",
          `You appear to have deviated ${payload.deviationMetres ?? ""}m from your route to ${payload.destinationName ?? "destination"}. Are you safe? Your contacts have been notified.`,
          [{ text: "I'm OK", onPress: () => setWalkState("active") }, { text: "Get Help" }]
        );
      } else if (event === "walksafe:stopped") {
        setWalkState("stopped");
        Alert.alert(
          "⚠️ You've Stopped Moving",
          `You haven't moved for ${payload.stoppedForSeconds ?? 180} seconds near ${payload.destinationName ?? "your route"}. Your contacts have been notified. If you're in danger, tap SOS.`,
          [
            { text: "I'm OK", onPress: () => setWalkState("active") },
            { text: "🚨 SOS", style: "destructive", onPress: () => onStoppedEscalate?.() },
          ]
        );
      } else if (event === "walksafe:arrived") {
        stopTracking();
        setWalkState("arrived");
        setSession(null);
        sessionIdRef.current = null;
      }
    },
    [onStoppedEscalate, stopTracking]
  );

  /* ─── Resume active session on mount ───────────────────── */
  useEffect(() => {
    let active = true;
    void api<WalkSession | null>("/api/walksafe/active").then((result) => {
      if (!active || !result.data?.id) return;
      sessionIdRef.current = result.data.id;
      setSession(result.data);
      setWalkState("active");
    });
    return () => { active = false; };
  }, []);

  /* ─── Cleanup ───────────────────────────────────────────── */
  useEffect(() => {
    return () => stopTracking();
  }, [stopTracking]);

  /* ─── Formatted elapsed time ────────────────────────────── */
  const elapsedLabel = (() => {
    const m = Math.floor(elapsedSeconds / 60);
    const s = elapsedSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  })();

  return {
    walkState,
    session,
    currentCoords,
    distanceToDestM,
    elapsedLabel,
    loading,
    startWalk,
    markArrived,
    cancelWalk,
    handleSocketEvent,
  };
}
