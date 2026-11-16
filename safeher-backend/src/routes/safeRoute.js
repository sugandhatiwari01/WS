/**
 * Safest Route & Geospatial Safety API Router
 *
 * Endpoints:
 * - POST /api/routes/safest: Calculates multi-alternative routes with safety scoring
 * - GET /api/routes/alternatives: Fetches alternative corridors
 * - GET /api/safety/nearby: Queries infrastructure within radius
 * - POST /api/safety/reports: Submits citizen hazard/safety report
 * - GET /api/safety/reports: Fetches public safety concerns
 * - GET /api/safety/places: Search & geocode Indian places via Nominatim
 */

const express = require("express");
const { body, query, validationResult } = require("express-validator");
const axios = require("axios");
const SafetyLocation = require("../models/SafetyLocation");
const CrimeStatistic = require("../models/CrimeStatistic");
const CitizenSafetyReport = require("../models/CitizenSafetyReport");
const {
  getAlternativeRoutes,
  scoreRoute,
  haversineM,
  DEFAULT_WEIGHTS,
} = require("../services/safestRouteService");

const router = express.Router();

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg });
  next();
};

/* ─── 1. POST /api/routes/safest ─────────────────────────────────────── */
router.post(
  "/safest",
  body("originLat").isFloat({ min: -90, max: 90 }).withMessage("Valid originLat required"),
  body("originLng").isFloat({ min: -180, max: 180 }).withMessage("Valid originLng required"),
  body("destLat").isFloat({ min: -90, max: 90 }).withMessage("Valid destLat required"),
  body("destLng").isFloat({ min: -180, max: 180 }).withMessage("Valid destLng required"),
  body("weights").optional().isObject(),
  validate,
  async (req, res, next) => {
    try {
      const { originLat, originLng, destLat, destLng, weights } = req.body;
      const origin = [parseFloat(originLat), parseFloat(originLng)];
      const dest = [parseFloat(destLat), parseFloat(destLng)];

      // 1. Fetch multi-alternative routes via OSRM
      const rawRoutes = await getAlternativeRoutes(origin, dest);

      // 2. Fetch spatial safety facilities within corridor bounding box
      const minLat = Math.min(origin[0], dest[0]) - 0.05;
      const maxLat = Math.max(origin[0], dest[0]) + 0.05;
      const minLng = Math.min(origin[1], dest[1]) - 0.05;
      const maxLng = Math.max(origin[1], dest[1]) + 0.05;

      const allFacilities = await SafetyLocation.find({});
      const corridorFacilities = allFacilities.filter(
        (f) =>
          f.latitude >= minLat &&
          f.latitude <= maxLat &&
          f.longitude >= minLng &&
          f.longitude <= maxLng
      );

      // 3. Fetch regional crime statistics
      const allCrimeStats = await CrimeStatistic.find({});

      // 4. Fetch community hazard reports
      const citizenReports = await CitizenSafetyReport.find({});

      // 5. Score all candidate routes
      const scoredRoutes = await Promise.all(
        rawRoutes.map((r, index) =>
          scoreRoute(
            { ...r, routeId: `route-${index + 1}` },
            corridorFacilities,
            allCrimeStats,
            citizenReports,
            weights || DEFAULT_WEIGHTS
          )
        )
      );

      // 6. Sort by safety score descending
      scoredRoutes.sort((a, b) => b.safetyScore - a.safetyScore);

      // Mark the safest recommended route
      if (scoredRoutes.length > 0) {
        scoredRoutes[0].isRecommended = true;
      }

      res.json({
        ok: true,
        recommendedRouteId: scoredRoutes[0]?.routeId,
        routes: scoredRoutes,
        metadata: {
          facilitiesAnalyzed: corridorFacilities.length,
          weightsApplied: weights || DEFAULT_WEIGHTS,
          evaluatedAt: new Date().toISOString(),
          disclaimer:
            "Safety scores are comparative indicators derived from verified public infrastructure, illumination, and historical statistics. SafeHer does not guarantee absolute safety. Always remain alert.",
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ─── 2. GET /api/safety/nearby ──────────────────────────────────────── */
router.get("/nearby", async (req, res, next) => {
  try {
    const lat = req.query.latitude ? parseFloat(req.query.latitude) : 12.9716;
    const lng = req.query.longitude ? parseFloat(req.query.longitude) : 77.5946;
    const radiusM = req.query.radiusM ? parseInt(req.query.radiusM, 10) : 5000;
    const type = req.query.type;

    const all = await SafetyLocation.find({});
    const nearby = all
      .map((item) => ({
        ...item,
        distanceM: Math.round(haversineM(lat, lng, item.latitude, item.longitude)),
      }))
      .filter((item) => item.distanceM <= radiusM && (!type || item.locationType === type))
      .sort((a, b) => a.distanceM - b.distanceM);

    res.json(nearby);
  } catch (err) {
    next(err);
  }
});

/* ─── 3. GET /api/safety/places (India Geocoding Proxy) ─────────────────── */
router.get("/places", async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q || q.trim().length < 2) return res.json([]);

    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: `${q.trim()}, India`,
        format: "json",
        addressdetails: 1,
        limit: 7,
        countrycodes: "in",
      },
      headers: { "User-Agent": "SafeHer-Route-Safety-System/1.0" },
      timeout: 8000,
    });

    const results = (response.data || []).map((item) => ({
      placeId: item.place_id,
      name: item.display_name.split(",")[0],
      displayName: item.display_name,
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      type: item.type,
      state: item.address?.state || "India",
      city: item.address?.city || item.address?.town || item.address?.suburb,
    }));

    res.json(results);
  } catch (err) {
    console.warn("[Places Proxy Warning]:", err.message);
    res.json([]);
  }
});

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
