import { router } from "expo-router";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { Action, Badge, Card, Divider, Header } from "@/components/ui";
import { Contact, getContacts, saveContacts } from "@/lib/storage";
import { api, post } from "@/lib/api";
import { isInternetUnavailable, openSmsComposer } from "@/lib/safety-sms";
import { colors, styles } from "@/lib/theme";

type ServerContact = { _id: string; name: string; phone?: string; email?: string };
type RideSmsResult = {
  smsConfigured: boolean;
  sentCount: number;
  results: { name: string; phone: string; ok: boolean }[];
};

type UberRideData = {
  service?: string;
  driverName?: string;
  driverPhone?: string;
  driverRating?: string;
  vehicle?: string;
  plate?: string;
  tripId?: string;
  destination?: string;
  etaMinutes?: number;
  currentLatitude?: number;
  currentLongitude?: number;
};

function uniquePhones(contacts: Contact[]) {
  return [...new Set(contacts.flatMap((contact) => (contact.phone ? [contact.phone.trim()] : [])).filter(Boolean))];
}

export default function RideScreen() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [service, setService] = useState("Uber");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [tripReference, setTripReference] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [contactWarning, setContactWarning] = useState("");

  /* ─── Uber Integration State ───────────────────────────── */
  const [uberConnected, setUberConnected] = useState(false);
  const [uberLoading, setUberLoading] = useState(false);
  const [activeUberRide, setActiveUberRide] = useState<UberRideData | null>(null);

  useEffect(() => {
    let active = true;
    void getContacts()
      .then((saved) => {
        if (active) setContacts(saved);
      })
      .catch(() => {
        if (active) Alert.alert("Contacts unavailable", "Saved trusted contacts could not be loaded from this device.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void api<ServerContact[]>("/api/contacts")
      .then(async (result) => {
        if (!active) return;
        if (!result.data) {
          setContactWarning("Using contacts saved on this device. The server contact list could not be refreshed.");
          return;
        }
        const synced = result.data.map((contact) => ({
          id: contact._id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
        }));
        setContacts(synced);
        await saveContacts(synced);
        setContactWarning("");
      })
      .catch((error) => {
        if (active) {
          setContactWarning(
            error instanceof Error
              ? `Using contacts saved on this device. ${error.message}`
              : "Using contacts saved on this device. The server contact list could not be refreshed."
          );
        }
      });

    // Check Uber connection status
    void api<{ connected: boolean; configured: boolean; demoMode: boolean }>("/api/uber/status").then((res) => {
      if (active && res.data?.connected) {
        setUberConnected(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  /* ─── Uber Integration Actions ─────────────────────────── */
  const connectUber = async () => {
    setUberLoading(true);
    try {
      const res = await api<{ url: string; demoMode?: boolean }>("/api/uber/auth-url");
      if (res.error || !res.data) {
        Alert.alert("Uber connection error", res.error || "Could not retrieve Uber login URL.");
        return;
      }

      if (res.data.demoMode) {
        // Exchange demo code
        const exchange = await post<{ ok: boolean; message: string }>("/api/uber/exchange-token", {
          code: "mock_uber_auth_code_demo",
        });
        if (exchange.data?.ok) {
          setUberConnected(true);
          Alert.alert("Uber Connected", "Your Uber account is linked. Fetching active ride details...");
          await fetchUberRide();
        }
        return;
      }

      // Live OAuth2
      const authResult = await WebBrowser.openAuthSessionAsync(res.data.url, "safeher://uber-callback");
      if (authResult.type === "success" && authResult.url) {
        const urlParams = new URL(authResult.url);
        const code = urlParams.searchParams.get("code");
        if (code) {
          const exchange = await post<{ ok: boolean }>("/api/uber/exchange-token", { code });
          if (exchange.data?.ok) {
            setUberConnected(true);
            Alert.alert("Uber Connected", "Your Uber account is linked.");
            await fetchUberRide();
          }
        }
      }
    } catch (e) {
      Alert.alert("Uber connection failed", e instanceof Error ? e.message : "Unable to link Uber account.");
    } finally {
      setUberLoading(false);
    }
  };

  const fetchUberRide = async () => {
    setUberLoading(true);
    try {
      const res = await api<{ active: boolean; message?: string; ride?: UberRideData }>("/api/uber/current-ride");
      if (res.data?.active && res.data.ride) {
        const ride = res.data.ride;
        setActiveUberRide(ride);
        setService(ride.service || "Uber");
        setDriverName(ride.driverName || "");
        setDriverPhone(ride.driverPhone || "");
        setVehicle(ride.vehicle || "");
        setPlate(ride.plate || "");
        setTripReference(ride.tripId || "");
        setDestination(ride.destination || "");
        Alert.alert(
          "Uber Ride Found",
          `Driver: ${ride.driverName}\nVehicle: ${ride.vehicle} (${ride.plate})\nTap 'Send details to family' to notify contacts automatically.`
        );
      } else {
        Alert.alert("No Active Ride", res.data?.message || "No ongoing Uber trip was detected on this account.");
      }
    } catch (e) {
      Alert.alert("Failed to fetch Uber ride", e instanceof Error ? e.message : "Request failed.");
    } finally {
      setUberLoading(false);
    }
  };

  const autoShareUberRideWithFamily = async () => {
    const phones = uniquePhones(contacts);
    if (!phones.length) {
      Alert.alert("No contacts", "Add trusted contacts with phone numbers first.");
      return;
    }

    setSending(true);
    try {
      const res = await post<{ ok: boolean; sentCount: number; results: unknown[] }>("/api/uber/share-ride", {
        ride: activeUberRide || {
          service: service.trim() || "Uber",
          driverName: driverName.trim(),
          driverPhone: driverPhone.trim(),
          vehicle: vehicle.trim(),
          plate: plate.trim(),
          tripReference: tripReference.trim(),
          destination: destination.trim(),
        },
      });

      if (res.data?.ok) {
        Alert.alert(
          "Ride Details Sent Automatically",
          `Uber ride details were sent automatically to your family & trusted contacts without requiring manual confirmation.`
        );
      } else {
        Alert.alert("Send failed", res.error || "Server could not send the automated SMS.");
      }
    } catch (e) {
      Alert.alert("Send failed", e instanceof Error ? e.message : "Could not complete automated send.");
    } finally {
      setSending(false);
    }
  };

  /* ─── Manual or Fallback Ride Notification ─────────────── */
  const notifyContacts = async () => {
    if (!driverName.trim() || !vehicle.trim() || !plate.trim()) {
      Alert.alert("Ride details needed", "Enter the driver name, vehicle, and license plate before sharing.");
      return;
    }
    const phones = uniquePhones(contacts);
    if (!phones.length) {
      Alert.alert("No phone contacts", "Add trusted contacts with phone numbers before sharing ride details.");
      return;
    }

    setSending(true);
    try {
      let coordinates: { latitude: number; longitude: number } | null = null;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        const granted = permission.granted || (await Location.requestForegroundPermissionsAsync()).granted;
        if (granted) {
          const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        }
      } catch (_) {}

      let internetUnavailable = false;
      try {
        internetUnavailable = await isInternetUnavailable();
      } catch (_) {}

      if (!internetUnavailable) {
        // AUTOMATED: Send directly via backend API without human intervention
        const result = await post<RideSmsResult>("/api/notify/ride-sms", {
          service: service.trim() || "Cab",
          driverName: driverName.trim(),
          driverPhone: driverPhone.trim() || undefined,
          vehicle: vehicle.trim(),
          plate: plate.trim(),
          tripReference: tripReference.trim() || undefined,
          destination: destination.trim() || undefined,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
        });

        if (result.data?.sentCount && result.data.sentCount > 0) {
          Alert.alert(
            "Ride Details Sent Automatically",
            `Your ride details were sent to ${result.data.sentCount} trusted contact(s) via automated SMS without requiring manual taps.`
          );
          return;
        }

        if (result.data && !result.data.smsConfigured) {
          Alert.alert(
            "Server SMS not configured",
            "The backend SMS provider (Fast2SMS) is not configured. Falling back to phone SMS app."
          );
        }
      }

      // Offline fallback: Native SMS composer
      const locationLine = coordinates
        ? `Current location: https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`
        : "Current location is unavailable.";
      const message = [
        `SafeHer ride check-in (${service.trim() || "Cab"})`,
        `Driver: ${driverName.trim()}`,
        driverPhone.trim() ? `Driver phone: ${driverPhone.trim()}` : "",
        `Vehicle: ${vehicle.trim()}`,
        `License plate: ${plate.trim().toUpperCase()}`,
        tripReference.trim() ? `Trip reference: ${tripReference.trim()}` : "",
        destination.trim() ? `Destination: ${destination.trim()}` : "",
        locationLine,
        "I am sharing these details for my safety. Please check in with me if I do not confirm arrival.",
      ]
        .filter(Boolean)
        .join("\n");

      await openSmsComposer(phones, message);
    } catch (error) {
      Alert.alert("Ride alert failed", error instanceof Error ? error.message : "The ride details could not be shared.");
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Share cab details"
        subtitle="Send your ride information to trusted contacts automatically before or during a trip."
      />

      {/* ─── UBER INTEGRATION CARD ─── */}
      <Card>
        <View style={styles.spaceBetween}>
          <Text style={styles.h2}>🚗 Uber Integration</Text>
          <Badge
            label={uberConnected ? "UBER CONNECTED" : "NOT LINKED"}
            variant={uberConnected ? "success" : "neutral"}
          />
        </View>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Auto-fetch driver and vehicle details from your Uber app and share with your family automatically.
        </Text>

        {!uberConnected ? (
          <Action
            label={uberLoading ? "Connecting to Uber..." : "Connect Uber Account"}
            loading={uberLoading}
            onPress={() => void connectUber()}
          />
        ) : (
          <>
            <Action
              label={uberLoading ? "Fetching ride..." : "🔄 Sync Active Uber Ride"}
              secondary
              loading={uberLoading}
              onPress={() => void fetchUberRide()}
            />
            {activeUberRide && (
              <View style={{ marginTop: 10, padding: 10, backgroundColor: colors.border, borderRadius: 8 }}>
                <Text style={{ fontWeight: "700" }}>Driver: {activeUberRide.driverName} {activeUberRide.driverRating ? `(${activeUberRide.driverRating}★)` : ""}</Text>
                <Text style={{ marginTop: 2 }}>Vehicle: {activeUberRide.vehicle} • {activeUberRide.plate}</Text>
                {activeUberRide.destination ? <Text style={{ marginTop: 2 }}>To: {activeUberRide.destination}</Text> : null}
                <View style={{ marginTop: 10 }}>
                  <Action
                    label={sending ? "Sending..." : "🚀 Auto-Send Uber Details to Family"}
                    loading={sending}
                    onPress={() => void autoShareUberRideWithFamily()}
                  />
                </View>
              </View>
            )}
          </>
        )}
      </Card>

      {/* ─── MANUAL / EDIT RIDE DETAILS ─── */}
      <Card>
        <Text style={styles.h3}>Ride and driver details</Text>
        <Text style={[styles.caption, { marginTop: 6 }]}>
          All ride details are sent automatically to your contacts via server SMS when online.
        </Text>
        <TextInput style={styles.input} placeholder="Ride service (e.g. Uber, Ola, Rapido)" value={service} onChangeText={setService} />
        <TextInput style={styles.input} placeholder="Driver name" value={driverName} onChangeText={setDriverName} />
        <TextInput style={styles.input} placeholder="Driver phone (optional)" value={driverPhone} onChangeText={setDriverPhone} keyboardType="phone-pad" />
        <TextInput style={styles.input} placeholder="Vehicle make/model (e.g. Maruti Dzire White)" value={vehicle} onChangeText={setVehicle} />
        <TextInput style={styles.input} placeholder="License plate / registration (e.g. DL 01 AB 1234)" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
        <TextInput style={styles.input} placeholder="Trip reference (optional)" value={tripReference} onChangeText={setTripReference} />
        <TextInput style={styles.input} placeholder="Destination (optional)" value={destination} onChangeText={setDestination} />
        <Divider />
        <Text style={styles.h3}>Trusted recipients</Text>
        {contactWarning ? <Text style={[styles.caption, { marginTop: 6 }]}>{contactWarning}</Text> : null}
        {loading ? (
          <Text style={[styles.caption, { marginTop: 8 }]}>Loading saved contacts…</Text>
        ) : contacts.filter((contact) => Boolean(contact.phone)).length === 0 ? (
          <Action label="Add a trusted contact" secondary onPress={() => router.push("/contacts" as never)} />
        ) : (
          contacts.filter((contact) => Boolean(contact.phone)).map((contact) => (
            <Text key={contact.id} style={[styles.subtitle, { marginTop: 8 }]}>
              {contact.name} · {contact.phone}
            </Text>
          ))
        )}
        <Action
          label={sending ? "Sharing ride details automatically…" : "Notify my trusted contacts (Automated)"}
          loading={sending}
          disabled={loading || !contacts.some((contact) => contact.phone)}
          onPress={() => void notifyContacts()}
        />
      </Card>

      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
