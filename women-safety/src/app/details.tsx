import { router, useLocalSearchParams } from "expo-router";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Location from "expo-location";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { uploadAudio } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

export default function Details() {
  const params = useLocalSearchParams<{ id: string; status?: string; level?: string }>();
  const [coords, setCoords] = useState("Location unavailable");
  const [recordedUri, setRecordedUri] = useState("");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const startRecording = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return Alert.alert("Microphone permission needed", "Allow microphone access to record evidence.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };
  const stopRecording = async () => {
    await recorder.stop();
    const uri = recorder.uri || "";
    setRecordedUri(uri);
    if (!uri) {
      Alert.alert("Recording unavailable", "The audio recording could not be saved.");
      return;
    }
    const result = await uploadAudio(`/api/emergencies/${params.id}/audio`, uri);
    if (result.error) Alert.alert("Audio upload failed", `${result.error}\nThe recording was not attached to the server incident.`);
  };
  return <View style={[styles.safe, styles.container]}>
    <Header title="Incident response" subtitle={`${params.level || "SOS"} • ${params.status || "ACTIVE"}`} />
    <Card><Text style={{ fontWeight: "900", fontSize: 19, color: colors.red }}>Live location</Text><Action label="Get current location" onPress={async () => { const p = await Location.requestForegroundPermissionsAsync(); if (p.status !== "granted") return Alert.alert("Permission needed", "Allow location access."); const l = await Location.getCurrentPositionAsync({}); setCoords(`${l.coords.latitude.toFixed(5)}, ${l.coords.longitude.toFixed(5)}`); }} /><Text style={{ marginTop: 12, fontWeight: "700" }}>{coords}</Text><Action label="Open map" secondary onPress={() => { if (coords === "Location unavailable") return Alert.alert("Location needed", "Refresh the location first."); Linking.openURL(`https://maps.google.com/?q=${coords.replace(" ", "")}`); }} /></Card>
    <Card><Text style={{ fontWeight: "900", fontSize: 19 }}>Audio evidence</Text><Text style={styles.subtitle}>{recordedUri ? "Recording attached to this incident." : "Record a short audio note for dispatch."}</Text><Action label={recorderState.isRecording ? "Stop and save recording" : "Start recording"} onPress={recorderState.isRecording ? stopRecording : startRecording} /></Card>
    <Action label="Back to incidents" secondary onPress={() => router.back()} />
  </View>;
}
