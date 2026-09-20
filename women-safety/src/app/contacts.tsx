import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput } from "react-native";
import { Action, Card, Header } from "@/components/ui";
import { Contact, getContacts, saveContacts } from "@/lib/storage";
import { api, post } from "@/lib/api";
import { styles } from "@/lib/theme";

export default function ContactsScreen() {
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<{ _id: string; name: string; email: string; phone?: string } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    getContacts().then(setContacts);
    api<{ _id: string; name: string; phone?: string; email?: string }[]>("/api/contacts").then(async (result) => {
      if (result.data) {
        const synced = result.data.map((item) => ({ id: item._id, name: item.name, phone: item.phone, email: item.email }));
        await saveContacts(synced);
        setContacts(synced);
      }
    });
  }, []);

  const searchUser = async () => {
    if (!email.trim().includes("@")) return Alert.alert("Enter an email", "Search using the exact email used to register.");
    setSearching(true);
    const result = await api<{ _id: string; name: string; email: string; phone?: string }>(`/api/contacts/search?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    setSearching(false);
    if (result.data) setFoundUser(result.data);
    else Alert.alert("User not found", result.error === "REGISTERED_USER_NOT_FOUND" ? "No active USER account uses that email." : result.error || "Unable to search right now.");
  };

  const addContact = async () => {
    if (!foundUser) return;
    const result = await post<{ _id: string; name: string; email: string; phone?: string }>("/api/contacts", { email: foundUser.email, relationship: relationship.trim() || undefined }, true);
    if (result.data) {
      const next = [...contacts, { id: result.data._id, name: result.data.name, phone: result.data.phone, email: result.data.email }];
      await saveContacts(next);
      setContacts(next);
      setFoundUser(null);
      setEmail("");
      setRelationship("");
    } else if (!result.offline) Alert.alert("Could not add contact", result.error || "The user could not be added.");
    setEmail("");
  };

  const removeContact = (contact: Contact) => Alert.alert("Remove contact?", `Remove ${contact.name} from your safety network?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: async () => {
      const next = contacts.filter((item) => item.id !== contact.id);
      await saveContacts(next);
      setContacts(next);
      if (/^[a-f\d]{24}$/i.test(contact.id)) {
        const result = await api(`/api/contacts/${contact.id}`, { method: "DELETE" });
        if (result.error) Alert.alert("Contact removed locally", result.error);
      }
    } },
  ]);

  return <ScrollView style={styles.safe} contentContainerStyle={styles.container}>
    <Header title="Trusted contacts" subtitle="People who can be contacted when you need help." />
    <Card>
      <Text style={styles.subtitle}>Search for another registered USER by their unique email, then add them.</Text>
      <TextInput style={styles.input} placeholder="Registered user's email" value={email} onChangeText={(value) => { setEmail(value); setFoundUser(null); }} autoCapitalize="none" keyboardType="email-address" />
      <Action label={searching ? "Searching..." : "Search user"} onPress={searchUser} />
      {foundUser ? <><Text style={{ fontWeight: "800", fontSize: 17 }}>{foundUser.name}</Text><Text style={styles.subtitle}>{foundUser.email}</Text><TextInput style={styles.input} placeholder="Relationship (optional)" value={relationship} onChangeText={setRelationship} /><Action label="Add as trusted contact" onPress={addContact} /></> : null}
    </Card>
    {contacts.length === 0 ? <Card><Text style={styles.subtitle}>No trusted contacts yet. Add someone you trust above.</Text></Card> :
      contacts.map((contact) => <Card key={contact.id}>
        <Text style={{ fontWeight: "800", fontSize: 17 }}>{contact.name}</Text>
        <Text style={styles.subtitle}>{contact.email || contact.phone}</Text>
        <Pressable onPress={() => removeContact(contact)}><Text style={{ color: "#D92D20", fontWeight: "700", marginTop: 12 }}>Remove</Text></Pressable>
      </Card>)}
    <Action label="Back to settings" secondary onPress={() => router.back()} />
  </ScrollView>;
}
