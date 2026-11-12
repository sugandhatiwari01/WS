import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SosProvider } from "@/hooks/useSos";

function SessionProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <SosProvider key={user?._id ?? "signed-out"}>{children}</SosProvider>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SessionProviders>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProviders>
    </AuthProvider>
  );
}
