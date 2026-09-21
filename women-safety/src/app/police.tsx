import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Text, View, Vibration } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { api, post } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

type Incident = {
  _id: string;
  emergencyId?: string;
  level?: string;
  status?: string;
  triggerType?: string;
  createdAt?: string;
  nearbyStation?: { name?: string; distanceKm?: number };
};

const nextAction: Record<string, { label: string; path: string } | undefined> = {
  ASSIGNED: { label: "Mark responding", path: "respond" },
  RESPONDING: { label: "Mark on scene", path: "on-scene" },
  ON_SCENE: { label: "Mark resolved", path: "resolve" },
};

export default function Police() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState("");
  const knownIds = useRef<string[]>([]);
  const load = useCallback(async () => {
    const result = await api<Incident[]>("/api/police/incidents");
    if (result.data) {
      if (knownIds.current.length && result.data.some(item => !knownIds.current.includes(item._id))) Vibration.vibrate([0, 500, 250, 500]);
      knownIds.current = result.data.map(item => item._id);
      setIncidents(result.data); setError("");
    }
    else setError(result.error || "Unable to load incidents.");
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [load]);
  const update = async (incident: Incident, action: { label: string; path: string }) => {
    const result = await post(`/api/police/incidents/${incident._id}/${action.path}`, {});
    if (result.error) Alert.alert("Update failed", result.error);
    else await load();
  };
  const claim = async (incident: Incident) => {
    const result = await post(`/api/police/incidents/${incident._id}/claim`, {});
    if (result.error) Alert.alert("Unable to claim incident", result.error);
    else await load();
  };
  return <View style={[styles.safe, styles.container]}>
    <Header title="Police response" subtitle="Active incidents within the 10 km station response range." />
    {error ? <Card><Text style={{ color: colors.red }}>{error}</Text><Action label="Retry" secondary onPress={load} /></Card> : null}
    {!incidents.length && !error ? <Card><Text style={styles.subtitle}>No open incidents.</Text></Card> : incidents.map(incident => {
      const action = nextAction[incident.status || ""];
      return <Card key={incident._id}>
        <Text style={{ fontWeight: "900", color: colors.red, fontSize: 17 }}>{incident.level || "LEVEL_1"} • {incident.status || "OPEN"}</Text>
        <Text style={styles.subtitle}>{incident.triggerType || "Emergency"}{"\n"}{incident.createdAt ? new Date(incident.createdAt).toLocaleString() : "Just now"}</Text>
        <Text style={{ marginTop: 8, fontWeight: "700" }}>{incident.nearbyStation?.name || "Nearest station"}{incident.nearbyStation?.distanceKm != null ? ` • ${incident.nearbyStation.distanceKm} km` : ""}</Text>
        {incident.status === "CREATED" || incident.status === "DISPATCHED" || incident.status === "VIEWED" ? <Action label="Claim incident" onPress={() => claim(incident)} /> : action ? <Action label={action.label} onPress={() => update(incident, action)} /> : null}
        <Action label="View location and audio" secondary onPress={() => router.push({ pathname: "/details", params: { id: incident._id, status: incident.status, level: incident.level } } as never)} />
      </Card>;
    })}
    <Action label="Back home" secondary onPress={() => router.replace("/home" as never)} />
  </View>;
}
