/**
 * Safest-route engine — works anywhere in India using only real, open data.
 *
 * Routes: OSRM on OpenStreetMap roads (FOSSGIS foot/car servers, public OSRM as backup).
 *   When OSRM returns a single route, genuine alternatives are requested through a
 *   detour waypoint on either side of the trip; they follow real roads.
 *
 * Safety factors, checked every ~200 m along each route:
 *   - Police reach (45%): distance to the nearest real police station.
 *   - Help points (30%): share of the route within 500 m of a police station, hospital/clinic or transit station.
 *   - Street lighting (25%): share of the route on roads tagged lit=yes in OpenStreetMap
 *     (Overpass only, and only when at least 20% of the route has a lit tag).
 *   - Community reports: each SafeHer hazard report within 150 m of the route lowers the score by 5 (max 25).
 *
 * Data: one Overpass request per route when Overpass is up. Otherwise a few paced Photon lookups,
 * which may not reach every part of a long or dense route — those parts are reported as not covered
 * instead of being treated as "no police". Factors without data are left out; nothing is assumed.
 */

const { loadPlaces, overpass, fromOverpassElement, categoryOf, distanceKm, fetchWithTimeout, onlySlowSourceLeft } = require("./osmPlaces");

const ROUTERS = {
  walking: ["https://routing.openstreetmap.de/routed-foot/route/v1/driving"],
  driving: ["https://routing.openstreetmap.de/routed-car/route/v1/driving", "https://router.project-osrm.org/route/v1/driving"],
};
const MAX_TRIP_KM = { walking: 60, driving: 600 };
const WEIGHTS = { police: 0.45, help: 0.3, lighting: 0.25 };
const SAMPLE_STEP_M = 200;
const MAX_SAMPLES = 400;
const POLICE_FULL_M = 500;
const POLICE_ZERO_M = 3000;
const HELP_RADIUS_M = 500;
const REPORT_RADIUS_M = 150;
const LIT_MATCH_M = 30;
const MIN_FACTOR_COVERAGE = 0.3;
const MAX_PHOTON_CENTRES = 5;
/** Nominatim allows 1 request per second, so use fewer, wider lookups when it is the only source. */
const MAX_SLOW_CENTRES = 3;

const haversineM = (lat1, lng1, lat2, lng2) => distanceKm(lat1, lng1, lat2, lng2) * 1000;

/* ─── Geometry helpers ─────────────────────────────────────── */

/** Points every ~stepM metres along a [lng, lat] line (always includes both ends). */
function sample(coords, stepM = SAMPLE_STEP_M) {
  if (!coords?.length) return [];
  const out = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    if (acc >= stepM) {
      out.push(coords[i]);
      acc = 0;
    }
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Evenly thins a list to at most max items. */
const thin = (list, max) => (list.length <= max ? list : list.filter((_, i) => i % Math.ceil(list.length / max) === 0));

/** Distance in metres from point p to segment a–b (all [lat, lng]), equirectangular approximation. */
function pointSegmentM(p, a, b) {
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** [lat, lng] check-points along a route. */
const routePoints = (route) => thin(sample(route.geometry.coordinates), MAX_SAMPLES).map(([lng, lat]) => [lat, lng]);

/* ─── Routing ──────────────────────────────────────────────── */

async function osrm(mode, points, alternatives) {
  const coords = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const qs = `overview=full&geometries=geojson&steps=true&alternatives=${alternatives ? 3 : "false"}`;
  let lastError;
  for (const base of ROUTERS[mode]) {
    try {
      const res = await fetchWithTimeout(`${base}/${coords}?${qs}`, {}, 15000);
      const data = await res.json().catch(() => null);
      if (data?.code === "Ok" && data.routes?.length) return data.routes;
      lastError = new Error(data?.message || data?.code || `Routing server returned ${res.status}`);
      if (data?.code === "NoRoute") break; // no road connection — another server won't help
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Routing unavailable");
}

/** Fraction of route b's points within 60 m of route a. */
function overlap(a, b) {
  const pa = sample(a.geometry.coordinates, 300);
  const pb = sample(b.geometry.coordinates, 300);
  if (!pb.length) return 1;
  let near = 0;
  for (const [lng, lat] of pb) if (pa.some(([x, y]) => haversineM(lat, lng, y, x) < 60)) near++;
  return near / pb.length;
}

/** Main road names of a route, from OSRM steps (longest stretches first, in travel order). */
function roadNames(route) {
  const totals = new Map();
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const name = step.ref ? `${step.name || ""}${step.name ? " (" : ""}${step.ref}${step.name ? ")" : ""}` : step.name;
      if (name) totals.set(name, (totals.get(name) || 0) + step.distance);
    }
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  if (top.length) return top.join(", ");
  return (route.legs || []).map((l) => l.summary).filter(Boolean).join(", ") || "Local roads";
}

/** Real alternative routes between two points (1–3). */
async function getRoutes(origin, dest, mode) {
  const routes = await osrm(mode, [origin, dest], true);
  const fastest = routes[0];
  if (routes.length < 3) {
    // Ask for real detours through a waypoint on each side of the straight line.
    const [lat1, lng1] = origin;
    const [lat2, lng2] = dest;
    const straightKm = distanceKm(lat1, lng1, lat2, lng2);
    const offsetKm = Math.min(Math.max(straightKm * 0.18, 0.3), 8);
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    const kmPerDegLng = 111.32 * Math.cos((midLat * Math.PI) / 180);
    const dx = (lng2 - lng1) * kmPerDegLng;
    const dy = (lat2 - lat1) * 111.32;
    const len = Math.hypot(dx, dy) || 1;
    const via = [1, -1].map((side) => [midLat + (side * (dx / len) * offsetKm) / 111.32, midLng + (side * (-dy / len) * offsetKm) / kmPerDegLng]);
    const detours = await Promise.allSettled(via.map((v) => osrm(mode, [origin, v, dest], false)));
    for (const d of detours) {
      if (d.status !== "fulfilled" || routes.length >= 3) continue;
      const r = d.value[0];
      if (r.distance > fastest.distance * 1.6) continue; // too long to be a sensible alternative
      if (routes.some((existing) => overlap(existing, r) > 0.8)) continue; // essentially the same roads
      routes.push({ ...r, viaWaypoint: true });
    }
  }
  return routes.slice(0, 3);
}

/* ─── Corridor data ────────────────────────────────────────── */

/** Everything for one route in a single Overpass request (places + lit roads). Throws if Overpass is down. */
async function corridorFromOverpass(route) {
  const poly = thin(sample(route.geometry.coordinates, 250), 150).map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(",");
  const query = `[out:json][timeout:25];
(nwr["amenity"="police"](around:${POLICE_ZERO_M},${poly});
 nwr["amenity"~"^(hospital|clinic)$"](around:${HELP_RADIUS_M + 100},${poly});
 nwr["railway"="station"](around:${HELP_RADIUS_M + 100},${poly});
 nwr["public_transport"="station"](around:${HELP_RADIUS_M + 100},${poly});
 nwr["amenity"="bus_station"](around:${HELP_RADIUS_M + 100},${poly}););
out center tags;
way["highway"]["lit"](around:${LIT_MATCH_M},${poly});
out geom;`;
  const data = await overpass(query, 15000);
  const places = { police: [], hospital: [], transit: [] };
  const litWays = [];
  for (const el of data.elements || []) {
    if (el.type === "way" && Array.isArray(el.geometry) && el.tags?.highway && el.tags?.lit) {
      litWays.push({ lit: ["yes", "24/7", "automatic", "interval"].includes(el.tags.lit), nodes: el.geometry.map((g) => [g.lat, g.lon]) });
      continue;
    }
    const category = categoryOf(el.tags);
    const place = category && fromOverpassElement(el, category);
    if (place) places[category].push(place);
  }
  return { places, litWays, provider: "overpass" };
}

/** Backup: a few paced Photon lookups shared by all routes, each remembering how far it reached. */
async function corridorFromPhoton(routes) {
  const longestKm = Math.max(...routes.map((r) => r.distance / 1000));
  const slow = onlySlowSourceLeft();
  const spacingKm = Math.min(Math.max(longestKm / (slow ? 2.5 : 4), 2), 40);
  const centres = [];
  for (const r of routes) {
    for (const [lng, lat] of sample(r.geometry.coordinates, spacingKm * 1000)) {
      if (!centres.some(([y, x]) => distanceKm(lat, lng, y, x) < spacingKm / 2)) centres.push([lat, lng]);
    }
  }
  const chosen = thin(centres, slow ? MAX_SLOW_CENTRES : MAX_PHOTON_CENTRES);
  const radiusKm = Math.min(25, spacingKm * 0.75 + POLICE_ZERO_M / 1000);
  const lookups = {};
  for (const category of ["police", "hospital", "transit"]) {
    const results = await Promise.allSettled(chosen.map(([lat, lng]) => loadPlaces(category, lat, lng, radiusKm, { quick: slow })));
    lookups[category] = results.map((r, i) => (r.status === "fulfilled" ? { lat: chosen[i][0], lng: chosen[i][1], coveredKm: r.value.coveredKm, places: r.value.places, provider: r.value.provider } : null)).filter(Boolean);
  }
  const merge = (list) => [...new Map(list.flatMap((l) => l.places).map((p) => [p.id, p])).values()];
  const providers = new Set(Object.values(lookups).flat().map((l) => l.provider));
  return {
    places: { police: merge(lookups.police), hospital: merge(lookups.hospital), transit: merge(lookups.transit) },
    litWays: null,
    lookups,
    provider: providers.size ? [...providers].join("+") : "unavailable",
  };
}

/* ─── Scoring ──────────────────────────────────────────────── */

const policePointScore = (m) => (m <= POLICE_FULL_M ? 100 : m >= POLICE_ZERO_M ? 0 : 100 * (1 - (m - POLICE_FULL_M) / (POLICE_ZERO_M - POLICE_FULL_M)));

function nearestM(lat, lng, places) {
  let best = Infinity;
  for (const p of places) {
    if (Math.abs(p.latitude - lat) > 0.1 || Math.abs(p.longitude - lng) > 0.1) continue; // >~10 km away, skip fast
    const d = haversineM(lat, lng, p.latitude, p.longitude);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Was this point really searched for a category? Always true with Overpass (searched along the route).
 * With Photon, the point must sit inside a lookup's covered radius with room to spare for `needM`.
 */
function covered(lookups, lat, lng, needM) {
  if (!lookups) return true;
  return lookups.some((l) => distanceKm(lat, lng, l.lat, l.lng) * 1000 + needM <= l.coveredKm * 1000);
}

function scoreRoute(route, corridor, reports) {
  const pts = routePoints(route);
  const { police, hospital, transit } = corridor.places;
  const help = [...police, ...hospital, ...transit];
  const lk = corridor.lookups;

  let policeSum = 0, policeN = 0, beyond = 0, helpYes = 0, helpN = 0, farthest = 0, closest = Infinity;
  for (const [lat, lng] of pts) {
    const dPolice = nearestM(lat, lng, police);
    // Police: the nearest station is known if the search reached at least that far (capped at 3 km).
    if (covered(lk?.police, lat, lng, Math.min(dPolice, POLICE_ZERO_M))) {
      policeSum += policePointScore(dPolice);
      policeN++;
      if (dPolice > POLICE_ZERO_M) beyond++;
      else farthest = Math.max(farthest, dPolice);
      closest = Math.min(closest, dPolice);
    }
    const dHelp = nearestM(lat, lng, help);
    const helpKnown = dHelp <= HELP_RADIUS_M || (covered(lk?.police, lat, lng, HELP_RADIUS_M) && covered(lk?.hospital, lat, lng, HELP_RADIUS_M) && covered(lk?.transit, lat, lng, HELP_RADIUS_M));
    if (helpKnown) {
      helpN++;
      if (dHelp <= HELP_RADIUS_M) helpYes++;
    }
  }
  const n = pts.length || 1;
  const policeAvailable = lk ? lk.police.length > 0 : true;
  const helpAvailable = lk ? lk.police.length + lk.hospital.length + lk.transit.length > 0 : true;
  const share = { police: policeN / n, help: helpN / n, lighting: 0 };
  const factors = {
    police: policeAvailable && share.police >= MIN_FACTOR_COVERAGE ? policeSum / policeN : null,
    help: helpAvailable && share.help >= MIN_FACTOR_COVERAGE ? (100 * helpYes) / helpN : null,
    lighting: null,
  };

  // Lighting: share of tagged route points that are on lit roads (needs ≥20% of the route tagged).
  let lightingKnownPct = null;
  if (corridor.litWays) {
    let known = 0, lit = 0;
    for (const p of pts) {
      let best = null;
      for (const w of corridor.litWays) {
        for (let i = 1; i < w.nodes.length; i++) {
          const d = pointSegmentM(p, w.nodes[i - 1], w.nodes[i]);
          if (d <= LIT_MATCH_M && (!best || d < best.d)) best = { d, lit: w.lit };
        }
      }
      if (best) {
        known++;
        if (best.lit) lit++;
      }
    }
    lightingKnownPct = Math.round((100 * known) / n);
    share.lighting = known / n;
    if (known / n >= 0.2) factors.lighting = (100 * lit) / known;
  }

  const reportsNear = reports.filter((r) => pts.some(([lat, lng]) => haversineM(lat, lng, r.latitude, r.longitude) <= REPORT_RADIUS_M));
  const hazards = reportsNear.filter((r) => r.category !== "safe_haven").length;

  const used = Object.entries(factors).filter(([, v]) => v != null);
  const weightSum = used.reduce((s, [k]) => s + WEIGHTS[k], 0);
  const base = weightSum ? used.reduce((s, [k, v]) => s + WEIGHTS[k] * v, 0) / weightSum : null;
  const safetyScore = base == null ? null : Math.max(0, Math.round(base - Math.min(25, hazards * 5)));
  // How much of the full score (all factors, whole route) is backed by real data.
  const dataCoverage = Math.round(100 * used.reduce((s, [k]) => s + WEIGHTS[k] * Math.min(1, share[k]), 0));

  return {
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
    legs: [{ summary: roadNames(route) }],
    viaWaypoint: Boolean(route.viaWaypoint),
    safetyScore,
    dataCoverage,
    indicators: {
      policeProximity: factors.police == null ? null : Math.round(factors.police),
      helpPointsCoverage: factors.help == null ? null : Math.round(factors.help),
      streetlightCoverage: factors.lighting == null ? null : Math.round(factors.lighting),
      lightingKnownPct,
      routeCheckedPct: Math.round(100 * share.police),
      communityReports: hazards,
      closestPoliceDistM: Number.isFinite(closest) ? Math.round(closest) : null,
      // Among checked points within 3 km of a station, the farthest one; and the share beyond 3 km.
      farthestFromPoliceM: factors.police == null || beyond === policeN ? null : Math.round(farthest),
      beyondPolice3kmPct: factors.police == null ? null : Math.round((100 * beyond) / policeN),
    },
  };
}

/**
 * Real routes between origin and dest ([lat, lng]) scored for safety.
 * @param {object} opts { mode: "walking"|"driving", reports: community reports [{latitude, longitude, category}] }
 */
async function evaluateSafestRoutes(origin, dest, { mode = "walking", reports = [] } = {}) {
  const tripKm = distanceKm(origin[0], origin[1], dest[0], dest[1]);
  if (tripKm < 0.05) {
    const err = new Error("Start and destination are the same place.");
    err.status = 400;
    throw err;
  }
  if (tripKm > MAX_TRIP_KM[mode]) {
    const err = new Error(`That trip is about ${Math.round(tripKm)} km in a straight line — too far for ${mode} routing (limit ${MAX_TRIP_KM[mode]} km).${mode === "walking" ? " Try driving." : ""}`);
    err.status = 400;
    throw err;
  }

  let rawRoutes;
  try {
    rawRoutes = await getRoutes(origin, dest, mode);
  } catch (e) {
    const noRoute = /no ?route/i.test(e.message);
    const err = new Error(noRoute ? "No road connection was found between these places." : "The routing service is not reachable right now. Please try again shortly.");
    err.status = noRoute ? 404 : 503;
    throw err;
  }

  // Safety data: Overpass per route if it's up, otherwise shared paced Photon lookups.
  let corridors;
  try {
    corridors = await Promise.all(rawRoutes.map(corridorFromOverpass));
  } catch (_) {
    const shared = await corridorFromPhoton(rawRoutes);
    corridors = rawRoutes.map(() => shared);
  }

  const fastestDuration = Math.min(...rawRoutes.map((r) => r.duration));
  const scored = rawRoutes.map((r, i) => ({ routeId: `route-${i + 1}`, ...scoreRoute(r, corridors[i], reports), isFastest: r.duration === fastestDuration }));
  // Safest first; ties go to the quicker route. Routes without a score go last.
  scored.sort((a, b) => (b.safetyScore ?? -1) - (a.safetyScore ?? -1) || a.duration - b.duration);
  if (scored[0]?.safetyScore != null) scored[0].isRecommended = true;

  // Real facilities within 1 km of the top route, for map pins.
  const topIndex = rawRoutes.findIndex((_, i) => `route-${i + 1}` === scored[0].routeId);
  const topPts = thin(sample(scored[0].geometry.coordinates, 300), 150).map(([lng, lat]) => [lat, lng]);
  const { police, hospital, transit } = corridors[topIndex].places;
  const near = (list, type) =>
    list
      .filter((p) => topPts.some(([lat, lng]) => haversineM(lat, lng, p.latitude, p.longitude) <= 1000))
      .map((p) => ({ name: p.name || "Unnamed", locationType: type, latitude: p.latitude, longitude: p.longitude, phone: p.phone || null, osmUrl: p.osmUrl }));
  const facilities = [...near(police, "police_station"), ...near(hospital, "hospital"), ...near(transit, "public_transit")].slice(0, 60);

  const provider = corridors[0].provider;
  const lightingAvailable = corridors.some((c) => c.litWays != null);
  return {
    routes: scored,
    facilities,
    metadata: {
      mode,
      placeProvider: provider,
      lightingAvailable,
      facilitiesAnalyzed: corridors.reduce((s, c) => s + c.places.police.length + c.places.hospital.length + c.places.transit.length, 0),
      dataSources: [
        "Roads & routes: OpenStreetMap (OSRM)",
        provider === "unavailable" ? "Police, hospitals, transit: map service unreachable right now" : `Police, hospitals, transit: OpenStreetMap (${provider})`,
        lightingAvailable ? "Street lighting: OpenStreetMap lit tags" : "Street lighting: map data unavailable right now",
        "Community reports: SafeHer users",
      ],
      evaluatedAt: new Date().toISOString(),
      disclaimer:
        "Scores compare these routes using open map data (police, hospitals, transit, and lighting where mapped) plus SafeHer community reports. Map coverage varies and no route is guaranteed safe — stay alert and keep SOS ready.",
    },
  };
}

module.exports = { evaluateSafestRoutes, haversineM, sample, scoreRoute, corridorFromOverpass, WEIGHTS };
