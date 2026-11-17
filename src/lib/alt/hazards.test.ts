import { describe, expect, it } from "vitest";
import { byCompany, countyLookup, parseNws, parseQuakes, plantsUnder, type Plant } from "./hazards";

const plants: Plant[] = [
  { t: "DOW", id: "P1", n: "FREEPORT", c: "FREEPORT", s: "TX", f: "48039", la: 28.95, lo: -95.36 },
  { t: "DOW", id: "P2", n: "MIDLAND", c: "MIDLAND", s: "MI", f: "26111", la: 43.6, lo: -84.24 },
  { t: "XOM", id: "P3", n: "BAYTOWN", c: "BAYTOWN", s: "TX", f: "48201", la: 29.75, lo: -95.0 },
  { t: "XOM", id: "P4", n: "NO COUNTY", c: "X", s: "TX", f: null, la: 29.0, lo: -95.3 },
  // valley plant in a county whose mountain zone is under a warning
  { t: "VMC", id: "P5", n: "BAKERSFIELD", c: "BAKERSFIELD", s: "CA", f: "06029", la: 35.37, lo: -119.02, z: ["CAZ314", "CAC029", "CAZ580"] },
  { t: "VMC", id: "P6", n: "TEHACHAPI", c: "TEHACHAPI", s: "CA", f: "06029", la: 35.13, lo: -118.45, z: ["CAZ331", "CAC029", "CAZ581"] },
];

const nws = {
  features: [
    // storm-based warning drawn as a polygon around Freeport only (its county list also names Harris)
    { id: "https://api.weather.gov/alerts/a1", geometry: { type: "Polygon", coordinates: [[[-95.5, 28.8], [-95.2, 28.8], [-95.2, 29.1], [-95.5, 29.1], [-95.5, 28.8]]] }, properties: { id: "a1", event: "Tornado Warning", headline: "Tornado Warning", areaDesc: "Brazoria", senderName: "NWS Houston", ends: "2026-11-17T12:00:00Z", geocode: { SAME: ["048039", "048201"] } } },
    // zone-based warning: whole counties
    { id: "https://api.weather.gov/alerts/a2", geometry: null, properties: { id: "a2", event: "Winter Storm Warning", areaDesc: "Midland", geocode: { SAME: ["026111"] } } },
    // zone warning for the mountains only; its SAME list names all of Kern county
    { id: "https://api.weather.gov/alerts/a3", geometry: null, properties: { id: "a3", event: "Blizzard Warning", areaDesc: "South End of the Upper Sierra", geocode: { SAME: ["006029"], UGC: ["CAZ331"] } } },
    // marine and advisories are ignored
    { id: "x", geometry: null, properties: { id: "x", event: "Small Craft Advisory", geocode: { SAME: ["048201"] } } },
  ],
};

describe("parseNws", () => {
  it("keeps land hazards and turns SAME codes into county FIPS", () => {
    const h = parseNws(nws);
    expect(h.map((x) => x.event)).toEqual(["Tornado Warning", "Winter Storm Warning", "Blizzard Warning"]);
    expect(h[2].zones).toEqual(["CAZ331"]);
    expect(h[0].counties).toEqual(["48039", "48201"]);
    expect(h[0].rings).toHaveLength(1);
  });
});

describe("plantsUnder", () => {
  it("uses the storm polygon when there is one (including plants without a county), else the named counties", () => {
    const hits = plantsUnder(parseNws(nws), plants);
    const tornado = hits.filter((x) => x.hazard.event === "Tornado Warning").map((x) => x.plant.id).sort();
    // Baytown sits in a named county but outside the polygon, so it is not under the warning
    expect(tornado).toEqual(["P1", "P4"]);
    expect(hits.find((x) => x.hazard.event === "Winter Storm Warning")).toMatchObject({ by: "county", plant: { id: "P2" } });
  });
  it("matches zone warnings by the plant's own NWS zone, not the whole county", () => {
    const hits = plantsUnder(parseNws(nws), plants).filter((x) => x.hazard.event === "Blizzard Warning");
    expect(hits.map((x) => [x.plant.id, x.by])).toEqual([["P6", "zone"]]);
  });
  it("places plants near a quake by magnitude-scaled distance", () => {
    const q = parseQuakes({ features: [{ id: "q1", geometry: { coordinates: [-95.1, 29.7, 10] }, properties: { mag: 5.2, place: "near Houston", time: 0, url: "https://earthquake.usgs.gov/q1" } }] });
    const hits = plantsUnder(q, plants);
    expect(hits.map((h) => h.plant.id).sort()).toEqual(["P1", "P3", "P4"]); // within 100 km
    expect(hits.find((h) => h.plant.id === "P3")!.distanceKm).toBeLessThan(15);
  });
});

describe("byCompany", () => {
  it("groups plants per company with the most severe hazard first", () => {
    const g = byCompany(plantsUnder(parseNws(nws), plants));
    expect(g.map((x) => x.ticker)).toEqual(["DOW", "XOM", "VMC"]);
    expect(g[0].kinds).toEqual(["Tornado", "Winter storm"]);
    expect(g[0].plants.map((p) => p.id)).toEqual(["P1", "P2"]);
  });
});

describe("countyLookup", () => {
  const census = ["STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT", "TX|48|201|x|Harris County|H1|A", "LA|22|033|x|East Baton Rouge Parish|H1|A", "VA|51|760|x|Richmond city|C7|F", "VA|51|159|x|Richmond County|H1|A", "MO|29|189|x|St. Louis County|H1|A"].join("\n");
  const f = countyLookup(census);
  it("matches TRI county names to FIPS, including parishes, saints and independent cities", () => {
    expect(f("TX", "HARRIS")).toBe("48201");
    expect(f("LA", "EAST BATON ROUGE PARISH")).toBe("22033");
    expect(f("MO", "SAINT LOUIS")).toBe("29189");
    expect(f("VA", "RICHMOND (CITY)")).toBe("51760");
    expect(f("VA", "RICHMOND")).toBe("51159");
    expect(f("TX", "NOWHERE")).toBeNull();
  });
});
