import { useEffect, useState } from "react";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Alert, Text } from "react-native";
import { Action, Card } from "@/components/ui";
import { styles } from "@/lib/theme";

export type AudioEvidence = {
  _id: string;
  createdAt?: string;
  duration?: number;
  url?: string | null;
};

export default function AudioEvidencePlayer({ recordings }: { recordings: AudioEvidence[] }) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioModeError, setAudioModeError] = useState("");
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    let active = true;
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((error: unknown) => {
      if (active) {
        setAudioModeError(error instanceof Error ? error.message : "Audio playback mode could not be configured.");
      }
    });
    return () => { active = false; };
  }, []);

  const togglePlayback = (recording: AudioEvidence) => {
    if (!recording.url) {
      Alert.alert("Recording unavailable", "The server did not provide a playable recording link.");
      return;
    }
    if (playingId === recording._id && playerStatus.playing) {
      player.pause();
      return;
    }
    try {
      player.replace(recording.url);
      player.play();
      setPlayingId(recording._id);
    } catch (error) {
      Alert.alert("Playback failed", error instanceof Error ? error.message : "The recording could not be played.");
    }
  };

  return (
    <>
      {recordings.map((recording) => (
        <Card key={recording._id}>
          <Text style={styles.caption}>
            {recording.createdAt ? new Date(recording.createdAt).toLocaleString() : "Incident audio"}
            {recording.duration ? ` · ${Math.round(recording.duration)} seconds` : ""}
          </Text>
          <Action
            label={playingId === recording._id && playerStatus.playing ? "Pause recording" : "Play recording"}
            secondary
            disabled={!recording.url}
            onPress={() => togglePlayback(recording)}
          />
        </Card>
      ))}
      {audioModeError || playerStatus.error ? (
        <Text style={styles.errorText}>{audioModeError || playerStatus.error}</Text>
      ) : null}
    </>
  );
}
