import { Redirect, router } from "expo-router";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import { Audio } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Text, View, Vibration } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api, post, uploadAudio } from "@/lib/api";
import { createAlert, resolveAlert } from "@/lib/storage";
import { colors, styles } from "@/lib/theme";

type IncomingEmergency = { _id: string; emergencyId?: string; level?: string; status?: string; nearbyStation?: { name?: string; distanceKm?: number; location?: { coordinates?: number[] } } };

export default function Home() {
  const { user, signOut } = useAuth(); const [location, setLocation] = useState<string>("Location not shared"); const [active, setActive] = useState(false); const [emergencyId, setEmergencyId] = useState<string | null>(null); const [station, setStation] = useState<IncomingEmergency["nearbyStation"]>(); const [recording, setRecording] = useState<Audio.Recording | null>(null); const [incoming, setIncoming] = useState<IncomingEmergency[]>([]); const last = useRef(0); const seenIncoming = useRef("");
  const loadIncoming = useCallback(async () => {
    const result = await api<IncomingEmergency[]>("/api/family/emergencies");
    if (result.data) {
      const latest = result.data[0]?._id || "";
      if (latest && seenIncoming.current && latest !== seenIncoming.current) Vibration.vibrate([0, 500, 250, 500]);
      seenIncoming.current = latest;
      setIncoming(result.data);
    }
  }, []);
  const loadActiveEmergency = useCallback(async () => {
    const result = await api<{ _id: string; emergencyId?: string; nearbyStation?: IncomingEmergency["nearbyStation"] }>("/api/emergencies/active");
    if (result.data) {
      setEmergencyId(result.data._id || result.data.emergencyId || null);
      setStation(result.data.nearbyStation);
      setActive(true);
    }
  }, []);
  const triggerSos = useCallback(async (level: "LEVEL_1" | "LEVEL_2") => {
    const localAlert = await createAlert("sos", location);
    const [latitude, longitude] = location.split(",").map(Number);
    const body = {
      level,
      triggerType: "SOS_BUTTON",
      ...(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {}),
    };
    const result = await post<{ _id?: string; emergencyId?: string; nearbyStation?: IncomingEmergency["nearbyStation"] }>("/api/emergencies", body, true);
    if (result.error && !result.offline) {
      await resolveAlert(localAlert.id);
      Alert.alert("SOS could not be sent", result.error);
      return;
    }
    setEmergencyId(result.data?._id || result.data?.emergencyId || null);
    setStation(result.data?.nearbyStation);
    setActive(true);
    Vibration.vibrate([0, 250, 150, 250]);
    Alert.alert("SOS active", result.offline ? "Saved on this device and queued." : "Your safety network has been notified.");
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
  const toggleRecording = useCallback(async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri && emergencyId) {
        const result = await uploadAudio(`/api/emergencies/${emergencyId}/audio`, uri);
        Alert.alert(result.error ? "Audio upload failed" : "Audio saved", result.error || "The recording is attached to your active emergency.");
      }
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return Alert.alert("Microphone permission needed", "Allow microphone access to record evidence.");
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const result = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(result.recording);
  }, [emergencyId, recording]);
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
          Alert.alert("Shake detected", "Start an SOS alert?", [{ text: "Cancel" }, { text: "Start SOS", onPress: () => triggerSos("LEVEL_1") }]);
        }
      });
      Accelerometer.setUpdateInterval(500);
    }
    void loadIncoming();
    void loadActiveEmergency();
    const incomingTimer = setInterval(() => { void loadIncoming(); }, 10000);
    return () => { sub?.remove(); clearInterval(incomingTimer); };
  }, [loadActiveEmergency, loadIncoming, triggerSos]);
  if (!user) return <Redirect href="/login" />;
  const isUser = user.role === "user";
  return <ScrollView style={styles.safe} contentContainerStyle={styles.container}><Header title={`Hi, ${user.name}`} subtitle={isUser ? "You are protected. Your trusted network is ready." : user.role === "family" ? "Stay connected to your family circle." : "Monitor and respond to active incidents."}/>
    {incoming.length > 0 && <Card><Text style={{fontWeight:"800",color:colors.red}}>🚨 Trusted contact alerts</Text>{incoming.slice(0, 3).map((item) => <Text key={item._id} style={[styles.subtitle,{marginTop:8}]}>{item.emergencyId || item._id} • {item.level || "EMERGENCY"} • {item.status}</Text>)}<Action label="Open family dashboard" secondary onPress={()=>(router as any).push("/family")}/></Card>}
    {isUser ? <><Card><Text style={{fontSize:20,fontWeight:"900",color:colors.ink}}>Emergency SOS</Text><Text style={styles.subtitle}>Choose the response level. Your location is shared with police and trusted contacts.</Text><Action label={active ? "SOS ACTIVE — CANCEL" : "SOS — LEVEL 1"} onPress={active ? cancelSos : () => triggerSos("LEVEL_1")}/>{!active && <Action label="SOS — LEVEL 2 (URGENT)" onPress={() => triggerSos("LEVEL_2")}/>}{active&&<><Text style={{color:colors.red,marginTop:12,fontWeight:"700"}}>Alert active • location {location}</Text><Action label={recording ? "STOP AND SAVE AUDIO" : "RECORD AUDIO EVIDENCE"} secondary onPress={toggleRecording}/></>}</Card><Card><Text style={{fontWeight:"800",fontSize:17}}>Current location</Text><Text style={[styles.subtitle,{marginTop:6}]}>{location}</Text>{station?.name && <><Text style={{fontWeight:"800",marginTop:14}}>Nearest police station</Text><Text style={styles.subtitle}>{station.name} • {station.distanceKm} km away (10 km response range)</Text><Action label="View station on map" secondary onPress={() => { const coordinates = station.location?.coordinates; if (coordinates) Linking.openURL(`https://maps.google.com/?q=${coordinates[1]},${coordinates[0]}`); }} /></>}<Action label="Trusted contacts & settings" secondary onPress={()=>(router as any).push("/settings")}/></Card><Card><Text style={{fontWeight:"800",fontSize:17}}>Safety tools</Text><Action label="Alert history" secondary onPress={()=>(router as any).push("/history")}/></Card></> : <Card><Text style={{fontSize:19,fontWeight:"800"}}>{user.role==="family"?"Family dashboard":"Police dashboard"}</Text><Text style={styles.subtitle}>Live response queue and nearby station coverage.</Text><Action label="Open dashboard" onPress={()=>(router as any).push(user.role==="family"?"/family":"/police")}/></Card>}
    <Action label="Sign out" secondary onPress={()=>signOut()}/><View style={{height:30}}/><Text style={{textAlign:"center",color:colors.muted}}>If you are in immediate danger, call emergency services.</Text></ScrollView>;
}
