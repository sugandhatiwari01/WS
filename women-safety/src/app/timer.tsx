/**
 * Check-in timer screen
 *
 * User sets a deadline. An expired timer starts SOS when this screen is active
 * or reopened; this does not run as a background service.
 */

import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, ScrollView, Text, View } from "react-native";
import * as Location from "expo-location";
import * as SMS from "expo-sms";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Action, Card, Divider, Header } from "@/components/ui";
import { useSos } from "@/hooks/useSos";
import { useAuth } from "@/lib/auth";
import { Contact, getContacts, saveContacts } from "@/lib/storage";
import { api, post } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

const PRESET_MINUTES = [5, 10, 15, 30];
const TIMER_STORAGE_KEY = "safeher-check-in-timer";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type CheckinContact = Pick<Contact, "id" | "name"> & { phone: string };
type StoredTimer = { expiresAt: number; durationMinutes: number; contact?: CheckinContact; armed?: boolean };
type ServerContact = { _id: string; name: string; phone?: string; email?: string };

export default function TimerScreen() {
  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(null);
  const [plannedMinutes, setPlannedMinutes] = useState(15);
  const [contacts, setContacts] = useState<CheckinContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<CheckinContact | null>(null);
  const [contactError, setContactError] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const expiryRef = useRef<number | null>(null);
  const expiredRef = useRef(false);

  const { sosState, startCountdown } = useSos();
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    void getContacts()
      .then((saved) => {
        if (active) {
          setContacts(saved
            .filter((contact): contact is Contact & { phone: string } => Boolean(contact.phone))
            .map(({ id, name, phone }) => ({ id, name, phone })));
        }
      })
      .catch(() => { if (active) setContactError("Saved contacts could not be loaded."); });
    void api<ServerContact[]>("/api/contacts")
      .then(async (result) => {
        if (!active) return;
        if (!result.data) {
          setContactError(result.error || "Could not verify contacts with the server.");
          return;
        }
        const saved: CheckinContact[] = result.data
          .filter((contact): contact is ServerContact & { phone: string } => Boolean(contact.phone))
          .map((contact) => ({ id: contact._id, name: contact.name, phone: contact.phone }));
        setContacts(saved);
        setContactError("");
        await saveContacts(result.data.map((contact) => ({
          id: contact._id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
        })));
      })
      .catch(() => { if (active) setContactError("Contacts could not be synced with the server."); });
    return () => { active = false; };
  }, []);

  const expireTimer = useCallback(async () => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    expiryRef.current = null;
    setRunning(false);
    setRemaining(0);
    try {
      await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
    } catch {
      Alert.alert("Timer storage issue", "The expired timer could not be cleared from this device.");
    }

    if (sosState === "idle") {
      startCountdown("LEVEL_1", "TIMER");
      Alert.alert(
        "Check-in timer expired",
        "SafeHer is attempting to start SOS. It does not call emergency services; call 112 directly for immediate help."
      );
    } else {
      Alert.alert("Check-in timer expired", "An SOS is already active.");
    }
  }, [sosState, startCountdown]);

  const saveTimer = useCallback(async (
    minutes: number,
    contact?: CheckinContact,
    armed = true
  ): Promise<StoredTimer | null> => {
    const expiresAt = Date.now() + minutes * 60_000;
    const stored: StoredTimer = { expiresAt, durationMinutes: minutes, contact, armed };
    try {
      await AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      Alert.alert("Timer could not start", "SafeHer could not save this timer on your device. Please try again.");
      return null;
    }
    return stored;
  }, []);

  const activateTimer = useCallback((timer: StoredTimer) => {
    expiredRef.current = false;
    expiryRef.current = timer.expiresAt;
    setSelectedMinutes(timer.durationMinutes);
    setSelectedContact(timer.contact ?? null);
    setRemaining(Math.max(0, Math.ceil((timer.expiresAt - Date.now()) / 1000)));
    setRunning(true);
  }, []);

  const armPreparedTimer = useCallback(async (timer: StoredTimer) => {
    const armedTimer = { ...timer, armed: true };
    try {
      await AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(armedTimer));
    } catch {
      Alert.alert("Timer could not start", "Your trip message may have been sent, but SafeHer could not save the check-in timer.");
      return false;
    }
    activateTimer(armedTimer);
    return true;
  }, [activateTimer]);

  const startTimer = useCallback(async (minutes: number) => {
    const timer = await saveTimer(minutes);
    if (!timer) return;
    activateTimer(timer);
  }, [activateTimer, saveTimer]);

  const discardPreparedTimer = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
    } catch {
      Alert.alert("Timer cleanup failed", "A prepared trip timer could not be cleared from this device.");
    }
  }, []);

  const shareTripPlan = useCallback(async () => {
    if (!selectedContact?.phone) {
      Alert.alert("Choose a trusted contact", "Select someone with a saved phone number to prepare a trip message.");
      return;
    }

    const timer = await saveTimer(plannedMinutes, selectedContact, false);
    if (!timer) return;

    let coords: { latitude: number; longitude: number } | null = null;
    let locationText = "Starting location unavailable.";
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.granted) {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        locationText = `Starting location: https://maps.google.com/?q=${position.coords.latitude},${position.coords.longitude}`;
      }
    } catch {
      locationText = "Starting location could not be read.";
    }

    const arrivalTime = new Date(timer.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    // AUTOMATED: Try server-side SMS first (zero user intervention)
    try {
      const serverResult = await post<{ ok: boolean; smsConfigured: boolean }>("/api/notify/trip-sms", {
        contactPhone: selectedContact.phone,
        contactName: selectedContact.name,
        userName: user?.name,
        arrivalTime,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      });

      if (serverResult.data?.ok) {
        if (await armPreparedTimer(timer)) {
          Alert.alert(
            "Trip check-in started (Automated)",
            `An automated SMS was sent to ${selectedContact.name} with your starting location and ${arrivalTime} deadline.`
          );
          return;
        }
      }
    } catch (_) {}

    // Offline / fallback to phone SMS app if server send didn't succeed
    try {
      if (!(await SMS.isAvailableAsync())) {
        Alert.alert("SMS unavailable", "This device cannot open an SMS composer. You can still start a private check-in timer.");
        return;
      }
      const message = `I'm heading out now and plan to check in by ${arrivalTime}. ${locationText} This is not live location tracking. Please call me if I do not check in.`;
      const response = await SMS.sendSMSAsync(selectedContact.phone, message);
      if (response.result === "sent" || response.result === "unknown") {
        await armPreparedTimer(timer);
      } else {
        await discardPreparedTimer();
        Alert.alert("Message cancelled", "The trip timer was not started.");
      }
    } catch (error) {
      await discardPreparedTimer();
      Alert.alert("Trip message failed", error instanceof Error ? error.message : "The messaging app could not prepare the message.");
    }
  }, [armPreparedTimer, discardPreparedTimer, plannedMinutes, saveTimer, selectedContact, user?.name]);

  const sendArrivalCheckin = useCallback(async (contact: CheckinContact) => {
    // AUTOMATED: Try server-side SMS first
    try {
      const res = await post<{ ok: boolean }>("/api/notify/trip-arrival", {
        contactPhone: contact.phone,
        userName: user?.name,
      });
      if (res.data?.ok) {
        Alert.alert(
          "Timer stopped (Automated)",
          `An automated arrival SMS was sent to ${contact.name}. You're all set!`
        );
        return;
      }
    } catch (_) {}

    // Fallback to native SMS composer
    try {
      if (await SMS.isAvailableAsync()) {
        await SMS.sendSMSAsync(contact.phone, `I arrived safely. My SafeHer check-in timer is stopped.`);
      }
      Alert.alert("Check-in complete", "Your timer has been stopped.");
    } catch (error) {
      Alert.alert("Timer stopped", error instanceof Error ? `Could not prepare the arrival message: ${error.message}` : "Contact your trusted person directly.");
    }
  }, [user?.name]);

  const stopTimer = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
    } catch {
      Alert.alert("Timer could not be cancelled", "The saved timer could not be cleared. Please try again.");
      return;
    }
    expiryRef.current = null;
    expiredRef.current = true;
    setRunning(false);
    setSelectedMinutes(null);
    setRemaining(0);
    const contact = selectedContact;
    setSelectedContact(null);
    if (contact?.phone) {
      await sendArrivalCheckin(contact);
    } else {
      Alert.alert("Check-in complete", "Your timer has been stopped.");
    }
  }, [selectedContact, sendArrivalCheckin]);

  /* Restore an unfinished timer after navigating away or reopening the app. */
  useEffect(() => {
    let mounted = true;
    const restoreTimer = async () => {
      try {
        const value = await AsyncStorage.getItem(TIMER_STORAGE_KEY);
        if (!mounted || !value) return;

        const timer = JSON.parse(value) as StoredTimer;
        if (!Number.isFinite(timer.expiresAt) || !Number.isFinite(timer.durationMinutes)) {
          throw new Error("Saved timer is invalid.");
        }
        if (timer.armed === false) {
          await AsyncStorage.removeItem(TIMER_STORAGE_KEY);
          if (mounted) Alert.alert("Trip timer not started", "The SMS confirmation did not finish, so SafeHer did not start the timer.");
          return;
        }
        expiryRef.current = timer.expiresAt;
        expiredRef.current = false;
        setSelectedMinutes(timer.durationMinutes);
        setSelectedContact(timer.contact ?? null);
        const secondsLeft = Math.max(0, Math.ceil((timer.expiresAt - Date.now()) / 1000));
        if (secondsLeft === 0) {
          await expireTimer();
        } else {
          setRemaining(secondsLeft);
          setRunning(true);
        }
      } catch {
        if (mounted) {
          Alert.alert("Could not restore timer", "The saved check-in timer could not be read from this device.");
        }
      } finally {
        if (mounted) setRestoring(false);
      }
    };
    void restoreTimer();

    return () => { mounted = false; };
  }, [expireTimer]);

  /* Use the absolute deadline so background pauses don't extend the timer. */
  useEffect(() => {
    if (!running) return;
    const updateRemaining = () => {
      const expiresAt = expiryRef.current;
      if (expiresAt === null) return;
      const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(secondsLeft);
      if (secondsLeft === 0) void expireTimer();
    };
    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updateRemaining();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [running, expireTimer]);

  /* ─── progress percentage ──────────────────────────────── */
  const totalSeconds = (selectedMinutes ?? 0) * 60;
  const percent = totalSeconds > 0 ? Math.round((remaining / totalSeconds) * 100) : 0;

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Check-in timer"
        subtitle="Set a check-in deadline. If you miss it, SafeHer starts SOS when this screen is active or reopened."
      />

      {restoring ? (
        <Card>
          <Text style={styles.subtitle}>Checking for an active timer…</Text>
        </Card>
      ) : !running ? (
        <Card>
          <Text style={styles.h3}>Plan a safe trip</Text>
          <Text style={[styles.subtitle, { marginTop: 6, marginBottom: 10 }]}>
            Pick a check-in deadline. You can prepare a one-time ETA and starting-pin message for someone you trust, then get a reminder to check in.
          </Text>
          {PRESET_MINUTES.map((min) => (
            <Action
              key={min}
              label={`${min} minutes`}
              secondary={plannedMinutes !== min}
              onPress={() => setPlannedMinutes(min)}
            />
          ))}
          <Divider />
          <Text style={styles.h3}>Tell someone before you leave</Text>
          <Text style={[styles.caption, { marginTop: 4 }]}>
            SafeHer opens your SMS app with a starting pin and ETA. It does not share live location; you choose whether to send.
          </Text>
          {contactError ? <Text style={[styles.caption, { marginTop: 8 }]}>{contactError}</Text> : null}
          {contacts.length === 0 ? (
            <Action label="Add a trusted contact" secondary onPress={() => router.push("/contacts" as never)} />
          ) : (
            contacts.map((contact) => (
              <Action
                key={contact.id}
                label={`${selectedContact?.id === contact.id ? "Selected: " : ""}${contact.name}`}
                secondary={selectedContact?.id !== contact.id}
                onPress={() => setSelectedContact(contact)}
              />
            ))
          )}
          {selectedContact ? (
            <Action
              label={`Share trip plan & start ${plannedMinutes}-minute check-in`}
              onPress={() => void shareTripPlan()}
            />
          ) : null}
          <Action
            label={`Start private ${plannedMinutes}-minute check-in`}
            secondary
            disabled={sosState !== "idle"}
            onPress={() => void startTimer(plannedMinutes)}
          />
        </Card>
      ) : (
        <Card danger>
          {/* Large countdown display */}
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <Text style={{ fontSize: 72, fontWeight: "900", color: colors.amber, fontVariant: ["tabular-nums"] }}>
              {formatTime(remaining)}
            </Text>
            <Text style={[styles.subtitle, { marginTop: 8 }]}>
              {remaining > 0 ? "Tap 'I'm safe' before this reaches zero." : "Time's up — SOS is starting."}
            </Text>
            <Text style={[styles.caption, { marginTop: 6 }]}>
              {percent}% remaining of {selectedMinutes} minutes
            </Text>
          </View>

          <Action
            label="✅ I'm safe — stop timer"
            green
            onPress={stopTimer}
          />
          <Text style={[styles.caption, { textAlign: "center", marginTop: 10 }]}>
            The deadline is saved on this device. If you close SafeHer, reopen this screen to check it. SOS cannot be sent while the app is closed.
          </Text>
        </Card>
      )}

      {/* How it works */}
      {!running && (
        <Card>
          <Text style={styles.h3}>How it works</Text>
          <View style={{ marginTop: 8, gap: 10 }}>
            {[
              "Choose a check-in deadline for your walk, ride, or meeting.",
              "Optionally share a one-time ETA and starting pin via your SMS app.",
              "If you arrive safely, tap the check-in button; SafeHer can prepare an arrival message.",
              "If the deadline passes, SOS is attempted only when this screen is active or reopened. Call 112 for immediate help.",
            ].map((step, i) => (
              <Text key={i} style={styles.subtitle}>{step}</Text>
            ))}
          </View>
        </Card>
      )}

      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
