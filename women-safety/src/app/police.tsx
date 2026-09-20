import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { api, post } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

type Incident = { _id: string; emergencyId?: string; level?: string; status?: string; triggerType?: string; createdAt?: string };

export default function Police() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await api<Incident[]>("/api/police/incidents");
    if (result.data) setIncidents(result.data);
    else setError(result.error || "Unable to load incidents.");
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const claim = async (incident: Incident) => {
    const result = await post(`/api/police/incidents/${incident._id}/claim`, {});
    if (result.error) Alert.alert("Unable to claim incident", result.error);
    else { Alert.alert("Incident claimed", "You are now assigned to this response."); load(); }
  };
  return <View style={[styles.safe, styles.container]}>
    <Header title="Police response" subtitle="Protected incident queue from SafeHer." />
    {error ? <Card><Text style={{ color: colors.red }}>{error}</Text><Action label="Retry" secondary onPress={load} /></Card> : null}
    {incidents.length === 0 && !error ? <Card><Text style={styles.subtitle}>No open incidents.</Text></Card> :
      incidents.map((incident) => <Card key={incident._id}><Text style={{ fontWeight: "800", color: colors.red }}>{incident.level || "LEVEL_1"} • {incident.status || "OPEN"}</Text><Text style={styles.subtitle}>{incident.triggerType || "Emergency"}{"\n"}{incident.createdAt ? new Date(incident.createdAt).toLocaleString() : "Just now"}</Text><Action label="Claim incident" onPress={() => claim(incident)} /><Action label="View details and map" secondary onPress={() => router.push({ pathname: "/details", params: { id: incident._id } } as never)} /></Card>)}
    <Action label="Back home" secondary onPress={() => router.replace("/home" as never)} />
  </View>;
}
