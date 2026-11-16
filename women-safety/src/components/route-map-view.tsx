import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { Badge } from "@/components/ui";

export type RouteGeometry = {
  type: string;
  coordinates: [number, number][]; // [lng, lat]
};

export type EvaluatedRoute = {
  routeId: string;
  distance: number; // metres
  duration: number; // seconds
  safetyScore: number; // 0 - 100
  dataCoverage: number; // 0 - 100%
  isRecommended?: boolean;
  geometry: RouteGeometry;
  legs?: { summary?: string }[];
  indicators: {
    streetlightCoverage: number;
    policeProximity: number;
    crimeSafetyIndex: number;
    populationActivity: number;
    cctvAvailability: number;
    closestPoliceDistM?: number;
  };
};

type RouteMapViewProps = {
  routes: EvaluatedRoute[];
  selectedRouteId: string;
  originCoords: { latitude: number; longitude: number };
  destCoords: { latitude: number; longitude: number };
  originName?: string;
  destName?: string;
  safetyMarkers?: {
    name: string;
    locationType: string;
    latitude: number;
    longitude: number;
  }[];
};

export default function RouteMapView({
  routes,
  selectedRouteId,
  originCoords,
  destCoords,
  originName = "Current Location",
  destName = "Destination",
  safetyMarkers = [],
}: RouteMapViewProps) {
  const canvasWidth = 330;
  const canvasHeight = 260;
  const pad = 36;

  // Compute spatial bounding box enclosing all coordinates
  let minLat = Math.min(originCoords.latitude, destCoords.latitude);
  let maxLat = Math.max(originCoords.latitude, destCoords.latitude);
  let minLng = Math.min(originCoords.longitude, destCoords.longitude);
  let maxLng = Math.max(originCoords.longitude, destCoords.longitude);

  routes.forEach((r) => {
    (r.geometry?.coordinates || []).forEach(([lng, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
  });

  // Ensure non-zero delta
  const latDelta = Math.max(0.01, maxLat - minLat);
  const lngDelta = Math.max(0.01, maxLng - minLng);

  const project = (lat: number, lng: number) => {
    const x = pad + ((lng - minLng) / lngDelta) * (canvasWidth - pad * 2);
    // Invert Y
    const y = canvasHeight - pad - ((lat - minLat) / latDelta) * (canvasHeight - pad * 2);
    return { x, y };
  };

  const toSvgPath = (coords: [number, number][]) => {
    if (!coords || coords.length === 0) return "";
    return coords.reduce((acc, [lng, lat], idx) => {
      const { x, y } = project(lat, lng);
      return `${acc} ${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, "");
  };

  const originP = project(originCoords.latitude, originCoords.longitude);
  const destP = project(destCoords.latitude, destCoords.longitude);
  const activeRoute = routes.find((r) => r.routeId === selectedRouteId) || routes[0];

  return (
    <View style={styles.card}>
      {/* Route Badge Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>🗺️ Multi-Corridor Safety Map</Text>
          <Text style={styles.subtitle}>
            Comparing {routes.length} candidate paths by illumination, police & crime index
          </Text>
        </View>
        {activeRoute && (
          <Badge
            label={`${activeRoute.safetyScore}/100 SAFE`}
            variant={activeRoute.safetyScore >= 65 ? "success" : activeRoute.safetyScore >= 45 ? "warning" : "danger"}
          />
        )}
      </View>

      {/* SVG Map Canvas */}
      <View style={styles.svgContainer}>
        <Svg width={canvasWidth} height={canvasHeight}>
          <Defs>
            <LinearGradient id="mapBg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#0F172A" stopOpacity="0.98" />
              <Stop offset="100%" stopColor="#1E293B" stopOpacity="0.95" />
            </LinearGradient>
          </Defs>

          {/* Background Canvas */}
          <Rect x="0" y="0" width={canvasWidth} height={canvasHeight} rx="14" fill="url(#mapBg)" />

          {/* Subtle Grid Lines */}
          <Path d={`M 0 ${canvasHeight / 2} L ${canvasWidth} ${canvasHeight / 2}`} stroke="#334155" strokeWidth="0.8" strokeDasharray="4,4" />
          <Path d={`M ${canvasWidth / 2} 0 L ${canvasWidth / 2} ${canvasHeight}`} stroke="#334155" strokeWidth="0.8" strokeDasharray="4,4" />

          {/* Render Inactive Alternative Routes First */}
          {routes
            .filter((r) => r.routeId !== selectedRouteId)
            .map((route) => {
              const d = toSvgPath(route.geometry?.coordinates || []);
              return (
                <Path
                  key={route.routeId}
                  d={d}
                  stroke="#64748B"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity="0.65"
                />
              );
            })}

          {/* Render Active Selected Route with Glow */}
          {activeRoute && (
            <G>
              <Path
                d={toSvgPath(activeRoute.geometry?.coordinates || [])}
                stroke={activeRoute.isRecommended ? "#10B981" : "#38BDF8"}
                strokeWidth="7"
                strokeOpacity="0.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={toSvgPath(activeRoute.geometry?.coordinates || [])}
                stroke={activeRoute.isRecommended ? "#22C55E" : "#0284C7"}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </G>
          )}

          {/* Safety Infrastructure Nodes on Corridor */}
          {safetyMarkers.map((marker, idx) => {
            const { x, y } = project(marker.latitude, marker.longitude);
            const isPolice = marker.locationType === "police_station";
            const isHospital = marker.locationType === "hospital";
            return (
              <G key={`${marker.name}-${idx}`}>
                <Circle cx={x} cy={y} r="6" fill={isPolice ? "#3B82F6" : isHospital ? "#EF4444" : "#F59E0B"} stroke="#FFFFFF" strokeWidth="1" />
                <SvgText x={x} y={y - 8} fill="#E2E8F0" fontSize="8" fontWeight="600" textAnchor="middle">
                  {isPolice ? "👮" : isHospital ? "🏥" : "💡"}
                </SvgText>
              </G>
            );
          })}

          {/* Origin Pin (Start) */}
          <G>
            <Circle cx={originP.x} cy={originP.y} r="10" fill="#38BDF8" fillOpacity="0.3" />
            <Circle cx={originP.x} cy={originP.y} r="6" fill="#0284C7" stroke="#FFFFFF" strokeWidth="1.5" />
            <SvgText x={originP.x} y={originP.y + 16} fill="#BAE6FD" fontSize="9" fontWeight="bold" textAnchor="middle">
              START
            </SvgText>
          </G>

          {/* Destination Pin (End) */}
          <G>
            <Circle cx={destP.x} cy={destP.y} r="12" fill="#EF4444" fillOpacity="0.3" />
            <Circle cx={destP.x} cy={destP.y} r="6" fill="#DC2626" stroke="#FFFFFF" strokeWidth="1.5" />
            <SvgText x={destP.x} y={destP.y - 10} fill="#FECACA" fontSize="9" fontWeight="bold" textAnchor="middle">
              DEST
            </SvgText>
          </G>
        </Svg>

        {/* Legend Overlay */}
        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View style={[styles.legendIndicator, { backgroundColor: "#22C55E" }]} />
            <Text style={styles.legendTxt}>Safest Route</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendIndicator, { backgroundColor: "#64748B" }]} />
            <Text style={styles.legendTxt}>Alternative</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendIndicator, { backgroundColor: "#3B82F6" }]} />
            <Text style={styles.legendTxt}>Police Post</Text>
          </View>
        </View>
      </View>

      {/* Corridor Summary */}
      <View style={styles.infoRow}>
        <Text style={styles.infoTxt}>
          From: <Text style={{ fontWeight: "700" }}>{originName}</Text>
        </Text>
        <Text style={styles.infoTxt}>
          To: <Text style={{ fontWeight: "700" }}>{destName}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginVertical: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  svgContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    borderRadius: 14,
    overflow: "hidden",
  },
  legend: {
    position: "absolute",
    bottom: 8,
    left: 10,
    backgroundColor: "rgba(15, 23, 42, 0.88)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: "row",
    gap: 8,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendTxt: {
    fontSize: 9,
    color: "#E2E8F0",
    fontWeight: "600",
  },
  infoRow: {
    marginTop: 8,
    gap: 2,
  },
  infoTxt: {
    fontSize: 11,
    color: "#475569",
  },
});
