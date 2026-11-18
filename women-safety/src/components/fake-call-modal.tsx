import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import * as Speech from "expo-speech";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { colors } from "@/lib/theme";

const RINGTONE = require("../../assets/sounds/ringtone.wav");

type FakeCallModalProps = {
  visible: boolean;
  callerName?: string;
  callerNumber?: string;
  onDismiss: () => void;
};

export default function FakeCallModal({
  visible,
  callerName = "Mom",
  callerNumber = "+91 98765 43210",
  onDismiss,
}: FakeCallModalProps) {
  const [callState, setCallState] = useState<"ringing" | "connected">("ringing");
  const [callSeconds, setCallSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Original synthesised ringtone (see scripts/generate-ringtone.js), looped while ringing.
  // Created on first ring, not during render, so the web build's server-side render never touches audio.
  const ringtoneRef = useRef<AudioPlayer | null>(null);

  // Handle ringing vibration + ringtone
  useEffect(() => {
    const ringing = visible && callState === "ringing";
    let stopped = false;
    if (ringing) {
      if (Platform.OS !== "web") {
        Vibration.vibrate([0, 1000, 1000], true);
      }
      // Ring even when the phone is on silent, like a real incoming call screen.
      setAudioModeAsync({ playsInSilentMode: true })
        .catch(() => undefined)
        .finally(() => {
          if (stopped) return;
          try {
            if (!ringtoneRef.current) ringtoneRef.current = createAudioPlayer(RINGTONE);
            const ringtone = ringtoneRef.current;
            ringtone.loop = true;
            ringtone.volume = 1;
            void ringtone.seekTo(0);
            ringtone.play();
          } catch (_) {}
        });
    } else {
      Vibration.cancel();
    }
    return () => {
      stopped = true;
      Vibration.cancel();
      try {
        ringtoneRef.current?.pause();
      } catch (_) {}
    };
  }, [visible, callState]);

  // Free the audio player when the call screen goes away.
  useEffect(() => () => {
    try {
      ringtoneRef.current?.remove();
    } catch (_) {}
    ringtoneRef.current = null;
  }, []);

  // Handle connected call timer & speech
  useEffect(() => {
    if (visible && callState === "connected") {
      setCallSeconds(0);
      timerRef.current = setInterval(() => {
        setCallSeconds((s) => s + 1);
      }, 1000);

      // Speak realistic caller voice
      try {
        Speech.stop();
        Speech.speak(
          "Hey, where are you right now? I'm waiting for you right outside with the car. Please come out quickly, okay?",
          {
            language: "en-IN",
            pitch: 1.05,
            rate: 0.95,
          }
        );
      } catch (_) {}
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      try {
        Speech.stop();
      } catch (_) {}
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      try {
        Speech.stop();
      } catch (_) {}
    };
  }, [visible, callState]);

  const handleAccept = () => {
    Vibration.cancel();
    setCallState("connected");
  };

  const handleEnd = () => {
    Vibration.cancel();
    try {
      Speech.stop();
    } catch (_) {}
    setCallState("ringing");
    setCallSeconds(0);
    onDismiss();
  };

  const formatCallTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={handleEnd}>
      <View style={modalStyles.container}>
        {/* Caller Info */}
        <View style={modalStyles.callerSection}>
          <View style={modalStyles.avatarCircle}>
            <Text style={modalStyles.avatarText}>{callerName.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={modalStyles.callerName}>{callerName}</Text>
          <Text style={modalStyles.callerNumber}>{callerNumber}</Text>
          <Text style={modalStyles.callStatus}>
            {callState === "ringing" ? "Incoming call…" : `Connected (${formatCallTime(callSeconds)})`}
          </Text>
        </View>

        {/* Action Buttons */}
        {callState === "ringing" ? (
          <View style={modalStyles.ringingActions}>
            <View style={modalStyles.buttonColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decline Call"
                onPress={handleEnd}
                style={[modalStyles.callButton, { backgroundColor: colors.red }]}
              >
                <Text style={modalStyles.buttonIcon}>✕</Text>
              </Pressable>
              <Text style={modalStyles.buttonLabel}>Decline</Text>
            </View>

            <View style={modalStyles.buttonColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Accept Call"
                onPress={handleAccept}
                style={[modalStyles.callButton, { backgroundColor: colors.green }]}
              >
                <Text style={modalStyles.buttonIcon}>📞</Text>
              </Pressable>
              <Text style={modalStyles.buttonLabel}>Accept</Text>
            </View>
          </View>
        ) : (
          <View style={modalStyles.connectedActions}>
            <View style={modalStyles.buttonColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="End Call"
                onPress={handleEnd}
                style={[modalStyles.callButton, { backgroundColor: colors.red }]}
              >
                <Text style={modalStyles.buttonIcon}>✆</Text>
              </Pressable>
              <Text style={modalStyles.buttonLabel}>End Call</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A", // Dark midnight blue
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  callerSection: {
    alignItems: "center",
    marginTop: 40,
  },
  avatarCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 2,
    borderColor: "#475569",
  },
  avatarText: {
    fontSize: 48,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  callerName: {
    fontSize: 32,
    fontWeight: "800",
    color: "#F8FAFC",
    marginBottom: 8,
  },
  callerNumber: {
    fontSize: 16,
    color: "#94A3B8",
    marginBottom: 16,
  },
  callStatus: {
    fontSize: 18,
    fontWeight: "600",
    color: "#38BDF8", // Soft light blue
  },
  ringingActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    paddingHorizontal: 30,
    marginBottom: 40,
  },
  connectedActions: {
    alignItems: "center",
    width: "100%",
    marginBottom: 40,
  },
  buttonColumn: {
    alignItems: "center",
    gap: 12,
  },
  callButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  buttonIcon: {
    fontSize: 32,
    color: "#FFFFFF",
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#E2E8F0",
  },
});
