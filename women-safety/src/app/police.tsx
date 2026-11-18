/**
 * Police Dashboard — Sensical Tactical & Dispatch Command Center
 *
 * Provides:
 *  1. 🚨 Active SOS Dispatch Queue: Instant emergency dispatches with level,
 *     live location stream, audio evidence, and state machine (Claim → Responding → On Scene → Resolved).
 *  2. 📋 Crime & Evidence Reports: Citizen in-app crime submissions with photo proof,
 *     exact GPS scene coords, and officer investigation remarks.
 *  3. 🗺️ Tactical Radar Map: Live tactical visualization showing active SOS incidents
 *     and all jurisdictional police stations.
 *  4. 📊 Command Metrics: Live count of open emergencies, reports, and stations.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { Action, Badge, Card, Divider, EmptyState, Header, StatusBanner } from "@/components/ui";
import LiveMapView, { ActiveIncidentMarker, PoliceStationMarker } from "@/components/live-map-view";
import { api, patch, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/hooks/useSocket";
import { BadgeVariant, colors, styles as themeStyles } from "@/lib/theme";

type Incident = {
  _id: string;
  emergencyId?: string;
  status?: string;
  level?: string;
  triggerType?: string;
  createdAt?: string;
  stationId?: string;
  nearbyStation?: { name?: string; distanceKm?: number; phone?: string | null };
  initialLocation?: { latitude?: number; longitude?: number; lat?: number; lng?: number } | null;
  currentLocation?: { latitude?: number; longitude?: number; lat?: number; lng?: number; timestamp?: string } | null;
  assignedOfficerId?: string;
};

type CrimeReport = {
  _id: string;
  reportId?: string;
  userId?: string;
  userName?: string;
  userPhone?: string;
  crimeType: string;
  description: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  photoUrl?: string;
  priority?: string;
  status?: "SUBMITTED" | "INVESTIGATING" | "ACTION_TAKEN" | "CLOSED";
  createdAt?: string;
  officerName?: string;
  policeNotes?: string;
  stationId?: string;
  nearestStationName?: string;
  stationDistanceKm?: number;
};

const STATUS_FLOW: Record<string, { label: string; path: string; color: string } | undefined> = {
  ASSIGNED: { label: "🚓 Mark Responding →", path: "respond", color: "#0284C7" },
  RESPONDING: { label: "📍 Mark On Scene →", path: "on-scene", color: "#F59E0B" },
  ON_SCENE: { label: "✅ Mark Resolved", path: "resolve", color: "#10B981" },
};

function statusVariant(status?: string): BadgeVariant {
  if (!status) return "neutral";
  if (["CREATED", "DISPATCHED", "VIEWED"].includes(status)) return "danger";
  if (status === "ASSIGNED") return "warning";
  if (status === "RESPONDING") return "info";
  if (status === "ON_SCENE") return "warning";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

function crimeStatusVariant(status?: string): BadgeVariant {
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

function getCoords(loc: unknown): { latitude: number; longitude: number } | null {
  if (!loc) return null;
  const l = loc as { latitude?: number; longitude?: number; lat?: number; lng?: number };
  const lat = l.latitude ?? l.lat;
  const lng = l.longitude ?? l.lng;
  if (lat != null && lng != null) return { latitude: lat, longitude: lng };
  return null;
}

export default function PoliceDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"incidents" | "reports" | "map">("incidents");

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [reports, setReports] = useState<CrimeReport[]>([]);
  const [stations, setStations] = useState<PoliceStationMarker[]>([]);
  const [officerLocation, setOfficerLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [stationRadiusKm, setStationRadiusKm] = useState(10);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [policeNotesDraft, setPoliceNotesDraft] = useState<Record<string, string>>({});
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);

  const knownEmergencyIds = useRef(new Set<string>());
  const knownReportIds = useRef(new Set<string>());

  /* ─── Fetch Officer GPS ──────────────────────────────────── */
  const fetchOfficerLocation = useCallback(async () => {
    try {
      // Ask (the browser shows its own prompt) so the station radar can centre on the officer.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setOfficerLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      }
    } catch (_) {}
  }, []);

  /* ─── Real police stations (OpenStreetMap) around the officer ─── */
  useEffect(() => {
    if (!officerLocation) return;
    let cancelled = false;
    void (async () => {
      setStationsLoading(true);
      const result = await api<PoliceStationMarker[]>(
        `/api/police/stations?latitude=${officerLocation.latitude}&longitude=${officerLocation.longitude}&radiusKm=${stationRadiusKm}`
      );
      if (cancelled) return;
      if (result.data) {
        setStations(result.data);
        setStationsError(null);
      } else {
        setStationsError(result.error || "Could not look up nearby police stations.");
      }
      setStationsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [officerLocation, stationRadiusKm]);

  /* ─── Load All Data ─────────────────────────────────────── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [incidentsRes, reportsRes] = await Promise.allSettled([
        api<Incident[]>("/api/police/incidents"),
        api<CrimeReport[]>("/api/police/reports"),
      ]);

      if (incidentsRes.status === "fulfilled" && incidentsRes.value.data) {
        const data = incidentsRes.value.data;
        const newOnes = data.filter((i) => !knownEmergencyIds.current.has(i._id));
        if (newOnes.length > 0 && knownEmergencyIds.current.size > 0) {
          Vibration.vibrate([0, 500, 200, 500]);
        }
        knownEmergencyIds.current = new Set(data.map((i) => i._id));
        setIncidents(data);
      }

      if (reportsRes.status === "fulfilled" && reportsRes.value.data) {
        const data = reportsRes.value.data;
        const newReports = data.filter((r) => !knownReportIds.current.has(r._id));
        if (newReports.length > 0 && knownReportIds.current.size > 0) {
          Vibration.vibrate([0, 300, 150, 300]);
        }
        knownReportIds.current = new Set(data.map((r) => r._id));
        setReports(data);
      }


      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error refreshing dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ─── Real-Time Socket Connection ───────────────────────── */
  useSocket({
    userId: user?._id,
    onEvent: (event, data) => {
      if (event === "emergency:new") {
        Vibration.vibrate([0, 500, 200, 500]);
        const item = data as Incident;
        setIncidents((prev) => (prev.some((i) => i._id === item._id) ? prev : [item, ...prev]));
      } else if (event === "location:live") {
        const loc = data as { emergencyId: string; latitude: number; longitude: number; timestamp?: string };
        setIncidents((prev) =>
          prev.map((i) =>
            i._id === loc.emergencyId || i.emergencyId === loc.emergencyId
              ? { ...i, currentLocation: { latitude: loc.latitude, longitude: loc.longitude, timestamp: loc.timestamp } }
              : i
          )
        );
      } else if (event === "crime:new") {
        Vibration.vibrate([0, 400, 200, 400]);
        const report = data as CrimeReport;
        setReports((prev) => (prev.some((r) => r._id === report._id) ? prev : [report, ...prev]));
      } else if (event === "crime:updated") {
        const updated = data as CrimeReport;
        setReports((prev) =>
          prev.map((r) => (r._id === updated._id || r.reportId === updated.reportId ? updated : r))
        );
      } else if (
        event === "audio:evidence" ||
        event === "photo:evidence" ||
        event === "emergency:updated" ||
        event === "incident:claimed" ||
        event === "emergency:cancelled"
      ) {
        void loadAll();
      }
    },
  });

  useEffect(() => {
    void fetchOfficerLocation();
    void loadAll();
    const timer = setInterval(() => void loadAll(), 15_000);
    return () => clearInterval(timer);
  }, [fetchOfficerLocation, loadAll]);

  /* ─── Incident Actions ───────────────────────────────────── */
  const claimIncident = async (incident: Incident) => {
    const result = await post(`/api/police/incidents/${incident._id}/claim`, {});
    if (result.error) {
      Alert.alert(
        result.error === "CASE_ALREADY_CLAIMED" ? "Already Claimed" : "Unable to Claim",
        result.error === "CASE_ALREADY_CLAIMED"
          ? "Another officer has already taken ownership of this incident."
          : result.error
      );
    } else {
      await loadAll();
    }
  };

  const advanceIncident = async (incident: Incident, action: { label: string; path: string }) => {
    const result = await post(`/api/police/incidents/${incident._id}/${action.path}`, {});
    if (result.error) {
      Alert.alert("Status update failed", result.error);
    } else {
      await loadAll();
    }
  };

  /* ─── Crime Report Status Update ────────────────────────── */
  const updateCrimeStatus = async (
    reportId: string,
    newStatus: "INVESTIGATING" | "ACTION_TAKEN" | "CLOSED"
  ) => {
    setUpdatingReportId(reportId);
    try {
      const notes = policeNotesDraft[reportId];
      const result = await patch<CrimeReport>(`/api/police/reports/${reportId}/status`, {
        status: newStatus,
        policeNotes: notes?.trim() || undefined,
      });

      if (result.error) {
        Alert.alert("Update failed", result.error);
      } else {
        Alert.alert("Status Updated", `Crime report marked as "${newStatus}". Citizen notified in-app.`);
        await loadAll();
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to update report.");
    } finally {
      setUpdatingReportId(null);
    }
  };

  const openNav = (lat: number, lng: number, label: string) => {
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  };

  // Metric counts
  const openIncidents = incidents.filter(
    (i) => !["RESOLVED", "CANCELLED", "FALSE_ALARM"].includes(i.status || "")
  );
  const pendingReports = reports.filter((r) => r.status !== "CLOSED");

  // Prepare map incident markers
  const mapIncidentMarkers: ActiveIncidentMarker[] = openIncidents
    .map((i): ActiveIncidentMarker | null => {
      const c = getCoords(i.currentLocation || i.initialLocation);
      if (!c) return null;
      return {
        _id: i._id,
        level: i.level || "LEVEL_1",
        latitude: c.latitude,
        longitude: c.longitude,
        label: i.triggerType || "SOS",
      };
    })
    .filter((m): m is ActiveIncidentMarker => m !== null);

  return (
    <ScrollView style={themeStyles.safe} contentContainerStyle={themeStyles.scrollContent}>
      {/* Officer Header */}
      <Header
        title={`Officer ${user?.name || "Dispatch"}`}
        subtitle="Police Tactical Command & Real-time Emergency Response Center"
      />

      {/* Sensical KPI Metric Cards */}
      <View style={policeStyles.metricRow}>
        <View style={[policeStyles.metricCard, { borderLeftColor: "#EF4444" }]}>
          <Text style={policeStyles.metricNumber}>{openIncidents.length}</Text>
          <Text style={policeStyles.metricLabel}>🚨 Active SOS</Text>
        </View>
        <View style={[policeStyles.metricCard, { borderLeftColor: "#3B82F6" }]}>
          <Text style={policeStyles.metricNumber}>{pendingReports.length}</Text>
          <Text style={policeStyles.metricLabel}>📋 Crime Proofs</Text>
        </View>
        <View style={[policeStyles.metricCard, { borderLeftColor: "#10B981" }]}>
          <Text style={policeStyles.metricNumber}>{stations.length}</Text>
          <Text style={policeStyles.metricLabel}>📡 Stations</Text>
        </View>
      </View>

      {/* Main Tab Controls */}
      <View style={policeStyles.tabBar}>
        <TouchableOpacity
          style={[policeStyles.tabItem, activeTab === "incidents" && policeStyles.tabItemActive]}
          onPress={() => setActiveTab("incidents")}
        >
          <Text style={[policeStyles.tabText, activeTab === "incidents" && policeStyles.tabTextActive]}>
            🚨 SOS Queue ({openIncidents.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[policeStyles.tabItem, activeTab === "reports" && policeStyles.tabItemActive]}
          onPress={() => setActiveTab("reports")}
        >
          <Text style={[policeStyles.tabText, activeTab === "reports" && policeStyles.tabTextActive]}>
            📋 Crime Proofs ({reports.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[policeStyles.tabItem, activeTab === "map" && policeStyles.tabItemActive]}
          onPress={() => setActiveTab("map")}
        >
          <Text style={[policeStyles.tabText, activeTab === "map" && policeStyles.tabTextActive]}>
            🗺️ Tactical Map
          </Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <Card danger>
          <Text style={themeStyles.errorText}>{error}</Text>
          <Action label="Retry" secondary onPress={loadAll} />
        </Card>
      ) : null}

      {/* ─────────────────── TAB 1: SOS INCIDENT DISPATCH QUEUE ─────────────────── */}
      {activeTab === "incidents" && (
        <View style={{ gap: 12 }}>
          {openIncidents.length > 0 && (
            <StatusBanner
              title={`🚨 ${openIncidents.length} Emergency Alert${openIncidents.length > 1 ? "s" : ""} Active`}
              subtitle="Claim an incident immediately to initiate tactical dispatch."
            />
          )}

          {loading && incidents.length === 0 ? (
            <EmptyState message="Syncing emergency dispatch queue…" />
          ) : openIncidents.length === 0 ? (
            <EmptyState message="All clear. No active SOS alerts in your jurisdiction right now." />
          ) : (
            openIncidents.map((incident) => {
              const action = STATUS_FLOW[incident.status || ""];
              const canClaim = ["CREATED", "DISPATCHED", "VIEWED"].includes(incident.status || "");
              const isAssignedToMe = String(incident.assignedOfficerId) === String(user?._id);
              const coords = getCoords(incident.currentLocation || incident.initialLocation);

              return (
                <Card key={incident._id} danger={canClaim}>
                  <View style={themeStyles.spaceBetween}>
                    <View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[themeStyles.h3, { color: colors.red }]}>
                          🚨 {incident.level || "LEVEL_1"} SOS
                        </Text>
                        <Badge label={incident.status || "OPEN"} variant={statusVariant(incident.status)} />
                      </View>
                      <Text style={themeStyles.caption}>
                        Trigger: {incident.triggerType || "SOS_BUTTON"} • Started {elapsedSince(incident.createdAt)}
                      </Text>
                    </View>
                  </View>

                  {/* Nearest Station / Jurisdictional Routing */}
                  {incident.nearbyStation?.name && (
                    <Text style={[themeStyles.subtitle, { marginTop: 8 }]}>
                      🏢 Nearest police station: {incident.nearbyStation.name}
                      {incident.nearbyStation.distanceKm != null ? ` (${incident.nearbyStation.distanceKm} km from the victim)` : ""}
                      {incident.nearbyStation.phone ? ` · 📞 ${incident.nearbyStation.phone}` : ""}
                    </Text>
                  )}

                  {/* Live Coordinates */}
                  {coords && (
                    <View style={policeStyles.locationStrip}>
                      <Text style={policeStyles.locationText}>
                        📍 Live GPS: {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                        {incident.currentLocation?.timestamp
                          ? ` · updated ${new Date(incident.currentLocation.timestamp).toLocaleTimeString()}`
                          : ""}
                      </Text>
                      <TouchableOpacity
                        style={policeStyles.navMiniBtn}
                        onPress={() => openNav(coords.latitude, coords.longitude, "Emergency Incident")}
                      >
                        <Text style={policeStyles.navMiniBtnText}>🧭 Navigate</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Divider />

                  {/* Primary Officer Action Pipeline */}
                  {canClaim ? (
                    <Action
                      label="🔒 Claim & Take Ownership of Incident"
                      onPress={() => void claimIncident(incident)}
                    />
                  ) : action ? (
                    <Action
                      label={action.label}
                      onPress={() => void advanceIncident(incident, action)}
                    />
                  ) : null}

                  {/* View Details & Audio Evidence */}
                  <Action
                    label="📍 Live Map, Audio & Photos"
                    secondary
                    onPress={() =>
                      router.push({
                        pathname: "/details",
                        params: {
                          id: incident._id,
                          status: incident.status,
                          latitude: coords?.latitude.toString(),
                          longitude: coords?.longitude.toString(),
                        },
                      } as never)
                    }
                  />
                </Card>
              );
            })
          )}
        </View>
      )}

      {/* ─────────────────── TAB 2: CITIZEN CRIME PROOFS & REPORTS ─────────────────── */}
      {activeTab === "reports" && (
        <View style={{ gap: 12 }}>
          {reports.length === 0 && !loading ? (
            <EmptyState message="No crime evidence reports submitted yet. When users report incidents with photo proof, they appear here instantly." />
          ) : (
            reports.map((report) => {
              const draftNote = policeNotesDraft[report._id] ?? report.policeNotes ?? "";
              const coords = report.location?.latitude != null && report.location?.longitude != null
                ? { latitude: report.location.latitude, longitude: report.location.longitude }
                : null;

              return (
                <Card key={report._id || report.reportId}>
                  <View style={themeStyles.spaceBetween}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={themeStyles.h3}>{report.crimeType}</Text>
                        <Badge
                          label={report.status || "SUBMITTED"}
                          variant={crimeStatusVariant(report.status)}
                        />
                        {report.priority && (
                          <Badge
                            label={report.priority}
                            variant={report.priority === "HIGH" ? "danger" : "neutral"}
                          />
                        )}
                      </View>
                      <Text style={themeStyles.caption}>
                        Ref: {report.reportId || report._id} • Reported {elapsedSince(report.createdAt)}
                      </Text>
                    </View>
                  </View>

                  {/* Citizen Contact Info */}
                  <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={themeStyles.caption}>
                      Citizen: <Text style={{ fontWeight: "700" }}>{report.userName || "Confidential User"}</Text>
                    </Text>
                    {report.userPhone && (
                      <TouchableOpacity onPress={() => void Linking.openURL(`tel:${report.userPhone}`)}>
                        <Text style={[themeStyles.caption, { color: colors.primary, fontWeight: "700" }]}>
                          📞 {report.userPhone}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Proof Photo Display */}
                  {report.photoUrl && (
                    <View style={policeStyles.photoFrame}>
                      <Image
                        source={{ uri: report.photoUrl }}
                        style={policeStyles.reportPhoto}
                        resizeMode="cover"
                      />
                      <Text style={policeStyles.photoCaption}>📸 Photo Evidence Proof Attached</Text>
                    </View>
                  )}

                  {/* Description */}
                  <Text style={[themeStyles.subtitle, { marginTop: 10 }]}>{report.description}</Text>

                  {/* Location Info */}
                  {coords && (
                    <View style={policeStyles.locationStrip}>
                      <Text style={policeStyles.locationText}>
                        📍 Scene: {report.location?.address || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`}
                      </Text>
                      <TouchableOpacity
                        style={policeStyles.navMiniBtn}
                        onPress={() => openNav(coords.latitude, coords.longitude, "Crime Scene")}
                      >
                        <Text style={policeStyles.navMiniBtnText}>🧭 Map</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Divider />

                  {/* Officer Action & Notes Section */}
                  <Text style={[themeStyles.caption, { fontWeight: "700", marginBottom: 6 }]}>
                    Officer Case Notes / FIR Action Remarks:
                  </Text>
                  <TextInput
                    style={policeStyles.notesInput}
                    placeholder="Enter dispatch notes, suspect lookup details, or action taken..."
                    value={draftNote}
                    onChangeText={(text) =>
                      setPoliceNotesDraft((prev) => ({ ...prev, [report._id]: text }))
                    }
                    multiline
                  />

                  {/* Status Buttons */}
                  <View style={policeStyles.statusActionRow}>
                    <TouchableOpacity
                      style={[policeStyles.statusBtn, { backgroundColor: "#0284C7" }]}
                      disabled={updatingReportId === report._id}
                      onPress={() => void updateCrimeStatus(report._id, "INVESTIGATING")}
                    >
                      <Text style={policeStyles.statusBtnText}>🔍 Investigating</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[policeStyles.statusBtn, { backgroundColor: "#F59E0B" }]}
                      disabled={updatingReportId === report._id}
                      onPress={() => void updateCrimeStatus(report._id, "ACTION_TAKEN")}
                    >
                      <Text style={policeStyles.statusBtnText}>⚡ Action Taken</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[policeStyles.statusBtn, { backgroundColor: "#10B981" }]}
                      disabled={updatingReportId === report._id}
                      onPress={() => void updateCrimeStatus(report._id, "CLOSED")}
                    >
                      <Text style={policeStyles.statusBtnText}>✅ Close Case</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          )}
        </View>
      )}

      {/* ─────────────────── TAB 3: TACTICAL RADAR MAP ─────────────────── */}
      {activeTab === "map" && (
        <LiveMapView
          title="Tactical Station Radar"
          subtitle="Real-time tactical display showing station jurisdictions and active citizen emergencies."
          userLocation={officerLocation}
          policeStations={stations}
          activeIncidents={mapIncidentMarkers}
          onRefresh={() => void fetchOfficerLocation()}
          loading={stationsLoading}
          radiusKm={stationRadiusKm}
          onRadiusChange={setStationRadiusKm}
          error={stationsError}
        />
      )}

      <Action label="🔄 Refresh Tactical Feed" secondary onPress={loadAll} />
      <Action label="← Back Home" secondary onPress={() => router.replace("/home" as never)} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const policeStyles = StyleSheet.create({
  metricRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderLeftWidth: 4,
    alignItems: "center",
  },
  metricNumber: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 2,
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  tabItemActive: {
    backgroundColor: "#0284C7",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  locationStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  locationText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
    flex: 1,
  },
  navMiniBtn: {
    backgroundColor: "#0284C7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  navMiniBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  photoFrame: {
    marginTop: 10,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  reportPhoto: {
    width: "100%",
    height: 180,
  },
  photoCaption: {
    backgroundColor: "#0F172A",
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "600",
    paddingVertical: 4,
    textAlign: "center",
  },
  notesInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    color: "#0F172A",
    minHeight: 50,
    marginBottom: 10,
  },
  statusActionRow: {
    flexDirection: "row",
    gap: 6,
  },
  statusBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  statusBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
});
