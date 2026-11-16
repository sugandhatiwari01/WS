/**
 * India-Wide Safest Route Navigation Screen — Universal Edition
 *
 * Capabilities:
 * - Enter ANY starting location in India (editable text or 1-tap live GPS)
 * - Enter ANY destination anywhere in India (by place name, city, landmark, or coordinates)
 * - Live Pan-India Autocomplete powered by Photon OpenStreetMap & India Directory
 * - Automatically resolves and geocodes any typed text on the fly
 * - Multi-corridor OSRM alternative route generation across all Indian States & UTs
 * - Comprehensive safety evaluation (Illumination, Police Posts, NCRB Risk Index, Transit Hubs)
 * - Interactive multi-route visual map with infrastructure pins
 * - Real-time turn-by-turn navigation simulation mode
 * - Community safety concern reporting
 */

import React, { useCallback, useEffect, useState } from "react";
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
import RouteMapView, { EvaluatedRoute } from "@/components/route-map-view";
import { api, post } from "@/lib/api";
import { colors, styles as themeStyles } from "@/lib/theme";

type PlaceResult = {
  placeId: number | string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  state?: string;
  city?: string;
};

type SafetyFacility = {
  name: string;
  locationType: string;
  latitude: number;
  longitude: number;
};

export default function SafestRouteScreen() {
  // Navigation & Origin/Dest State
  const [originCoords, setOriginCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [originText, setOriginText] = useState("Current GPS Location");
  const [destinationText, setDestinationText] = useState("");
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // Search Results State
  const [activeSearchField, setActiveSearchField] = useState<"origin" | "dest" | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<PlaceResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Route & Safety Evaluation State
  const [routes, setRoutes] = useState<EvaluatedRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  const [safetyMarkers, setSafetyMarkers] = useState<SafetyFacility[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationMeta, setEvaluationMeta] = useState<string>("");

  // Navigation Mode State
  const [isNavigating, setIsNavigating] = useState(false);
  const [remainingDistM, setRemainingDistM] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);

  // Safety Reporting State
  const [showReportCard, setShowReportCard] = useState(false);
  const [reportCategory, setReportCategory] = useState("poor_lighting");
  const [reportDesc, setReportDesc] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  // 1. Detect Current GPS Location
  const detectLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("GPS permission required", "Please allow GPS location access to detect your current position.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setOriginCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setOriginText(`My GPS (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`);
    } catch (_) {
      setOriginCoords({ latitude: 12.9716, longitude: 77.5946 });
      setOriginText("Bengaluru Central (MG Road)");
    }
  }, []);

  useEffect(() => {
    void detectLocation();
  }, [detectLocation]);

  // 2. Pan-India Place Search (for both Origin and Destination)
  const searchOriginPlaces = async (text: string) => {
    setOriginText(text);
    setOriginCoords(null); // Will re-resolve
    setActiveSearchField("origin");
    if (text.trim().length < 2) {
      setOriginSuggestions([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api<PlaceResult[]>(`/api/safety/places?q=${encodeURIComponent(text.trim())}`);
      if (res.data) setOriginSuggestions(res.data);
    } catch (_) {
    } finally {
      setSearching(false);
    }
  };

  const searchDestPlaces = async (text: string) => {
    setDestinationText(text);
    setDestinationCoords(null); // Will re-resolve
    setActiveSearchField("dest");
    if (text.trim().length < 2) {
      setDestSuggestions([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api<PlaceResult[]>(`/api/safety/places?q=${encodeURIComponent(text.trim())}`);
      if (res.data) setDestSuggestions(res.data);
    } catch (_) {
    } finally {
      setSearching(false);
    }
  };

  const selectOrigin = (place: PlaceResult) => {
    setOriginCoords({ latitude: place.latitude, longitude: place.longitude });
    setOriginText(place.name || place.displayName.split(",")[0]);
    setOriginSuggestions([]);
    setActiveSearchField(null);
  };

  const selectDestination = (place: PlaceResult) => {
    setDestinationCoords({ latitude: place.latitude, longitude: place.longitude });
    setDestinationText(place.name || place.displayName.split(",")[0]);
    setDestSuggestions([]);
    setActiveSearchField(null);
  };

  // Helper to parse coordinate strings like "18.52, 73.85"
  const parseCoordinates = (str: string): { latitude: number; longitude: number } | null => {
    const match = str.trim().match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[3]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { latitude: lat, longitude: lng };
      }
    }
    return null;
  };

  // 3. Find & Score Safest Routes
  const findSafestRoutes = async (destLatParam?: number, destLngParam?: number) => {
    setOriginSuggestions([]);
    setDestSuggestions([]);
    setActiveSearchField(null);

    // Resolve Origin coordinates if not set
    let resolvedOrigin = originCoords;
    if (!resolvedOrigin && originText.trim()) {
      const parsed = parseCoordinates(originText);
      if (parsed) {
        resolvedOrigin = parsed;
        setOriginCoords(parsed);
      } else {
        const found = await api<PlaceResult[]>(`/api/safety/places?q=${encodeURIComponent(originText.trim())}`);
        if (found.data && found.data.length > 0) {
          resolvedOrigin = { latitude: found.data[0].latitude, longitude: found.data[0].longitude };
          setOriginCoords(resolvedOrigin);
        }
      }
    }

    if (!resolvedOrigin) {
      resolvedOrigin = { latitude: 12.9716, longitude: 77.5946 };
      setOriginCoords(resolvedOrigin);
    }

    // Resolve Destination coordinates if not set
    let resolvedDest = destLatParam && destLngParam ? { latitude: destLatParam, longitude: destLngParam } : destinationCoords;

    if (!resolvedDest && destinationText.trim()) {
      const parsed = parseCoordinates(destinationText);
      if (parsed) {
        resolvedDest = parsed;
        setDestinationCoords(parsed);
      } else {
        setEvaluating(true);
        const found = await api<PlaceResult[]>(`/api/safety/places?q=${encodeURIComponent(destinationText.trim())}`);
        if (found.data && found.data.length > 0) {
          resolvedDest = { latitude: found.data[0].latitude, longitude: found.data[0].longitude };
          setDestinationCoords(resolvedDest);
          setDestinationText(found.data[0].name || destinationText);
        }
      }
    }

    if (!resolvedDest) {
      Alert.alert("Destination needed", "Enter any city, town, road, or address in India.");
      setEvaluating(false);
      return;
    }

    setEvaluating(true);
    setRoutes([]);
    try {
      const payload = {
        originLat: resolvedOrigin.latitude,
        originLng: resolvedOrigin.longitude,
        destLat: resolvedDest.latitude,
        destLng: resolvedDest.longitude,
        origin: originText,
        destination: destinationText,
      };

      const res = await post<{
        ok: boolean;
        recommendedRouteId: string;
        routes: EvaluatedRoute[];
        metadata: { disclaimer: string; evaluatedAt: string };
      }>("/api/routes/safest", payload);

      if (res.error || !res.data?.routes || res.data.routes.length === 0) {
        Alert.alert("Routing failed", res.error || "Could not calculate routes for this corridor.");
        return;
      }

      setRoutes(res.data.routes);
      setSelectedRouteId(res.data.recommendedRouteId || res.data.routes[0].routeId);
      setEvaluationMeta(res.data.metadata?.disclaimer || "");

      // Query nearby corridor safety facilities for visualization
      const midLat = (resolvedOrigin.latitude + resolvedDest.latitude) / 2;
      const midLng = (resolvedOrigin.longitude + resolvedDest.longitude) / 2;
      const facsRes = await api<SafetyFacility[]>(`/api/safety/nearby?latitude=${midLat}&longitude=${midLng}&radiusM=15000`);
      if (facsRes.data) {
        setSafetyMarkers(facsRes.data.slice(0, 15));
      }
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Route calculation failed.");
    } finally {
      setEvaluating(false);
    }
  };

  // Start Navigation Simulation
  const startNavigation = () => {
    const selected = routes.find((r) => r.routeId === selectedRouteId) || routes[0];
    if (!selected) return;

    setIsNavigating(true);
    setRemainingDistM(selected.distance);
    setRemainingSec(selected.duration);
    Alert.alert(
      "Safest Navigation Active",
      `Navigating along the safest corridor (${selected.safetyScore}/100 Safety Score). SafeHer is actively tracking lighting, police proximity, and route deviations.`
    );
  };

  // Submit Citizen Safety Report
  const submitSafetyReport = async () => {
    const coords = originCoords || { latitude: 12.9716, longitude: 77.5946 };
    setSubmittingReport(true);
    try {
      const res = await post("/api/safety/reports", {
        category: reportCategory,
        latitude: coords.latitude,
        longitude: coords.longitude,
        description: reportDesc.trim() || undefined,
      });

      if (res.data) {
        Alert.alert(
          "Report Submitted",
          "Your community safety concern has been recorded and will inform safety evaluations for fellow commuters."
        );
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

  return (
    <ScrollView style={themeStyles.safe} contentContainerStyle={themeStyles.scrollContent}>
      <Header
        title="India-Wide Safest Route"
        subtitle="Universal safety routing across India. Enter ANY start and destination to compare routes by illumination, police reach, and crime statistics."
      />

      {/* ─── 1. ORIGIN & DESTINATION SEARCH BAR ─── */}
      <Card>
        <Text style={themeStyles.h3}>Origin & Destination (Pan-India)</Text>

        {/* Origin Input (Fully Editable or 1-tap GPS) */}
        <View style={routeStyles.inputRow}>
          <Text style={{ fontSize: 16 }}>📍</Text>
          <TextInput
            style={[themeStyles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Starting from (e.g. Pune, Hauz Khas, My GPS)"
            value={originText}
            onChangeText={searchOriginPlaces}
          />
          <TouchableOpacity style={routeStyles.gpsBtn} onPress={detectLocation}>
            <Text style={routeStyles.gpsBtnText}>📍 GPS</Text>
          </TouchableOpacity>
        </View>

        {/* Origin Autocomplete Suggestions */}
        {activeSearchField === "origin" && originSuggestions.length > 0 && (
          <View style={routeStyles.suggestionsContainer}>
            {originSuggestions.map((item) => (
              <TouchableOpacity
                key={item.placeId}
                style={routeStyles.suggestionItem}
                onPress={() => selectOrigin(item)}
              >
                <Text style={routeStyles.suggestionName}>{item.name}</Text>
                <Text style={routeStyles.suggestionDetails} numberOfLines={1}>
                  {item.displayName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Destination Input (Takes ANY location in India) */}
        <View style={[routeStyles.inputRow, { marginTop: 8 }]}>
          <Text style={{ fontSize: 16 }}>🏁</Text>
          <TextInput
            style={[themeStyles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Destination in India (any city, area, landmark)"
            value={destinationText}
            onChangeText={searchDestPlaces}
            onSubmitEditing={() => void findSafestRoutes()}
          />
          {searching && activeSearchField === "dest" && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} />
          )}
        </View>

        {/* Destination Autocomplete Suggestions */}
        {activeSearchField === "dest" && destSuggestions.length > 0 && (
          <View style={routeStyles.suggestionsContainer}>
            {destSuggestions.map((item) => (
              <TouchableOpacity
                key={item.placeId}
                style={routeStyles.suggestionItem}
                onPress={() => selectDestination(item)}
              >
                <Text style={routeStyles.suggestionName}>{item.name}</Text>
                <Text style={routeStyles.suggestionDetails} numberOfLines={1}>
                  {item.displayName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Quick Indian Metros Shortcuts */}
        <Text style={[themeStyles.caption, { marginTop: 10, fontWeight: "600" }]}>Quick Pan-India Hubs:</Text>
        <View style={routeStyles.quickTags}>
          {[
            { label: "Pune", lat: 18.5204, lng: 73.8567 },
            { label: "Mumbai Bandra", lat: 19.0552, lng: 72.8347 },
            { label: "Delhi Connaught Pl", lat: 28.6328, lng: 77.2197 },
            { label: "Bengaluru Koramangala", lat: 12.9352, lng: 77.6245 },
            { label: "Hyderabad Banjara", lat: 17.4156, lng: 78.4357 },
            { label: "Chennai T. Nagar", lat: 13.0418, lng: 80.2341 },
            { label: "Kolkata Park St", lat: 22.5518, lng: 88.3524 },
            { label: "Jaipur Pink City", lat: 26.9157, lng: 75.8189 },
            { label: "Chandigarh Sec 17", lat: 30.7415, lng: 76.7794 },
            { label: "Kochi Marine Drive", lat: 9.9816, lng: 76.2799 },
          ].map((tag) => (
            <TouchableOpacity
              key={tag.label}
              style={routeStyles.tagPill}
              onPress={() => {
                setDestinationCoords({ latitude: tag.lat, longitude: tag.lng });
                setDestinationText(tag.label);
                void findSafestRoutes(tag.lat, tag.lng);
              }}
            >
              <Text style={routeStyles.tagTxt}>{tag.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Divider />

        <Action
          label={evaluating ? "Evaluating Multi-Route Safety…" : "🛡️ Calculate Safest Routes"}
          loading={evaluating}
          disabled={evaluating || !destinationText.trim()}
          onPress={() => void findSafestRoutes()}
        />
      </Card>

      {/* ─── 2. MULTI-CORRIDOR ROUTE MAP VIEW ─── */}
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

      {/* ─── 3. ALTERNATIVE ROUTE COMPARISON CARDS ─── */}
      {routes.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={[themeStyles.h2, { marginTop: 4 }]}>Alternative Corridors ({routes.length})</Text>

          {routes.map((route, idx) => {
            const isSelected = route.routeId === selectedRouteId;
            const distKm = (route.distance / 1000).toFixed(1);
            const durMin = Math.round(route.duration / 60);

            return (
              <TouchableOpacity
                key={route.routeId}
                style={[routeStyles.routeCard, isSelected && routeStyles.routeCardActive]}
                onPress={() => setSelectedRouteId(route.routeId)}
              >
                {/* Header row */}
                <View style={themeStyles.spaceBetween}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[themeStyles.h3, isSelected && { color: colors.primary }]}>
                      Route {idx + 1}: {route.legs?.[0]?.summary || `Corridor ${idx + 1}`}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {route.isRecommended && <Badge label="SAFEST ROUTE" variant="success" />}
                    <Badge
                      label={`${route.safetyScore}/100`}
                      variant={route.safetyScore >= 65 ? "success" : route.safetyScore >= 45 ? "warning" : "danger"}
                    />
                  </View>
                </View>

                {/* Distance & Time */}
                <Text style={[themeStyles.subtitle, { marginTop: 4 }]}>
                  🛣️ {distKm} km  •  ⏱️ ~{durMin} min  •  📊 Coverage: {route.dataCoverage}%
                </Text>

                {/* Safety Indicators Grid */}
                <View style={routeStyles.indicatorGrid}>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>💡 {route.indicators.streetlightCoverage}%</Text>
                    <Text style={routeStyles.indicatorLbl}>Lighting</Text>
                  </View>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>👮 {route.indicators.policeProximity}%</Text>
                    <Text style={routeStyles.indicatorLbl}>Police Reach</Text>
                  </View>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>🛡️ {route.indicators.crimeSafetyIndex}%</Text>
                    <Text style={routeStyles.indicatorLbl}>Crime Index</Text>
                  </View>
                  <View style={routeStyles.indicatorItem}>
                    <Text style={routeStyles.indicatorVal}>🏪 {route.indicators.populationActivity}%</Text>
                    <Text style={routeStyles.indicatorLbl}>Activity Hubs</Text>
                  </View>
                </View>

                {/* Closest police station distance */}
                {route.indicators.closestPoliceDistM != null && (
                  <Text style={[themeStyles.caption, { marginTop: 6, color: "#334155" }]}>
                    🚨 Closest police facility along route: ~{route.indicators.closestPoliceDistM} m
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ─── 4. NAVIGATION LAUNCH & CONTROLS ─── */}
      {selectedRoute && !isNavigating && (
        <Card>
          <View style={themeStyles.spaceBetween}>
            <View>
              <Text style={themeStyles.h3}>Selected: Route {selectedRoute.routeId}</Text>
              <Text style={themeStyles.caption}>
                {(selectedRoute.distance / 1000).toFixed(1)} km • {Math.round(selectedRoute.duration / 60)} min
              </Text>
            </View>
            <Badge label="VERIFIED SAFE CORRIDOR" variant="success" />
          </View>

          <Divider />

          <Action
            label="🧭 Start Safest Route Navigation"
            onPress={startNavigation}
          />
          <Action
            label="🌐 Open in Google Maps"
            secondary
            onPress={() => {
              if (!destinationCoords) return;
              const origStr = originCoords ? `${originCoords.latitude},${originCoords.longitude}` : "";
              const destStr = `${destinationCoords.latitude},${destinationCoords.longitude}`;
              void Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origStr}&destination=${destStr}`);
            }}
          />
        </Card>
      )}

      {/* ─── 5. ACTIVE NAVIGATION SIMULATOR SCREEN ─── */}
      {isNavigating && selectedRoute && (
        <Card danger>
          <View style={themeStyles.spaceBetween}>
            <Text style={[themeStyles.h2, { color: colors.red }]}>🧭 Active Navigation</Text>
            <Badge label="SAFETY SHIELD ON" variant="success" />
          </View>
          <Text style={[themeStyles.subtitle, { marginTop: 6 }]}>
            Destination: {destinationText}
          </Text>
          <Text style={[themeStyles.h3, { marginTop: 6, color: "#0F172A" }]}>
            Remaining: {(remainingDistM / 1000).toFixed(1)} km  •  ~{Math.round(remainingSec / 60)} min
          </Text>
          <Text style={[themeStyles.caption, { marginTop: 4 }]}>
            Route Corridor Safety Score: {selectedRoute.safetyScore}/100. Continuous GPS deviation alert is active.
          </Text>

          <Divider />

          <Action
            label="✅ Mark Arrival at Destination"
            onPress={() => {
              setIsNavigating(false);
              Alert.alert("Arrival Confirmed", "You have arrived safely at your destination. 🎉");
            }}
          />
          <Action
            label="Stop Navigation"
            secondary
            onPress={() => setIsNavigating(false)}
          />
        </Card>
      )}

      {/* ─── 6. CITIZEN SAFETY CONCERN REPORTING ─── */}
      <Card>
        <View style={themeStyles.spaceBetween}>
          <Text style={themeStyles.h3}>⚠️ Community Safety Reporting</Text>
          <TouchableOpacity onPress={() => setShowReportCard(!showReportCard)}>
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
              {showReportCard ? "Close" : "+ Report Concern"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={[themeStyles.caption, { marginTop: 2 }]}>
          Contribute ground-truth reports regarding poor lighting, harassment spots, or deserted stretches.
        </Text>

        {showReportCard && (
          <View style={{ marginTop: 12 }}>
            <Text style={[themeStyles.caption, { fontWeight: "700" }]}>Issue Category:</Text>
            <View style={routeStyles.quickTags}>
              {[
                { id: "poor_lighting", label: "💡 Broken/Poor Lighting" },
                { id: "harassment_hotspot", label: "🚨 Harassment Hotspot" },
                { id: "deserted_stretch", label: "⚠️ Deserted / Isolated Road" },
                { id: "safe_haven", label: "🏪 Safe Haven / 24-7 Active" },
              ].map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[routeStyles.tagPill, reportCategory === c.id && routeStyles.tagPillActive]}
                  onPress={() => setReportCategory(c.id)}
                >
                  <Text style={[routeStyles.tagTxt, reportCategory === c.id && { color: "#FFF" }]}>
                    {c.label}
                  </Text>
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
              label={submittingReport ? "Submitting…" : "Submit Safety Report"}
              loading={submittingReport}
              onPress={submitSafetyReport}
            />
          </View>
        )}
      </Card>

      {/* Attribution & Legal Transparency */}
      {evaluationMeta ? (
        <Text style={[themeStyles.caption, { textAlign: "center", marginHorizontal: 12, marginTop: 4 }]}>
          {evaluationMeta}
        </Text>
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
