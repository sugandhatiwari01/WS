import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Action } from "@/components/ui";
import { uploadPhoto } from "@/lib/api";
import { colors, styles } from "@/lib/theme";

/** How often a photo is taken while the SOS is active. */
export const PHOTO_INTERVAL_MS = 20_000;
/** Stops after this many photos so a long SOS doesn't fill storage or burn mobile data. */
const MAX_PHOTOS = 30;

/**
 * Visible camera preview shown on the active SOS card. While mounted it takes a
 * photo every PHOTO_INTERVAL_MS and uploads it to the incident, where police and
 * linked family can see it. The preview stays on screen, so the camera is never
 * used without the person seeing it.
 */
export default function SosEvidenceCamera({ emergencyId }: { emergencyId: string }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>("back");
  const [sent, setSent] = useState(0);
  const [status, setStatus] = useState("Starting camera…");
  const busy = useRef(false);
  const sentRef = useRef(0);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const capture = useCallback(async () => {
    if (busy.current || !cameraRef.current || sentRef.current >= MAX_PHOTOS) return;
    busy.current = true;
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.4, shutterSound: false });
      if (!picture?.uri) return;
      const result = await uploadPhoto(`/api/emergencies/${emergencyId}/photos`, picture.uri);
      if (result.error) {
        setStatus(`Last photo not sent: ${result.error}`);
      } else {
        sentRef.current += 1;
        setSent(sentRef.current);
        setStatus(
          sentRef.current >= MAX_PHOTOS
            ? `Photo limit reached (${MAX_PHOTOS}).`
            : `Last photo sent at ${new Date().toLocaleTimeString()}`
        );
      }
    } catch (error) {
      setStatus(`Photo failed: ${error instanceof Error ? error.message : "camera error"}`);
    } finally {
      busy.current = false;
    }
  }, [emergencyId]);

  useEffect(() => {
    if (!ready) return;
    const first = setTimeout(() => void capture(), 1500);
    const timer = setInterval(() => void capture(), PHOTO_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ready, capture]);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={styles.caption}>Camera permission is off, so no photos are being sent.</Text>
        {permission.canAskAgain ? (
          <Action label="📷 Allow camera for SOS photos" secondary onPress={() => void requestPermission()} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <View style={{ width: 96, height: 128, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing={facing}
            animateShutter={false}
            onCameraReady={() => setReady(true)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h3, { color: colors.red }]}>📷 Photo evidence · {sent} sent</Text>
          <Text style={[styles.caption, { marginTop: 4 }]}>
            A photo is taken every {PHOTO_INTERVAL_MS / 1000}s and shared with police and your linked family.
          </Text>
          <Text style={[styles.caption, { marginTop: 4 }]}>{status}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
            style={{ marginTop: 6 }}
          >
            <Text style={{ color: colors.red, fontWeight: "700" }}>↺ Use {facing === "back" ? "front" : "back"} camera</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
