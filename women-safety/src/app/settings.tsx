/**
 * Settings screen
 *
 * Sections:
 *  - Profile (name, email, phone)
 *  - SOS preferences (shake sensitivity)
 *  - Trusted contacts
 *  - Emergency quick-dial
 *  - Fake call test
 *  - Sign out
 */

import { router } from "expo-router";
import { useState } from "react";
import { Alert, Linking, ScrollView, Switch, Text, View } from "react-native";
import { Action, Card, Divider, Header } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useSos } from "@/hooks/useSos";
import { post } from "@/lib/api";
import FakeCallModal from "@/components/fake-call-modal";
import { colors, styles } from "@/lib/theme";

export default function Settings() {
  const { user, signOut } = useAuth();
  const { shakeEnabled, updateShakeEnabled } = useSos();
  const [fakeCalling, setFakeCalling] = useState(false);
  const [fakeCallModalVisible, setFakeCallModalVisible] = useState(false);

  const openUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error("Action not supported on this device.");
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert("Action unavailable", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const triggerFakeCall = async () => {
    setFakeCalling(true);
    try {
      void post("/api/notify/fake-call", {});
      Alert.alert(
        "Incoming Call Scheduled",
        "Your phone will ring in 3 seconds. Use this call to step away safely.",
        [{ text: "OK" }]
      );
      setTimeout(() => {
        setFakeCallModalVisible(true);
      }, 3000);
    } catch (_) {
      setFakeCallModalVisible(true);
    } finally {
      setFakeCalling(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header title="Settings" subtitle="Manage your profile and safety preferences." />

      {/* Profile */}
      <Card>
        <Text style={styles.h3}>👤 My profile</Text>
        <Divider />
        <Text style={styles.caption}>Name</Text>
        <Text style={[styles.h3, { marginTop: 2 }]}>{user?.name}</Text>
        <Text style={[styles.caption, { marginTop: 10 }]}>Email</Text>
        <Text style={[styles.subtitle, { marginTop: 2 }]}>{user?.email}</Text>
        {user?.phone && (
          <>
            <Text style={[styles.caption, { marginTop: 10 }]}>Phone</Text>
            <Text style={[styles.subtitle, { marginTop: 2 }]}>{user.phone}</Text>
          </>
        )}
      </Card>

      {/* SOS Preferences */}
      <Card>
        <Text style={styles.h3}>🛡️ SOS preferences</Text>
        <Divider />
        <View style={[styles.spaceBetween, { marginTop: 4 }]}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={styles.h3}>Shake-to-SOS</Text>
            <Text style={styles.caption}>
              Shake your phone hard to start the SOS countdown automatically. Your preference is saved on this device.
            </Text>
          </View>
          <Switch
            value={shakeEnabled}
            onValueChange={(enabled) => void updateShakeEnabled(enabled)}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>
      </Card>

      {/* Trusted contacts */}
      <Card>
        <Text style={styles.h3}>👥 Trusted contacts</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Add family and friends who may receive alerts. SMS requires server setup and delivery is not guaranteed.
        </Text>
        <Action label="Manage trusted contacts" onPress={() => router.push("/contacts" as never)} />
      </Card>

      {/* Emergency services */}
      <Card>
        <Text style={styles.h3}>📞 Emergency services</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>Quick-dial in an emergency.</Text>
        <Divider />
        <Action label="Call 112 — Emergency" danger onPress={() => openUrl("tel:112")} />
        <Action label="Call 100 — Police" secondary onPress={() => openUrl("tel:100")} />
        <Action label="Call 108 — Ambulance" secondary onPress={() => openUrl("tel:108")} />
        <Action label="Call 1091 — Women helpline" secondary onPress={() => openUrl("tel:1091")} />
      </Card>

      {/* Fake call */}
      <Card>
        <Text style={styles.h3}>📱 Fake incoming call</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Simulate an incoming phone call to give you a natural excuse to exit uncomfortable or threatening situations.
        </Text>
        <Action
          label={fakeCalling ? "Scheduling call..." : "Test fake call"}
          secondary
          loading={fakeCalling}
          onPress={triggerFakeCall}
        />
      </Card>

      {/* More screens */}
      <Card>
        <Text style={styles.h3}>📋 More</Text>
        <Action label="Alert history" secondary onPress={() => router.push("/history" as never)} />
        <Action label="Gesture triggers" secondary onPress={() => router.push("/gesture" as never)} />
      </Card>

      <Action label="Sign out" danger onPress={confirmSignOut} />
      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 40 }} />

      <FakeCallModal
        visible={fakeCallModalVisible}
        callerName="Mom"
        onDismiss={() => setFakeCallModalVisible(false)}
      />
    </ScrollView>
  );
}
