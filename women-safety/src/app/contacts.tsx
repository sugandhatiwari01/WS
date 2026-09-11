import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Contact = {
  name: string;
  phone: string;
};

const CONTACTS_KEY = "safeher_trusted_contacts";

export default function ContactsScreen() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);

  // LOAD SAVED CONTACTS
  useEffect(() => {
    const loadContacts = async () => {
      try {
        const savedContacts = await AsyncStorage.getItem(
          CONTACTS_KEY
        );

        if (savedContacts) {
          setContacts(JSON.parse(savedContacts));
        }
      } catch (error) {
        console.log("Error loading contacts:", error);
      }
    };

    loadContacts();
  }, []);

  // SAVE CONTACTS
  const saveContacts = async (newContacts: Contact[]) => {
    try {
      await AsyncStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify(newContacts)
      );

      setContacts(newContacts);
    } catch (error) {
      console.log("Error saving contacts:", error);
    }
  };

  // ADD CONTACT
  const addContact = () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert(
        "Missing information",
        "Please enter both name and phone number."
      );
      return;
    }

    const newContact = {
      name: name.trim(),
      phone: phone.trim(),
    };

    const newContacts = [
      ...contacts,
      newContact,
    ];

    saveContacts(newContacts);

    setName("");
    setPhone("");
  };

  // DELETE CONTACT
  const deleteContact = (index: number) => {
    Alert.alert(
      "Delete Contact",
      `Remove ${contacts[index].name} from trusted contacts?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const newContacts = contacts.filter(
              (_, i) => i !== index
            );

            saveContacts(newContacts);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>

      <Text style={styles.title}>
        Trusted Contacts
      </Text>

      <Text style={styles.subtitle}>
        People SAFEHER can contact during an emergency
      </Text>

      {/* ADD CONTACT */}

      <View style={styles.form}>

        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor="#777"
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Phone number"
          placeholderTextColor="#777"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />

        <Pressable
          style={styles.addButton}
          onPress={addContact}
        >
          <Text style={styles.addText}>
            + ADD CONTACT
          </Text>
        </Pressable>

      </View>

      {/* CONTACT LIST */}

      <View style={styles.list}>

        {contacts.length === 0 ? (

          <Text style={styles.empty}>
            No trusted contacts added yet.
          </Text>

        ) : (

          contacts.map((contact, index) => (

            <View
              key={index}
              style={styles.contactCard}
            >

              <View>
                <Text style={styles.contactName}>
                  {contact.name}
                </Text>

                <Text style={styles.contactPhone}>
                  📞 {contact.phone}
                </Text>
              </View>

              <Pressable
                onPress={() => deleteContact(index)}
              >
                <Text style={styles.delete}>
                  DELETE
                </Text>
              </Pressable>

            </View>

          ))

        )}

      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0D",
    paddingTop: 70,
    paddingHorizontal: 20,
  },

  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "bold",
  },

  subtitle: {
    color: "#AAAAAA",
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },

  form: {
    marginTop: 30,
  },

  input: {
    backgroundColor: "#1C1C1E",
    color: "white",
    paddingVertical: 14,
    paddingHorizontal: 15,
    borderRadius: 10,
    marginBottom: 12,
    fontSize: 16,
  },

  addButton: {
    backgroundColor: "#E53935",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },

  addText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 15,
  },

  list: {
    marginTop: 30,
  },

  empty: {
    color: "#777",
    textAlign: "center",
    marginTop: 20,
  },

  contactCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  contactName: {
    color: "white",
    fontSize: 17,
    fontWeight: "bold",
  },

  contactPhone: {
    color: "#AAAAAA",
    marginTop: 6,
    fontSize: 14,
  },

  delete: {
    color: "#E53935",
    fontSize: 12,
    fontWeight: "bold",
  },
});