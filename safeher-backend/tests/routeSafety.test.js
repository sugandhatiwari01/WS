/**
 * Offline tests for the safest-route scoring (no network: Overpass is mocked with test fixtures).
 */
jest.mock("../src/services/osmPlaces", () => {
  const actual = jest.requireActual("../src/services/osmPlaces");
  return { ...actual, overpass: jest.fn() };
});

const osmPlaces = require("../src/services/osmPlaces");
const { scoreRoute, corridorFromOverpass, WEIGHTS } = require("../src/services/routeSafety");

// A 2 km straight route heading north from (28.6000, 77.2000). ~0.009° latitude ≈ 1 km.
const route = {
  distance: 2000,
  duration: 1500,
  geometry: { type: "LineString", coordinates: Array.from({ length: 21 }, (_, i) => [77.2, 28.6 + i * 0.0009]) },
  legs: [{ steps: [{ name: "Test Road", distance: 2000 }] }],
};
const place = (id, category, lat, lng) => ({ id, category, name: id, latitude: lat, longitude: lng });
const corridor = (places, extra = {}) => ({ places: { police: [], hospital: [], transit: [], ...places }, litWays: null, provider: "test", ...extra });

describe("scoreRoute", () => {
  test("police beside the route scores high; no lighting data leaves lighting out", () => {
    const r = scoreRoute(route, corridor({ police: [place("p1", "police", 28.609, 77.2005)] }), []);
    expect(r.indicators.policeProximity).toBeGreaterThan(80);
    expect(r.indicators.streetlightCoverage).toBeNull();
    // police + help factors only → 75% of the weight has data
    expect(r.dataCoverage).toBe(Math.round(100 * (WEIGHTS.police + WEIGHTS.help)));
    expect(r.legs[0].summary).toBe("Test Road");
  });

  test("no police within 3 km gives zero police reach", () => {
    const r = scoreRoute(route, corridor({ police: [place("far", "police", 28.7, 77.2)] }), []);
    expect(r.indicators.policeProximity).toBe(0);
    expect(r.indicators.beyondPolice3kmPct).toBe(100);
    expect(r.indicators.farthestFromPoliceM).toBeNull(); // never a made-up distance
  });

  test("lit roads along the whole route give full lighting", () => {
    const litWays = [{ lit: true, nodes: [[28.5995, 77.2], [28.6185, 77.2]] }];
    const r = scoreRoute(route, corridor({ police: [place("p1", "police", 28.609, 77.2)] }, { litWays }), []);
    expect(r.indicators.streetlightCoverage).toBe(100);
    expect(r.indicators.lightingKnownPct).toBe(100);
    expect(r.dataCoverage).toBe(100);
  });

  test("unlit roads give zero lighting", () => {
    const litWays = [{ lit: false, nodes: [[28.5995, 77.2], [28.6185, 77.2]] }];
    const r = scoreRoute(route, corridor({}, { litWays }), []);
    expect(r.indicators.streetlightCoverage).toBe(0);
  });

  test("community hazard reports next to the route lower the score by 5 each", () => {
    const base = scoreRoute(route, corridor({ police: [place("p1", "police", 28.609, 77.2)] }), []);
    const reports = [
      { latitude: 28.605, longitude: 77.2005, category: "poor_lighting" },
      { latitude: 28.61, longitude: 77.2005, category: "harassment_hotspot" },
      { latitude: 28.61, longitude: 77.2005, category: "safe_haven" }, // not a hazard
      { latitude: 28.7, longitude: 77.3, category: "deserted_stretch" }, // far away
    ];
    const withReports = scoreRoute(route, corridor({ police: [place("p1", "police", 28.609, 77.2)] }), reports);
    expect(withReports.indicators.communityReports).toBe(2);
    expect(withReports.safetyScore).toBe(base.safetyScore - 10);
  });

  test("Photon lookups that only reached part of the route: unchecked parts are not counted as unsafe", () => {
    // One lookup at the route start that only covered 1.5 km (a full page of results in a dense area).
    const lookup = (places) => [{ lat: 28.6, lng: 77.2, coveredKm: 1.5, places }];
    const police = [place("p1", "police", 28.6005, 77.2)];
    const c = corridor({ police }, { lookups: { police: lookup(police), hospital: lookup([]), transit: lookup([]) } });
    const r = scoreRoute(route, c, []);
    expect(r.indicators.routeCheckedPct).toBeLessThan(60);
    expect(r.indicators.policeProximity).toBeGreaterThan(80); // the checked part is close to the station
    expect(r.dataCoverage).toBeLessThan(75); // and the coverage figure admits the rest wasn't checked
  });

  test("a search that reached too little of the route leaves police reach as no data", () => {
    const lookup = (places) => [{ lat: 28.6, lng: 77.2, coveredKm: 0.8, places }];
    const police = [place("p1", "police", 28.6005, 77.2)];
    const r = scoreRoute(route, corridor({ police }, { lookups: { police: lookup(police), hospital: lookup([]), transit: lookup([]) } }), []);
    expect(r.indicators.policeProximity).toBeNull();
  });

  test("no data at all gives no score instead of a made-up one", () => {
    const empty = { police: [], hospital: [], transit: [] };
    const r = scoreRoute(route, corridor({}, { lookups: empty }), []);
    expect(r.safetyScore).toBeNull();
    expect(r.dataCoverage).toBe(0);
  });
});

describe("corridorFromOverpass", () => {
  test("sorts Overpass elements into police / hospital / transit and lit roads", async () => {
    osmPlaces.overpass.mockResolvedValue({
      elements: [
        { type: "node", id: 1, lat: 28.601, lon: 77.2, tags: { amenity: "police", name: "Test Police", phone: "011-2345 6789" } },
        { type: "way", id: 2, center: { lat: 28.605, lon: 77.201 }, tags: { amenity: "hospital", name: "Test Hospital" } },
        { type: "node", id: 3, lat: 28.61, lon: 77.2, tags: { railway: "station", name: "Test Metro" } },
        { type: "way", id: 4, tags: { highway: "primary", lit: "yes" }, geometry: [{ lat: 28.6, lon: 77.2 }, { lat: 28.62, lon: 77.2 }] },
        { type: "way", id: 5, tags: { highway: "service", lit: "no" }, geometry: [{ lat: 28.6, lon: 77.21 }, { lat: 28.61, lon: 77.21 }] },
      ],
    });
    const c = await corridorFromOverpass(route);
    expect(c.places.police.map((p) => p.name)).toEqual(["Test Police"]);
    expect(c.places.police[0].phone).toBe("011-2345 6789");
    expect(c.places.hospital[0].latitude).toBe(28.605); // way centre used
    expect(c.places.transit[0].name).toBe("Test Metro");
    expect(c.litWays.map((w) => w.lit)).toEqual([true, false]);
    const query = osmPlaces.overpass.mock.calls[0][0];
    expect(query).toContain('nwr["amenity"="police"](around:3000,');
    expect(query).toContain('way["highway"]["lit"]');
  });
});
