import AsyncStorage from "@react-native-async-storage/async-storage";

export type Contact = { id: string; name: string; phone?: string; email?: string };
export type SafetyAlert = {
  id: string;
  type: "sos" | "timer";
  status: "active" | "resolved";
  createdAt: string;
  location?: string;
};

const CONTACTS_KEY = "women-safety-contacts";
const ALERTS_KEY = "women-safety-alerts";

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function write<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const getContacts = () => read<Contact[]>(CONTACTS_KEY, []);
export const saveContacts = (contacts: Contact[]) => write(CONTACTS_KEY, contacts);
export const getAlerts = () => read<SafetyAlert[]>(ALERTS_KEY, []);
export const saveAlerts = (alerts: SafetyAlert[]) => write(ALERTS_KEY, alerts);

export async function createAlert(type: SafetyAlert["type"], location?: string) {
  const alert: SafetyAlert = {
    id: `${Date.now()}`,
    type,
    status: "active",
    createdAt: new Date().toISOString(),
    location,
  };
  const alerts = await getAlerts();
  await saveAlerts([alert, ...alerts]);
  return alert;
}

export async function resolveAlert(id: string) {
  const alerts = await getAlerts();
  await saveAlerts(alerts.map((alert) => alert.id === id ? { ...alert, status: "resolved" } : alert));
}
