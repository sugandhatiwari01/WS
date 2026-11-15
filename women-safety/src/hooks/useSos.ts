/**
 * useSos — central SOS state machine hook
 *
 * States:
 *   idle      → no emergency active
 *   countdown → 3-second pre-fire window (cancellable)
 *   active    → emergency is live, location is streaming
 */

import { createContext, createElement, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Platform, Vibration } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import { api, post } from "@/lib/api";
import { createAlert, getContacts, resolveAlert } from "@/lib/storage";
import { isInternetUnavailable, openSmsComposer } from "@/lib/safety-sms";
import { useAuth } from "@/lib/auth";

export type SosState = "idle" | "countdown" | "sending" | "active";
export type SosLevel = "LEVEL_1" | "LEVEL_2";
export type TriggerType = "SOS_BUTTON" | "SHAKE" | "TIMER" | "MANUAL_LEVEL_2";

type NearbyStation = {
  name?: string;
  distanceKm?: number;
  stationId?: string;
  location?: { coordinates?: number[] };
};

type EmergencyResponse = {
  _id?: string;
  emergencyId?: string;
  alreadyActive?: boolean;
  startedAt?: string;
  currentLocation?: { latitude?: number; longitude?: number } | null;
  nearbyStation?: NearbyStation;
};

const COUNTDOWN_SECONDS = 3;
const LOCATION_UPDATE_INTERVAL_MS = 5_000; // Live tracking interval (5s)
const SHAKE_THRESHOLD = 2.5;
const SHAKE_COOLDOWN_MS = 4_000;
const SHAKE_ENABLED_KEY = "safeher-shake-sos-enabled";

type SosController = ReturnType<typeof useSosController>;
const SosContext = createContext<SosController | null>(null);

export function SosProvider({ children }: PropsWithChildren) {
  const value = useSosController();
  return createElement(SosContext.Provider, { value }, children);
}

export function useSos() {
  const value = useContext(SosContext);
  if (!value) throw new Error("SosProvider is missing.");
  return value;
}

function useSosController() {
  const { user } = useAuth();
  const userName = user?.name;

  const [sosState, setSosState] = useState<SosState>("idle");
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [nearbyStation, setNearbyStation] = useState<NearbyStation | undefined>();
  const [locationStr, setLocationStr] = useState<string>("Location not shared");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [shakeEnabled, setShakeEnabledState] = useState(true);

  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTriggerType = useRef<TriggerType>("SOS_BUTTON");
  const pendingLevel = useRef<SosLevel>("LEVEL_1");
  const lastShake = useRef(0);
  const localAlertId = useRef<string | null>(null);
  const managedEmergencyId = useRef<string | null>(null);

  /* ─── location helpers ─────────────────────────────────── */

  const getCurrentCoords = useCallback(async (requestPermission = true): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const currentPermission = await Location.getForegroundPermissionsAsync();
      const { status } = currentPermission.status === "granted" || !requestPermission
        ? currentPermission
        : await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return null;
    }
  }, []);

  const updateLocationForEmergency = useCallback(
    async (id: string) => {
      const coords = await getCurrentCoords(false);
      if (!coords) {
        setLocationStr("Location permission unavailable");
        return;
      }
      setLocationStr(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      try {
        const result = await post(`/api/emergencies/${id}/location`, {
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        if (result.error) {
          setLocationStr(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} · update failed`);
        }
      } catch {
        setLocationStr(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} · update failed`);
      }
    },
    [getCurrentCoords]
  );

  const startLiveLocationTracking = useCallback(async (id: string) => {
    if (locationTimer.current) clearInterval(locationTimer.current);
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }

    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
          (pos) => {
            const { latitude, longitude } = pos.coords;
            setLocationStr(`${latitude.toFixed(5)}, ${longitude.toFixed(5)} · Live`);
            void post(`/api/emergencies/${id}/location`, { latitude, longitude });
          }
        );
        locationWatcherRef.current = sub;
      }
    } catch (_) {}

    // Periodic fallback
    locationTimer.current = setInterval(() => {
      void updateLocationForEmergency(id);
    }, LOCATION_UPDATE_INTERVAL_MS);
  }, [updateLocationForEmergency]);

  const stopLiveLocationTracking = useCallback(() => {
    if (locationTimer.current) {
      clearInterval(locationTimer.current);
      locationTimer.current = null;
    }
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
  }, []);

  /* ─── countdown logic ──────────────────────────────────── */

  const startCountdown = useCallback((level: SosLevel, triggerType: TriggerType) => {
    if (sosState !== "idle") return;
    pendingLevel.current = level;
    pendingTriggerType.current = triggerType;
    setCountdown(COUNTDOWN_SECONDS);
    setSosState("countdown");
    Vibration.vibrate([0, 200]);
  }, [sosState]);

  const updateShakeEnabled = useCallback(async (enabled: boolean) => {
    try {
      await AsyncStorage.setItem(SHAKE_ENABLED_KEY, String(enabled));
      setShakeEnabledState(enabled);
    } catch {
      Alert.alert("Preference not saved", "Shake-to-SOS could not be updated on this device.");
    }
  }, []);

  const cancelCountdown = useCallback(() => {
    if (sosState !== "countdown") return;
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
    setSosState("idle");
    setCountdown(COUNTDOWN_SECONDS);
  }, [sosState]);

  const sendOfflineSmsFallback = useCallback(async (
    coordinates: { latitude: number; longitude: number } | null,
  ) => {
    const contacts = await getContacts();
    const phoneNumbers = [...new Set(contacts
      .map((contact) => contact.phone?.trim())
      .filter((phone): phone is string => Boolean(phone)))];
    if (!phoneNumbers.length) {
      return "No saved trusted-contact phone numbers are available for cellular SMS.";
    }

    const mapsLink = coordinates
      ? `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`
      : "Location unavailable.";
    const message = `SOS: ${userName || "Someone using SafeHer"} needs help. Location: ${mapsLink} Call 112 if immediate assistance is needed.`;
    try {
      const response = await openSmsComposer(phoneNumbers, message);
      if (response.result === "sent") {
        return "Your messaging app reported the SOS SMS sent or scheduled; delivery is not guaranteed.";
      }
      if (response.result === "unknown") {
        return "The SMS composer was opened, but the device could not confirm sending. Check your messaging app.";
      }
      return "The SMS composer was cancelled, so the trusted contacts were not notified by SMS.";
    } catch (error) {
      return error instanceof Error
        ? `Cellular SMS fallback failed: ${error.message}`
        : "Cellular SMS fallback failed.";
    }
  }, [userName]);

  /* ─── fire SOS ─────────────────────────────────────────── */

  const fireSos = useCallback(async () => {
    let localAlert: Awaited<ReturnType<typeof createAlert>> | null = null;
    let emergencyCreated = false;
    try {
      const coords = await getCurrentCoords();
      if (coords) {
        setLocationStr(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      }

      localAlert = await createAlert("sos", coords ? `${coords.latitude},${coords.longitude}` : undefined);
      localAlertId.current = localAlert.id;

      const body: Record<string, unknown> = {
        level: pendingLevel.current,
        triggerType: pendingTriggerType.current,
      };
      if (coords) {
        body.latitude = coords.latitude;
        body.longitude = coords.longitude;
      }

      let internetUnavailable = false;
      try {
        internetUnavailable = await isInternetUnavailable();
      } catch {
        // Continue with the backend request; its result will determine whether SMS fallback is needed.
      }
      if (internetUnavailable) {
        const smsStatus = await sendOfflineSmsFallback(coords);
        await resolveAlert(localAlert.id);
        setSosState("idle");
        Alert.alert(
          "No internet connection",
          `${smsStatus} SafeHer could not create a server incident or notify the police dashboard. Call 112 directly for immediate help.`
        );
        return;
      }

      const result = await post<EmergencyResponse>("/api/emergencies", body);

      if (result.error) {
        const smsStatus = result.offline ? await sendOfflineSmsFallback(coords) : "";
        await resolveAlert(localAlert.id);
        Alert.alert(
          result.offline ? "SOS server unavailable" : "SOS could not be sent",
          result.offline
            ? `${smsStatus} SafeHer could not create a server incident or notify the police dashboard. Call 112 directly or try again when connected.`
            : result.error
        );
        setSosState("idle");
        return;
      }

      const id = result.data?._id || result.data?.emergencyId || null;
      if (!id) {
        await resolveAlert(localAlert.id);
        Alert.alert("SOS could not be confirmed", "The server did not return an emergency reference. Call 112 directly if you need immediate help.");
        setSosState("idle");
        return;
      }
      emergencyCreated = true;
      setEmergencyId(id);
      setNearbyStation(result.data?.nearbyStation);
      setElapsedSeconds(result.data?.startedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(result.data.startedAt).getTime()) / 1000))
        : 0);
      if (result.data?.currentLocation?.latitude != null && result.data.currentLocation.longitude != null) {
        setLocationStr(`${result.data.currentLocation.latitude.toFixed(5)}, ${result.data.currentLocation.longitude.toFixed(5)}`);
      }
      setSosState("active");
      Vibration.vibrate([0, 300, 150, 300]);

      let contactAlertStatus = result.data?.alreadyActive
        ? "An existing SOS was found; duplicate contact messages were not sent."
        : "In-app contact alerts may be delayed if recipients are offline.";
      if (!result.data?.alreadyActive && userName) {
        try {
          const notificationResult = await post<{ sent: number; smsConfigured: boolean; results?: { ok?: boolean }[] }>("/api/notify/sos-sms", {
            emergencyId: id,
            userName,
            latitude: coords?.latitude,
            longitude: coords?.longitude,
          });
          if (notificationResult.error) {
            contactAlertStatus = `Could not confirm contact SMS alerts: ${notificationResult.error}`;
          } else if (!notificationResult.data?.smsConfigured) {
            contactAlertStatus = "SMS alerts are not configured on the server. In-app contact alerts may still arrive if recipients are online.";
          } else {
            const accepted = notificationResult.data.results?.filter((item) => item.ok).length ?? 0;
            const attempted = notificationResult.data.results?.length ?? 0;
            contactAlertStatus = attempted
              ? `SMS provider accepted ${accepted} of ${attempted} contact alert request${attempted === 1 ? "" : "s"}. Delivery is not guaranteed.`
              : "No phone-number contacts were available for SMS alerts.";
          }
        } catch (error) {
          contactAlertStatus = `Could not confirm contact SMS alerts: ${error instanceof Error ? error.message : "request failed"}`;
        }
      }

      Alert.alert(
        "SOS active in SafeHer",
        `${coords ? "Your location was shared with SafeHer." : "Location could not be shared."} ${contactAlertStatus} SafeHer does not dispatch emergency services. Call 112 directly for immediate help.`
      );

      void startLiveLocationTracking(id);
      elapsedTimer.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } catch (error) {
      if (!emergencyCreated && localAlert) {
        try {
          await resolveAlert(localAlert.id);
        } catch {
          Alert.alert("Local SOS cleanup failed", "The emergency could not be confirmed, and its local history entry could not be cleared.");
        }
      }
      setSosState(emergencyCreated ? "active" : "idle");
      Alert.alert(
        emergencyCreated ? "SOS active in SafeHer" : "SOS could not be confirmed",
        `${error instanceof Error ? error.message : "An unexpected error occurred."} ${emergencyCreated ? "Contact notification status is unknown." : "Call 112 directly if you need immediate help."}`
      );
    }
  }, [getCurrentCoords, sendOfflineSmsFallback, updateLocationForEmergency, userName]);

  /* ─── countdown effect ─────────────────────────────────── */

  useEffect(() => {
    if (sosState !== "countdown") return;
    countdownTimer.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(countdownTimer.current!);
          countdownTimer.current = null;
          setSosState("sending");
          void fireSos();
          return COUNTDOWN_SECONDS;
        }
        return n - 1;
      });
    }, 1000);
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [sosState, fireSos]);

  /* ─── cancel SOS ───────────────────────────────────────── */

  const cancelSos = useCallback(async () => {
    if (!emergencyId) {
      if (localAlertId.current) {
        try {
          await resolveAlert(localAlertId.current);
        } catch (error) {
          Alert.alert("SOS stopped", error instanceof Error ? `Local history could not be updated: ${error.message}` : "Local history could not be updated.");
        }
      }
      setSosState("idle");
      return;
    }

    let result;
    try {
      result = await post(`/api/emergencies/${emergencyId}/cancel`, {});
    } catch (error) {
      Alert.alert("Unable to confirm cancellation", error instanceof Error ? error.message : "Your SOS may still be active.");
      return;
    }
    if (result.error) {
      Alert.alert(
        "Unable to confirm cancellation",
        `${result.error}\nYour SOS may still be active. Keep trying when connected and call 112 if in danger.`
      );
      return;
    }

    stopLiveLocationTracking();
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
    setSosState("idle");
    setEmergencyId(null);
    setNearbyStation(undefined);
    setElapsedSeconds(0);
    if (localAlertId.current) {
      try {
        await resolveAlert(localAlertId.current);
      } catch (error) {
        Alert.alert("SOS cancelled", error instanceof Error ? `Local history could not be updated: ${error.message}` : "Local history could not be updated.");
      }
    }

    if (userName) {
      try {
        const notificationResult = await post("/api/notify/sos-cancel", { emergencyId, userName });
        if (notificationResult.error) {
          Alert.alert("SOS cancelled in SafeHer", `Could not confirm all-clear contact messages: ${notificationResult.error}`);
        }
      } catch (error) {
        Alert.alert("SOS cancelled in SafeHer", `Could not confirm all-clear contact messages: ${error instanceof Error ? error.message : "request failed"}`);
      }
    }

  }, [emergencyId, userName]);

  /* ─── load existing active emergency on mount ──────────── */

  const loadActiveEmergency = useCallback(async () => {
    const result = await api<EmergencyResponse>("/api/emergencies/active");
    if (result.data?._id) {
      const id = result.data._id;
      setEmergencyId(id);
      setNearbyStation(result.data.nearbyStation);
      setSosState("active");
      if (result.data.startedAt) {
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(result.data.startedAt).getTime()) / 1000)));
      }
      if (managedEmergencyId.current !== id) {
        if (elapsedTimer.current) clearInterval(elapsedTimer.current);
        if (locationTimer.current) clearInterval(locationTimer.current);
        managedEmergencyId.current = id;
        elapsedTimer.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
        void startLiveLocationTracking(id);
      }
    }
  }, [startLiveLocationTracking]);

  useEffect(() => {
    if (user?.role !== "user" || !user._id) return;
    const timer = setTimeout(() => {
      void loadActiveEmergency().catch((error) => {
        Alert.alert("SOS status unavailable", error instanceof Error ? error.message : "Could not load active SOS status.");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [user?._id, user?.role, loadActiveEmergency]);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(SHAKE_ENABLED_KEY)
      .then((value) => {
        if (active && value !== null) setShakeEnabledState(value === "true");
      })
      .catch(() => {
        Alert.alert("Could not load preference", "Shake-to-SOS remains enabled by default on this device.");
      });
    return () => { active = false; };
  }, []);

  /* ─── shake detection ──────────────────────────────────── */

  const setupShake = useCallback(() => {
    if (Platform.OS === "web" || !shakeEnabled) return () => {};
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const force = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (force > SHAKE_THRESHOLD && now - lastShake.current > SHAKE_COOLDOWN_MS) {
        lastShake.current = now;
        if (sosState === "idle") {
          startCountdown("LEVEL_1", "SHAKE");
        }
      }
    });
    Accelerometer.setUpdateInterval(400);
    return () => sub.remove();
  }, [shakeEnabled, sosState, startCountdown]);

  useEffect(() => {
    if (user?.role !== "user" || !user._id) return;
    const removeShake = setupShake();
    return removeShake;
  }, [setupShake, user?._id, user?.role]);

  /* ─── cleanup on unmount ───────────────────────────────── */

  useEffect(() => {
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      stopLiveLocationTracking();
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      managedEmergencyId.current = null;
    };
  }, []);

  /* ─── format elapsed time ──────────────────────────────── */

  const elapsedLabel = (() => {
    const m = Math.floor(elapsedSeconds / 60);
    const s = elapsedSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  })();

  return {
    sosState,
    countdown,
    emergencyId,
    nearbyStation,
    locationStr,
    elapsedLabel,
    startCountdown,
    cancelCountdown,
    cancelSos,
    loadActiveEmergency,
    setupShake,
    shakeEnabled,
    updateShakeEnabled,
    getCurrentCoords,
  };
}
