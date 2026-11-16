import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router } from "expo-router";
import { Action, Badge, Card, Divider, EmptyState, Header } from "@/components/ui";
import { api, post, uploadPhoto } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/hooks/useSocket";
import { BadgeVariant, colors, styles as themeStyles } from "@/lib/theme";

const CRIME_CATEGORIES = [
  { id: "Harassment", label: "🚨 Harassment / Eve Teasing", priority: "HIGH" },
  { id: "Stalking", label: "👁️ Stalking / Being Followed", priority: "HIGH" },
  { id: "Assault", label: "🥊 Physical Assault / Threat", priority: "HIGH" },
  { id: "Suspicious Activity", label: "⚠️ Suspicious Person / Activity", priority: "MEDIUM" },
  { id: "Domestic Violence", label: "🏠 Domestic Violence / Abuse", priority: "HIGH" },
  { id: "Theft", label: "👜 Snatching / Theft", priority: "MEDIUM" },
  { id: "Other", label: "❓ Other Incident", priority: "LOW" },
];

type CrimeReportItem = {
  _id: string;
  reportId?: string;
  crimeType: string;
  description: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  photoUrl?: string;
  priority?: string;
  status?: "SUBMITTED" | "INVESTIGATING" | "ACTION_TAKEN" | "CLOSED";
  createdAt?: string;
  officerName?: string;
  policeNotes?: string;
  nearestStationName?: string;
  stationDistanceKm?: number;
};

function statusBadgeVariant(status?: string): BadgeVariant {
  if (status === "SUBMITTED") return "warning";
  if (status === "INVESTIGATING") return "info";
  if (status === "ACTION_TAKEN") return "warning";
  if (status === "CLOSED") return "success";
  return "neutral";
}

function elapsedSince(isoDate?: string): string {
  if (!isoDate) return "just now";
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function ReportCrimeScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"new" | "history">("new");

  // Form State
  const [selectedCategory, setSelectedCategory] = useState<string>("Harassment");
  const [description, setDescription] = useState("");
  const [addressLandmark, setAddressLandmark] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [priority, setPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("HIGH");
  const [submitting, setSubmitting] = useState(false);

  // Location State
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);

  // History State
  const [myReports, setMyReports] = useState<CrimeReportItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Real-time socket listener for status updates
  useSocket({
    userId: user?._id,
    onEvent: (event, data) => {
      if (event === "crime:updated") {
        const updated = data as CrimeReportItem;
        setMyReports((prev) =>
          prev.map((r) => (r._id === updated._id || r.reportId === updated.reportId ? updated : r))
        );
      }
    },
  });

  const fetchLocation = useCallback(async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "Please grant location access to tag the crime scene coordinates.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch (e) {
      console.warn("Could not fetch location:", e);
    } finally {
      setLocating(false);
    }
  }, []);

  const loadMyReports = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const result = await api<CrimeReportItem[]>("/api/police/reports/my");
      if (result.data) {
        setMyReports(result.data);
      }
    } catch (_) {
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void fetchLocation();
    void loadMyReports();
  }, [fetchLocation, loadMyReports]);

  // Photo Capture
  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera permission", "Camera access is needed to capture proof of crime.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (e) {
      Alert.alert("Camera error", e instanceof Error ? e.message : "Could not open camera.");
    }
  };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Photo library permission", "Access is needed to choose an image evidence proof.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (e) {
      Alert.alert("Photo library error", e instanceof Error ? e.message : "Could not select photo.");
    }
  };

  // Submit report directly to police
  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert("Details required", "Please describe what happened so police can take appropriate action.");
      return;
    }

    setSubmitting(true);
    try {
      let uploadedPhotoUrl: string | undefined = undefined;
      let storageRef: string | undefined = undefined;

      // 1. Upload photo proof if attached
      if (photoUri) {
        const uploadRes = await uploadPhoto<{ photoUrl?: string; storageReference?: string }>(
          "/api/police/reports/upload",
          photoUri
        );
        if (uploadRes.data?.photoUrl) {
          uploadedPhotoUrl = uploadRes.data.photoUrl;
          storageRef = uploadRes.data.storageReference;
        }
      }

      // 2. Submit report body to Police endpoint
      const reportRes = await post<CrimeReportItem>("/api/police/reports", {
        crimeType: selectedCategory,
        description: description.trim(),
        latitude: currentCoords?.latitude,
        longitude: currentCoords?.longitude,
        address: addressLandmark.trim() || undefined,
        photoUrl: uploadedPhotoUrl,
        storageReference: storageRef,
        priority,
      });

      if (reportRes.error || !reportRes.data) {
        Alert.alert("Submission failed", reportRes.error || "Could not deliver report to police.");
        return;
      }

      const report = reportRes.data;
      Alert.alert(
        "Report Transmitted to Police",
        `Reference ID: ${report.reportId || report._id}\n\nYour confidential report and proof have been securely dispatched to the Police Dashboard. You will receive real-time updates as officers investigate.`,
        [{ text: "View Report Status", onPress: () => setActiveTab("history") }]
      );

      // Reset form
      setDescription("");
      setAddressLandmark("");
      setPhotoUri(null);
      void loadMyReports();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "An error occurred while submitting.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={themeStyles.safe} contentContainerStyle={themeStyles.scrollContent}>
      <Header
        title="Report a Crime"
        subtitle="Confidential in-app reporting directly to law enforcement. Your contacts will NOT be notified."
      />

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === "new" && styles.tabButtonActive]}
          onPress={() => setActiveTab("new")}
        >
          <Text style={[styles.tabButtonText, activeTab === "new" && styles.tabButtonTextActive]}>
            📝 File Report
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === "history" && styles.tabButtonActive]}
          onPress={() => {
            setActiveTab("history");
            void loadMyReports();
          }}
        >
          <Text style={[styles.tabButtonText, activeTab === "history" && styles.tabButtonTextActive]}>
            📋 My Reports ({myReports.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "new" ? (
        <>
          {/* Security & Confidentiality Banner */}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 22 }}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={[themeStyles.h3, { color: colors.ink }]}>Direct Police Channel Only</Text>
                <Text style={[themeStyles.caption, { marginTop: 2 }]}>
                  This evidence and report are transmitted strictly to the Police Dashboard. It is never
                  shared with your family, friends, or trusted contacts.
                </Text>
              </View>
            </View>
          </Card>

          {/* 1. Category Selection */}
          <Card>
            <Text style={themeStyles.h3}>1. Select Incident Type</Text>
            <Text style={[themeStyles.caption, { marginTop: 4, marginBottom: 10 }]}>
              Choose the category that best matches what you witnessed or experienced.
            </Text>
            <View style={styles.categoriesGrid}>
              {CRIME_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.categoryPill, isSelected && styles.categoryPillActive]}
                    onPress={() => {
                      setSelectedCategory(cat.id);
                      setPriority(cat.priority as "HIGH" | "MEDIUM" | "LOW");
                    }}
                  >
                    <Text style={[styles.categoryText, isSelected && styles.categoryTextActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>

          {/* 2. Photo Proof Attachment */}
          <Card>
            <Text style={themeStyles.h3}>2. Attach Photo / Evidence Proof</Text>
            <Text style={[themeStyles.caption, { marginTop: 4, marginBottom: 10 }]}>
              Take a live photo or upload from gallery (suspect, vehicle plate, damage, scene).
            </Text>

            {photoUri ? (
              <View style={styles.previewContainer}>
                <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.removeImageBtn}
                  onPress={() => setPhotoUri(null)}
                >
                  <Text style={styles.removeImageText}>✕ Remove Photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.photoActionsRow}>
                <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
                  <Text style={styles.photoBtnIcon}>📸</Text>
                  <Text style={styles.photoBtnText}>Capture Photo</Text>
                  <Text style={themeStyles.caption}>Open Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoBtn} onPress={pickImage}>
                  <Text style={styles.photoBtnIcon}>🖼️</Text>
                  <Text style={styles.photoBtnText}>Pick from Gallery</Text>
                  <Text style={themeStyles.caption}>Select Image</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>

          {/* 3. Location Tagging */}
          <Card>
            <View style={themeStyles.spaceBetween}>
              <Text style={themeStyles.h3}>3. Location of Incident</Text>
              <Badge
                label={currentCoords ? "GPS TAGGED" : "PENDING"}
                variant={currentCoords ? "success" : "warning"}
              />
            </View>
            <Text style={[themeStyles.caption, { marginTop: 4 }]}>
              {currentCoords
                ? `📍 Tagged: ${currentCoords.latitude.toFixed(5)}, ${currentCoords.longitude.toFixed(5)}`
                : "Fetching GPS coordinates..."}
            </Text>

            <TextInput
              style={[themeStyles.input, { marginTop: 10 }]}
              placeholder="Landmark, building, or street address (optional)"
              value={addressLandmark}
              onChangeText={setAddressLandmark}
            />

            <Action
              label={locating ? "Updating GPS…" : "📍 Refresh Current GPS Coordinates"}
              secondary
              loading={locating}
              onPress={fetchLocation}
            />
          </Card>

          {/* 4. Incident Details */}
          <Card>
            <Text style={themeStyles.h3}>4. Describe What Happened</Text>
            <Text style={[themeStyles.caption, { marginTop: 4, marginBottom: 8 }]}>
              Provide details such as what occurred, suspect appearance, clothing, vehicle number, direction of escape, etc.
            </Text>

            <TextInput
              style={[themeStyles.input, { height: 100, textAlignVertical: "top" }]}
              placeholder="Enter detailed description here..."
              multiline
              numberOfLines={4}
              value={description}
              onChangeText={setDescription}
            />

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
              <Text style={[themeStyles.caption, { fontWeight: "700", marginRight: 8 }]}>Priority:</Text>
              {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.priorityPill, priority === p && styles.priorityPillActive]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[styles.priorityText, priority === p && styles.priorityTextActive]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Divider />

            <Action
              label={submitting ? "Transmitting to Police…" : "🛡️ Submit Confidential Report to Police"}
              loading={submitting}
              disabled={submitting || !description.trim()}
              onPress={handleSubmit}
            />
          </Card>
        </>
      ) : (
        /* My Reports Tab */
        <View style={{ gap: 12 }}>
          {loadingHistory && myReports.length === 0 ? (
            <Card>
              <Text style={themeStyles.caption}>Loading your submitted reports…</Text>
            </Card>
          ) : myReports.length === 0 ? (
            <EmptyState message="You haven't submitted any crime reports yet. Reports filed here remain strictly confidential between you and the police." />
          ) : (
            myReports.map((report) => (
              <Card key={report._id || report.reportId}>
                <View style={themeStyles.spaceBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={themeStyles.h3}>{report.crimeType}</Text>
                    <Text style={themeStyles.caption}>
                      Ref: {report.reportId || report._id} • {elapsedSince(report.createdAt)}
                    </Text>
                  </View>
                  <Badge
                    label={report.status || "SUBMITTED"}
                    variant={statusBadgeVariant(report.status)}
                  />
                </View>

                {report.photoUrl && (
                  <View style={{ marginTop: 10 }}>
                    <Image
                      source={{ uri: report.photoUrl }}
                      style={{ width: "100%", height: 160, borderRadius: 8 }}
                      resizeMode="cover"
                    />
                  </View>
                )}

                <Text style={[themeStyles.subtitle, { marginTop: 10 }]}>{report.description}</Text>

                {report.location?.latitude != null && report.location?.longitude != null && (
                  <Text style={[themeStyles.caption, { marginTop: 6 }]}>
                    📍 {report.location.address || `${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)}`}
                  </Text>
                )}

                {report.nearestStationName && (
                  <Text style={[themeStyles.caption, { marginTop: 2, color: colors.primary }]}>
                    📡 Routed to: {report.nearestStationName}
                    {report.stationDistanceKm != null ? ` (${report.stationDistanceKm} km)` : ""}
                  </Text>
                )}

                {/* Police Action Remarks */}
                {report.policeNotes ? (
                  <View style={styles.policeNotesBox}>
                    <Text style={{ fontWeight: "700", color: "#0F172A", fontSize: 13 }}>
                      👮 Officer Remark ({report.officerName || "Assigned Officer"}):
                    </Text>
                    <Text style={{ color: "#334155", fontSize: 13, marginTop: 4 }}>
                      {report.policeNotes}
                    </Text>
                  </View>
                ) : null}
              </Card>
            ))
          )}

          <Action label="🔄 Refresh Reports" secondary onPress={loadMyReports} />
        </View>
      )}

      <Action label="← Back" secondary onPress={() => router.back()} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#0284C7",
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  tabButtonTextActive: {
    color: "#FFFFFF",
  },
  categoriesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  categoryPillActive: {
    borderColor: "#0284C7",
    backgroundColor: "#E0F2FE",
  },
  categoryText: {
    fontSize: 13,
    color: "#334155",
    fontWeight: "600",
  },
  categoryTextActive: {
    color: "#0369A1",
    fontWeight: "700",
  },
  photoActionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  photoBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#94A3B8",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  photoBtnIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  photoBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1E293B",
  },
  previewContainer: {
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  previewImage: {
    width: "100%",
    height: 180,
  },
  removeImageBtn: {
    backgroundColor: "#FEE2E2",
    paddingVertical: 8,
    alignItems: "center",
  },
  removeImageText: {
    color: "#DC2626",
    fontWeight: "700",
    fontSize: 12,
  },
  priorityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#F1F5F9",
    marginRight: 6,
  },
  priorityPillActive: {
    backgroundColor: "#0F172A",
  },
  priorityText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  priorityTextActive: {
    color: "#FFFFFF",
  },
  policeNotesBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    borderLeftWidth: 4,
    borderLeftColor: "#0284C7",
  },
});
