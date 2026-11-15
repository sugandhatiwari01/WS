/**
 * Police dashboard screen
 *
 * Shows all open incidents assigned to the officer's station.
 * Real-time via Socket.IO (station:{stationId} room), with 10 s polling fallback.
 * Workflow: CREATED → ASSIGNED (claim) → RESPONDING → ON_SCENE → RESOLVED
 */

import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, Text, View, Vibration } from "react-native";
import { Action, Badge, Card, Divider, EmptyState, Header, StatusBanner } from "@/components/ui";
import { api, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/hooks/useSocket";
import { BadgeVariant, styles } from "@/lib/theme";

type Incident = {
  _id: string;
  emergencyId?: string;
  status?: string;
  triggerType?: string;
  createdAt?: string;
  stationId?: string;
  nearbyStation?: { name?: string; distanceKm?: number };
  initialLocation?: { latitude?: number; longitude?: number; lat?: number; lng?: number } | null;
  currentLocation?: { latitude?: number; longitude?: number; lat?: number; lng?: number } | null;
};

const STATUS_FLOW: Record<string, { label: string; path: string } | undefined> = {
  ASSIGNED: { label: "Mark responding →", path: "respond" },
  RESPONDING: { label: "Mark on scene →", path: "on-scene" },
  ON_SCENE: { label: "✅ Mark resolved", path: "resolve" },
};

function statusVariant(status?: string): BadgeVariant {
  if (!status) return "neutral";
  if (["CREATED", "DISPATCHED", "VIEWED"].includes(status)) return "danger";
  if (status === "ASSIGNED") return "warning";
  if (status === "RESPONDING") return "info";
  if (status === "ON_SCENE") return "warning";
  if (status === "RESOLVED") return "success";
  if (["CANCELLED", "FALSE_ALARM"].includes(status)) return "neutral";
  return "neutral";
}

function elapsedSince(isoDate?: string): string {
  if (!isoDate) return "just now";
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getMapUrl(incident: Incident): string | null {
  const loc = incident.currentLocation || incident.initialLocation;
  if (!loc) return null;
  const lat = (loc as { latitude?: number }).latitude ?? (loc as { lat?: number }).lat;
  const lng = (loc as { longitude?: number }).longitude ?? (loc as { lng?: number }).lng;
  if (lat != null && lng != null) return `https://maps.google.com/?q=${lat},${lng}`;
  return null;
}

export default function PoliceScreen() {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const knownIds = useRef(new Set<string>());

  const load = useCallback(async () => {
    const result = await api<Incident[]>("/api/police/incidents");
    if (result.data) {
      // Vibrate if new incident arrived
      const newOnes = result.data.filter((i) => !knownIds.current.has(i._id));
      if (newOnes.length > 0 && knownIds.current.size > 0) {
        Vibration.vibrate([0, 500, 200, 500]);
      }
      knownIds.current = new Set(result.data.map((incident) => incident._id));
      setIncidents(result.data);
      setError("");
    } else {
      setError(result.error || "Unable to load incidents.");
    }
    setLoading(false);
  }, []);

  /* ─── Socket.IO real-time (station room) ───────────────── */
  useSocket({
    userId: user?._id,
    stationId: incidents[0]?.stationId, // join station room once known
    onEvent: (event, data) => {
      if (event === "emergency:new") {
        Vibration.vibrate([0, 500, 200, 500]);
        setIncidents((prev) => {
          const item = data as Incident;
          if (prev.some((i) => i._id === item._id)) return prev;
          knownIds.current.add(item._id);
          return [item, ...prev];
        });
      } else if (event === "location:live") {
        const loc = data as { emergencyId: string; latitude: number; longitude: number };
        setIncidents((prev) =>
          prev.map((item) =>
            item._id === loc.emergencyId || item.emergencyId === loc.emergencyId
              ? { ...item, currentLocation: { latitude: loc.latitude, longitude: loc.longitude } }
              : item
          )
        );
      } else if (event === "audio:evidence") {
        Vibration.vibrate([0, 300, 100, 300]);
        void load();
      } else if (event === "incident:claimed" || event === "emergency:cancelled") {
        void load();
      }
    },
  });

  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  /* ─── Claim incident ───────────────────────────────────── */
  const claim = async (incident: Incident) => {
    const result = await post(`/api/police/incidents/${incident._id}/claim`, {});
    if (result.error) {
      Alert.alert(
        result.error === "CASE_ALREADY_CLAIMED" ? "Already claimed" : "Unable to claim",
        result.error === "CASE_ALREADY_CLAIMED"
          ? "Another officer has already claimed this incident."
          : result.error
      );
    } else {
      await load();
    }
  };

  /* ─── Status transition ────────────────────────────────── */
  const advance = async (incident: Incident, action: { label: string; path: string }) => {
    const result = await post(`/api/police/incidents/${incident._id}/${action.path}`, {});
    if (result.error) {
      Alert.alert("Update failed", result.error);
    } else {
      await load();
    }
  };

  const openCount = incidents.filter(
    (i) => !["RESOLVED", "CANCELLED", "FALSE_ALARM"].includes(i.status || "")
  ).length;

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Police response"
        subtitle="Active incidents within 10 km of your station."
      />

      {openCount > 0 && (
        <StatusBanner
          title={`🚨 ${openCount} open incident${openCount > 1 ? "s" : ""}`}
          subtitle="Claim an incident to take ownership."
        />
      )}

      {error ? (
        <Card danger>
          <Text style={styles.errorText}>{error}</Text>
          <Action label="Retry" secondary onPress={load} />
        </Card>
      ) : null}

      {loading && incidents.length === 0 ? (
        <EmptyState message="Loading incidents..." />
      ) : incidents.length === 0 && !error ? (
        <EmptyState message="No open incidents. The dashboard updates in real-time when new emergencies are dispatched." />
      ) : (
        incidents.map((incident) => {
          const action = STATUS_FLOW[incident.status || ""];
          const canClaim = ["CREATED", "DISPATCHED", "VIEWED"].includes(incident.status || "");
          const mapUrl = getMapUrl(incident);
          const location = incident.currentLocation || incident.initialLocation;
          const latitude = location?.latitude ?? location?.lat;
          const longitude = location?.longitude ?? location?.lng;

          return (
            <Card key={incident._id} danger={canClaim}>
              {/* Header row */}
              <View style={styles.spaceBetween}>
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Badge label={incident.status || "OPEN"} variant={statusVariant(incident.status)} />
                  </View>
                  <Text style={styles.caption}>
                    {incident.triggerType || "Emergency"} • {elapsedSince(incident.createdAt)}
                  </Text>
                </View>
              </View>

              {/* Station */}
              {incident.nearbyStation?.name && (
                <Text style={[styles.subtitle, { marginTop: 8 }]}>
                  📡 {incident.nearbyStation.name}
                  {incident.nearbyStation.distanceKm != null
                    ? ` • ${incident.nearbyStation.distanceKm} km from station`
                    : ""}
                </Text>
              )}

              <Divider />

              {/* Map */}
              {mapUrl && (
                <Action
                  label="📍 Open location on map"
                  onPress={() => void Linking.openURL(mapUrl)}
                />
              )}

              {/* Primary action */}
              {canClaim && (
                <Action label="🔒 Claim this incident" onPress={() => void claim(incident)} />
              )}
              {action && !canClaim && (
                <Action label={action.label} onPress={() => void advance(incident, action)} />
              )}

              {/* Details */}
              <Action
                label="View incident & recordings"
                secondary
                onPress={() =>
                  router.push({
                    pathname: "/details",
                    params: {
                      id: incident._id,
                      status: incident.status,
                      latitude: latitude?.toString(),
                      longitude: longitude?.toString(),
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
