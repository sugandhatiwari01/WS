import { router, useLocalSearchParams } from "expo-router";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { uploadAudio } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

export default function Details() {
  const params = useLocalSearchParams<{ id: string; status?: string; level?: string }>();
  const [coords, setCoords] = useState("Location unavailable");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedUri, setRecordedUri] = useState("");
  const startRecording = async () => {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return Alert.alert("Microphone permission needed", "Allow microphone access to record evidence.");
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const result = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(result.recording);
  };
  const stopRecording = async () => {
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI() || "";
    setRecordedUri(uri);
    setRecording(null);
    const result = await uploadAudio(`/api/emergencies/${params.id}/audio`, uri);
    if (result.error) Alert.alert("Audio saved locally", result.error);
  };
  return <View style={[styles.safe, styles.container]}>
    <Header title="Incident response" subtitle={`${params.level || "SOS"} • ${params.status || "ACTIVE"}`} />
    <Card><Text style={{ fontWeight: "900", fontSize: 19, color: colors.red }}>Live location</Text><Action label="Get current location" onPress={async () => { const p = await Location.requestForegroundPermissionsAsync(); if (p.status !== "granted") return Alert.alert("Permission needed", "Allow location access."); const l = await Location.getCurrentPositionAsync({}); setCoords(`${l.coords.latitude.toFixed(5)}, ${l.coords.longitude.toFixed(5)}`); }} /><Text style={{ marginTop: 12, fontWeight: "700" }}>{coords}</Text><Action label="Open map" secondary onPress={() => { if (coords === "Location unavailable") return Alert.alert("Location needed", "Refresh the location first."); Linking.openURL(`https://maps.google.com/?q=${coords.replace(" ", "")}`); }} /></Card>
    <Card><Text style={{ fontWeight: "900", fontSize: 19 }}>Audio evidence</Text><Text style={styles.subtitle}>{recordedUri ? "Recording attached to this incident." : "Record a short audio note for dispatch."}</Text><Action label={recording ? "Stop and save recording" : "Start recording"} onPress={recording ? stopRecording : startRecording} /></Card>
    <Action label="Back to incidents" secondary onPress={() => router.back()} />
  </View>;
}
