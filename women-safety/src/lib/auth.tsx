import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { post, setToken } from "@/lib/api";

export type Role = "user" | "family" | "police";
export type User = { _id?: string; name: string; email: string; role: Role; phone?: string };
type AuthResponse = { user: User; token: string };
type Auth = {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};
const Ctx = createContext<Auth | null>(null);
const USER_KEY = "women-safety-user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(USER_KEY), AsyncStorage.getItem("women-safety-token")])
      .then(([value, token]) => { if (value && token) setUser(JSON.parse(value)); })
      .finally(() => setLoading(false));
  }, []);
  const authenticate = async (result: ReturnType<typeof post<AuthResponse>>) => {
    const response = await result;
    if (!response.data || !response.data.token || !response.data.user) {
      throw new Error(response.error || "Authentication failed.");
    }
    await setToken(response.data.token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
    setUser(response.data.user);
  };
  const value = useMemo<Auth>(() => ({
    user, loading, error,
    login: async (email, password) => {
      try { setError(null); await authenticate(post<AuthResponse>("/api/auth/login", { email, password })); }
      catch (e) { const message = e instanceof Error ? e.message : "Unable to sign in."; setError(message); throw e; }
    },
    register: async (name, email, password, phone) => {
      try { setError(null); await authenticate(post<AuthResponse>("/api/auth/register", { name, email, password, phone })); }
      catch (e) { const message = e instanceof Error ? e.message : "Unable to create account."; setError(message); throw e; }
    },
    signOut: async () => { setUser(null); await setToken(null); await AsyncStorage.removeItem(USER_KEY); },
    clearError: () => setError(null),
  }), [user, loading, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() { const value = useContext(Ctx); if (!value) throw new Error("AuthProvider missing"); return value; }
