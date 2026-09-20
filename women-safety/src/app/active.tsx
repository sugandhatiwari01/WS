import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { getAlerts, resolveAlert, SafetyAlert } from "@/lib/storage";
import { colors, styles } from "@/lib/theme";

export default function Active() {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const load = useCallback(() => getAlerts().then((items) => setAlerts(items.filter((item) => item.status === "active"))), []);
  useEffect(() => { load(); }, [load]);
  const resolve = (alert: SafetyAlert) => Alert.alert("Resolve alert?", "This will mark the alert as safe.", [
    { text: "Cancel", style: "cancel" },
    { text: "Resolve", onPress: async () => { await resolveAlert(alert.id); load(); } },
  ]);
  return <View style={[styles.safe, styles.container]}>
    <Header title="Active alerts" subtitle="Alerts currently shared with your safety network." />
    {alerts.length === 0 ? <Card><Text style={{ fontWeight: "800", color: colors.green }}>No active alerts</Text><Text style={styles.subtitle}>You are all clear.</Text></Card> :
      alerts.map((alert) => <Card key={alert.id}><Text style={{ fontWeight: "800", color: colors.red }}>{alert.type.toUpperCase()} alert</Text><Text style={styles.subtitle}>{new Date(alert.createdAt).toLocaleString()}{"\n"}Location: {alert.location || "Not available"}</Text><Action label="Mark as safe" secondary onPress={() => resolve(alert)} /></Card>)}
    <Action label="Back home" onPress={() => router.replace("/home" as never)} />
  </View>;
}
