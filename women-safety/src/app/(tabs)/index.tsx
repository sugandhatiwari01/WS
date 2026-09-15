import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Linking,
} from "react-native";
import { Accelerometer } from "expo-sensors";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as SMS from "expo-sms";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function HomeScreen() {
  const [shakeEnabled, setShakeEnabled] = useState(false);
  const router = useRouter();
  // SHAKE
  const shakeCount = useRef(0);
  const firstShakeTime = useRef(0);

  // SAFETY CHECK
  const [safetyCheckActive, setSafetyCheckActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState(5);
  const [emergencyLocation, setEmergencyLocation] = useState("");
  const [discreetMode, setDiscreetMode] = useState(false);
  const [silentSOS, setSilentSOS] = useState(false);

  const callPrimaryContact = async () => {
    try {
      const savedContacts = await AsyncStorage.getItem(
        "safeher_trusted_contacts"
      );

      const contacts = savedContacts
        ? JSON.parse(savedContacts)
        : [];

      if (contacts.length === 0) {
        console.log("❌ No trusted contacts found");
        return;
      }

      const primaryContact = contacts[0];

      const phoneNumber = primaryContact.phone.replace(/\s/g, "");

      const supported = await Linking.canOpenURL(
        `tel:${phoneNumber}`
      );

      if (!supported) {
        console.log("❌ Phone calls are not supported");
        return;
      }

      console.log(
        `📞 Calling ${primaryContact.name}: ${phoneNumber}`
      );

      await Linking.openURL(`tel:${phoneNumber}`);
    } catch (error) {
      console.log("❌ Call error:", error);
    }
  };
  const handleSOS = async () => {
    console.log(
      silentSOS
        ? "🔇 SILENT SOS TRIGGERED"
        : "🚨 SOS TRIGGERED"
    );

    // existing code...

    try {
      // 1. Get location
      const { status } =
        await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        console.log("❌ Location permission denied");
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;

      const mapsLink =
        `https://www.google.com/maps?q=${latitude},${longitude}`;

      console.log("📍 LOCATION:", mapsLink);

      setEmergencyLocation(mapsLink);

      // 2. Load trusted contacts
      const savedContacts =
        await AsyncStorage.getItem(
          "safeher_trusted_contacts"
        );

      const contacts = savedContacts
        ? JSON.parse(savedContacts)
        : [];

      if (contacts.length === 0) {
        console.log("❌ No trusted contacts found");
        return;
      }

      // 3. Primary contact = first contact
      const primaryContact = contacts[0];

      const phoneNumber =
        primaryContact.phone.replace(/\s/g, "");

      console.log(
        `📞 Calling ${primaryContact.name}: ${phoneNumber}`
      );

      // 3.5 Send SMS via Fast2SMS (via your backend, not client-side)
      // 3.5 Send SMS via Fast2SMS (direct call, like Edesy)
      try {
        const cleanNumber = phoneNumber.replace("+91", "").replace("+", "");
        const smsUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=eoCQS65txTb8riNKvRMPZyfVB7hJ2Gj1DwLYOWnIscmqFzEXU4b8RzPsDGZqFjQwN1TvfHMViY6BC3ye&route=q&message=${encodeURIComponent(`🚨 SOS from SafeHer user. Location: ${mapsLink}`)}&language=english&flash=0&numbers=${cleanNumber}`;

        const smsRes = await fetch(smsUrl, { method: "GET" });
        const smsData = await smsRes.json();
        console.log("📩 Fast2SMS response:", smsData);
      } catch (smsError) {
        console.log("❌ SMS failed:", smsError);
      }


      // 4. Automatically open call

      // 4. Automatically open call
      // 4. Trigger Edesy AI call
      // 4. Trigger Edesy AI call directly (no backend)
      try {
        const callRes = await fetch("https://voice-agent.edesy.in/api/v1/calls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer vp_live_d406b6baad6928caadf02364540d4662c627e9254bd33ce34354c713c0448672",
          },
          body: JSON.stringify({
            agentId: 46363,
            phoneNumber: phoneNumber,
          }),
        });
        const callData = await callRes.json();
        console.log("📞 Edesy call response:", callData);
      } catch (callError) {
        console.log("❌ Edesy call failed:", callError);
      }

      // 5. Also open native dialer as backup


    } catch (error) {
      console.log("❌ SOS error:", error);
    }
  };
  // -------------------------
  // SHAKE DETECTION
  // -------------------------

  useEffect(() => {
    if (!shakeEnabled) {
      return;
    }

    Accelerometer.setUpdateInterval(100);

    let canDetectShake = true;

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(
        x * x +
        y * y +
        z * z
      );

      const now = Date.now();

      // Reset if sequence takes too long
      if (
        shakeCount.current > 0 &&
        now - firstShakeTime.current > 3000
      ) {
        shakeCount.current = 0;
        firstShakeTime.current = 0;

        console.log("Shake sequence reset");
      }

      // SHAKE START
      if (magnitude > 1.5 && canDetectShake) {
        canDetectShake = false;

        // First shake
        if (shakeCount.current === 0) {
          shakeCount.current = 1;
          firstShakeTime.current = now;

          console.log("Shake 1");
        }

        // Second / third shake
        else {
          shakeCount.current++;

          console.log(
            `Shake ${shakeCount.current}`
          );
        }

        // THREE SHAKES
        if (shakeCount.current === 3) {
          console.log(
            "🚨 THREE SHAKES DETECTED"
          );

          handleSOS();

          shakeCount.current = 0;
          firstShakeTime.current = 0;
        }
      }

      // SHAKE ENDED
      if (magnitude < 1.2) {
        canDetectShake = true;
      }
    });

    return () => {
      subscription.remove();

      shakeCount.current = 0;
      firstShakeTime.current = 0;
    };
  }, [shakeEnabled]);

  // -------------------------
  // SAFETY CHECK TIMER
  // -------------------------

  useEffect(() => {
    if (!safetyCheckActive) {
      return;
    }

    if (timeLeft <= 0) {
      console.log("⏰ SAFETY CHECK TIMEOUT");

      setSafetyCheckActive(false);

      handleSOS();

      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft(previous => previous - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [safetyCheckActive, timeLeft]);

  // -------------------------
  // START SAFETY CHECK
  // -------------------------

  const startSafetyCheck = () => {
    console.log(
      `🛡️ SAFETY CHECK STARTED: ${selectedDuration} minutes`
    );

    setTimeLeft(selectedDuration * 60);
    setSafetyCheckActive(true);
  };

  // -------------------------
  // USER IS SAFE
  // -------------------------

  const confirmSafe = () => {
    console.log("✅ USER CONFIRMED SAFE");

    setSafetyCheckActive(false);
    setTimeLeft(0);
  };
  if (
    (discreetMode || silentSOS) &&
    emergencyLocation !== ""
  ) {
    return (
      <View style={styles.calculatorScreen}>
        <Text style={styles.calculatorTitle}>
          Calculator
        </Text>

        <View style={styles.calculatorDisplay}>
          <Text style={styles.calculatorNumber}>
            0
          </Text>
        </View>

        <View style={styles.calculatorButtons}>
          {[
            "7", "8", "9", "÷",
            "4", "5", "6", "×",
            "1", "2", "3", "-",
            "0", ".", "=", "+"
          ].map((item) => (
            <View
              key={item}
              style={styles.calculatorButton}
            >
              <Text style={styles.calculatorButtonText}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  return (

    <ScrollView

      contentContainerStyle={styles.container}
    >

      <Text style={styles.title}>
        SAFEHER
      </Text>

      <Text style={styles.subtitle}>
        Your safety, always.
      </Text>

      {/* SOS BUTTON */}

      <Pressable
        style={styles.sosButton}
        onPress={() => {
          console.log("BUTTON PRESSED");
          handleSOS();
        }}
      >
        <Text style={styles.sosText}>
          SOS
        </Text>
      </Pressable>

      <Text style={styles.instruction}>
        Press in an emergency
      </Text>

      {/* SHAKE */}

      <Pressable
        style={styles.shakeButton}
        onPress={() => {
          setShakeEnabled(
            previous => !previous
          );
        }}
      >
        <Text style={styles.shakeText}>
          {shakeEnabled
            ? "🟢 Shake SOS: ON"
            : "⚪ Shake SOS: OFF"}
        </Text>
      </Pressable>
      <View style={styles.optionRow}>
        <Text style={styles.optionText}>
          🔇 Silent SOS
        </Text>

        <Pressable
          style={[
            styles.toggle,
            silentSOS && styles.toggleActive,
          ]}
          onPress={() => setSilentSOS(previous => !previous)}
        >
          <Text style={styles.toggleText}>
            {silentSOS ? "ON" : "OFF"}
          </Text>
        </Pressable>
      </View>
      <Pressable
        style={styles.contactsButton}
        onPress={() => router.push("/contacts")}
      >
        <Text style={styles.contactsText}>
          👥 Trusted Contacts
        </Text>
      </Pressable>
      <Pressable
        style={styles.callButton}
        onPress={callPrimaryContact}
      >
        <Text style={styles.callText}>
          📞 CALL PRIMARY CONTACT
        </Text>
      </Pressable>
      <View style={styles.optionRow}>
        <Text style={styles.optionText}>
          🔐 Discreet Mode
        </Text>

        <Pressable
          style={[
            styles.toggle,
            discreetMode && styles.toggleActive,
          ]}
          onPress={() => setDiscreetMode(!discreetMode)}
        >
          <Text style={styles.toggleText}>
            {discreetMode ? "ON" : "OFF"}
          </Text>
        </Pressable>
      </View>
      {/* SAFETY CHECK */}

      {/* SAFETY CHECK */}

      {!safetyCheckActive ? (

        <View style={styles.safetySection}>

          <Text style={styles.sectionTitle}>
            🛡️ Safety Check
          </Text>

          <Text style={styles.sectionSubtitle}>
            Choose how long you want to be monitored
          </Text>

          <View style={styles.durationRow}>

            {[5, 15, 30, 60].map((minutes) => (

              <Pressable
                key={minutes}
                style={[
                  styles.durationButton,
                  selectedDuration === minutes &&
                  styles.durationButtonSelected,
                ]}
                onPress={() => setSelectedDuration(minutes)}
              >
                <Text
                  style={[
                    styles.durationText,
                    selectedDuration === minutes &&
                    styles.durationTextSelected,
                  ]}
                >
                  {minutes === 60
                    ? "1 hour"
                    : `${minutes} min`}
                </Text>
              </Pressable>

            ))}

          </View>

          <Pressable
            style={styles.startSafetyButton}
            onPress={startSafetyCheck}
          >
            <Text style={styles.startSafetyText}>
              START SAFETY CHECK
            </Text>
          </Pressable>

        </View>

      ) : (

        <View style={styles.safetyCard}>

          <Text style={styles.safetyTitle}>
            🛡️ Safety Check Active
          </Text>

          <Text style={styles.timer}>
            {Math.floor(timeLeft / 60)}:
            {String(timeLeft % 60).padStart(2, "0")}
          </Text>

          <Text style={styles.question}>
            Are you safe?
          </Text>

          <Pressable
            style={styles.safeButton}
            onPress={confirmSafe}
          >
            <Text style={styles.safeText}>
              I'M SAFE
            </Text>
          </Pressable>

        </View>

      )}
      {emergencyLocation !== "" && (
        <View style={styles.locationCard}>

          <Text style={styles.locationTitle}>
            🚨 Emergency Location
          </Text>

          <Text style={styles.locationText}>
            Your current location has been detected.
          </Text>

          <Pressable
            onPress={() => Linking.openURL(emergencyLocation)}
          >
            <Text style={styles.locationLink}>
              📍 Open location in Google Maps
            </Text>
          </Pressable>

        </View>
      )}
    </ScrollView>
  );

}


const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0D0D0D",
    alignItems: "center",
    paddingTop: 70,
    paddingBottom: 40,
    minHeight: "100%",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "white",
  },

  subtitle: {
    color: "#AAAAAA",
    fontSize: 16,
    marginTop: 8,
  },

  sosButton: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#E53935",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 65,
  },

  sosText: {
    color: "white",
    fontSize: 42,
    fontWeight: "bold",
  },

  instruction: {
    color: "#AAAAAA",
    marginTop: 18,
    fontSize: 15,
  },

  shakeButton: {
    marginTop: 25,
    paddingVertical: 14,
    paddingHorizontal: 25,
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
  },

  shakeText: {
    color: "white",
    fontSize: 16,
  },

  safetyButton: {
    marginTop: 20,
    paddingVertical: 15,
    paddingHorizontal: 25,
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
  },

  safetyText: {
    color: "white",
    fontSize: 16,
  },

  safetyCard: {
    marginTop: 20,
    width: 280,
    padding: 20,
    backgroundColor: "#1C1C1E",
    borderRadius: 15,
    alignItems: "center",
  },

  safetyTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },

  timer: {
    color: "white",
    fontSize: 42,
    fontWeight: "bold",
    marginTop: 10,
  },

  question: {
    color: "#AAAAAA",
    fontSize: 15,
    marginTop: 5,
  },

  safeButton: {
    marginTop: 15,
    backgroundColor: "#2E7D32",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
  },

  safeText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  safetySection: {
    marginTop: 25,
    width: 320,
    alignItems: "center",
  },

  sectionTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },

  sectionSubtitle: {
    color: "#AAAAAA",
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
  },

  durationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 15,
    gap: 8,
  },

  durationButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#1C1C1E",
    borderRadius: 10,
  },

  durationButtonSelected: {
    backgroundColor: "#E53935",
  },

  durationText: {
    color: "#AAAAAA",
    fontSize: 14,
  },

  durationTextSelected: {
    color: "white",
    fontWeight: "bold",
  },

  startSafetyButton: {
    marginTop: 15,
    paddingVertical: 13,
    paddingHorizontal: 22,
    backgroundColor: "#1C1C1E",
    borderRadius: 10,
  },

  startSafetyText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
  contactsButton: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 25,
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
  },

  contactsText: {
    color: "white",
    fontSize: 16,
  },
  locationCard: {
    marginTop: 25,
    width: 320,
    padding: 18,
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    alignItems: "center",
  },

  locationTitle: {
    color: "#E53935",
    fontSize: 18,
    fontWeight: "bold",
  },

  locationText: {
    color: "#AAAAAA",
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },

  locationLink: {
    color: "#64B5F6",
    fontSize: 12,
    marginTop: 10,
    textAlign: "center",
  },
  calculatorScreen: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 20,
  },

  calculatorTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: "#222",
    marginTop: 40,
  },

  calculatorDisplay: {
    height: 100,
    backgroundColor: "#fff",
    borderRadius: 12,
    marginTop: 30,
    justifyContent: "flex-end",
    alignItems: "flex-end",
    padding: 20,
  },

  calculatorNumber: {
    fontSize: 40,
    color: "#222",
  },

  calculatorButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 20,
    gap: 10,
  },

  calculatorButton: {
    width: "22%",
    height: 65,
    backgroundColor: "#ddd",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },

  calculatorButtonText: {
    fontSize: 22,
    color: "#222",
  },

  optionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 10,
  },

  optionText: {
    color: "#fff",
    fontSize: 16,
  },

  toggle: {
    backgroundColor: "#555",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
  },

  toggleActive: {
    backgroundColor: "#2e7d32",
  },

  toggleText: {
    color: "#fff",
    fontWeight: "bold",
  },
  callButton: {
    marginTop: 15,
    paddingVertical: 14,
    paddingHorizontal: 25,
    backgroundColor: "#2E7D32",
    borderRadius: 12,
  },

  callText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});