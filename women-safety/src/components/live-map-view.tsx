import React, { useState } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { Action, Badge, Card, Divider } from "@/components/ui";
import { colors, styles as themeStyles } from "@/lib/theme";
import { INDIA_HELPLINES } from "@/lib/helplines";

/** Radius choices for the nearby-station search (km). */
export const STATION_RADIUS_OPTIONS = [2, 5, 10, 20];

export type PoliceStationMarker = {
  _id?: string;
  stationId: string;
  name: string;
  type?: string;
  /** Only set when OpenStreetMap lists a number for this station. */
  phone?: string | null;
  altPhone?: string | null;
  address?: string | null;
  distanceKm?: number | null;
  latitude: number;
  longitude: number;
  source?: string;
  osmUrl?: string;
};

export type ActiveIncidentMarker = {
  _id: string;
  level?: string;
  latitude: number;
  longitude: number;
  label?: string;
};

type LiveMapViewProps = {
  userLocation: { latitude: number; longitude: number } | null;
  policeStations: PoliceStationMarker[];
  activeIncidents?: ActiveIncidentMarker[];
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  loading?: boolean;
  /** Search radius in km; the parent re-fetches stations when it changes. */
  radiusKm?: number;
  onRadiusChange?: (km: number) => void;
  /** Error from the station lookup (e.g. map service unreachable). */
  error?: string | null;
};

export default function LiveMapView({
  userLocation,
  policeStations,
  activeIncidents = [],
  title = "Live Safety & Tactical Map",
  subtitle = "Real-time location, patrol coverage, and nearest police stations.",
  onRefresh,
  loading = false,
  radiusKm,
  onRadiusChange,
  error = null,
}: LiveMapViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localRange, setLocalRange] = useState<number>(10);
  const [showAll, setShowAll] = useState(false);
  const rangeKm = radiusKm ?? localRange;
  const setRangeKm = (km: number) => (onRadiusChange ? onRadiusChange(km) : setLocalRange(km));
  // Keep the selection valid when the list changes (new radius or position).
  const selectedStation = policeStations.find((s) => s.stationId === selectedId) ?? policeStations[0] ?? null;
  const setSelectedStation = (s: PoliceStationMarker) => setSelectedId(s.stationId);
  const listed = showAll ? policeStations : policeStations.slice(0, 5);

  const centerLat = userLocation?.latitude ?? 0;
  const centerLng = userLocation?.longitude ?? 0;

  // Radar Canvas Size
  const canvasSize = 320;
  const center = canvasSize / 2;
  const radius = center - 24;

  /** Project lat/lng to radar canvas coordinates relative to center */
  const projectToCanvas = (lat: number, lng: number) => {
    // 1 deg lat ~ 111km
    const kmPerDegreeLat = 111.32;
    const kmPerDegreeLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);

    const dNorthKm = (lat - centerLat) * kmPerDegreeLat;
    const dEastKm = (lng - centerLng) * kmPerDegreeLng;

    // Scale to radar radius
    const scale = radius / rangeKm;
    let x = center + dEastKm * scale;
    let y = center - dNorthKm * scale; // inverted Y axis for screen

    // Clamp within bounds
    const dx = x - center;
    const dy = y - center;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius - 10) {
      const angle = Math.atan2(dy, dx);
      x = center + Math.cos(angle) * (radius - 12);
      y = center + Math.sin(angle) * (radius - 12);
    }

    return { x, y };
  };

  const handleCall = (phone?: string) => {
    if (!phone) return;
    void Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, "")}`);
  };

  const handleNavigate = (station: PoliceStationMarker) => {
    const daddr = `${station.latitude},${station.longitude}`;
    const saddr = userLocation ? `${userLocation.latitude},${userLocation.longitude}` : "";
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(station.name)}@${daddr}`,
      android: `geo:0,0?q=${daddr}(${encodeURIComponent(station.name)})`,
      default: `https://www.google.com/maps/dir/?api=1&origin=${saddr}&destination=${daddr}`,
    });
    void Linking.openURL(url as string);
  };

  const openGoogleMapsAround = () => {
    const url = `https://www.google.com/maps/search/police+station/@${centerLat},${centerLng},14z`;
    void Linking.openURL(url);
  };

  return (
    <Card>
      <View style={themeStyles.spaceBetween}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={themeStyles.h2}>🗺️ {title}</Text>
          <Text style={[themeStyles.caption, { marginTop: 2 }]}>{subtitle}</Text>
        </View>
        <Badge
          label={userLocation ? "GPS LOCKED" : "SEARCHING"}
          variant={userLocation ? "success" : "warning"}
        />
      </View>

      {/* Range Filter Controls */}
      <View style={mapStyles.rangeContainer}>
        <Text style={[themeStyles.caption, { fontWeight: "700", marginRight: 8 }]}>Search radius:</Text>
        {STATION_RADIUS_OPTIONS.map((r) => (
          <TouchableOpacity
            key={r}
            style={[mapStyles.rangeButton, rangeKm === r && mapStyles.rangeButtonActive]}
            onPress={() => setRangeKm(r)}
          >
            <Text style={[mapStyles.rangeText, rangeKm === r && mapStyles.rangeTextActive]}>
              {r} km
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Visual Radar Map Canvas */}
      <View style={mapStyles.canvasWrapper}>
        <Svg width={canvasSize} height={canvasSize}>
          <Defs>
            <LinearGradient id="radarGrid" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#1E293B" stopOpacity="0.95" />
              <Stop offset="100%" stopColor="#0F172A" stopOpacity="0.98" />
            </LinearGradient>
            <LinearGradient id="pulseGlow" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.35" />
              <Stop offset="100%" stopColor="#38BDF8" stopOpacity="0.05" />
            </LinearGradient>
          </Defs>

          {/* Background Map Frame */}
          <Rect x="0" y="0" width={canvasSize} height={canvasSize} rx="16" fill="url(#radarGrid)" />

          {/* Concentric Range Rings */}
          <Circle cx={center} cy={center} r={radius * 0.33} stroke="#334155" strokeWidth="1" strokeDasharray="4,4" fill="none" />
          <Circle cx={center} cy={center} r={radius * 0.66} stroke="#334155" strokeWidth="1" strokeDasharray="4,4" fill="none" />
          <Circle cx={center} cy={center} r={radius} stroke="#475569" strokeWidth="1.5" fill="none" />

          {/* Crosshairs */}
          <Line x1={center} y1="12" x2={center} y2={canvasSize - 12} stroke="#1E293B" strokeWidth="1.5" />
          <Line x1="12" y1={center} x2={canvasSize - 12} y2={center} stroke="#1E293B" strokeWidth="1.5" />

          {/* Compass labels */}
          <SvgText x={center} y="22" fill="#64748B" fontSize="10" fontWeight="700" textAnchor="middle">N</SvgText>
          <SvgText x={canvasSize - 18} y={center + 4} fill="#64748B" fontSize="10" fontWeight="700" textAnchor="middle">E</SvgText>
          <SvgText x={center} y={canvasSize - 14} fill="#64748B" fontSize="10" fontWeight="700" textAnchor="middle">S</SvgText>
          <SvgText x="18" y={center + 4} fill="#64748B" fontSize="10" fontWeight="700" textAnchor="middle">W</SvgText>

          {/* User Live Location Pulse (Center) */}
          <Circle cx={center} cy={center} r="20" fill="url(#pulseGlow)" />
          <Circle cx={center} cy={center} r="10" fill="#0284C7" fillOpacity="0.4" />
          <Circle cx={center} cy={center} r="6" fill="#38BDF8" />
          <Circle cx={center} cy={center} r="2.5" fill="#FFFFFF" />

          {/* Police Station Markers */}
          {userLocation && policeStations.map((station, idx) => {
            const { x, y } = projectToCanvas(station.latitude, station.longitude);
            const isSelected = selectedStation?.stationId === station.stationId;

            return (
              <G key={station.stationId || idx}>
                {isSelected && (
                  <Circle cx={x} cy={y} r="14" fill="#22C55E" fillOpacity="0.3" stroke="#22C55E" strokeWidth="1" />
                )}
                <Circle cx={x} cy={y} r="7" fill={isSelected ? "#22C55E" : "#3B82F6"} stroke="#FFFFFF" strokeWidth="1.5" />
                <SvgText
                  x={x}
                  y={y - 10}
                  fill="#E2E8F0"
                  fontSize="9"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {station.name.length > 14 ? `${station.name.slice(0, 13)}…` : station.name}
                </SvgText>
              </G>
            );
          })}

          {/* Active Incidents Markers (if any) */}
          {userLocation && activeIncidents.map((inc, idx) => {
            const { x, y } = projectToCanvas(inc.latitude, inc.longitude);
            return (
              <G key={inc._id || idx}>
                <Circle cx={x} cy={y} r="12" fill="#EF4444" fillOpacity="0.35" />
                <Circle cx={x} cy={y} r="6" fill="#DC2626" stroke="#FFFFFF" strokeWidth="1.5" />
                <SvgText x={x} y={y + 16} fill="#F87171" fontSize="9" fontWeight="bold" textAnchor="middle">
                  {inc.label || "SOS"}
                </SvgText>
              </G>
            );
          })}
        </Svg>

        {/* Tactical Legend Overlay */}
        <View style={mapStyles.legendOverlay}>
          <View style={mapStyles.legendItem}>
            <View style={[mapStyles.legendDot, { backgroundColor: "#38BDF8" }]} />
            <Text style={mapStyles.legendText}>You (Live GPS)</Text>
          </View>
          <View style={mapStyles.legendItem}>
            <View style={[mapStyles.legendDot, { backgroundColor: "#3B82F6" }]} />
            <Text style={mapStyles.legendText}>Police Post</Text>
          </View>
          {activeIncidents.length > 0 && (
            <View style={mapStyles.legendItem}>
              <View style={[mapStyles.legendDot, { backgroundColor: "#EF4444" }]} />
              <Text style={mapStyles.legendText}>Active SOS</Text>
            </View>
          )}
        </View>
      </View>

      {/* Status: no location / lookup error / nothing within radius */}
      {!userLocation ? (
        <Text style={[themeStyles.caption, { marginTop: 12 }]}>
          Allow location access to find police stations near you. In an emergency, call 112.
        </Text>
      ) : error ? (
        <Text style={[themeStyles.errorText, { marginTop: 12 }]}>{error}</Text>
      ) : loading && policeStations.length === 0 ? (
        <Text style={[themeStyles.caption, { marginTop: 12 }]}>Searching OpenStreetMap for police stations within {rangeKm} km…</Text>
      ) : policeStations.length === 0 ? (
        <Text style={[themeStyles.caption, { marginTop: 12 }]}>
          No police stations are listed on OpenStreetMap within {rangeKm} km. Try a larger radius, or call 112.
        </Text>
      ) : null}

      {/* Selected Station Detail Card */}
      {userLocation && !error && selectedStation && (
        <View style={mapStyles.stationCard}>
          <View style={themeStyles.spaceBetween}>
            <View style={{ flex: 1 }}>
              <Text style={mapStyles.stationTitle}>🏢 {selectedStation.name}</Text>
              <Text style={mapStyles.stationSubtitle}>{selectedStation.type || "Police station"}</Text>
            </View>
            {selectedStation.distanceKm != null && (
              <Badge
                label={`${selectedStation.distanceKm.toFixed(1)} km`}
                variant={selectedStation.distanceKm <= 3 ? "success" : "neutral"}
              />
            )}
          </View>
          <Text style={mapStyles.stationAddress}>📍 {selectedStation.address || "Address not listed on the map"}</Text>
          <Text style={[themeStyles.caption, { marginTop: 4 }]}>
            {selectedStation.phone
              ? `Station phone (from OpenStreetMap): ${selectedStation.phone}`
              : "This station's phone number isn't listed. Call 112 — it reaches the police anywhere in India."}
          </Text>

          <View style={mapStyles.actionRow}>
            <TouchableOpacity
              style={[mapStyles.actionBtn, { backgroundColor: "#0284C7" }]}
              onPress={() => handleCall(selectedStation.phone || "112")}
            >
              <Text style={mapStyles.actionBtnText}>
                📞 {selectedStation.phone ? "Call station" : "Call 112"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[mapStyles.actionBtn, { backgroundColor: "#1E293B" }]}
              onPress={() => handleNavigate(selectedStation)}
            >
              <Text style={mapStyles.actionBtnText}>🧭 Directions</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Stations list */}
      {userLocation && !error && policeStations.length > 0 && (
        <>
          <Text style={[themeStyles.h3, { marginTop: 14, marginBottom: 6 }]}>
            {policeStations.length} police station{policeStations.length === 1 ? "" : "s"} within {rangeKm} km
          </Text>
          <View style={{ gap: 8 }}>
            {listed.map((s) => {
              const isSelected = selectedStation?.stationId === s.stationId;
              return (
                <TouchableOpacity
                  key={s.stationId}
                  style={[mapStyles.stationListItem, isSelected && mapStyles.stationListItemActive]}
                  onPress={() => setSelectedStation(s)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[mapStyles.listName, isSelected && { color: colors.primary }]}>{s.name}</Text>
                    <Text style={themeStyles.caption} numberOfLines={1}>
                      {s.type || "Police station"}{s.address ? ` · ${s.address}` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[themeStyles.caption, { fontWeight: "700" }]}>
                      {s.distanceKm != null ? `${s.distanceKm.toFixed(1)} km` : ""}
                    </Text>
                    <Text style={[themeStyles.caption, { color: colors.muted }]}>{s.phone || "No phone listed"}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          {policeStations.length > 5 && (
            <TouchableOpacity onPress={() => setShowAll((v) => !v)} style={{ marginTop: 8 }}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                {showAll ? "Show fewer" : `Show all ${policeStations.length}`}
              </Text>
            </TouchableOpacity>
          )}
          <Text style={[themeStyles.caption, { marginTop: 8 }]}>
            Station data © OpenStreetMap contributors. Small posts may be missing — if unsure, call 112.
          </Text>
        </>
      )}

      {/* Official helplines */}
      <Text style={[themeStyles.h3, { marginTop: 16, marginBottom: 6 }]}>Official helplines (India)</Text>
      <View style={{ gap: 6 }}>
        {INDIA_HELPLINES.map((h) => (
          <TouchableOpacity key={h.number} style={mapStyles.stationListItem} onPress={() => handleCall(h.number)}>
            <View style={{ flex: 1 }}>
              <Text style={mapStyles.listName}>{h.label}</Text>
              <Text style={themeStyles.caption} numberOfLines={1}>{h.detail}</Text>
            </View>
            <Text style={[mapStyles.listName, { color: colors.primary }]}>📞 {h.number}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Divider />

      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Action
            label="🌐 Open in Maps"
            secondary
            onPress={openGoogleMapsAround}
          />
        </View>
        {onRefresh && (
          <View style={{ flex: 1 }}>
            <Action
              label={loading ? "Refreshing…" : "🔄 Refresh stations"}
              secondary
              loading={loading}
              onPress={onRefresh}
            />
          </View>
        )}
      </View>
    </Card>
  );
}

const mapStyles = StyleSheet.create({
  rangeContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 8,
  },
  rangeButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#F1F5F9",
    marginRight: 6,
  },
  rangeButtonActive: {
    backgroundColor: "#0284C7",
  },
  rangeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },
  rangeTextActive: {
    color: "#FFFFFF",
  },
  canvasWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 6,
    position: "relative",
  },
  legendOverlay: {
    position: "absolute",
    bottom: 12,
    left: 14,
    flexDirection: "row",
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "600",
  },
  stationCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  stationTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  stationSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  stationAddress: {
    fontSize: 12,
    color: "#334155",
    marginTop: 6,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  stationListItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  stationListItemActive: {
    borderColor: "#0284C7",
    backgroundColor: "#F0F9FF",
  },
  listName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1E293B",
  },
});
