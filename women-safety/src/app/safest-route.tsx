/**
 * Safest Route — any start and destination in India.
 *
 * - Start from GPS or any typed place; search any city, town, village, area or landmark in India
 * - Walking or driving routes from OpenStreetMap (real roads, with genuine alternatives)
 * - Each route scored on real open data: police reach, nearby help points (police, hospitals,
 *   transit) and street lighting where mapped, minus SafeHer community hazard reports
 * - Factors without data show "No data" — nothing is invented
 * - Opens the chosen route in Google Maps for turn-by-turn directions
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { Action, Badge, Card, Divider, Header } from "@/components/ui";
import RouteMapView, { EvaluatedRoute, scoreVariant } from "@/components/route-map-view";
import { api, post } from "@/lib/api";
import { colors, styles as themeStyles } from "@/lib/theme";

type PlaceResult = {
  placeId: number | string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  state?: string | null;
  city?: string | null;
};

type SafetyFacility = {
  name: string;
  locationType: string;
  latitude: number;
  longitude: number;
};

type Coords = { latitude: number; longitude: number };
type TravelMode = "walking" | "driving";

type SafestResponse = {
  ok: boolean;
  origin: Coords;
  destination: Coords;
  recommendedRouteId: string;
  routes: EvaluatedRoute[];
  facilities: SafetyFacility[];
  metadata: { disclaimer: string; dataSources: string[]; lightingAvailable: boolean; placeProvider: string };
};

const pct = (v: number | null | undefined) => (v == null ? "No data" : `${v}%`);
const km = (m: number | null | undefined) => (m == null ? "—" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export default function SafestRouteScreen() {
  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [destinationCoords, setDestinationCoords] = useState<Coords | null>(null);
  const [mode, setMode] = useState<TravelMode>("walking");

  const [activeSearchField, setActiveSearchField] = useState<"origin" | "dest" | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<PlaceResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const [routes, setRoutes] = useState<EvaluatedRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  const [safetyMarkers, setSafetyMarkers] = useState<SafetyFacility[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [meta, setMeta] = useState<SafestResponse["metadata"] | null>(null);

  const [showReportCard, setShowReportCard] = useState(false);
  const [reportCategory, setReportCategory] = useState("poor_lighting");
  const [reportDesc, setReportDesc] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  // 1. Current GPS location as the default start
  const detectLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setOriginText("");
        Alert.alert("Location is off", "Allow location access, or type where you are starting from.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setOriginCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setOriginText("My current location");
    } catch (_) {
      setOriginCoords(null);
      setOriginText("");
      Alert.alert("Location unavailable", "Could not get your GPS position. Type where you are starting from.");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(detectLocation);
  }, [detectLocation]);

  // 2. Place search anywhere in India (results near the start are preferred)
  const searchPlaces = async (text: string, field: "origin" | "dest") => {
    if (field === "origin") {
      setOriginText(text);
      setOriginCoords(null);
    } else {
      setDestinationText(text);
      setDestinationCoords(null);
    }
    setActiveSearchField(field);
    const setList = field === "origin" ? setOriginSuggestions : setDestSuggestions;
    if (text.trim().length < 2) {
      setList([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const near = field === "dest" && originCoords ? `&nearLat=${originCoords.latitude}&nearLng=${originCoords.longitude}` : "";
      const res = await api<PlaceResult[]>(`/api/safety/places?q=${encodeURIComponent(text.trim())}${near}`);
      if (seq === searchSeq.current && res.data) setList(res.data); // ignore out-of-order replies
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const selectPlace = (place: PlaceResult, field: "origin" | "dest") => {
    const coords = { latitude: place.latitude, longitude: place.longitude };
    if (field === "origin") {
      setOriginCoords(coords);
      setOriginText(place.name);
      setOriginSuggestions([]);
    } else {
      setDestinationCoords(coords);
      setDestinationText(place.name);
      setDestSuggestions([]);
    }
    setActiveSearchField(null);
  };

  /** Coordinates for a field: already chosen, typed as "lat, lng", or the top search result. */
  const resolve = async (coords: Coords | null, text: string, near?: Coords | null): Promise<Coords | null> => {
    if (coords) return coords;
    const t = text.trim();
    if (!t) return null;
    const nearQs = near ? `&nearLat=${near.latitude}&nearLng=${near.longitude}` : "";
    const found = await api<PlaceResult[]>(`/api/safety/places?q=${encodeURIComponent(t)}${nearQs}`);
    const top = found.data?.[0];
    return top ? { latitude: top.latitude, longitude: top.longitude } : null;
  };

  // 3. Find and score routes
  const findSafestRoutes = async () => {
    setOriginSuggestions([]);
    setDestSuggestions([]);
    setActiveSearchField(null);
    setEvaluating(true);
    try {
      const origin = await resolve(originCoords, originText);
      if (!origin) {
        Alert.alert("Starting point needed", "Use GPS or type where you are starting from in India.");
        return;
      }
      setOriginCoords(origin);
      const dest = await resolve(destinationCoords, destinationText, origin);
      if (!dest) {
        Alert.alert("Destination not found", "Try a more specific place name in India, e.g. area and city.");
        return;
      }
      setDestinationCoords(dest);
      setRoutes([]);
      const res = await post<SafestResponse>("/api/routes/safest", {
        originLat: origin.latitude,
        originLng: origin.longitude,
        destLat: dest.latitude,
        destLng: dest.longitude,
        mode,
      });
      if (res.error || !res.data?.routes?.length) {
        Alert.alert("No routes", res.error || "Could not calculate routes between these places.");
        return;
      }
      setRoutes(res.data.routes);
      setSelectedRouteId(res.data.recommendedRouteId || res.data.routes[0].routeId);
      setSafetyMarkers(res.data.facilities || []);
      setMeta(res.data.metadata);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Route calculation failed.");
    } finally {
      setEvaluating(false);
    }
  };

  // Turn-by-turn directions in Google Maps along the chosen road(s)
  const openInMaps = (route: EvaluatedRoute) => {
    if (!originCoords || !destinationCoords) return;
    const coords = route.geometry.coordinates;
    // Pass a midpoint of the chosen route as a waypoint so Maps follows the same corridor.
    const mid = coords[Math.floor(coords.length / 2)];
    const params = new URLSearchParams({
      api: "1",
      origin: `${originCoords.latitude},${originCoords.longitude}`,
      destination: `${destinationCoords.latitude},${destinationCoords.longitude}`,
      travelmode: mode === "walking" ? "walking" : "driving",
      ...(mid ? { waypoints: `${mid[1]},${mid[0]}` } : {}),
    });
    void Linking.openURL(`https://www.google.com/maps/dir/?${params}`);
  };

  // Community safety report at the user's current GPS position
  const submitSafetyReport = async () => {
    setSubmittingReport(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Location needed", "A report is pinned to where you are, so location access is required.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const res = await post("/api/safety/reports", {
        category: reportCategory,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        description: reportDesc.trim() || undefined,
      });
      if (res.data) {
        Alert.alert("Report submitted", "Thank you. Reports near a route lower its safety score for other SafeHer users.");
        setShowReportCard(false);
        setReportDesc("");
      } else {
        Alert.alert("Submission failed", res.error || "Unable to save safety report.");
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setSubmittingReport(false);
    }
  };

  const selectedRoute = routes.find((r) => r.routeId === selectedRouteId) || routes[0];

  const renderSuggestions = (list: PlaceResult[], field: "origin" | "dest") =>
    activeSearchField === field && list.length > 0 ? (
      <View style={routeStyles.suggestionsContainer}>
        {list.map((item) => (
          <TouchableOpacity key={item.placeId} style={routeStyles.suggestionItem} onPress={() => selectPlace(item, field)}>
            <Text style={routeStyles.suggestionName}>{item.name}</Text>
            <Text style={routeStyles.suggestionDetails} numberOfLines={1}>
              {item.displayName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    ) : null;

  return (
    <ScrollView style={themeStyles.safe} contentContainerStyle={themeStyles.scrollContent}>
      <Header
        title="Safest Route"
        subtitle="Any start and destination in India. Compare real routes by police reach, nearby help and street lighting."
      />

      {/* ─── 1. START, DESTINATION, MODE ─── */}
      <Card>
        <View style={routeStyles.inputRow}>
          <Text style={{ fontSize: 16 }}>📍</Text>
          <TextInput
            style={[themeStyles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Starting from (place in India or use GPS)"
            value={originText}
            onChangeText={(t) => void searchPlaces(t, "origin")}
          />
          <TouchableOpacity style={routeStyles.gpsBtn} onPress={() => void detectLocation()}>
            <Text style={routeStyles.gpsBtnText}>📍 GPS</Text>
          </TouchableOpacity>
        </View>
        {renderSuggestions(originSuggestions, "origin")}

        <View style={[routeStyles.inputRow, { marginTop: 8 }]}>
          <Text style={{ fontSize: 16 }}>🏁</Text>
          <TextInput
            style={[themeStyles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Destination — city, town, village, area or landmark"
            value={destinationText}
            onChangeText={(t) => void searchPlaces(t, "dest")}
            onSubmitEditing={() => void findSafestRoutes()}
          />
          {searching && <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} />}
        </View>
        {renderSuggestions(destSuggestions, "dest")}

        <Text style={[themeStyles.caption, { marginTop: 12, fontWeight: "700" }]}>Travelling by</Text>
        <View style={routeStyles.quickTags}>
          {(["walking", "driving"] as TravelMode[]).map((m) => (
            <TouchableOpacity key={m} style={[routeStyles.tagPill, mode === m && routeStyles.tagPillActive]} onPress={() => setMode(m)}>
              <Text style={[routeStyles.tagTxt, mode === m && { color: "#FFF" }]}>{m === "walking" ? "🚶 Walking" : "🚗 Car / cab / auto"}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Divider />

        <Action
          label={evaluating ? "Checking routes…" : "🛡️ Find safest route"}
          loading={evaluating}
          disabled={evaluating || !destinationText.trim()}
          onPress={() => void findSafestRoutes()}
        />
        {evaluating ? (
          <Text style={[themeStyles.caption, { textAlign: "center" }]}>Looking up police stations, hospitals and transit along each route — this can take up to 20 seconds.</Text>
        ) : null}
      </Card>

      {/* ─── 2. MAP ─── */}
      {routes.length > 0 && originCoords && destinationCoords && (
        <RouteMapView
          routes={routes}
          selectedRouteId={selectedRouteId}
          originCoords={originCoords}
          destCoords={destinationCoords}
          originName={originText}
          destName={destinationText}
          safetyMarkers={safetyMarkers}
        />
      )}

      {/* ─── 3. ROUTE COMPARISON ─── */}
      {routes.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={[themeStyles.h2, { marginTop: 4 }]}>
            {routes.length === 1 ? "Only one route found" : `${routes.length} routes compared`}
          </Text>

          {routes.map((route, idx) => {
            const isSelected = route.routeId === selectedRouteId;
            const i = route.indicators;
            return (
              <TouchableOpacity
                key={route.routeId}
                style={[routeStyles.routeCard, isSelected && routeStyles.routeCardActive]}
                onPress={() => setSelectedRouteId(route.routeId)}
              >
                <View style={themeStyles.spaceBetween}>
                  <Text style={[themeStyles.h3, { flex: 1 }, isSelected && { color: colors.primary }]} numberOfLines={2}>
                    Route {idx + 1}: via {route.legs?.[0]?.summary || "local roads"}
                  </Text>
                  <Badge label={route.safetyScore == null ? "No data" : `${route.safetyScore}/100`} variant={scoreVariant(route.safetyScore)} />
                </View>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {route.isRecommended && <Badge label="SAFEST OF THESE" variant="success" />}
                  {route.isFastest && <Badge label="FASTEST" variant="neutral" />}
                </View>

                <Text style={[themeStyles.subtitle, { marginTop: 4 }]}>
                  🛣️ {(route.distance / 1000).toFixed(1)} km  •  ⏱️ ~{Math.round(route.duration / 60)} min  •  Data behind score: {route.dataCoverage}%
                </Text>

                <View style={routeStyles.indicatorGrid}>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>👮 {pct(i.policeProximity)}</Text>
                    <Text style={routeStyles.indicatorLbl}>Police reach</Text>
                  </View>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>🏥 {pct(i.helpPointsCoverage)}</Text>
                    <Text style={routeStyles.indicatorLbl}>Help within 500 m</Text>
                  </View>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>💡 {pct(i.streetlightCoverage)}</Text>
                    <Text style={routeStyles.indicatorLbl}>Lit roads</Text>
                  </View>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>⚠️ {i.communityReports}</Text>
                    <Text style={routeStyles.indicatorLbl}>User reports</Text>
                  </View>
                </View>

                {i.beyondPolice3kmPct != null && i.beyondPolice3kmPct > 0 ? (
                  <Text style={[themeStyles.caption, { marginTop: 6, color: colors.red }]}>
                    🚨 {i.beyondPolice3kmPct}% of this route is more than 3 km from any police station
                  </Text>
                ) : i.farthestFromPoliceM != null ? (
                  <Text style={[themeStyles.caption, { marginTop: 6, color: "#334155" }]}>
                    🚨 Never more than {km(i.farthestFromPoliceM)} from a police station
                  </Text>
                ) : null}
                {i.routeCheckedPct < 90 && route.safetyScore != null && (
                  <Text style={[themeStyles.caption, { marginTop: 2 }]}>Map data reached {i.routeCheckedPct}% of this route.</Text>
                )}
              </TouchableOpacity>
            );
          })}

          {meta && (
            <Text style={[themeStyles.caption, { marginHorizontal: 4 }]}>
              {meta.dataSources.join(" · ")}
            </Text>
          )}
        </View>
      )}

      {/* ─── 4. GO ─── */}
      {selectedRoute && (
        <Card>
          <Text style={themeStyles.h3}>Route {routes.indexOf(selectedRoute) + 1} selected</Text>
          <Text style={themeStyles.caption}>
            {(selectedRoute.distance / 1000).toFixed(1)} km • ~{Math.round(selectedRoute.duration / 60)} min {mode === "walking" ? "walking" : "by road"}
          </Text>
          <Action label="🧭 Open directions in Google Maps" onPress={() => openInMaps(selectedRoute)} />
          <Text style={[themeStyles.caption, { marginTop: 4 }]}>
            Google Maps may adjust the exact roads. Keep SafeHer open so SOS stays one tap away.
          </Text>
        </Card>
      )}

      {/* ─── 5. COMMUNITY SAFETY REPORTING ─── */}
      <Card>
        <View style={themeStyles.spaceBetween}>
          <Text style={themeStyles.h3}>⚠️ Report a safety concern here</Text>
          <TouchableOpacity onPress={() => setShowReportCard(!showReportCard)}>
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
              {showReportCard ? "Close" : "+ Report"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={[themeStyles.caption, { marginTop: 2 }]}>
          Pinned to your current location. Hazard reports within 150 m of a route lower its score for everyone.
        </Text>

        {showReportCard && (
          <View style={{ marginTop: 12 }}>
            <Text style={[themeStyles.caption, { fontWeight: "700" }]}>Issue category:</Text>
            <View style={routeStyles.quickTags}>
              {[
                { id: "poor_lighting", label: "💡 Broken/poor lighting" },
                { id: "harassment_hotspot", label: "🚨 Harassment hotspot" },
                { id: "deserted_stretch", label: "⚠️ Deserted / isolated road" },
                { id: "safe_haven", label: "🏪 Safe haven / open 24×7" },
              ].map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[routeStyles.tagPill, reportCategory === c.id && routeStyles.tagPillActive]}
                  onPress={() => setReportCategory(c.id)}
                >
                  <Text style={[routeStyles.tagTxt, reportCategory === c.id && { color: "#FFF" }]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[themeStyles.input, { height: 60, marginTop: 10 }]}
              placeholder="Optional landmark or detail about this spot..."
              value={reportDesc}
              onChangeText={setReportDesc}
            />

            <Action
              label={submittingReport ? "Submitting…" : "Submit safety report"}
              loading={submittingReport}
              onPress={() => void submitSafetyReport()}
            />
          </View>
        )}
      </Card>

      {meta?.disclaimer ? (
        <Text style={[themeStyles.caption, { textAlign: "center", marginHorizontal: 12, marginTop: 4 }]}>{meta.disclaimer}</Text>
      ) : null}

      <Action label="← Back Home" secondary onPress={() => router.back()} />
      <View style={{ height: 35 }} />
    </ScrollView>
  );
}

const routeStyles = StyleSheet.create({
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  gpsBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#0284C7",
    borderRadius: 8,
  },
  gpsBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  suggestionsContainer: {
    marginTop: 4,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    overflow: "hidden",
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  suggestionName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  suggestionDetails: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  quickTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tagPillActive: {
    backgroundColor: "#0284C7",
    borderColor: "#0284C7",
  },
  tagTxt: {
    fontSize: 11,
    color: "#334155",
    fontWeight: "600",
  },
  routeCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  routeCardActive: {
    borderColor: "#0284C7",
    backgroundColor: "#F0F9FF",
  },
  indicatorGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    backgroundColor: "#F8FAFC",
    padding: 8,
    borderRadius: 8,
  },
  indicatorItem: {
    alignItems: "center",
  },
  indicatorVal: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  indicatorLbl: {
    fontSize: 10,
    color: "#64748B",
    marginTop: 2,
  },
});
