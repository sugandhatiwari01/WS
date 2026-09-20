import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { getAlerts, SafetyAlert } from "@/lib/storage";
import { api } from "@/lib/api";
import { styles } from "@/lib/theme";

export default function History() {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  useEffect(() => {
    getAlerts().then(setAlerts);
    api<{ _id: string; triggerType?: string; status?: string; createdAt?: string; currentLocation?: { latitude: number; longitude: number } }[]>("/api/emergencies/history").then((result) => {
      if (result.data) setAlerts(result.data.map((item) => ({ id: item._id, type: item.triggerType === "TIMER" ? "timer" : "sos", status: item.status === "RESOLVED" || item.status === "CANCELLED" ? "resolved" : "active", createdAt: item.createdAt || new Date().toISOString(), location: item.currentLocation ? `${item.currentLocation.latitude}, ${item.currentLocation.longitude}` : undefined })));
    });
  }, []);
  return <View style={[styles.safe, styles.container]}>
    <Header title="Alert history" subtitle="A private record of your safety events." />
    {alerts.length === 0 ? <Card><Text style={styles.subtitle}>Your completed SOS and timer events will appear here.</Text></Card> :
      alerts.map((alert) => <Card key={alert.id}><Text style={{ fontWeight: "800" }}>{alert.type.toUpperCase()} • {alert.status}</Text><Text style={styles.subtitle}>{new Date(alert.createdAt).toLocaleString()}{"\n"}{alert.location || "Location not shared"}</Text></Card>)}
    <Action label="Back home" onPress={() => router.replace("/home" as never)} />
  </View>;
}
