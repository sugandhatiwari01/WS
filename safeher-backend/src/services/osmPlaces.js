/**
 * Real places from OpenStreetMap near a point: police, hospitals/clinics, transit stations.
 *
 * 1. Overpass API — every matching place within the radius, with phone/address tags.
 * 2. Photon (komoot) reverse search by OSM tag — backup when Overpass is down. It returns at most
 *    50 places per type, so in dense areas the area it really covers can be smaller than asked;
 *    that covered radius is reported as `coveredKm` so callers never mistake "not fetched" for "none".
 * 3. Nominatim (OpenStreetMap) category search in a box — last resort, strictly 1 request per second.
 *
 * Nothing is invented. Photon is a free public service, so its requests are paced and cached.
 */

const USER_AGENT = "SafeHer/1.0 (women-safety app; safety place lookup)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse";
const PHOTON_LIMIT = 50;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_LIMIT = 40;
const FETCH_RADIUS_KM = 25;
const CACHE_REUSE_KM = 3;
const MAX_RADIUS_KM = FETCH_RADIUS_KM - CACHE_REUSE_KM;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1500;

/** Overpass selectors and Photon OSM tags per category. */
const CATEGORIES = {
  police: {
    overpass: ['nwr["amenity"="police"]'],
    photon: ["amenity:police"],
    nominatim: ["police"],
  },
  hospital: {
    overpass: ['nwr["amenity"="hospital"]', 'nwr["amenity"="clinic"]'],
    photon: ["amenity:hospital"],
    nominatim: ["hospital"],
  },
  transit: {
    overpass: ['nwr["railway"="station"]', 'nwr["public_transport"="station"]', 'nwr["amenity"="bus_station"]'],
    photon: ["railway:station"],
    nominatim: ["railway station", "bus station"],
  },
};

const caches = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, new Map()]));

function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, headers: { "User-Agent": USER_AGENT, ...(options.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

const joinAddress = (parts) => {
  const seen = new Set();
  const clean = parts.map((p) => (p || "").trim()).filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  return clean.length ? clean.join(", ") : null;
};

/** Keeps a phone number only if it looks like a real dialable number. */
const cleanPhone = (raw) => {
  if (!raw) return null;
  const first = String(raw).split(/[;,/]/)[0].trim();
  return first.replace(/[^\d+]/g, "").length >= 3 ? first : null;
};

/* ─── Overpass ─────────────────────────────────────────────── */

/** After Overpass fails, skip it for a while so lookups don't keep waiting on it. */
const OVERPASS_RETRY_MS = 5 * 60 * 1000;
let overpassDownUntil = 0;

/** Runs an Overpass query on all mirrors at once; the first good answer wins. */
async function overpass(query, timeoutMs = 6000) {
  if (Date.now() < overpassDownUntil) throw new Error("Overpass unavailable (recent failure, retrying later)");
  const tryEndpoint = async (endpoint) => {
    const res = await fetchWithTimeout(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}` }, timeoutMs);
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return res.json();
  };
  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map(tryEndpoint));
  } catch (e) {
    overpassDownUntil = Date.now() + OVERPASS_RETRY_MS;
    throw new Error(`Overpass unavailable (${(e.errors || [e]).map((x) => x.message).join("; ")})`);
  }
}

/** Which of our categories an OSM element belongs to, from its tags. */
function categoryOf(tags = {}) {
  if (tags.amenity === "police") return "police";
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "hospital";
  if (tags.railway === "station" || tags.public_transport === "station" || tags.amenity === "bus_station") return "transit";
  return null;
}

/** Converts an Overpass element (node/way/relation with center) to our place shape. */
function fromOverpassElement(el, category) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  return {
    id: `osm-${el.type}-${el.id}`,
    category: category || categoryOf(t),
    name: t["name:en"] || t.name || null,
    kind: t.amenity || t.railway || t.public_transport || category,
    phone: cleanPhone(t.phone || t["contact:phone"] || t["phone:mobile"]),
    address: t["addr:full"] || joinAddress([t["addr:housenumber"], t["addr:street"], t["addr:suburb"], t["addr:city"] || t["addr:district"], t["addr:postcode"]]),
    latitude: lat,
    longitude: lng,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

async function fromOverpass(category, lat, lng, radiusKm) {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat},${lng})`;
  const query = `[out:json][timeout:15];(${CATEGORIES[category].overpass.map((sel) => `${sel}${around};`).join("")});out center tags;`;
  const data = await overpass(query);
  return { places: (data.elements || []).map((el) => fromOverpassElement(el, category)).filter(Boolean), coveredKm: radiusKm };
}

/* ─── Photon (paced) ───────────────────────────────────────── */

/** Photon is a free shared service: at most 2 requests in flight, at least 300 ms apart. */
const PHOTON_CONCURRENCY = 2;
const PHOTON_GAP_MS = 300;
let photonActive = 0;
let photonLastStart = 0;
const photonQueue = [];
function photonFetch(url) {
  return new Promise((resolve, reject) => {
    photonQueue.push({ url, resolve, reject });
    pumpPhoton();
  });
}
function pumpPhoton() {
  if (photonActive >= PHOTON_CONCURRENCY || !photonQueue.length) return;
  const wait = Math.max(0, photonLastStart + PHOTON_GAP_MS - Date.now());
  if (wait > 0) return void setTimeout(pumpPhoton, wait);
  const job = photonQueue.shift();
  photonActive++;
  photonLastStart = Date.now();
  fetchWithTimeout(job.url, {}, 6000)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Photon ${res.status}`);
      job.resolve(await res.json());
    })
    .catch(job.reject)
    .finally(() => {
      photonActive--;
      pumpPhoton();
    });
  pumpPhoton();
}

/** After Photon fails (e.g. it is rate-limiting us), skip it for a while. */
const PHOTON_RETRY_MS = 5 * 60 * 1000;
let photonDownUntil = 0;

async function fromPhoton(category, lat, lng, radiusKm) {
  if (Date.now() < photonDownUntil) throw new Error("Photon unavailable (recent failure, retrying later)");
  try {
    return await photonLookup(category, lat, lng, radiusKm);
  } catch (e) {
    photonDownUntil = Date.now() + PHOTON_RETRY_MS;
    throw e;
  }
}

async function photonLookup(category, lat, lng, radiusKm) {
  const typeName = { N: "node", W: "way", R: "relation" };
  // Reverse search returns the nearest places of a type by distance (forward search only matches names).
  const batches = await Promise.all(CATEGORIES[category].photon.map(async (tag) => {
    const data = await photonFetch(`${PHOTON_REVERSE_URL}?lat=${lat}&lon=${lng}&osm_tag=${tag}&radius=${radiusKm}&limit=${PHOTON_LIMIT}`);
    const places = (data.features || []).map((f) => {
      const p = f.properties || {};
      const [sLng, sLat] = f.geometry?.coordinates || [];
      if (sLat == null || sLng == null) return null;
      const osmType = typeName[p.osm_type] || "node";
      return {
        id: `osm-${osmType}-${p.osm_id}`,
        category,
        name: p.name || null,
        kind: p.osm_value || category,
        phone: null, // Photon does not return contact tags
        address: joinAddress([p.housenumber, p.street, p.locality || p.district, p.city, p.postcode]),
        latitude: sLat,
        longitude: sLng,
        osmUrl: `https://www.openstreetmap.org/${osmType}/${p.osm_id}`,
      };
    }).filter(Boolean);
    // A full page means there are more beyond the farthest result: only that far is really covered.
    const farthest = places.reduce((m, p) => Math.max(m, distanceKm(lat, lng, p.latitude, p.longitude)), 0);
    return { places, coveredKm: places.length >= PHOTON_LIMIT ? farthest : radiusKm };
  }));
  return { places: batches.flatMap((b) => b.places), coveredKm: Math.min(...batches.map((b) => b.coveredKm)) };
}

/* ─── Nominatim (last resort, 1 request per second) ────────── */

/** Nominatim's usage policy allows at most one request per second. */
const NOMINATIM_GAP_MS = 1100;
let nominatimChain = Promise.resolve();
let nominatimLast = 0;
function nominatimFetch(url) {
  const run = nominatimChain.then(async () => {
    const wait = Math.max(0, nominatimLast + NOMINATIM_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    nominatimLast = Date.now();
    const res = await fetchWithTimeout(url, {}, 9000);
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return res.json();
  });
  nominatimChain = run.catch(() => undefined);
  return run;
}

/** Places of a category within a box around (lat, lng). A full page shrinks the box once. */
/** quick: one phrase per category and no second, smaller search (used for route checks). */
async function fromNominatim(category, lat, lng, radiusKm, { quick = false } = {}) {
  const search = async (phrase, km) => {
    const dLat = km / 111.32;
    const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    const params = new URLSearchParams({ q: phrase, format: "jsonv2", addressdetails: "1", countrycodes: "in", bounded: "1", limit: String(NOMINATIM_LIMIT), viewbox: [lng - dLng, lat + dLat, lng + dLng, lat - dLat].map((v) => v.toFixed(5)).join(",") });
    const rows = await nominatimFetch(`${NOMINATIM_URL}?${params}`);
    return Array.isArray(rows) ? rows : [];
  };
  const batches = [];
  const phrases = quick ? CATEGORIES[category].nominatim.slice(0, 1) : CATEGORIES[category].nominatim;
  for (const phrase of phrases) {
    let km = radiusKm;
    let rows = await search(phrase, km);
    // A full page is an arbitrary subset of the box, so search a smaller box to get a complete answer.
    if (!quick && rows.length >= NOMINATIM_LIMIT && km > 1.5) {
      km = Math.max(1.5, km / 3);
      rows = await search(phrase, km);
    }
    const places = rows.map((x) => ({
      id: `osm-${x.osm_type}-${x.osm_id}`,
      category,
      name: x.name || null,
      kind: x.type || category,
      phone: null,
      address: joinAddress([x.address?.road, x.address?.suburb || x.address?.neighbourhood, x.address?.city || x.address?.town || x.address?.village, x.address?.postcode]),
      latitude: Number(x.lat),
      longitude: Number(x.lon),
      osmUrl: `https://www.openstreetmap.org/${x.osm_type}/${x.osm_id}`,
    }));
    // A box contains the circle of radius km; if the page is still full, only claim half of it.
    batches.push({ places, coveredKm: rows.length >= NOMINATIM_LIMIT ? km / 2 : km });
  }
  return { places: batches.flatMap((b) => b.places), coveredKm: Math.min(...batches.map((b) => b.coveredKm)) };
}

/* ─── Cache + public API ───────────────────────────────────── */

/** Drops the same place mapped twice (e.g. as a point and as a building). */
function dedupe(places) {
  const kept = [];
  for (const s of places) {
    const dup = kept.find((k) => k.id === s.id || (distanceKm(k.latitude, k.longitude, s.latitude, s.longitude) < 0.08 && (k.name || "").toLowerCase() === (s.name || "").toLowerCase()));
    if (dup) {
      dup.phone = dup.phone || s.phone;
      dup.address = dup.address || s.address;
    } else kept.push({ ...s });
  }
  return kept;
}

/** A cached lookup that already answers "places within radiusKm of (lat, lng)". */
function cachedFor(category, lat, lng, radiusKm, { allowStale = false } = {}) {
  let best = null;
  for (const entry of caches[category].values()) {
    if (!allowStale && Date.now() - entry.at >= CACHE_TTL_MS) continue;
    const d = distanceKm(lat, lng, entry.lat, entry.lng);
    if (d > CACHE_REUSE_KM) continue;
    // Reuse when the earlier request reached at least as far as this one needs.
    if (entry.requestedKm >= radiusKm + d && (!best || d < best.d)) best = { entry, d };
  }
  return best && { ...best.entry, coveredKm: Math.max(0, best.entry.coveredKm - best.d) };
}

/**
 * Places of a category around (lat, lng).
 * @returns {Promise<{places: object[], provider: string, coveredKm: number}>} coveredKm = radius truly searched.
 * Throws with status 503 if every source fails.
 */
async function loadPlaces(category, lat, lng, radiusKm = FETCH_RADIUS_KM, { quick = false } = {}) {
  if (!CATEGORIES[category]) throw new Error(`Unknown place category: ${category}`);
  const radius = Math.min(Math.max(radiusKm, 0.5), FETCH_RADIUS_KM);
  const fresh = cachedFor(category, lat, lng, radius);
  if (fresh) return fresh;
  let result;
  let provider;
  // Start Photon alongside Overpass so a down Overpass costs no extra wait.
  const photon = fromPhoton(category, lat, lng, radius);
  photon.catch(() => undefined);
  try {
    result = await fromOverpass(category, lat, lng, radius);
    provider = "overpass";
  } catch (overpassError) {
    try {
      result = await photon;
      provider = "photon";
    } catch (photonError) {
      try {
        result = await fromNominatim(category, lat, lng, radius, { quick });
        provider = "nominatim";
      } catch (nominatimError) {
        const stale = cachedFor(category, lat, lng, radius, { allowStale: true });
        if (stale) return stale;
        const err = new Error("Could not reach OpenStreetMap right now. Call 112 in an emergency.");
        err.status = 503;
        err.cause = { overpass: overpassError.message, photon: photonError.message, nominatim: nominatimError.message };
        throw err;
      }
    }
  }
  const entry = { at: Date.now(), lat, lng, requestedKm: radius, coveredKm: result.coveredKm, provider, places: dedupe(result.places) };
  const cache = caches[category];
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(`${lat},${lng},${radius},${entry.at}`, entry);
  return entry;
}

/** Photon forward search (place names), respecting the skip-after-failure window. */
async function photonSearch(params) {
  if (Date.now() < photonDownUntil) throw new Error("Photon unavailable (recent failure, retrying later)");
  try {
    return await photonFetch(`https://photon.komoot.io/api/?${params}`);
  } catch (e) {
    photonDownUntil = Date.now() + PHOTON_RETRY_MS;
    throw e;
  }
}

/** Nominatim forward search, paced at 1 request per second. */
const nominatimSearch = (params) => nominatimFetch(`${NOMINATIM_URL}?${params}`);

/** True while both fast sources are known to be down (only paced Nominatim is left). */
const onlySlowSourceLeft = () => Date.now() < overpassDownUntil && Date.now() < photonDownUntil;

/** Cached entry for a category near a point, or null (instant, no network). */
const peekPlaces = (category, lat, lng, radiusKm = 1) => cachedFor(category, lat, lng, radiusKm);

module.exports = {
  loadPlaces,
  photonSearch,
  nominatimSearch,
  onlySlowSourceLeft,
  peekPlaces,
  overpass,
  fromOverpassElement,
  categoryOf,
  distanceKm,
  fetchWithTimeout,
  FETCH_RADIUS_KM,
  CACHE_REUSE_KM,
  MAX_RADIUS_KM,
  USER_AGENT,
};
