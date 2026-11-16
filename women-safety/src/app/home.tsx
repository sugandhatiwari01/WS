import { Redirect, router } from "expo-router";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Text, View } from "react-native";
import { Action, Badge, Card, Divider, Header, SosButton, StatusBanner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api, post, uploadAudio } from "@/lib/api";
import { useSos } from "@/hooks/useSos";
import { useSocket } from "@/hooks/useSocket";
import FakeCallModal from "@/components/fake-call-modal";
import LiveMapView, { PoliceStationMarker } from "@/components/live-map-view";
import { colors, styles } from "@/lib/theme";

type IncomingEmergency = {
  _id: string;
  emergencyId?: string;
  status?: string;
  userName?: string;
};

type SafetyHealth = { ok?: boolean; sms?: boolean; voice?: boolean };
type PendingAudio = { uri: string; emergencyId: string };

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
  const [fakeCallModalVisible, setFakeCallModalVisible] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [nearbyStations, setNearbyStations] = useState<PoliceStationMarker[]>([]);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
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
  // Separate recorder instance for auto-recording so it never conflicts with manual recording
  const autoRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const pendingAudioKey = user?._id ? `safeher-pending-audio-${user._id}` : null;

  useEffect(() => {
    if (!pendingAudioKey || !emergencyId) return;
    let active = true;
    void AsyncStorage.getItem(pendingAudioKey).then((value) => {
      if (!active || !value) return;
      const saved = JSON.parse(value) as PendingAudio;
      if (saved.uri && saved.emergencyId === emergencyId) setPendingAudio(saved);
    }).catch((error) => {
      if (active) {
        Alert.alert("Saved audio unavailable", error instanceof Error ? error.message : "The pending audio upload could not be restored.");
      }
    });
    return () => { active = false; };
  }, [emergencyId, pendingAudioKey]);

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

  const loadNearbyStations = useCallback(async () => {
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        setUserCoords({ latitude: lat, longitude: lng });
      }
      const queryParam = lat != null && lng != null ? `?latitude=${lat}&longitude=${lng}` : "";
      const result = await api<PoliceStationMarker[]>(`/api/police/stations${queryParam}`);
      if (result.data) {
        setNearbyStations(result.data);
      }
    } catch (_) {}
  }, []);

  /* ─── Init ─────────────────────────────────────────────── */
  useEffect(() => {
    void Promise.resolve().then(checkReadiness);
    void loadNearbyStations();

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
  }, [checkReadiness, loadNearbyStations]);

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

  const callEmergencyServices = async () => {
    try {
      await Linking.openURL("tel:112");
    } catch {
      Alert.alert("Unable to open the phone app", "Please open your phone app and call 112.");
    }
  };

  /* ─── Automated 10-second audio recording when SOS triggers ─── */
  const autoRecordedEmergencyId = useRef<string | null>(null);

  useEffect(() => {
    if (sosState !== "active" || !emergencyId) {
      if (sosState === "idle") autoRecordedEmergencyId.current = null;
      return;
    }
    if (autoRecordedEmergencyId.current === emergencyId) return;
    autoRecordedEmergencyId.current = emergencyId;

    let cancelled = false;
    const startAutoRecord = async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted || cancelled) return;
        // Use the dedicated auto-recorder (never conflicts with manual recording)
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await autoRecorder.prepareToRecordAsync();
        autoRecorder.record();

        setTimeout(async () => {
          if (cancelled) return;
          try {
            await autoRecorder.stop();
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
            const uri = autoRecorder.uri;
            if (uri && !cancelled) {
              await uploadRecording(uri);
            }
          } catch (e) {
            console.warn("Auto recording finish error:", e);
          }
        }, 10_000);
      } catch (e) {
        console.warn("Auto recording start error:", e);
      }
    };

    const timer = setTimeout(() => {
      void startAutoRecord();
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sosState, emergencyId]);

  /* ─── Audio recording ──────────────────────────────────── */
  const uploadRecording = async (uri: string) => {
    if (!emergencyId) {
      Alert.alert("Recording not uploaded", "There is no active server incident to attach this recording to. Start an SOS before recording.");
      return;
    }
    const pending = { uri, emergencyId };
    setPendingAudio(pending);
    if (pendingAudioKey) {
      try {
        await AsyncStorage.setItem(pendingAudioKey, JSON.stringify(pending));
      } catch (error) {
        Alert.alert("Retry not saved", error instanceof Error ? error.message : "The pending upload could not be saved on this device.");
      }
    }
    setAudioUploading(true);
    try {
      const result = await uploadAudio<{ url?: string }>(`/api/emergencies/${emergencyId}/audio`, uri);
      if (result.error) {
        Alert.alert(
          "Audio upload failed",
          `The recording is saved on this device but is not available in the police dashboard yet. ${result.error}`
        );
        return;
      }
      setPendingAudio(null);
      let cleanupWarning = "";
      if (pendingAudioKey) {
        try {
          await AsyncStorage.removeItem(pendingAudioKey);
        } catch (error) {
          cleanupWarning = error instanceof Error
            ? ` Its local retry marker could not be removed: ${error.message}`
            : " Its local retry marker could not be removed.";
        }
      }
      Alert.alert(
        "Audio shared with dispatch",
        `The recording is attached to this incident and can be reviewed from the police dashboard.${cleanupWarning}`
      );
      // Automatically send audio alert SMS & socket broadcast to family and police
      void post("/api/notify/audio-alert", {
        emergencyId,
        userName: user?.name,
        audioUrl: result.data?.url,
      });
    } catch (error) {
      Alert.alert("Audio upload failed", error instanceof Error ? error.message : "The recording is still saved on this device.");
    } finally {
      setAudioUploading(false);
    }
  };

  const toggleRecording = async () => {
    try {
      if (recorderState.isRecording) {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = recorder.uri || recorderState.url;
        if (!uri) {
          Alert.alert("Recording unavailable", "The microphone did not produce an audio file.");
          return;
        }
        await uploadRecording(uri);
        return;
      }
      if (sosState !== "active" || !emergencyId) {
        Alert.alert("Start SOS first", "Audio evidence can be recorded only while a server incident is active.");
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone needed", "Allow microphone access to record audio during an active SOS.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      Alert.alert("Audio recording failed", error instanceof Error ? error.message : "The microphone could not be started.");
    }
  };

  /* ─── Fake call ────────────────────────────────────────── */
  const triggerFakeCall = async () => {
    setFakeCalling(true);
    try {
      void post("/api/notify/fake-call", {});
      Alert.alert(
        "Incoming Call Scheduled",
        "Your phone will ring with an incoming call in 3 seconds. Use it to excuse yourself safely.",
        [{ text: "OK" }]
      );
      setTimeout(() => {
        setFakeCallModalVisible(true);
      }, 3000);
    } catch (_) {
      setFakeCallModalVisible(true);
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
          subtitle={`${incomingAlerts[0].userName || "A trusted contact"} needs help`}
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
          <Text style={[styles.caption, { marginTop: 6 }]}>
            Audio is recorded only when you start it. The microphone indicator stays visible while recording.
          </Text>
          {recorderState.isRecording ? (
            <Text accessibilityLiveRegion="polite" style={[styles.h3, { color: colors.red, marginTop: 8 }]}>
              ● Recording surroundings · {Math.floor(recorderState.durationMillis / 1000)}s
            </Text>
          ) : null}
          <Action
            label={audioUploading ? "Uploading audio…" : recorderState.isRecording ? "⏹ Stop & upload recording" : "🎙 Record surroundings"}
            secondary
            loading={audioUploading}
            disabled={audioUploading}
            onPress={() => void toggleRecording()}
          />
          {pendingAudio?.emergencyId === emergencyId ? (
            <Action
              label="Retry upload saved recording"
              secondary
              loading={audioUploading}
              disabled={audioUploading}
              onPress={() => void uploadRecording(pendingAudio.uri)}
            />
          ) : null}
          {pendingAudio?.emergencyId === emergencyId ? (
            <Text style={styles.caption}>
              This recording is on this device only until its upload succeeds. Police cannot review it yet.
            </Text>
          ) : null}
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

      {/* ─── INDIA-WIDE SAFEST ROUTE SYSTEM ─── */}
      <Card>
        <View style={styles.spaceBetween}>
          <Text style={styles.h2}>🧭 India-Wide Safest Route</Text>
          <Badge label="DATA-DRIVEN" variant="success" />
        </View>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Compare alternative routes between any two points in India using live lighting coverage,
          police outpost density, medical emergency havens, and NCRB crime statistics.
        </Text>
        <Action
          label="🔍 Find Safest Route Across India"
          onPress={() => router.push("/safest-route" as never)}
        />
      </Card>

      {/* ─── LIVE MAP & NEARBY POLICE STATIONS ─── */}
      <Card>
        <View style={styles.spaceBetween}>
          <Text style={styles.h2}>🗺️ Live Map & Police Stations</Text>
          <Badge
            label={userCoords ? "GPS ACTIVE" : "RADAR"}
            variant={userCoords ? "success" : "neutral"}
          />
        </View>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          {nearbyStations.length > 0
            ? `Nearest: ${nearbyStations[0].name} (${nearbyStations[0].distanceKm ?? 0.8} km away). Track your live position, compass, and nearest police stations.`
            : "Locate nearby police outposts and track your live GPS position on an interactive radar map."}
        </Text>

        <Action
          label={showMap ? "Hide Radar Map" : "🗺️ View Live Radar Map & Stations"}
          secondary
          onPress={() => setShowMap((prev) => !prev)}
        />

        {showMap && (
          <View style={{ marginTop: 12 }}>
            <LiveMapView
              userLocation={userCoords}
              policeStations={nearbyStations}
              onRefresh={loadNearbyStations}
            />
          </View>
        )}
      </Card>

      {/* ─── CONFIDENTIAL CRIME REPORTING TO POLICE ─── */}
      <Card>
        <View style={styles.spaceBetween}>
          <Text style={styles.h2}>🛡️ Report Crime to Police</Text>
          <Badge label="POLICE ONLY" variant="warning" />
        </View>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Privately transmit photo evidence, scene GPS coordinates, and incident details directly to
          the Police Dashboard. Strictly confidential — NOT shared with your contacts.
        </Text>
        <Action
          label="📸 Report Crime with Photo Proof"
          onPress={() => router.push("/report-crime" as never)}
        />
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

      <Card>
        <Text style={styles.h2}>Walk With Me</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Real-time GPS route tracking. Get automatic alerts to contacts if you deviate from your path
          or stop unexpectedly for more than 3 minutes.
        </Text>
        <Action
          label="Start a walk"
          secondary
          onPress={() => router.push("/ride" as never)}
        />
      </Card>

      {/* Additional tools */}
      <Card>
        <Text style={styles.h3}>Escape call tool</Text>
        <Text style={[styles.subtitle, { marginTop: 4, marginBottom: 8 }]}>
          Simulate an incoming phone call to give you a natural excuse to exit uncomfortable or threatening situations.
        </Text>
        <Action
          label={fakeCalling ? "Scheduling call…" : "📞 Request an incoming call"}
          secondary
          loading={fakeCalling}
          onPress={() => void triggerFakeCall()}
        />
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

      <FakeCallModal
        visible={fakeCallModalVisible}
        callerName="Mom"
        onDismiss={() => setFakeCallModalVisible(false)}
      />
    </ScrollView>
  );
}
