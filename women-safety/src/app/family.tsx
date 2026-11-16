/**
 * Family dashboard screen
 *
 * Shows active/recent emergencies from contacts who have added the current user
 * as a trusted contact. Real-time via Socket.IO, with 15 s polling fallback.
 */

import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { Action, Badge, Card, Divider, EmptyState, Header, StatusBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/hooks/useSocket";
import { colors, styles } from "@/lib/theme";

type Emergency = {
  _id: string;
  emergencyId?: string;
  status?: string;
  createdAt?: string;
  currentLocation?: { latitude?: number; longitude?: number } | null;
  initialLocation?: { latitude?: number; longitude?: number } | null;
  userId?: string;
};

type WalkAlert = {
  id: string;
  kind: "deviation" | "stopped" | "started";
  sessionId: string;
  userName?: string;
  destinationName?: string;
  latitude?: number;
  longitude?: number;
  deviationMetres?: number;
  stoppedForSeconds?: number;
  timestamp: string;
};

function statusVariant(status?: string): "danger" | "warning" | "success" | "neutral" {
  if (!status) return "neutral";
  if (["CREATED", "DISPATCHED", "VIEWED", "ASSIGNED"].includes(status)) return "danger";
  if (["RESPONDING", "ON_SCENE"].includes(status)) return "warning";
  if (["RESOLVED", "CANCELLED", "FALSE_ALARM"].includes(status)) return "success";
  return "neutral";
}

function elapsedSince(isoDate?: string): string {
  if (!isoDate) return "";
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getMapUrl(emergency: Emergency): string | null {
  const loc = emergency.currentLocation || emergency.initialLocation;
  if (loc?.latitude != null && loc?.longitude != null) {
    return `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  }
  return null;
}

export default function FamilyScreen() {
  const { user } = useAuth();
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [walkAlerts, setWalkAlerts] = useState<WalkAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<Emergency[]>("/api/family/emergencies");
    if (result.data) {
      setEmergencies(result.data);
      setError("");
    } else {
      setError(result.error || "Unable to load alerts.");
    }
    setLoading(false);
  }, []);

  /* ─── Socket.IO real-time ──────────────────────────────── */
  useSocket({
    userId: user?._id,
    onEvent: (event, data) => {
      if (event === "family:emergency") {
        setEmergencies((prev) => {
          const item = data as Emergency;
          if (prev.some((e) => e._id === item._id)) return prev;
          return [item, ...prev];
        });
      } else if (event === "location:live") {
        const loc = data as { emergencyId: string; latitude: number; longitude: number };
        setEmergencies((prev) =>
          prev.map((e) =>
            e._id === loc.emergencyId || e.emergencyId === loc.emergencyId
              ? { ...e, currentLocation: { latitude: loc.latitude, longitude: loc.longitude } }
              : e
          )
        );
      } else if (event === "audio:evidence" || event === "family:ride") {
        void load();
      } else if (event === "walksafe:deviation") {
        const d = data as { sessionId: string; userName?: string; destinationName?: string; latitude?: number; longitude?: number; deviationMetres?: number };
        setWalkAlerts((prev) => [
          { id: `dev-${d.sessionId}-${Date.now()}`, kind: "deviation", sessionId: d.sessionId, userName: d.userName, destinationName: d.destinationName, latitude: d.latitude, longitude: d.longitude, deviationMetres: d.deviationMetres, timestamp: new Date().toISOString() },
          ...prev.slice(0, 9),
        ]);
      } else if (event === "walksafe:stopped") {
        const d = data as { sessionId: string; userName?: string; destinationName?: string; latitude?: number; longitude?: number; stoppedForSeconds?: number };
        setWalkAlerts((prev) => [
          { id: `stp-${d.sessionId}-${Date.now()}`, kind: "stopped", sessionId: d.sessionId, userName: d.userName, destinationName: d.destinationName, latitude: d.latitude, longitude: d.longitude, stoppedForSeconds: d.stoppedForSeconds, timestamp: new Date().toISOString() },
          ...prev.slice(0, 9),
        ]);
      } else if (event === "walksafe:arrived" || event === "walksafe:cancelled") {
        const d = data as { sessionId: string };
        setWalkAlerts((prev) => prev.filter((a) => a.sessionId !== d.sessionId));
      }
    },
  });

  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const activeCount = emergencies.filter(
    (e) => !["RESOLVED", "CANCELLED", "FALSE_ALARM"].includes(e.status || "")
  ).length;

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Family dashboard"
        subtitle="Live safety alerts from your connected network."
      />

      {activeCount > 0 && (
        <StatusBanner
          title={`🚨 ${activeCount} active emergency${activeCount > 1 ? "ies" : ""}`}
          subtitle="Scroll down to see details and locations."
        />
      )}

      {/* Walk With Me alerts */}
      {walkAlerts.length > 0 && (
        <Card danger>
          <Text style={[styles.h2, { color: colors.red }]}>🚶 Walk Safety Alerts</Text>
          {walkAlerts.map((alert) => (
            <View key={alert.id} style={{ marginTop: 10, padding: 10, backgroundColor: colors.border, borderRadius: 8 }}>
              <Text style={{ fontWeight: "700" }}>
                {alert.kind === "deviation" ? "⚠️ Off Route" : "⚠️ Stopped"} — {alert.userName ?? "Contact"}
              </Text>
              <Text style={[styles.caption, { marginTop: 2 }]}>
                Walking to: {alert.destinationName ?? "unknown"}
              </Text>
              {alert.kind === "deviation" && alert.deviationMetres ? (
                <Text style={styles.caption}>Deviated {alert.deviationMetres} m from route</Text>
              ) : null}
              {alert.kind === "stopped" && alert.stoppedForSeconds ? (
                <Text style={styles.caption}>Stopped for {alert.stoppedForSeconds} seconds</Text>
              ) : null}
              {alert.latitude != null && alert.longitude != null ? (
                <Action
                  label={`📍 Last known: ${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`}
                  secondary
                  onPress={() => Linking.openURL(`https://maps.google.com/?q=${alert.latitude},${alert.longitude}`)}
                />
              ) : null}
            </View>
          ))}
        </Card>
      )}

      {error ? (
        <Card danger>
          <Text style={styles.errorText}>{error}</Text>
          <Action label="Retry" secondary onPress={load} />
        </Card>
      ) : null}

      {loading && emergencies.length === 0 ? (
        <EmptyState message="Loading alerts..." />
      ) : emergencies.length === 0 ? (
        <EmptyState message="No alerts right now. When a connected contact triggers SOS, it appears here instantly." />
      ) : (
        emergencies.map((emergency) => {
          const isActive = !["RESOLVED", "CANCELLED", "FALSE_ALARM"].includes(emergency.status || "");
          const mapUrl = getMapUrl(emergency);

          return (
            <Card key={emergency._id} danger={isActive}>
              <View style={styles.spaceBetween}>
                <View>
                  <Text style={[styles.h3, { color: isActive ? colors.red : colors.ink }]}>
                    {isActive ? "🚨 " : ""}
                    SOS alert
                  </Text>
                  <Text style={styles.caption}>
                    {emergency.emergencyId || emergency._id} • {elapsedSince(emergency.createdAt)}
                  </Text>
                </View>
                <Badge
                  label={emergency.status || "OPEN"}
                  variant={statusVariant(emergency.status)}
                />
              </View>

              <Divider />

              {mapUrl && (
                <Action
                  label={`📍 LIVE MAP: ${emergency.currentLocation?.latitude ? `${emergency.currentLocation.latitude.toFixed(5)}, ${emergency.currentLocation.longitude?.toFixed(5)}` : "View on map"}`}
                  onPress={() => Linking.openURL(mapUrl)}
                />
              )}
              <Action
                label="View details & audio evidence"
                secondary
                onPress={() =>
                  router.push({
                    pathname: "/details",
                    params: {
                      id: emergency._id,
                      status: emergency.status,
                      latitude: emergency.currentLocation?.latitude?.toString() || emergency.initialLocation?.latitude?.toString(),
                      longitude: emergency.currentLocation?.longitude?.toString() || emergency.initialLocation?.longitude?.toString(),
                    },
                  } as never)
                }
              />
            </Card>
          );
        })
      )}

      <Action label="🔄 Refresh" secondary onPress={load} />
      <Action label="← Back home" secondary onPress={() => router.replace("/home" as never)} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
