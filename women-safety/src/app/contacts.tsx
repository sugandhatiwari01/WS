/**
 * Contacts screen
 *
 * Two tabs:
 *  1. Phone contacts  — name + phone number, no app required (SMS alerts)
 *  2. App contacts    — search by email to link registered SafeHer users (in-app + SMS)
 */

import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Action, Badge, Card, Divider, EmptyState, Header } from "@/components/ui";
import { Contact, getContacts, saveContacts } from "@/lib/storage";
import { api, del, post } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

type Tab = "phone" | "app";

type ServerContact = {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  type?: "phone_only" | "app_user";
  relationship?: string;
};

type FoundUser = { _id: string; name: string; email: string; phone?: string };

function TabButton({
  id,
  label,
  selected,
  onPress,
}: {
  id: Tab;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 12,
        alignItems: "center",
        borderRadius: 10,
        backgroundColor: selected ? colors.primary : "transparent",
      }}
    >
      <Text style={{ fontWeight: "700", color: selected ? colors.white : colors.muted }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ContactsScreen() {
  const [tab, setTab] = useState<Tab>("phone");

  /* ─── shared state ─────────────────────────────────────── */
  const [contacts, setContacts] = useState<Contact[]>([]);

  /* ─── phone contact form ───────────────────────────────── */
  const [phoneName, setPhoneName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneRel, setPhoneRel] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  /* ─── app contact search ───────────────────────────────── */
  const [email, setEmail] = useState("");
  const [appRel, setAppRel] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [addingApp, setAddingApp] = useState(false);
  const [loadError, setLoadError] = useState("");

  /* ─── load contacts ────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    void getContacts()
      .then((cached) => { if (active) setContacts(cached); })
      .catch(() => { if (active) setLoadError("Saved contacts could not be loaded from this device."); });
    void api<ServerContact[]>("/api/contacts")
      .then(async (result) => {
        if (!active) return;
        if (!result.data) {
          setLoadError(result.error || "Could not verify contacts with the server.");
          return;
        }
        const synced: Contact[] = result.data.map((item) => ({
          id: item._id,
          name: item.name,
          phone: item.phone,
          email: item.email,
        }));
        if (active) {
          setContacts(synced);
          setLoadError("");
        }
        await saveContacts(synced);
      })
      .catch(() => { if (active) setLoadError("Contacts could not be synced with the server."); });
    return () => { active = false; };
  }, []);

  /* ─── add phone-only contact ───────────────────────────── */
  const addPhoneContact = async () => {
    if (!phoneName.trim()) return Alert.alert("Name required", "Enter the contact's name.");
    if (!phoneNumber.trim()) return Alert.alert("Phone required", "Enter a valid phone number.");
    setSavingPhone(true);
    try {
      const result = await post<ServerContact>("/api/contacts/phone", {
        name: phoneName.trim(),
        phone: phoneNumber.trim(),
        relationship: phoneRel.trim() || undefined,
      });
      if (result.error || !result.data) {
        Alert.alert("Contact not added", result.error || "The server did not confirm the contact.");
        return;
      }
      const next: Contact[] = [...contacts, { id: result.data._id, name: result.data.name, phone: result.data.phone }];
      setContacts(next);
      try {
        await saveContacts(next);
      } catch {
        Alert.alert("Contact added", "The server saved this contact, but the local copy could not be updated.");
      }
      setPhoneName("");
      setPhoneNumber("");
      setPhoneRel("");
      Alert.alert("Contact added", `${result.data.name} is on your server contact list. SMS depends on server configuration and delivery is not guaranteed.`);
    } catch (error) {
      Alert.alert("Contact not added", error instanceof Error ? error.message : "The contact could not be saved.");
    } finally {
      setSavingPhone(false);
    }
  };

  /* ─── search app user ──────────────────────────────────── */
  const searchUser = async () => {
    if (!email.trim().includes("@")) return Alert.alert("Enter an email", "Search using the exact registered email.");
    setSearching(true);
    setFoundUser(null);
    try {
      const result = await api<FoundUser>(`/api/contacts/search?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      if (result.data) {
        setFoundUser(result.data);
      } else {
        Alert.alert(
          "User not found",
          result.error === "REGISTERED_USER_NOT_FOUND"
            ? "No active SafeHer account uses that email."
            : result.error || "Unable to search right now."
        );
      }
    } catch (error) {
      Alert.alert(
        "Search failed",
        error instanceof Error ? error.message : "Unable to search right now."
      );
    } finally {
      setSearching(false);
    }
  };

  /* ─── add app-linked contact ───────────────────────────── */
  const addAppContact = async () => {
    if (!foundUser) return;
    setAddingApp(true);
    try {
      const result = await post<ServerContact>("/api/contacts", {
        email: foundUser.email,
        relationship: appRel.trim() || undefined,
      });
      if (result.error || !result.data) {
        Alert.alert("Contact not added", result.error || "The server did not confirm the contact.");
        return;
      }
      const next: Contact[] = [...contacts, { id: result.data._id, name: result.data.name, phone: result.data.phone, email: result.data.email }];
      setContacts(next);
      try {
        await saveContacts(next);
      } catch {
        Alert.alert("Contact added", "The server saved this contact, but the local copy could not be updated.");
      }
      setFoundUser(null);
      setEmail("");
      setAppRel("");
      Alert.alert("Contact added", `${result.data.name} is linked for in-app alerts. SMS depends on server configuration and delivery is not guaranteed.`);
    } catch (error) {
      Alert.alert("Contact not added", error instanceof Error ? error.message : "The contact could not be saved.");
    } finally {
      setAddingApp(false);
    }
  };

  /* ─── remove contact ───────────────────────────────────── */
  const removeContact = (contact: Contact) => {
    Alert.alert(
      "Remove contact?",
      `Remove ${contact.name} from your safety network?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (/^[0-9a-f-]{36}$/i.test(contact.id) || /^[a-f\d]{24}$/i.test(contact.id)) {
              const result = await del(`/api/contacts/${contact.id}`);
              if (result.error) {
                Alert.alert("Contact not removed", result.error);
                return;
              }
            }
            const next = contacts.filter((c) => c.id !== contact.id);
            setContacts(next);
            try {
              await saveContacts(next);
            } catch (error) {
              Alert.alert("Contact removed", error instanceof Error ? error.message : "The local contact cache could not be updated.");
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scrollContent}>
      <Header
        title="Trusted contacts"
        subtitle="People who may receive alerts. Delivery depends on server configuration and connectivity."
      />

      {loadError ? (
        <Card danger>
          <Text style={styles.errorText}>{loadError}</Text>
          <Text style={[styles.caption, { marginTop: 6 }]}>The list below may be a saved copy from this device.</Text>
        </Card>
      ) : null}

      {/* Tab switcher */}
      <View style={{ flexDirection: "row", backgroundColor: colors.border, borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <TabButton id="phone" selected={tab === "phone"} onPress={() => setTab("phone")} label="📱 Phone contacts" />
        <TabButton id="app" selected={tab === "app"} onPress={() => setTab("app")} label="📧 App users" />
      </View>

      {/* ── PHONE CONTACTS TAB ── */}
      {tab === "phone" && (
        <>
          <Card>
            <Text style={styles.h3}>Add by phone number</Text>
            <Text style={[styles.subtitle, { marginTop: 6 }]}>
              Family or friends without the app. SMS is attempted only when the server&apos;s SMS service is configured; delivery is not guaranteed.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Name (e.g. Mom)"
              value={phoneName}
              onChangeText={setPhoneName}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone number (e.g. +919876543210)"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Relationship (optional — e.g. Mother)"
              value={phoneRel}
              onChangeText={setPhoneRel}
            />
            <Action
              label={savingPhone ? "Saving..." : "Add phone contact"}
              loading={savingPhone}
              onPress={addPhoneContact}
            />
          </Card>
        </>
      )}

      {/* ── APP USER TAB ── */}
      {tab === "app" && (
        <>
          <Card>
            <Text style={styles.h3}>Add SafeHer app user</Text>
            <Text style={[styles.subtitle, { marginTop: 6 }]}>
              Search by their registered email. In-app alerts need connectivity; SMS also requires a configured server service.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Registered email address"
              value={email}
              onChangeText={(v) => { setEmail(v); setFoundUser(null); }}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Action label={searching ? "Searching..." : "Search user"} loading={searching} onPress={searchUser} />
            {foundUser && (
              <>
                <Divider />
                <Text style={styles.h3}>{foundUser.name}</Text>
                <Text style={styles.subtitle}>{foundUser.email}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Relationship (optional)"
                  value={appRel}
                  onChangeText={setAppRel}
                />
                <Action label={addingApp ? "Adding..." : "Add as trusted contact"} loading={addingApp} onPress={addAppContact} />
              </>
            )}
          </Card>
        </>
      )}

      {/* Contact list */}
      <Text style={[styles.h3, { marginTop: 8, marginBottom: 8 }]}>
        Your safety network ({contacts.length})
      </Text>

      {contacts.length === 0 ? (
        <EmptyState message="No trusted contacts yet. Add someone above." />
      ) : (
        contacts.map((contact) => (
          <Card key={contact.id}>
            <View style={styles.spaceBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.h3}>{contact.name}</Text>
                <Text style={styles.subtitle}>{contact.email || contact.phone}</Text>
                <View style={{ marginTop: 6 }}>
                  <Badge
                    label={contact.email ? "In-app alerts" : "SMS (if configured)"}
                    variant={contact.email ? "success" : "info"}
                  />
                </View>
              </View>
              <Pressable onPress={() => removeContact(contact)} style={{ padding: 8 }}>
                <Text style={styles.errorText}>Remove</Text>
              </Pressable>
            </View>
          </Card>
        ))
      )}

      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
