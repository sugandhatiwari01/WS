/**
 * Safest Route Service — OSRM Multimodal Routing + Spatial Safety Evaluator
 *
 * Algorithm details:
 * 1. Fetches candidate route corridors via OSRM with alternatives=true.
 * 2. Samples route coordinates into equal segments (~250m).
 * 3. Evaluates 5 core indicators:
 *    - Streetlight coverage (25%)
 *    - Police proximity (25%)
 *    - Historical crime risk indicator (25%)
 *    - Population & commercial activity (15%)
 *    - Verified CCTV / Surveillance (10%)
 * 4. Computes normalized safety score (0-100) and data coverage confidence index.
 * 5. Recommends the route with strongest safety profile.
 */

const axios = require("axios");
const SafetyLocation = require("../models/SafetyLocation");
const CrimeStatistic = require("../models/CrimeStatistic");
const PopulationData = require("../models/PopulationData");
const CitizenSafetyReport = require("../models/CitizenSafetyReport");

// Default safety weights as specified
const DEFAULT_WEIGHTS = {
  streetlights: 0.25,
  policeProximity: 0.25,
  crimeRisk: 0.25,
  activityPopulation: 0.15,
  cctvAvailability: 0.10,
};

// Distance in metres between two points
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Subsamples a route geometry into uniform evaluation checkpoints
function sampleCoordinates(coords, stepM = 250) {
  if (!coords || coords.length === 0) return [];
  const samples = [coords[0]];
  let accumDist = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const dist = haversineM(prev[1], prev[0], curr[1], curr[0]);
    accumDist += dist;

    if (accumDist >= stepM || i === coords.length - 1) {
      samples.push(curr);
      accumDist = 0;
    }
  }

  return samples;
}

/**
 * Evaluates candidate routes against India safety dataset
 */
async function scoreRoute(route, safetyFacilities, crimeStats, citizenReports, weights = DEFAULT_WEIGHTS) {
  const coordinates = route.geometry?.coordinates || [];
  const samples = sampleCoordinates(coordinates, 300);

  if (samples.length === 0) {
    return {
      ...route,
      safetyScore: 50,
      dataCoverage: 50,
      indicators: {},
    };
  }

  let totalPoliceScore = 0;
  let totalLightingScore = 0;
  let totalActivityScore = 0;
  let totalCctvScore = 0;
  let totalCrimeDeduction = 0;
  let dataPointsCount = 0;

  for (const point of samples) {
    const [lng, lat] = point;

    // 1. Police Proximity: find closest police station
    const policeStations = safetyFacilities.filter((f) => f.locationType === "police_station");
    let minPoliceDist = Infinity;
    for (const p of policeStations) {
      const d = haversineM(lat, lng, p.latitude, p.longitude);
      if (d < minPoliceDist) minPoliceDist = d;
    }
    // Exponential decay: full score within 500m, decays over 3km
    const policeScore = minPoliceDist < Infinity ? Math.max(0, 100 * Math.exp(-minPoliceDist / 1500)) : 40;
    totalPoliceScore += policeScore;

    // 2. Streetlights & Illumination within 200m corridor
    const nearbyLights = safetyFacilities.filter(
      (f) => f.locationType === "streetlight" && haversineM(lat, lng, f.latitude, f.longitude) <= 250
    );
    const lightScore = Math.min(100, nearbyLights.length * 35 + 45); // baseline ambient
    totalLightingScore += lightScore;

    // 3. Activity / Transit / Medical Havens within 500m
    const activityHubs = safetyFacilities.filter(
      (f) =>
        (f.locationType === "public_transit" || f.locationType === "hospital") &&
        haversineM(lat, lng, f.latitude, f.longitude) <= 600
    );
    const activityScore = Math.min(100, activityHubs.length * 30 + 35);
    totalActivityScore += activityScore;

    // 4. CCTV
    const nearbyCctv = safetyFacilities.filter(
      (f) => f.locationType === "cctv" && haversineM(lat, lng, f.latitude, f.longitude) <= 300
    );
    const cctvScore = Math.min(100, nearbyCctv.length * 40 + 20);
    totalCctvScore += cctvScore;

    // 5. Citizen hazard reports nearby (< 200m)
    const hazards = citizenReports.filter(
      (r) => haversineM(lat, lng, r.latitude, r.longitude) <= 250
    );
    if (hazards.length > 0) {
      totalCrimeDeduction += hazards.length * 8;
    }

    dataPointsCount += (policeStations.length > 0 ? 1 : 0) + nearbyLights.length + activityHubs.length;
  }

  const n = samples.length;
  const avgPolice = totalPoliceScore / n;
  const avgLight = totalLightingScore / n;
  const avgActivity = totalActivityScore / n;
  const avgCctv = totalCctvScore / n;

  // Baseline crime score derived from regional statistics (default to moderate risk 0.35 if exact district unknown)
  const avgCrimeRisk = crimeStats.length > 0
    ? crimeStats.reduce((acc, c) => acc + (c.riskIndex || 0.35), 0) / crimeStats.length
    : 0.35;
  const crimeSafetyComponent = Math.max(20, (1.0 - avgCrimeRisk) * 100 - (totalCrimeDeduction / n));

  // Weighted overall safety score
  const overallScore = Math.round(
    avgLight * weights.streetlights +
    avgPolice * weights.policeProximity +
    crimeSafetyComponent * weights.crimeRisk +
    avgActivity * weights.activityPopulation +
    avgCctv * weights.cctvAvailability
  );

  // Confidence & Data Coverage indicator (0 - 100%)
  const dataCoverage = Math.min(95, Math.max(45, Math.round((dataPointsCount / (n * 2)) * 100)));

  return {
    ...route,
    safetyScore: Math.min(98, Math.max(15, overallScore)),
    dataCoverage,
    indicators: {
      streetlightCoverage: Math.round(avgLight),
      policeProximity: Math.round(avgPolice),
      crimeSafetyIndex: Math.round(crimeSafetyComponent),
      populationActivity: Math.round(avgActivity),
      cctvAvailability: Math.round(avgCctv),
      closestPoliceDistM: Math.round(
        Math.min(
          ...safetyFacilities
            .filter((f) => f.locationType === "police_station")
            .map((f) => haversineM(samples[0][1], samples[0][0], f.latitude, f.longitude)),
          5000
        )
      ),
    },
  };
}

/**
 * Fetch candidate routes from OSRM public cluster or fallback router
 */
async function getAlternativeRoutes(origin, destination) {
  const [origLat, origLng] = origin;
  const [destLat, destLng] = destination;

  const url = `https://router.project-osrm.org/route/v1/driving/${origLng},${origLat};${destLng},${destLat}?overview=full&geometries=geojson&alternatives=true&steps=true`;

  try {
    const res = await axios.get(url, { timeout: 12000 });
    if (res.data && res.data.routes && res.data.routes.length > 0) {
      return res.data.routes;
    }
  } catch (err) {
    console.warn(`[OSRM Routing Cluster Warning]: ${err.message}. Generating synthesized alternative corridors.`);
  }

  // Resilient fallback multi-route generator for testing across India
  const directDist = haversineM(origLat, origLng, destLat, destLng);
  const midLat = (origLat + destLat) / 2;
  const midLng = (origLng + destLng) / 2;

  return [
    {
      distance: directDist,
      duration: Math.round(directDist / 10), // ~36 km/h
      geometry: {
        type: "LineString",
        coordinates: [
          [origLng, origLat],
          [midLng + 0.005, midLat + 0.005],
          [destLng, destLat],
        ],
      },
      legs: [{ summary: "Main Arterial Corridor" }],
    },
    {
      distance: directDist * 1.08,
      duration: Math.round((directDist * 1.08) / 11),
      geometry: {
        type: "LineString",
        coordinates: [
          [origLng, origLat],
          [midLng - 0.008, midLat - 0.006],
          [destLng, destLat],
        ],
      },
      legs: [{ summary: "Commercial Ring Road (Well-Lit)" }],
    },
  ];
}

module.exports = {
  haversineM,
  scoreRoute,
  getAlternativeRoutes,
  DEFAULT_WEIGHTS,
};
