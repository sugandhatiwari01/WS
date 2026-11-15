import { Text, View } from "react-native";
import { styles } from "@/lib/theme";
import type { AudioEvidence } from "./audio-evidence-player";

export default function AudioEvidencePlayer({ recordings }: { recordings: AudioEvidence[] }) {
  return (
    <>
      {recordings.map((recording) => (
        <View key={recording._id} style={{ marginTop: 12 }}>
          <Text style={styles.caption}>
            {recording.createdAt ? new Date(recording.createdAt).toLocaleString() : "Incident audio"}
            {recording.duration ? ` · ${Math.round(recording.duration)} seconds` : ""}
          </Text>
          {recording.url ? (
            <audio
              controls
              preload="none"
              src={recording.url}
              style={{ width: "100%", marginTop: 8 }}
            />
          ) : (
            <Text style={styles.errorText}>The server did not provide a playable recording link.</Text>
          )}
        </View>
      ))}
    </>
  );
}
