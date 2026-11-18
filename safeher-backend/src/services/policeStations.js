/**
 * Real police stations near a point, from OpenStreetMap (see osmPlaces.js for sources and caching).
 * Nothing is invented: a station's phone is returned only if OpenStreetMap lists one.
 */

const { loadPlaces, peekPlaces, distanceKm, MAX_RADIUS_KM } = require("./osmPlaces");

const stationKind = (name = "") =>
  /\b(post|chowki|chauki|chowky|outpost|booth|picket|beat)\b/i.test(name) ? "Police post" : "Police station";

const UNNAMED = "Police station (name not listed on map)";

const toStation = (p, lat, lng) => ({
  _id: p.id,
  stationId: p.id,
  name: p.name || UNNAMED,
  type: stationKind(p.name || ""),
  phone: p.phone,
  address: p.address,
  latitude: p.latitude,
  longitude: p.longitude,
  osmUrl: p.osmUrl,
  distanceKm: Math.round(distanceKm(lat, lng, p.latitude, p.longitude) * 100) / 100,
  source: "openstreetmap",
});

/**
 * Real police stations within radiusKm of (lat, lng), nearest first.
 * coveredKm is how far the search really reached (smaller than radiusKm only in very dense areas
 * when the backup source returns its maximum of 50 stations).
 * @returns {Promise<{ stations: object[], provider: string, radiusKm: number, coveredKm: number }>}
 */
async function findNearbyPoliceStations(lat, lng, radiusKm = 10) {
  const radius = Math.min(Math.max(Number(radiusKm) || 10, 0.5), MAX_RADIUS_KM);
  const { places, provider, coveredKm } = await loadPlaces("police", lat, lng, radius);
  const stations = places
    .map((p) => toStation(p, lat, lng))
    .filter((s) => s.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return { stations, provider, radiusKm: radius, coveredKm: Math.min(radius, Math.round(coveredKm * 10) / 10) };
}

/** Nearest station from already-cached data only (instant; null if this area hasn't been looked up). */
function nearestFromCache(lat, lng, radiusKm = 10) {
  const entry = peekPlaces("police", lat, lng, 1); // any cached lookup covering this spot
  if (!entry) return null;
  let best = null;
  for (const p of entry.places) {
    const s = toStation(p, lat, lng);
    if (s.distanceKm <= radiusKm && (!best || s.distanceKm < best.distanceKm)) best = s;
  }
  return best;
}

/** Nearest real station or null — never throws (used to enrich SOS incidents). */
async function findNearestPoliceStation(lat, lng, radiusKm = 10) {
  try {
    return (await findNearbyPoliceStations(lat, lng, radiusKm)).stations[0] || null;
  } catch (_) {
    return null;
  }
}

module.exports = { findNearbyPoliceStations, findNearestPoliceStation, nearestFromCache, distanceKm, MAX_RADIUS_KM };
