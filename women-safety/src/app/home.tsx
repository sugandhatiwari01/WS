import { Redirect, router } from "expo-router";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api, clearQueuedRequests, flushQueue, getQueuedRequestCount, post } from "@/lib/api";
import { createAlert, resolveAlert } from "@/lib/storage";
import { colors, styles } from "@/lib/theme";

type IncomingEmergency = { _id: string; emergencyId?: string; level?: string; status?: string };

export default function Home() {
  const { user, signOut } = useAuth(); const [location, setLocation] = useState<string>("Location not shared"); const [active, setActive] = useState(false); const [emergencyId, setEmergencyId] = useState<string | null>(null); const [queued, setQueued] = useState(0); const [incoming, setIncoming] = useState<IncomingEmergency[]>([]); const last = useRef(0);
  const loadIncoming = useCallback(async () => {
    const result = await api<IncomingEmergency[]>("/api/family/emergencies");
    if (result.data) setIncoming(result.data);
  }, []);
  const syncQueue = useCallback(async () => {
    const result = await flushQueue();
    setQueued(result.remaining);
    if (result.synced) Alert.alert("Safety updates synced", `${result.synced} queued update${result.synced === 1 ? "" : "s"} sent.`);
    else if (!result.remaining) Alert.alert("Queue cleared", "Stale updates that could not be authenticated were removed.");
  }, []);
  const clearQueue = useCallback(async () => {
    await clearQueuedRequests();
    setQueued(0);
  }, []);
  const triggerSos = useCallback(async () => {
    const localAlert = await createAlert("sos", location);
    const [latitude, longitude] = location.split(",").map(Number);
    const body = {
      level: "LEVEL_1",
      triggerType: "SOS_BUTTON",
      ...(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {}),
    };
    const result = await post<{ _id?: string; emergencyId?: string }>("/api/emergencies", body, true);
    if (result.error && !result.offline) {
      await resolveAlert(localAlert.id);
      Alert.alert("SOS could not be sent", result.error);
      return;
    }
    setEmergencyId(result.data?._id || result.data?.emergencyId || null);
    setQueued(await getQueuedRequestCount());
    setActive(true);
    Alert.alert("SOS active", result.offline ? "Saved on this device and queued. Retry sync when your connection returns." : "Your safety network has been notified.");
  }, [location]);
  const cancelSos = useCallback(async () => {
    if (!emergencyId) {
      setActive(false);
      return;
    }
    const result = await post(`/api/emergencies/${emergencyId}/cancel`, {}, true);
    if (result.offline) {
      Alert.alert("Cancellation queued", "The cancellation will sync when your connection returns.");
      setActive(false);
      return;
    }
    if (result.error) {
      Alert.alert("Unable to cancel", result.error);
      return;
    }
    setActive(false);
    setEmergencyId(null);
  }, [emergencyId]);
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(async ({ status }) => {
      if (status !== "granted") return;
      try {
        const p = await Location.getCurrentPositionAsync({});
        setLocation(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`);
      } catch {
        setLocation("Location unavailable");
      }
    });
    let sub: { remove: () => void } | undefined;
    if (Platform.OS !== "web") {
      sub = Accelerometer.addListener(({ x, y, z }) => {
        const force = Math.sqrt(x * x + y * y + z * z);
        if (force > 2.4 && Date.now() - last.current > 3000) {
          last.current = Date.now();
          Alert.alert("Shake detected", "Start an SOS alert?", [{ text: "Cancel" }, { text: "Start SOS", onPress: triggerSos }]);
        }
      });
      Accelerometer.setUpdateInterval(500);
    }
    getQueuedRequestCount().then(setQueued);
    void loadIncoming();
    const incomingTimer = setInterval(() => { void loadIncoming(); }, 10000);
    return () => { sub?.remove(); clearInterval(incomingTimer); };
  }, [loadIncoming, triggerSos]);
  if (!user) return <Redirect href="/login" />;
  const isUser = user.role === "user";
  return <ScrollView style={styles.safe} contentContainerStyle={styles.container}><Header title={`Hi, ${user.name}`} subtitle={isUser ? "You are protected. Your trusted network is ready." : user.role === "family" ? "Stay connected to your family circle." : "Monitor and respond to active incidents."}/>
    {incoming.length > 0 && <Card><Text style={{fontWeight:"800",color:colors.red}}>🚨 Trusted contact alerts</Text>{incoming.slice(0, 3).map((item) => <Text key={item._id} style={[styles.subtitle,{marginTop:8}]}>{item.emergencyId || item._id} • {item.level || "EMERGENCY"} • {item.status}</Text>)}<Action label="Open family dashboard" secondary onPress={()=>(router as any).push("/family")}/></Card>}
    {isUser ? <><Card><Text style={{fontSize:18,fontWeight:"800",color:colors.ink}}>Emergency SOS</Text><Text style={styles.subtitle}>Shares your live location with trusted contacts and emergency services.</Text><Action label={active ? "SOS ACTIVE — Tap to cancel" : "HOLD TO SEND SOS"} onPress={active ? cancelSos : triggerSos}/>{active&&<Text style={{color:colors.red,marginTop:12,fontWeight:"700"}}>Alert active • location {location}</Text>}</Card><Card><Text style={{fontWeight:"800",fontSize:17}}>Safety tools</Text><Action label="Start a safety timer" secondary onPress={()=>(router as any).push("/timer")}/><Action label="My active alerts" secondary onPress={()=>(router as any).push("/active")}/><Action label="Alert history" secondary onPress={()=>(router as any).push("/history")}/></Card></> : <><Card><Text style={{fontSize:19,fontWeight:"800"}}>{user.role==="family"?"Family dashboard":"Police dashboard"}</Text><Text style={styles.subtitle}>Real-time overview • Last synced just now</Text><Action label="Open dashboard" onPress={()=>(router as any).push(user.role==="family"?"/family":"/police")}/></Card></>}
    <Card><Text style={{fontWeight:"800"}}>Current location</Text><Text style={[styles.subtitle,{marginTop:6}]}>{location}</Text>{queued > 0 && <><Text style={[styles.subtitle,{marginTop:10,color:colors.amber}]}>{queued} safety update{queued === 1 ? "" : "s"} waiting to sync.</Text><Action label="Retry sync" secondary onPress={syncQueue}/><Action label="Clear stale updates" secondary onPress={clearQueue}/></>}<Action label="Trusted contacts & settings" secondary onPress={()=>(router as any).push("/settings")}/></Card>
    <Action label="Sign out" secondary onPress={()=>signOut()}/><View style={{height:30}}/><Text style={{textAlign:"center",color:colors.muted}}>If you are in immediate danger, call emergency services.</Text></ScrollView>;
}
