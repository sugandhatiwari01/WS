/**
 * Safest Route & Geospatial Safety API — works for any place in India.
 *
 * - GET  /api/safety/places   Place search anywhere in India (Photon, Nominatim backup)
 * - POST /api/routes/safest   Real alternative routes scored on real open data (see services/routeSafety.js)
 * - GET  /api/safety/nearby   Real police stations, hospitals and transit near a point
 * - POST /api/safety/reports  Community safety reports
 * - GET  /api/safety/reports
 */

const express = require("express");
const { body, query, validationResult } = require("express-validator");
const CitizenSafetyReport = require("../models/CitizenSafetyReport");
const { evaluateSafestRoutes, haversineM } = require("../services/routeSafety");
const { loadPlaces, photonSearch, nominatimSearch, MAX_RADIUS_KM } = require("../services/osmPlaces");

const router = express.Router();

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg });
  next();
};

/** India bounding box (lng,lat,lng,lat) — keeps search results inside the country. */
const INDIA_BBOX = "68.0,6.4,97.6,37.2";
const inIndia = (lat, lng) => lat >= 6.4 && lat <= 37.2 && lng >= 68.0 && lng <= 97.6;
/** Areas (city, town, village, neighbourhood…) are listed before roads and shops with the same name. */
const AREA_TYPES = new Set(["city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter", "locality", "district", "county", "state_district", "borough", "isolated_dwelling"]);

/**
 * Place search anywhere in India.
 * 1. "lat, lng" typed directly
 * 2. Photon (OpenStreetMap), restricted to India and biased towards `near` when given
 * 3. Nominatim (OpenStreetMap) if Photon fails or finds nothing
 */
async function geocodeIndiaPlace(queryStr, near) {
  if (!queryStr || typeof queryStr !== "string") return [];
  const q = queryStr.trim();
  if (q.length < 2) return [];

  const coordMatch = q.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[3]);
    if (!inIndia(lat, lng)) return [];
    return [{ placeId: `coords-${lat}-${lng}`, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, displayName: "GPS coordinates", latitude: lat, longitude: lng, state: null, city: null }];
  }

  let results = [];
  try {
    const params = new URLSearchParams({ q, limit: "10", bbox: INDIA_BBOX, lang: "en" });
    if (near) {
      params.set("lat", String(near.latitude));
      params.set("lon", String(near.longitude));
    }
    const data = await photonSearch(params);
    results = (data?.features || [])
      .filter((f) => f.properties?.countrycode === "IN" || f.properties?.country === "India")
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || q;
        const context = [p.district || p.locality, p.city, p.state].filter((x) => x && x !== name);
        return {
          placeId: `osm-${p.osm_type}-${p.osm_id}`,
          name,
          displayName: [...new Set([name, ...context, "India"])].join(", "),
          latitude: lat,
          longitude: lng,
          state: p.state || null,
          city: p.city || p.county || null,
          isArea: p.osm_key === "place" || AREA_TYPES.has(p.type),
        };
      });
    // Stable sort: areas first, otherwise keep Photon's relevance order.
    results = results.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.isArea) - Number(a.r.isArea) || a.i - b.i).map(({ r }) => r);
  } catch (err) {
    console.warn("[place search] Photon failed:", err.message);
  }

  if (results.length === 0) {
    // Indian names are often written joined or split ("Raj Nagar" / "Rajnagar"), so also try the joined form.
    const words = q.split(/\s+/);
    const variants = [q, ...(words.length >= 2 ? [[words[0] + words[1].toLowerCase(), ...words.slice(2)].join(" ")] : [])];
    for (const variant of variants) {
      const params = new URLSearchParams({ q: variant, format: "json", addressdetails: "1", limit: "6", countrycodes: "in" });
      // Prefer (not restrict to) places within ~50 km of the user.
      if (near) params.set("viewbox", [near.longitude - 0.5, near.latitude + 0.5, near.longitude + 0.5, near.latitude - 0.5].join(","));
      let data = null;
      for (let attempt = 0; attempt < 2 && data == null; attempt++) {
        try {
          data = await nominatimSearch(params);
        } catch (err) {
          console.warn("[place search] Nominatim failed:", err.message);
        }
      }
      const found = (Array.isArray(data) ? data : []).map((item) => ({
        placeId: `nominatim-${item.place_id}`,
        name: item.display_name.split(",")[0],
        displayName: item.display_name,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        state: item.address?.state || null,
        city: item.address?.city || item.address?.town || item.address?.village || null,
        isArea: ["city", "town", "village", "suburb", "neighbourhood", "locality", "quarter"].includes(item.addresstype),
      }));
      if (variant === q) {
        // The spelling the user typed: keep its results, areas first.
        results = found.map((r, i) => ({ r, i })).sort((x, y) => Number(y.r.isArea) - Number(x.r.isArea) || x.i - y.i).map(({ r }) => r);
        if (results.some((r) => r.isArea)) break; // found an actual area — no need to try the joined spelling
      } else {
        // Joined spelling: only add places that are actual areas, or use it when the typed spelling found nothing.
        const areas = found.filter((r) => r.isArea);
        results = areas.length ? [...areas, ...results] : results.length ? results : found;
      }
    }
  }

  // Drop near-duplicates (same name within ~300 m).
  const deduped = [];
  for (const item of results) {
    if (!deduped.some((d) => d.name === item.name && haversineM(d.latitude, d.longitude, item.latitude, item.longitude) < 300)) deduped.push(item);
  }
  return deduped.slice(0, 8);
}

/* ─── 1. POST /api/routes/safest ─────────────────────────────────────── */
router.post(
  "/safest",
  body("originLat").optional().isFloat({ min: -90, max: 90 }),
  body("originLng").optional().isFloat({ min: -180, max: 180 }),
  body("destLat").optional().isFloat({ min: -90, max: 90 }),
  body("destLng").optional().isFloat({ min: -180, max: 180 }),
  body("origin").optional().isString(),
  body("destination").optional().isString(),
  body("mode").optional().isIn(["walking", "driving"]).withMessage("mode must be walking or driving"),
  validate,
  async (req, res, next) => {
    try {
      const resolve = async (lat, lng, text, near) => {
        if (lat != null && lng != null) return [parseFloat(lat), parseFloat(lng)];
        if (!text) return null;
        const found = await geocodeIndiaPlace(text, near);
        return found.length ? [found[0].latitude, found[0].longitude] : null;
      };
      const origin = await resolve(req.body.originLat, req.body.originLng, req.body.origin);
      const dest = await resolve(req.body.destLat, req.body.destLng, req.body.destination, origin && { latitude: origin[0], longitude: origin[1] });
      if (!origin) return res.status(400).json({ error: "Could not find the starting point. Use GPS or type a place in India." });
      if (!dest) return res.status(400).json({ error: "Could not find the destination. Try a more specific place name in India." });
      if (!inIndia(...origin) || !inIndia(...dest)) return res.status(400).json({ error: "Both places must be in India." });

      const minLat = Math.min(origin[0], dest[0]) - 0.05, maxLat = Math.max(origin[0], dest[0]) + 0.05;
      const minLng = Math.min(origin[1], dest[1]) - 0.05, maxLng = Math.max(origin[1], dest[1]) + 0.05;
      const reports = (await CitizenSafetyReport.find({})).filter(
        (r) => r.latitude >= minLat && r.latitude <= maxLat && r.longitude >= minLng && r.longitude <= maxLng
      );

      const result = await evaluateSafestRoutes(origin, dest, { mode: req.body.mode || "walking", reports });
      res.json({
        ok: true,
        origin: { latitude: origin[0], longitude: origin[1] },
        destination: { latitude: dest[0], longitude: dest[1] },
        recommendedRouteId: result.routes.find((r) => r.isRecommended)?.routeId || result.routes[0]?.routeId,
        ...result,
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

/* ─── 2. GET /api/safety/nearby — real police, hospitals and transit ─── */
router.get(
  "/nearby",
  query("latitude").isFloat({ min: -90, max: 90 }).withMessage("latitude is required"),
  query("longitude").isFloat({ min: -180, max: 180 }).withMessage("longitude is required"),
  query("radiusM").optional().isInt({ min: 100, max: MAX_RADIUS_KM * 1000 }),
  validate,
  async (req, res, next) => {
    try {
      const lat = Number(req.query.latitude);
      const lng = Number(req.query.longitude);
      const radiusM = req.query.radiusM ? Number(req.query.radiusM) : 5000;
      const types = { police: "police_station", hospital: "hospital", transit: "public_transit" };
      const wanted = req.query.type ? Object.keys(types).filter((k) => types[k] === req.query.type) : Object.keys(types);
      const lists = await Promise.allSettled(wanted.map((c) => loadPlaces(c, lat, lng)));
      if (lists.every((l) => l.status === "rejected")) return res.status(503).json({ error: "Could not reach OpenStreetMap right now." });
      const nearby = lists
        .flatMap((l, i) => (l.status === "fulfilled" ? l.value.places.map((p) => ({ ...p, locationType: types[wanted[i]] })) : []))
        .map((p) => ({ name: p.name || "Unnamed", locationType: p.locationType, latitude: p.latitude, longitude: p.longitude, phone: p.phone, osmUrl: p.osmUrl, distanceM: Math.round(haversineM(lat, lng, p.latitude, p.longitude)) }))
        .filter((p) => p.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM);
      res.json(nearby);
    } catch (err) {
      next(err);
    }
  }
);

/* ─── 3. GET /api/safety/places ──────────────────────────────────────── */
router.get(
  "/places",
  query("nearLat").optional().isFloat({ min: -90, max: 90 }),
  query("nearLng").optional().isFloat({ min: -180, max: 180 }),
  validate,
  async (req, res) => {
    try {
      const near = req.query.nearLat != null && req.query.nearLng != null ? { latitude: Number(req.query.nearLat), longitude: Number(req.query.nearLng) } : undefined;
      res.json(await geocodeIndiaPlace(req.query.q, near));
    } catch (err) {
      console.warn("[Places Route Warning]:", err.message);
      res.json([]);
    }
  }
);

/* ─── 4. POST /api/safety/reports (Citizen Safety Reporting) ─────────── */
router.post(
  "/reports",
  body("category")
    .isIn(["poor_lighting", "harassment_hotspot", "deserted_stretch", "broken_infrastructure", "safe_haven"])
    .withMessage("Valid category required"),
  body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Valid latitude required"),
  body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Valid longitude required"),
  body("description").optional().isString().trim(),
  validate,
  async (req, res, next) => {
    try {
      const report = await CitizenSafetyReport.create({
        category: req.body.category,
        latitude: parseFloat(req.body.latitude),
        longitude: parseFloat(req.body.longitude),
        description: req.body.description || "Community reported safety hazard",
        verificationStatus: "PENDING",
      });
      res.status(201).json(report);
    } catch (err) {
      next(err);
    }
  }
);

/* ─── 5. GET /api/safety/reports ─────────────────────────────────────── */
router.get("/reports", async (req, res, next) => {
  try {
    const reports = await CitizenSafetyReport.find({}).sort("-createdAt").limit(50);
    res.json(reports);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
