/**
 * Gesture triggers screen
 *
 * Explains and configures hardware gesture-based SOS triggers.
 * Currently provides:
 *  - Volume button info (platform-specific)
 *  - Shake-to-SOS explanation
 *  - Screen-lock audio recording tip
 */

import { router } from "expo-router";
import { Linking, ScrollView, Text, View } from "react-native";
import { Action, Card, Divider, Header } from "@/components/ui";
import { styles } from "@/lib/theme";

type Step = { icon: string; title: string; detail: string };

function StepCard({ steps }: { steps: Step[] }) {
  return (
    <Card>
      {steps.map((step, i) => (
        <View key={i}>
          {i > 0 && <Divider />}
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <Text style={{ fontSize: 24 }}>{step.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.h3}>{step.title}</Text>
              <Text style={[styles.subtitle, { marginTop: 4 }]}>{step.detail}</Text>
            </View>
          </View>
        </View>
      ))}
    </Card>
  );
}

export default function GestureScreen() {
  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Gesture triggers"
        subtitle="Learn how to trigger SOS without looking at your phone."
      />

      {/* Shake */}
      <Text style={[styles.h2, { marginBottom: 10 }]}>📳 Shake to SOS</Text>
      <StepCard
        steps={[
          {
            icon: "1️⃣",
            title: "Make sure shake is enabled",
            detail: "Go to Settings, open SOS preferences, and turn on Shake-to-SOS.",
          },
          {
            icon: "2️⃣",
            title: "Shake your phone hard",
            detail:
              "A sharp, forceful shake starts a 3-second countdown.",
          },
          {
            icon: "3️⃣",
            title: "Countdown fires automatically",
            detail:
              "If you do not cancel within 3 seconds, SafeHer attempts to send SOS to its server. It does not call emergency services.",
          },
          {
            icon: "✅",
            title: "Tip: practice with shake",
            detail:
              "Try shaking firmly once to see the countdown. Tap CANCEL immediately to dismiss.",
          },
        ]}
      />

      <Divider />

      {/* Power button / volume */}
      <Text style={[styles.h2, { marginTop: 16, marginBottom: 10 }]}>📱 Power & volume button SOS</Text>
      <Card>
        <Text style={styles.h3}>Android</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Many Android phones have a built-in emergency SOS triggered by pressing the power button 5 times
          quickly. This is separate from the SafeHer app — it calls your local emergency number directly.
        </Text>
        <Text style={[styles.h3, { marginTop: 14 }]}>Enable it:</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Settings → Safety & Emergency → Emergency SOS → turn on Use Emergency SOS.
          (Location may vary by phone brand.)
        </Text>
        <Action
          label="Open phone Settings"
          secondary
          onPress={() => Linking.openSettings()}
        />
      </Card>

      <Card>
        <Text style={styles.h3}>Samsung One UI</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Settings → Safety and emergency → Send SOS messages → toggle on. Then press the
          side button 3 times quickly to send an SOS with location to your emergency contacts.
        </Text>
      </Card>

      <Divider />

      {/* Audio recording */}
      <Text style={[styles.h2, { marginTop: 16, marginBottom: 10 }]}>🎙 Background audio recording</Text>
      <Card>
        <Text style={styles.h3}>During an active SOS</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          While SOS is active, tap Record audio evidence on the home screen. Stop the recording
          to upload it to the incident when the server is available. Verify your deployment&apos;s
          storage and access controls before relying on uploaded recordings.
        </Text>
        <Text style={[styles.h3, { marginTop: 14 }]}>Important</Text>
        <Text style={[styles.subtitle, { marginTop: 6 }]}>
          Recording behavior varies by platform and app state. Do not rely on background recording
          without testing a production-like build on the target device.
        </Text>
      </Card>

      <Divider />

      {/* Fake call tip */}
      <Text style={[styles.h2, { marginTop: 16, marginBottom: 10 }]}>📞 Fake call tactic</Text>
      <Card>
        <Text style={styles.subtitle}>
          The optional incoming-call feature requests a call through a configured voice provider.
          It may not arrive, and it is not an emergency-response service. Use your judgment and call
          emergency services directly when needed.
        </Text>
      </Card>

      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
