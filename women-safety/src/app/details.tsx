import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { Action, Card, Header } from "@/components/ui";
import AudioEvidencePlayer, { type AudioEvidence } from "@/components/audio-evidence-player";
import LiveLocationMap from "@/components/live-location-map";
import { api } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

type EvidencePhoto = { _id: string; url?: string | null; takenAt: string };
type Point = { latitude?: number; longitude?: number; lat?: number; lng?: number; timestamp?: string };
type IncidentLive = { status?: string; currentLocation?: Point | null; initialLocation?: Point | null };
const ENDED = ["RESOLVED", "CANCELLED", "FALSE_ALARM"];
/** How often the details screen re-fetches the incident's live position. */
const LIVE_POLL_MS = 5_000;

export default function Details() {
  const params = useLocalSearchParams<{ id: string; status?: string; latitude?: string; longitude?: string }>();
  const incidentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const latitude = Array.isArray(params.latitude) ? params.latitude[0] : params.latitude;
  const longitude = Array.isArray(params.longitude) ? params.longitude[0] : params.longitude;
  const [live, setLive] = useState<IncidentLive | null>(null);
  const livePoint = live?.currentLocation || live?.initialLocation;
  const liveLat = livePoint?.latitude ?? livePoint?.lat;
  const liveLng = livePoint?.longitude ?? livePoint?.lng;
  const position =
    liveLat != null && liveLng != null
      ? { latitude: liveLat, longitude: liveLng }
      : latitude && longitude && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : null;
  const coords = position ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}` : "Incident location unavailable";
  const status = live?.status || params.status || "ACTIVE";
  const isLive = !ENDED.includes(status);

  // Follow the victim's position while the SOS is active.
  const loadLive = useCallback(async () => {
    if (!incidentId) return;
    const result = await api<IncidentLive>(`/api/emergencies/${incidentId}`);
    if (result.data) setLive(result.data);
  }, [incidentId]);
  useEffect(() => {
    void Promise.resolve().then(loadLive);
    if (!isLive) return;
    const timer = setInterval(() => void loadLive(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [loadLive, isLive]);
  const [recordings, setRecordings] = useState<AudioEvidence[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [recordingError, setRecordingError] = useState("");
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [photoError, setPhotoError] = useState("");

  const loadPhotos = useCallback(async () => {
    if (!incidentId) return;
    const result = await api<EvidencePhoto[]>(`/api/emergencies/${incidentId}/photos`);
    if (result.data) {
      setPhotos(result.data);
      setPhotoError("");
    } else {
      setPhotoError(result.error || "Incident photos could not be loaded.");
    }
  }, [incidentId]);

  const loadRecordings = useCallback(async () => {
    if (!incidentId) {
      setRecordingError("Incident reference is missing.");
      setLoadingRecordings(false);
      return;
    }
    setLoadingRecordings(true);
    try {
      const result = await api<AudioEvidence[]>(`/api/emergencies/${incidentId}/audio`);
      if (result.data) {
        setRecordings(result.data);
        setRecordingError("");
      } else {
        setRecordingError(result.error || "Incident recordings could not be loaded.");
      }
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "Incident recordings could not be loaded.");
    } finally {
      setLoadingRecordings(false);
    }
  }, [incidentId]);

  useEffect(() => {
    void Promise.resolve().then(loadRecordings);
  }, [loadRecordings]);

  // New photos arrive every ~20s during an active SOS, so keep the gallery fresh.
  useEffect(() => {
    void Promise.resolve().then(loadPhotos);
    const timer = setInterval(() => void loadPhotos(), 15_000);
    return () => clearInterval(timer);
  }, [loadPhotos]);

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.container}>
      <Header title="Incident response" subtitle={`SOS • ${status}`} />
      <Card>
        <Text style={{ fontWeight: "900", fontSize: 19, color: colors.red }}>Incident location</Text>
        <Text style={{ marginTop: 12, fontWeight: "700" }}>{coords}</Text>
        <Text style={[styles.caption, { marginTop: 4 }]}>
          {isLive
            ? `● Live — refreshes every ${LIVE_POLL_MS / 1000}s${live?.currentLocation?.timestamp ? ` · last update ${new Date(live.currentLocation.timestamp).toLocaleTimeString()}` : ""}`
            : "SOS ended — showing the last known position."}
        </Text>
        {position ? <LiveLocationMap latitude={position.latitude} longitude={position.longitude} /> : null}
        <Action
          label="Open map"
          secondary
          onPress={() => {
            if (coords === "Incident location unavailable") {
              Alert.alert("Location unavailable", "This incident did not include coordinates.");
              return;
            }
            void Linking.openURL(`https://maps.google.com/?q=${coords.replace(" ", "")}`).catch((error) => {
              Alert.alert("Map unavailable", error instanceof Error ? error.message : "Could not open the map.");
            });
          }}
        />
      </Card>
      <Card>
        <Text style={{ fontWeight: "900", fontSize: 19 }}>User-submitted audio</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Recordings are created only when the person experiencing the incident starts recording from their active SOS screen.
        </Text>
        {loadingRecordings ? (
          <Text style={[styles.caption, { marginTop: 10 }]}>Loading incident recordings…</Text>
        ) : recordingError ? (
          <>
            <Text style={[styles.errorText, { marginTop: 10 }]}>{recordingError}</Text>
            <Action label="Retry loading recordings" secondary onPress={() => void loadRecordings()} />
          </>
        ) : recordings.length === 0 ? (
          <Text style={[styles.caption, { marginTop: 10 }]}>No audio recordings have been uploaded for this incident.</Text>
        ) : (
          <AudioEvidencePlayer recordings={recordings} />
        )}
      </Card>
      <Card>
        <Text style={{ fontWeight: "900", fontSize: 19 }}>Photos from the SOS phone</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Taken automatically every 20 seconds while the SOS is active. Newest first; refreshes on its own.
        </Text>
        {photoError ? (
          <Text style={[styles.errorText, { marginTop: 10 }]}>{photoError}</Text>
        ) : photos.length === 0 ? (
          <Text style={[styles.caption, { marginTop: 10 }]}>No photos have been uploaded for this incident yet.</Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
            {[...photos].reverse().map((photo) => (
              <View key={photo._id} style={{ width: 150 }}>
                {photo.url ? (
                  <Image
                    source={{ uri: photo.url }}
                    style={{ width: 150, height: 200, borderRadius: 10, backgroundColor: colors.border }}
                    contentFit="cover"
                    accessibilityLabel={`SOS photo taken ${new Date(photo.takenAt).toLocaleTimeString()}`}
                  />
                ) : (
                  <View style={{ width: 150, height: 200, borderRadius: 10, backgroundColor: colors.border, justifyContent: "center" }}>
                    <Text style={[styles.caption, { textAlign: "center" }]}>Preview unavailable</Text>
                  </View>
                )}
                <Text style={[styles.caption, { marginTop: 4 }]}>{new Date(photo.takenAt).toLocaleTimeString()}</Text>
                {photo.url ? (
                  <Text style={{ color: colors.primary, fontWeight: "700" }} onPress={() => void Linking.openURL(photo.url!)}>
                    Open full size
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </Card>
      <Action label="Refresh recordings & photos" secondary onPress={() => { void loadRecordings(); void loadPhotos(); }} />
      <Action label="Back to incidents" secondary onPress={() => router.back()} />
    </ScrollView>
  );
}
