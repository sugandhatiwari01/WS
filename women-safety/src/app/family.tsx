import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { api } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

type Contact = { _id: string; name: string; phone: string };
type Emergency = { _id: string; emergencyId?: string; level?: string; status?: string; createdAt?: string };

export default function Family() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const load = useCallback(async () => {
    const result = await api<Contact[]>("/api/family");
    if (result.data) setContacts(result.data);
    else setError(result.error || "Unable to load your family circle.");
    const alerts = await api<Emergency[]>("/api/family/emergencies");
    if (alerts.data) setEmergencies(alerts.data);
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  return <View style={[styles.safe, styles.container]}>
    <Header title="Family dashboard" subtitle="Your circle's safety status, in one place." />
    {error ? <Card><Text style={{ color: colors.red }}>{error}</Text><Action label="Retry" secondary onPress={load} /></Card> : null}
    {contacts.length === 0 && !error ? <Card><Text style={styles.subtitle}>No family contacts are linked to this account yet.</Text></Card> :
      contacts.map((contact) => <Card key={contact._id}><Text style={{ fontWeight: "800", fontSize: 18 }}>{contact.name}</Text><Text style={styles.subtitle}>{contact.phone}</Text><Text style={{ color: colors.green, marginTop: 8, fontWeight: "700" }}>Connected</Text><Action label="View details & map" onPress={() => router.push("/details" as never)} /></Card>)}
    {emergencies.map((emergency) => <Card key={emergency._id}><Text style={{ fontWeight: "800", color: colors.red }}>🚨 {emergency.level || "EMERGENCY"} • {emergency.status}</Text><Text style={styles.subtitle}>{emergency.emergencyId || emergency._id}</Text><Action label="View emergency details" onPress={() => router.push({ pathname: "/details", params: { id: emergency._id } } as never)} /></Card>)}
    <Action label="Refresh" secondary onPress={load} />
    <Action label="Back home" secondary onPress={() => router.replace("/home" as never)} />
  </View>;
}
