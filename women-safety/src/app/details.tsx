import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import AudioEvidencePlayer, { type AudioEvidence } from "@/components/audio-evidence-player";
import { api } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

export default function Details() {
  const params = useLocalSearchParams<{ id: string; status?: string; latitude?: string; longitude?: string }>();
  const incidentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const latitude = Array.isArray(params.latitude) ? params.latitude[0] : params.latitude;
  const longitude = Array.isArray(params.longitude) ? params.longitude[0] : params.longitude;
  const coords =
    latitude && longitude && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
      ? `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : "Incident location unavailable";
  const [recordings, setRecordings] = useState<AudioEvidence[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [recordingError, setRecordingError] = useState("");

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

  return (
    <View style={[styles.safe, styles.container]}>
      <Header title="Incident response" subtitle={`SOS • ${params.status || "ACTIVE"}`} />
      <Card>
        <Text style={{ fontWeight: "900", fontSize: 19, color: colors.red }}>Incident location</Text>
        <Text style={{ marginTop: 12, fontWeight: "700" }}>{coords}</Text>
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
      <Action label="Refresh incident recordings" secondary onPress={() => void loadRecordings()} />
      <Action label="Back to incidents" secondary onPress={() => router.back()} />
    </View>
  );
}
