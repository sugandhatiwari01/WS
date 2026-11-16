/**
 * Walk With Me — Route Deviation Alert Screen
 *
 * Tracks the user's real-time GPS position along a chosen route.
 * Alerts family/police if the user:
 *   • Deviates > 300 m from the straight-line path (150 m in high-risk mode)
 *   • Stops for > 3 minutes without moving (90 s in high-risk mode)
 *
 * On a "stopped" alert the user can escalate directly to SOS.
 */

import { router } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Action, Badge, Card, Divider, Header } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useSos } from "@/hooks/useSos";
import { useWalkSafe } from "@/hooks/useWalkSafe";
import { useSocket } from "@/hooks/useSocket";
import { post } from "@/lib/api";
import { getContacts } from "@/lib/storage";
import { colors, styles } from "@/lib/theme";

export default function WalkWithMeScreen() {
  const { user } = useAuth();
  const { startCountdown } = useSos();

  /* ─── Form state ──────────────────────────────────────── */
  const [destinationName, setDestinationName] = useState("");
  const [destinationLat, setDestinationLat] = useState("");
  const [destinationLng, setDestinationLng] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("20");
  const [highRiskMode, setHighRiskMode] = useState(false);

  /* ─── Walk With Me hook ────────────────────────────────── */
  const {
    walkState,
    session,
    currentCoords,
    distanceToDestM,
    elapsedLabel,
    loading,
    startWalk,
    markArrived,
    cancelWalk,
    handleSocketEvent,
  } = useWalkSafe({
    onStoppedEscalate: () => startCountdown("LEVEL_1", "TIMER"),
  });

  /* ─── Socket.IO real-time ──────────────────────────────── */
  useSocket({
    userId: user?._id,
    onEvent: handleSocketEvent,
  });

  /* ─── Automated SMS to contacts ────────────────────────── */
  const sendStartSms = useCallback(async (destName: string, estMin: number) => {
    try {
      const contacts = await getContacts();
      const phones = contacts.flatMap((c) => (c.phone ? [c.phone.trim()] : []));
      if (!phones.length) return;
      await post("/api/notify/trip-sms", {
        userName: user?.name,
        destination: destName,
        estimatedMinutes: estMin,
        phones,
        message: `${user?.name ?? "Someone"} has started a walk to "${destName}" (est. ${estMin} min). You'll be automatically notified if they deviate from the route or stop unexpectedly. — SafeHer`,
      });
    } catch (_) {}
  }, [user?.name]);

  const sendArrivalSms = useCallback(async (destName: string) => {
    try {
      const contacts = await getContacts();
      const phones = contacts.flatMap((c) => (c.phone ? [c.phone.trim()] : []));
      if (!phones.length) return;
      await post("/api/notify/trip-arrival", {
        userName: user?.name,
        destination: destName,
        phones,
        message: `✅ ${user?.name ?? "Someone"} has arrived safely at "${destName}". — SafeHer`,
      });
    } catch (_) {}
  }, [user?.name]);

  /* ─── Start handler ─────────────────────────────────────── */
  const handleStart = async () => {
    if (!destinationName.trim()) {
      Alert.alert("Destination required", "Enter where you're walking to.");
      return;
    }
    const lat = parseFloat(destinationLat);
    const lng = parseFloat(destinationLng);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    if (!hasCoords) {
      Alert.alert(
        "No coordinates",
        "Without destination coordinates, only the stopped alert will work (not deviation). Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Continue anyway",
            onPress: async () => {
              await startWalk({
                destinationName: destinationName.trim(),
                destinationLat: 0,
                destinationLng: 0,
                estimatedMinutes: parseInt(estimatedMinutes, 10) || 20,
                highRiskMode,
              });
              void sendStartSms(destinationName.trim(), parseInt(estimatedMinutes, 10) || 20);
            },
          },
        ]
      );
      return;
    }
    await startWalk({
      destinationName: destinationName.trim(),
      destinationLat: lat,
      destinationLng: lng,
      estimatedMinutes: parseInt(estimatedMinutes, 10) || 20,
      highRiskMode,
    });
    void sendStartSms(destinationName.trim(), parseInt(estimatedMinutes, 10) || 20);
  };

  /* ─── Arrival handler ───────────────────────────────────── */
  const handleArrived = async () => {
    const dest = session?.destinationName ?? destinationName.trim();
    await markArrived();
    void sendArrivalSms(dest);
    Alert.alert("Safe arrival confirmed", "Your contacts have been notified that you arrived safely. 🎉");
  };

  /* ─── State badge ───────────────────────────────────────── */
  const badgeVariant = (() => {
    if (walkState === "active") return "success" as const;
    if (walkState === "deviation" || walkState === "stopped") return "warning" as const;
    if (walkState === "arrived") return "success" as const;
    return "neutral" as const;
  })();

  const badgeLabel = (() => {
    if (walkState === "active") return "WALK ACTIVE";
    if (walkState === "deviation") return "⚠️ DEVIATION";
    if (walkState === "stopped") return "⚠️ STOPPED";
    if (walkState === "arrived") return "✅ ARRIVED";
    return "IDLE";
  })();

  /* ─── Render ─────────────────────────────────────────────── */
  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Walk With Me"
        subtitle="Real-time route deviation and stop alerts. Your contacts are notified the moment something seems wrong."
      />

      {/* Status bar */}
      {walkState !== "idle" && (
        <Card danger={walkState === "deviation" || walkState === "stopped"}>
          <View style={styles.spaceBetween}>
            <Text style={[styles.h2, {
              color: walkState === "deviation" || walkState === "stopped" ? colors.red : colors.ink
            }]}>
              {walkState === "deviation" ? "⚠️ Off Route" :
               walkState === "stopped"   ? "⚠️ You Stopped" :
               walkState === "arrived"   ? "✅ Arrived" :
               "🚶 Walking"}
            </Text>
            <Badge label={badgeLabel} variant={badgeVariant} />
          </View>

          {session && (
            <Text style={[styles.subtitle, { marginTop: 6 }]}>
              To: {session.destinationName}
              {highRiskMode ? " · ⚡ High-risk mode" : ""}
            </Text>
          )}

          {walkState === "active" || walkState === "deviation" || walkState === "stopped" ? (
            <Text style={[styles.caption, { marginTop: 4 }]}>
              Elapsed: {elapsedLabel}
              {distanceToDestM !== null ? `  ·  ~${distanceToDestM < 1000 ? `${distanceToDestM} m` : `${(distanceToDestM / 1000).toFixed(1)} km`} to go` : ""}
            </Text>
          ) : null}

          {currentCoords && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.caption}>
                📍 {currentCoords.latitude.toFixed(5)}, {currentCoords.longitude.toFixed(5)} · Live
              </Text>
              <Action
                label="Open live map"
                secondary
                onPress={() =>
                  Linking.openURL(
                    `https://maps.google.com/?q=${currentCoords.latitude},${currentCoords.longitude}`
                  )
                }
              />
            </View>
          )}

          <Divider />

          {(walkState === "active" || walkState === "deviation" || walkState === "stopped") && (
            <>
              <Action
                label="✅ I've Arrived Safely"
                loading={loading}
                onPress={() => void handleArrived()}
              />
              <Action
                label="Cancel walk"
                secondary
                loading={loading}
                onPress={() => void cancelWalk()}
              />
              <Action
                label="🚨 Trigger SOS"
                danger
                onPress={() => startCountdown("LEVEL_1", "TIMER")}
              />
            </>
          )}

          {walkState === "arrived" && (
            <Action label="Start a new walk" secondary onPress={() => {
              setDestinationName("");
              setDestinationLat("");
              setDestinationLng("");
              setEstimatedMinutes("20");
              setHighRiskMode(false);
            }} />
          )}
        </Card>
      )}

      {/* Setup card — shown only when idle/arrived */}
      {(walkState === "idle" || walkState === "arrived") && (
        <Card>
          <Text style={styles.h2}>Plan your walk</Text>
          <Text style={[styles.subtitle, { marginTop: 6 }]}>
            Enter your destination. If you deviate from the route or stop unexpectedly,
            your trusted contacts and police are notified automatically.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Destination name (e.g. Home, Metro Station)"
            value={destinationName}
            onChangeText={setDestinationName}
          />
          <TextInput
            style={styles.input}
            placeholder="Destination latitude (optional, e.g. 28.6139)"
            value={destinationLat}
            onChangeText={setDestinationLat}
            keyboardType="numeric"
          />
          <TextInput
            style={styles.input}
            placeholder="Destination longitude (optional, e.g. 77.2090)"
            value={destinationLng}
            onChangeText={setDestinationLng}
            keyboardType="numeric"
          />
          <TextInput
            style={styles.input}
            placeholder="Estimated walk time in minutes (default 20)"
            value={estimatedMinutes}
            onChangeText={setEstimatedMinutes}
            keyboardType="numeric"
          />

          <Divider />

          <View style={[styles.spaceBetween, { marginVertical: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h3}>⚡ High-risk mode</Text>
              <Text style={[styles.caption, { marginTop: 2 }]}>
                Lowers deviation threshold to 150 m and stopped threshold to 90 s.
              </Text>
            </View>
            <Switch
              value={highRiskMode}
              onValueChange={setHighRiskMode}
              trackColor={{ true: colors.red }}
            />
          </View>

          <Divider />

          <Text style={[styles.caption, { marginBottom: 8 }]}>
            Your contacts will receive an automated SMS when you start and when you arrive.
            No action needed — it's fully automatic.
          </Text>

          <Action
            label={loading ? "Starting walk…" : "🚶 Start Walk With Me"}
            loading={loading}
            disabled={loading || !destinationName.trim()}
            onPress={() => void handleStart()}
          />
        </Card>
      )}

      {/* How it works */}
      {walkState === "idle" && (
        <Card>
          <Text style={styles.h3}>How it works</Text>
          <Text style={[styles.caption, { marginTop: 6, lineHeight: 20 }]}>
            1. Enter your destination and estimated walk time.{"\n"}
            2. Tap <Text style={{ fontWeight: "700" }}>Start Walk</Text> — your GPS is tracked live every 10 seconds.{"\n"}
            3. If you deviate more than 300 m from your route, your contacts are alerted instantly.{"\n"}
            4. If you stop for more than 3 minutes without moving, an alert fires automatically.{"\n"}
            5. Tap <Text style={{ fontWeight: "700" }}>I've Arrived Safely</Text> to send an all-clear.{"\n\n"}
            In high-risk mode thresholds drop to 150 m / 90 s.
          </Text>
        </Card>
      )}

      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
