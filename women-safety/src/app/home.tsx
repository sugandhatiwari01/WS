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
import SosEvidenceCamera from "@/components/sos-evidence-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
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

/** Automatic SOS audio: AUTO_CLIPS clips of AUTO_CLIP_MS, each starting AUTO_INTERVAL_MS after the previous one. */
const AUTO_CLIPS = 3;
const AUTO_CLIP_MS = 30_000;
const AUTO_INTERVAL_MS = 60_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const [autoRecording, setAutoRecording] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [nearbyStations, setNearbyStations] = useState<PoliceStationMarker[]>([]);
  const [stationRadiusKm, setStationRadiusKm] = useState(5);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);
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

  /** Real police stations (OpenStreetMap) within the chosen radius of the user's GPS position. */
  const loadNearbyStations = useCallback(async (radiusKm: number) => {
    setStationsLoading(true);
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        setUserCoords(null);
        setNearbyStations([]);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      setUserCoords({ latitude, longitude });
      const result = await api<PoliceStationMarker[]>(
        `/api/police/stations?latitude=${latitude}&longitude=${longitude}&radiusKm=${radiusKm}`
      );
      if (result.data) {
        setNearbyStations(result.data);
        setStationsError(null);
      } else {
        setStationsError(result.error || "Could not look up nearby police stations. Call 112 in an emergency.");
      }
    } catch (e) {
      setStationsError(e instanceof Error ? e.message : "Could not get your location.");
    } finally {
      setStationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadNearbyStations(stationRadiusKm));
  }, [loadNearbyStations, stationRadiusKm]);

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

  const callEmergencyServices = async () => {
    try {
      await Linking.openURL("tel:112");
    } catch {
      Alert.alert("Unable to open the phone app", "Please open your phone app and call 112.");
    }
  };

  /* ─── Keep the screen on during SOS so live location and photos keep flowing ─── */
  useEffect(() => {
    if (sosState !== "active" || Platform.OS === "web") return;
    const tag = "sos-active";
    activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      try { deactivateKeepAwake(tag); } catch { /* already released */ }
    };
  }, [sosState]);

  /* ─── Automatic SOS audio: 3 × 30 s clips, one minute apart ─── */
  const autoRecordedEmergencyId = useRef<string | null>(null);

  useEffect(() => {
    if (sosState !== "active" || !emergencyId) {
      if (sosState === "idle") autoRecordedEmergencyId.current = null;
      return;
    }
    if (autoRecordedEmergencyId.current === emergencyId) return;
    autoRecordedEmergencyId.current = emergencyId;

    let cancelled = false;
    let recording = false;
    const run = async () => {
      const permission = await requestRecordingPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (!permission?.granted) {
        setAutoStatus("Microphone permission is off, so automatic recording was skipped.");
        return;
      }
      setAutoRecording(true);
      let sent = 0;
      for (let clip = 1; clip <= AUTO_CLIPS && !cancelled; clip++) {
        const clipStarted = Date.now();
        try {
          setAutoStatus(`● Recording clip ${clip} of ${AUTO_CLIPS} (${AUTO_CLIP_MS / 1000}s)…`);
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await autoRecorder.prepareToRecordAsync();
          autoRecorder.record();
          recording = true;
          await wait(AUTO_CLIP_MS);
          if (cancelled) break;
          await autoRecorder.stop();
          recording = false;
          const uri = autoRecorder.uri;
          setAutoStatus(`Uploading clip ${clip} of ${AUTO_CLIPS}…`);
          // Only the first clip texts family, so one SOS doesn't send three messages.
          const ok = uri ? await uploadRecording(uri, { automatic: true, notify: clip === 1 }) : false;
          if (ok) sent += 1;
          setAutoStatus(ok ? `Clip ${clip} of ${AUTO_CLIPS} sent to police and family.` : `Clip ${clip} of ${AUTO_CLIPS} could not be sent — saved on this device.`);
        } catch (e) {
          recording = false;
          setAutoStatus(`Clip ${clip} of ${AUTO_CLIPS} failed: ${e instanceof Error ? e.message : "microphone error"}`);
        }
        if (clip < AUTO_CLIPS && !cancelled) {
          const remaining = AUTO_INTERVAL_MS - (Date.now() - clipStarted);
          if (remaining > 0) await wait(remaining);
        }
      }
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (_) {}
      if (cancelled) return;
      setAutoRecording(false);
      setAutoStatus(`Automatic recording finished — ${sent} of ${AUTO_CLIPS} clips sent. You can record more below.`);
    };

    const timer = setTimeout(() => void run(), 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (recording) autoRecorder.stop().catch(() => undefined);
      setAutoRecording(false);
      setAutoStatus(null);
    };
  }, [sosState, emergencyId]);

  /* ─── Audio recording ──────────────────────────────────── */
  /** Uploads a recording to the active incident. Automatic clips report in the SOS card instead of pop-ups. Returns true on success. */
  const uploadRecording = async (uri: string, options: { automatic?: boolean; notify?: boolean } = {}): Promise<boolean> => {
    const { automatic = false, notify = true } = options;
    if (!emergencyId) {
      if (!automatic) Alert.alert("Recording not uploaded", "There is no active server incident to attach this recording to. Start an SOS before recording.");
      return false;
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
        if (!automatic) {
          Alert.alert(
            "Audio upload failed",
            `The recording is saved on this device but is not available in the police dashboard yet. ${result.error}`
          );
        }
        return false;
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
      if (!automatic) {
        Alert.alert(
          "Audio shared with dispatch",
          `The recording is attached to this incident and can be reviewed from the police dashboard.${cleanupWarning}`
        );
      }
      // Send audio alert SMS & socket broadcast to family and police
      if (notify) {
        void post("/api/notify/audio-alert", {
          emergencyId,
          userName: user?.name,
          audioUrl: result.data?.url,
        });
      }
      return true;
    } catch (error) {
      if (!automatic) Alert.alert("Audio upload failed", error instanceof Error ? error.message : "The recording is still saved on this device.");
      return false;
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

      {/* Family dashboard — any account that someone added as a trusted contact */}
      <Card>
        <Text style={styles.h3}>👪 Family dashboard</Text>
        <Text style={[styles.subtitle, { marginTop: 4 }]}>
          See live SOS alerts, location, audio and photos from people who added you as a trusted contact.
        </Text>
        <Action label="Open family dashboard" secondary onPress={() => router.push("/family" as never)} />
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
            Live location is shared every few seconds while SafeHer is open. The screen stays on during SOS — keep the app open.
          </Text>
          {nearbyStation?.name && (
            <Text style={[styles.caption, { marginTop: 4 }]}>
              Nearest station: {nearbyStation.name} • {nearbyStation.distanceKm} km
            </Text>
          )}
          <Divider />
          <Text style={[styles.caption, { marginTop: 6 }]}>
            SOS records {AUTO_CLIPS} clips of {AUTO_CLIP_MS / 1000}s, one minute apart, and shares them with police and family. The microphone indicator stays visible while recording.
          </Text>
          {autoStatus ? (
            <Text accessibilityLiveRegion="polite" style={[styles.h3, { color: autoRecording ? colors.red : colors.ink, marginTop: 8 }]}>
              {autoStatus}
            </Text>
          ) : null}
          {recorderState.isRecording ? (
            <Text accessibilityLiveRegion="polite" style={[styles.h3, { color: colors.red, marginTop: 8 }]}>
              ● Recording surroundings · {Math.floor(recorderState.durationMillis / 1000)}s
            </Text>
          ) : null}
          <Action
            label={
              autoRecording
                ? "Automatic recording in progress…"
                : audioUploading
                  ? "Uploading audio…"
                  : recorderState.isRecording
                    ? "⏹ Stop & upload recording"
                    : "🎙 Record surroundings"
            }
            secondary
            loading={audioUploading && !autoRecording}
            disabled={audioUploading || autoRecording}
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
          {emergencyId ? (
            <>
              <Divider />
              <SosEvidenceCamera emergencyId={emergencyId} />
            </>
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
            ? `Nearest: ${nearbyStations[0].name}${nearbyStations[0].distanceKm != null ? ` (${nearbyStations[0].distanceKm.toFixed(1)} km away)` : ""}. Real stations from OpenStreetMap.`
            : userCoords && !stationsLoading && !stationsError
              ? `No police stations listed within ${stationRadiusKm} km. Open the map to widen the search, or call 112.`
              : "Find real police stations near you and the official helpline numbers."}
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
              onRefresh={() => void loadNearbyStations(stationRadiusKm)}
              loading={stationsLoading}
              radiusKm={stationRadiusKm}
              onRadiusChange={setStationRadiusKm}
              error={stationsError}
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
