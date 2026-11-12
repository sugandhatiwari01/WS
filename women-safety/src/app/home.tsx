import { Redirect, router } from "expo-router";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Text, View } from "react-native";
import { Action, Badge, Card, Divider, Header, SosButton, StatusBanner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api, post, uploadAudio } from "@/lib/api";
import { useSos } from "@/hooks/useSos";
import { useSocket } from "@/hooks/useSocket";
import { colors, styles } from "@/lib/theme";

type IncomingEmergency = {
  _id: string;
  emergencyId?: string;
  level?: string;
  status?: string;
  userName?: string;
};

type SafetyHealth = { ok?: boolean; sms?: boolean; voice?: boolean };

export default function Home() {
  const { user, signOut } = useAuth();
  const {
    sosState,
    countdown,
    emergencyId,
    nearbyStation,
    locationStr,
    elapsedLabel,
    shakeEnabled,
    startCountdown,
    cancelCountdown,
    cancelSos,
  } = useSos();

  const [incomingAlerts, setIncomingAlerts] = useState<IncomingEmergency[]>([]);
  const [fakeCalling, setFakeCalling] = useState(false);
  const [readiness, setReadiness] = useState({
    loading: true,
    backend: null as boolean | null,
    contacts: null as number | null,
    location: null as boolean | null,
    sms: null as boolean | null,
    voice: null as boolean | null,
  });

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const checkReadiness = useCallback(async () => {
    setReadiness((current) => ({ ...current, loading: true }));
    const [healthResult, contactsResult, locationResult] = await Promise.allSettled([
      api<SafetyHealth>("/health"),
      api<{ _id: string }[]>("/api/contacts"),
      Location.getForegroundPermissionsAsync(),
    ]);

    const health = healthResult.status === "fulfilled" ? healthResult.value.data : undefined;
    const contacts = contactsResult.status === "fulfilled" ? contactsResult.value.data : undefined;
    const permission = locationResult.status === "fulfilled" ? locationResult.value : undefined;
    setReadiness({
      loading: false,
      backend: Boolean(health?.ok && contacts !== undefined),
      contacts: contacts?.length ?? null,
      location: permission ? permission.status === "granted" : null,
      sms: typeof health?.sms === "boolean" ? health.sms : null,
      voice: typeof health?.voice === "boolean" ? health.voice : null,
    });
  }, []);

  /* ─── Socket.IO real-time ──────────────────────────────── */
  useSocket({
    userId: user?._id,
    onEvent: (event, data) => {
      if (event === "family:emergency") {
        setIncomingAlerts((prev) => {
          const item = data as IncomingEmergency;
          // Avoid duplicates
          if (prev.some((a) => a._id === item._id || a.emergencyId === item.emergencyId)) return prev;
          return [item, ...prev];
        });
      }
    },
  });

  /* ─── Init ─────────────────────────────────────────────── */
  useEffect(() => {
    void Promise.resolve().then(checkReadiness);

    // Load incoming family alerts via polling fallback (also updated via socket)
    const loadIncoming = async () => {
      const result = await api<IncomingEmergency[]>("/api/family/emergencies");
      if (result.data) setIncomingAlerts(result.data);
    };
    void loadIncoming();
    const pollTimer = setInterval(() => void loadIncoming(), 15_000);

    return () => {
      clearInterval(pollTimer);
    };
  }, [checkReadiness]);

  /* ─── SOS button press ─────────────────────────────────── */
  const handleSosPress = () => {
    if (sosState === "idle") {
      startCountdown("LEVEL_1", "SOS_BUTTON");
    } else if (sosState === "countdown") {
      cancelCountdown();
    } else if (sosState === "active") {
      Alert.alert(
        "Cancel SOS?",
        "This will try to cancel the SOS in SafeHer and send an all-clear contact message if available.",
        [
          { text: "Keep SOS Active", style: "cancel" },
          { text: "Cancel SOS", style: "destructive", onPress: () => void cancelSos() },
        ]
      );
    }
  };

  /* ─── Level 2 urgent ───────────────────────────────────── */
  const handleLevel2 = () => {
    if (sosState === "idle") startCountdown("LEVEL_2", "MANUAL_LEVEL_2");
  };

  const callEmergencyServices = async () => {
    try {
      await Linking.openURL("tel:112");
    } catch {
      Alert.alert("Unable to open the phone app", "Please open your phone app and call 112.");
    }
  };

  /* ─── Audio recording ──────────────────────────────────── */
  const toggleRecording = async () => {
    if (recorderState.isRecording) {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri && emergencyId) {
        const result = await uploadAudio(`/api/emergencies/${emergencyId}/audio`, uri);
        Alert.alert(
          result.error ? "Audio upload failed" : "✅ Audio saved",
          result.error || "Recording is attached to your active emergency."
        );
      }
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Microphone needed", "Allow microphone access to record evidence.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  /* ─── Fake call ────────────────────────────────────────── */
  const triggerFakeCall = async () => {
    setFakeCalling(true);
    try {
      const result = await post("/api/notify/fake-call", {});
      if (result.error) {
        Alert.alert("Call request failed", result.error);
      } else {
        Alert.alert("Call request accepted", "Check your profile phone. The voice provider may still fail to complete the call.");
      }
    } catch (error) {
      Alert.alert("Call request failed", error instanceof Error ? error.message : "The request could not be completed.");
    } finally {
      setFakeCalling(false);
    }
  };

  /* ─── Guards ───────────────────────────────────────────── */
  if (!user) return <Redirect href="/login" />;

  /* ─── POLICE / FAMILY view ─────────────────────────────── */
  if (user.role !== "user") {
    return (
      <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
        <Header
          title={`Hi, ${user.name}`}
          subtitle={user.role === "family" ? "Stay connected to your family circle." : "Monitor and respond to active incidents."}
        />
        <Card>
          <Text style={styles.h2}>{user.role === "family" ? "Family dashboard" : "Police dashboard"}</Text>
          <Text style={[styles.subtitle, { marginTop: 6 }]}>
            {user.role === "family" ? "Live alerts from your connected network." : "Real-time incident response queue."}
          </Text>
          <Action
            label={`Open ${user.role === "family" ? "family" : "police"} dashboard`}
            onPress={() => router.push(user.role === "family" ? "/family" : ("/police" as never))}
          />
        </Card>
        <Action label="Sign out" secondary onPress={signOut} />
      </ScrollView>
    );
  }

  /* ─── USER main view ───────────────────────────────────── */
  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title={`Hi, ${user.name}`}
        subtitle="Know what is ready before you need it."
      />

      <Card>
        <View style={styles.spaceBetween}>
          <Text style={styles.h2}>Safety readiness</Text>
          <Badge
            label={readiness.loading ? "CHECKING" : readiness.backend && (readiness.contacts ?? 0) > 0 && readiness.location ? "CORE READY" : "CHECK SETUP"}
            variant={readiness.loading ? "neutral" : readiness.backend && (readiness.contacts ?? 0) > 0 && readiness.location ? "success" : "warning"}
          />
        </View>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          A quick check of your server connection, trusted contacts, and location permission. This cannot verify emergency-service response.
        </Text>
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text style={styles.caption}>
            {readiness.backend === null ? "Server: checking…" : readiness.backend ? "Server and contact API: responding" : "Server or contact API: unavailable"}
          </Text>
          <Text style={styles.caption}>
            {readiness.contacts === null ? "Trusted contacts: could not verify" : `Trusted contacts: ${readiness.contacts} on server`}
          </Text>
          <Text style={styles.caption}>
            {readiness.location === null ? "Location permission: could not verify" : readiness.location ? "Location permission: allowed" : "Location permission: not allowed"}
          </Text>
          <Text style={styles.caption}>
            {readiness.sms === null ? "SMS service: could not verify" : readiness.sms ? "SMS service: configured (delivery is not guaranteed)" : "SMS service: not configured"}
          </Text>
          <Text style={styles.caption}>
            {readiness.voice === null ? "Incoming-call service: could not verify" : readiness.voice ? "Incoming-call service: configured" : "Incoming-call service: not configured"}
          </Text>
        </View>
        {readiness.contacts === 0 && (
          <Action label="Add a trusted contact" secondary onPress={() => router.push("/contacts" as never)} />
        )}
        {readiness.location === false && (
          <Action
            label="Allow location for SOS"
            secondary
            onPress={async () => {
              const permission = await Location.requestForegroundPermissionsAsync();
              if (!permission.granted) {
                Alert.alert("Location is still off", "Without location permission, SafeHer cannot share your coordinates.");
              }
              await checkReadiness();
            }}
          />
        )}
        <Action
          label={readiness.loading ? "Checking…" : "Run check again"}
          secondary
          disabled={readiness.loading}
          onPress={() => void checkReadiness()}
        />
      </Card>

      {/* Incoming family alerts */}
      {incomingAlerts.length > 0 && (
        <StatusBanner
          title={`🚨 ${incomingAlerts.length} contact alert${incomingAlerts.length > 1 ? "s" : ""}`}
          subtitle={`${incomingAlerts[0].level || "EMERGENCY"} from ${incomingAlerts[0].userName || "trusted contact"}`}
          actionLabel="View"
          onAction={() => router.push("/family" as never)}
        />
      )}

      {/* Active SOS status banner */}
      {sosState === "active" && (
        <Card danger>
          <Text style={[styles.h2, { color: colors.red }]}>🚨 SOS Active — {elapsedLabel}</Text>
          <Text style={[styles.subtitle, { marginTop: 6 }]}>📍 {locationStr}</Text>
          <Text style={[styles.caption, { marginTop: 6 }]}>
            Location updates are attempted while SafeHer is open; this is not background tracking.
          </Text>
          {nearbyStation?.name && (
            <Text style={[styles.caption, { marginTop: 4 }]}>
              Nearest station: {nearbyStation.name} • {nearbyStation.distanceKm} km
            </Text>
          )}
          <Divider />
          <Action
            label={recorderState.isRecording ? "⏹ Stop & save recording" : "🎙 Record audio evidence"}
            secondary
            onPress={toggleRecording}
          />
          {nearbyStation?.location?.coordinates && (
            <Action
              label="View station on map"
              secondary
              onPress={() => {
                const [lng, lat] = nearbyStation.location!.coordinates!;
                void Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
              }}
            />
          )}
        </Card>
      )}

      {/* Emergency actions */}
      <Card>
        <Text style={styles.h2}>Need help right now?</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          {sosState === "idle"
            ? "SOS asks SafeHer to share your location and alert linked contacts. It does not call emergency services."
            : sosState === "countdown"
            ? "SOS is about to start. Tap the circle or cancel below to stop it."
            : sosState === "sending"
            ? "SafeHer is contacting its server. This does not call emergency services."
            : "Your SOS is active. Call 112 directly if you need emergency services."}
        </Text>

        <SosButton state={sosState} countdown={countdown} onPress={handleSosPress} />

        {sosState === "idle" && (
          <Action label="🔴 Level 2 — Urgent / Violence" danger onPress={handleLevel2} />
        )}
        {sosState === "countdown" && (
          <Action label="✕ Cancel countdown" secondary onPress={cancelCountdown} />
        )}

        <Action
          label="Call emergency services — 112"
          danger
          onPress={() => void callEmergencyServices()}
        />

        {Platform.OS !== "web" && shakeEnabled && sosState === "idle" && (
          <Text style={[styles.caption, { textAlign: "center", marginTop: 8 }]}>
            You can also shake your phone to start SOS.
          </Text>
        )}
      </Card>

      {/* Planned journey */}
      <Card>
        <Text style={styles.h2}>Going somewhere?</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Set a check-in timer for a walk or journey. If it expires, SOS starts while the timer screen is active. If you close SafeHer, reopen that screen to check the deadline.
        </Text>
        <Action
          label="Plan a safe trip"
          secondary
          disabled={sosState !== "idle"}
          onPress={() => router.push("/timer" as never)}
        />
        <Action
          label="Manage trusted contacts"
          secondary
          onPress={() => router.push("/contacts" as never)}
        />
      </Card>

      {/* Additional tools */}
      <Card>
        <Text style={styles.h3}>More tools</Text>
        <Action
          label="Request an incoming call"
          secondary
          loading={fakeCalling}
          disabled={readiness.voice !== true || !user.phone}
          onPress={() => void triggerFakeCall()}
        />
        {(readiness.voice !== true || !user.phone) && (
          <Text style={styles.caption}>
            {readiness.voice !== true ? "The optional voice-call service is not configured on the server." : "Add a phone number to your profile to request a call."}
          </Text>
        )}
        <Action
          label="View alert history"
          secondary
          onPress={() => router.push("/history" as never)}
        />
      </Card>

      {/* Current location */}
      <Card>
        <Text style={styles.h3}>Current location</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>{locationStr}</Text>
      </Card>

      <Action label="⚙️ Settings" secondary onPress={() => router.push("/settings" as never)} />
      <Action label="Sign out" secondary onPress={signOut} />

      <View style={{ height: 40 }} />
      <Text style={[styles.caption, { textAlign: "center" }]}>
        SafeHer is a support tool, not a replacement for emergency services. Call 112 for immediate danger.
      </Text>
    </ScrollView>
  );
}
