// Live hazards at covered companies' US plants: National Weather Service warnings (storm polygons,
// else the counties a warning names) and USGS earthquakes near a plant. Plants come from EPA's
// Toxics Release Inventory (`plants.json`, built by `scripts/gov-data.ts --tri`). Pure.

export const NWS_ALERTS = "https://api.weather.gov/alerts/active?status=actual&message_type=alert,update";
export const USGS_QUAKES = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
export const PLANTS_PATH = "alt/plants.json";

/** A plant in the compact index: ticker, TRI id, name, city, state, county FIPS, latitude, longitude. */
export interface Plant {
  t: string;
  id: string;
  n: string;
  c: string;
  s: string;
  f: string | null;
  la: number | null;
  lo: number | null;
  /** NWS zones the plant sits in (forecast, county, fire weather), from the points API. */
  z?: string[];
}

export type HazardKind = "Hurricane" | "Tropical storm" | "Storm surge" | "Tornado" | "Severe storm" | "Flood" | "Winter storm" | "Ice" | "Cold" | "Heat" | "Wind" | "Fire" | "Tsunami" | "Dust" | "Earthquake";

/** Land hazards that can stop a plant, by NWS event name (marine alerts, advisories and statements are left out). */
export const HAZARD_EVENTS: Record<string, { kind: HazardKind; level: "warning" | "watch" }> = {
  "Hurricane Warning": { kind: "Hurricane", level: "warning" },
  "Hurricane Watch": { kind: "Hurricane", level: "watch" },
  "Extreme Wind Warning": { kind: "Hurricane", level: "warning" },
  "Tropical Storm Warning": { kind: "Tropical storm", level: "warning" },
  "Tropical Storm Watch": { kind: "Tropical storm", level: "watch" },
  "Storm Surge Warning": { kind: "Storm surge", level: "warning" },
  "Storm Surge Watch": { kind: "Storm surge", level: "watch" },
  "Tornado Warning": { kind: "Tornado", level: "warning" },
  "Severe Thunderstorm Warning": { kind: "Severe storm", level: "warning" },
  "Flash Flood Warning": { kind: "Flood", level: "warning" },
  "Flood Warning": { kind: "Flood", level: "warning" },
  "Coastal Flood Warning": { kind: "Flood", level: "warning" },
  "Lakeshore Flood Warning": { kind: "Flood", level: "warning" },
  "Winter Storm Warning": { kind: "Winter storm", level: "warning" },
  "Blizzard Warning": { kind: "Winter storm", level: "warning" },
  "Lake Effect Snow Warning": { kind: "Winter storm", level: "warning" },
  "Ice Storm Warning": { kind: "Ice", level: "warning" },
  "Extreme Cold Warning": { kind: "Cold", level: "warning" },
  "Wind Chill Warning": { kind: "Cold", level: "warning" },
  "Hard Freeze Warning": { kind: "Cold", level: "warning" },
  "Excessive Heat Warning": { kind: "Heat", level: "warning" },
  "Extreme Heat Warning": { kind: "Heat", level: "warning" },
  "High Wind Warning": { kind: "Wind", level: "warning" },
  "Red Flag Warning": { kind: "Fire", level: "warning" },
  "Fire Warning": { kind: "Fire", level: "warning" },
  "Tsunami Warning": { kind: "Tsunami", level: "warning" },
  "Dust Storm Warning": { kind: "Dust", level: "warning" },
};

export interface Hazard {
  id: string;
  kind: HazardKind;
  level: "warning" | "watch";
  event: string;
  headline: string;
  area: string;
  sender: string;
  onset: string | null;
  ends: string | null;
  url: string;
  /** County FIPS (5 digits) the alert names (SAME codes: whole counties, coarser than its zones). */
  counties: string[];
  /** NWS zone ids the alert covers (UGC, e.g. CAZ331, TXC039) — the alert's own area definition. */
  zones: string[];
  /** Outer rings [lon, lat] when the alert is drawn as a polygon (storm-based warnings). */
  rings: [number, number][][];
  /** Earthquakes only. */
  mag?: number;
  lat?: number;
  lon?: number;
}

type Geo = { type: string; coordinates: unknown } | null;
const ringsOf = (g: Geo): [number, number][][] => {
  if (!g) return [];
  if (g.type === "Polygon") return [(g.coordinates as [number, number][][])[0]].filter(Boolean);
  if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][]).map((p) => p[0]).filter(Boolean);
  return [];
};

/** NWS active-alerts GeoJSON → plant-relevant hazards. SAME codes ("048201") become county FIPS ("48201"). */
export function parseNws(json: unknown): Hazard[] {
  const fs = ((json as { features?: unknown[] })?.features ?? []) as { id?: string; geometry: Geo; properties: Record<string, any> }[];
  const out: Hazard[] = [];
  for (const f of fs) {
    const p = f.properties ?? {};
    const h = HAZARD_EVENTS[p.event];
    if (!h) continue;
    const counties = ((p.geocode?.SAME ?? []) as string[]).filter((x) => /^0\d{5}$/.test(x)).map((x) => x.slice(1));
    out.push({
      id: String(p.id ?? f.id ?? ""),
      ...h,
      event: p.event,
      headline: String(p.headline ?? p.event),
      area: String(p.areaDesc ?? ""),
      sender: String(p.senderName ?? ""),
      onset: p.onset ?? p.effective ?? null,
      ends: p.ends ?? p.expires ?? null,
      url: String(f.id ?? p["@id"] ?? ""),
      counties,
      zones: ((p.geocode?.UGC ?? []) as string[]).filter((x) => /^[A-Z]{2}[ZC]\d{3}$/.test(x)),
      rings: ringsOf(f.geometry),
    });
  }
  return out;
}

/** USGS week feed (M4.5+) → quakes as hazards with a magnitude-scaled radius. */
export function parseQuakes(json: unknown): Hazard[] {
  const fs = ((json as { features?: unknown[] })?.features ?? []) as { id: string; geometry: { coordinates: number[] }; properties: Record<string, any> }[];
  return fs
    .filter((f) => f.properties?.mag != null && f.geometry?.coordinates?.length >= 2)
    .map((f) => ({
      id: f.id,
      kind: "Earthquake" as const,
      level: "warning" as const,
      event: `M${Number(f.properties.mag).toFixed(1)} earthquake`,
      headline: String(f.properties.title ?? `M${f.properties.mag} earthquake`),
      area: String(f.properties.place ?? ""),
      sender: "USGS",
      onset: f.properties.time ? new Date(f.properties.time).toISOString() : null,
      ends: null,
      url: String(f.properties.url ?? ""),
      counties: [],
      zones: [],
      rings: [],
      mag: Number(f.properties.mag),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
}

/** Radius in km within which a quake of this magnitude can disrupt a plant. */
export const quakeRadiusKm = (m: number) => (m >= 7 ? 400 : m >= 6 ? 200 : m >= 5 ? 100 : 40);

export function km(a: { la: number; lo: number }, b: { la: number; lo: number }) {
  const r = Math.PI / 180;
  const d = Math.sin(((b.la - a.la) * r) / 2) ** 2 + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(((b.lo - a.lo) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(d));
}

/** Ray casting; ring points are [lon, lat]. */
export function inRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface PlantHit {
  plant: Plant;
  hazard: Hazard;
  /** How the plant was placed under the hazard. */
  by: "polygon" | "zone" | "county" | "distance";
  distanceKm?: number;
}

/**
 * Plants under each hazard: inside a storm polygon when the alert has one (precise), otherwise in an
 * NWS zone the alert lists (or, for plants without zone ids, a county it names); quakes by distance.
 * Polygon alerts never fall back to whole counties.
 */
export function plantsUnder(hazards: Hazard[], plants: Plant[]): PlantHit[] {
  const byCounty = new Map<string, Plant[]>();
  for (const p of plants) if (p.f) (byCounty.get(p.f) ?? byCounty.set(p.f, []).get(p.f)!).push(p);
  const zoned = plants.filter((p) => p.z?.length);
  const out: PlantHit[] = [];
  for (const h of hazards) {
    if (h.kind === "Earthquake") {
      const r = quakeRadiusKm(h.mag ?? 0);
      for (const p of plants) {
        if (p.la == null || p.lo == null) continue;
        const d = km({ la: p.la, lo: p.lo }, { la: h.lat!, lo: h.lon! });
        if (d <= r) out.push({ plant: p, hazard: h, by: "distance", distanceKm: Math.round(d) });
      }
      continue;
    }
    if (h.rings.length) {
      const box = h.rings.flat().reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), y0: Math.min(b.y0, y), y1: Math.max(b.y1, y) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
      for (const p of plants) {
        if (p.la == null || p.lo == null || p.lo < box.x0 || p.lo > box.x1 || p.la < box.y0 || p.la > box.y1) continue;
        if (h.rings.some((ring) => inRing(p.lo!, p.la!, ring))) out.push({ plant: p, hazard: h, by: "polygon" });
      }
      continue;
    }
    // zone alerts: a plant with known NWS zones is under the alert only if one of its zones is listed;
    // the SAME county list is a fallback for plants without zone ids (zones are often parts of a county)
    const zs = new Set(h.zones);
    for (const p of zoned) if (p.z!.some((z) => zs.has(z))) out.push({ plant: p, hazard: h, by: "zone" });
    for (const c of h.counties) for (const p of byCounty.get(c) ?? []) if (!p.z?.length) out.push({ plant: p, hazard: h, by: "county" });
  }
  return out;
}

const KIND_RANK: Record<HazardKind, number> = { Hurricane: 0, Tsunami: 0, Earthquake: 1, "Storm surge": 1, Tornado: 1, "Tropical storm": 2, Flood: 2, Ice: 3, "Winter storm": 3, "Severe storm": 3, Fire: 4, Cold: 4, Heat: 4, Wind: 5, Dust: 5 };

export interface CompanyHazards {
  ticker: string;
  plants: { id: string; n: string; c: string; s: string; la: number | null; lo: number | null; hazards: { id: string; kind: HazardKind; level: string; event: string; ends: string | null; url: string; by: string; distanceKm?: number }[] }[];
  kinds: HazardKind[];
  worst: number;
}

/** Hits grouped by company (most plants and most severe first), each plant with its hazards. */
export function byCompany(hits: PlantHit[]): CompanyHazards[] {
  const m = new Map<string, Map<string, CompanyHazards["plants"][number]>>();
  for (const h of hits) {
    const ps = m.get(h.plant.t) ?? m.set(h.plant.t, new Map()).get(h.plant.t)!;
    const p = ps.get(h.plant.id) ?? ps.set(h.plant.id, { id: h.plant.id, n: h.plant.n, c: h.plant.c, s: h.plant.s, la: h.plant.la, lo: h.plant.lo, hazards: [] }).get(h.plant.id)!;
    // one entry per event type per plant (a county can sit under several overlapping alerts)
    if (!p.hazards.some((x) => x.event === h.hazard.event)) p.hazards.push({ id: h.hazard.id, kind: h.hazard.kind, level: h.hazard.level, event: h.hazard.event, ends: h.hazard.ends, url: h.hazard.url, by: h.by, distanceKm: h.distanceKm });
  }
  const out: CompanyHazards[] = [];
  for (const [t, ps] of m) {
    const plants = [...ps.values()].map((p) => ({ ...p, hazards: p.hazards.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]) }));
    const kinds = [...new Set(plants.flatMap((p) => p.hazards.map((h) => h.kind)))].sort((a, b) => KIND_RANK[a] - KIND_RANK[b]);
    out.push({ ticker: t, plants: plants.sort((a, b) => KIND_RANK[a.hazards[0].kind] - KIND_RANK[b.hazards[0].kind] || a.n.localeCompare(b.n)), kinds, worst: Math.min(...kinds.map((k) => KIND_RANK[k])) });
  }
  return out.sort((a, b) => a.worst - b.worst || b.plants.length - a.plants.length || a.ticker.localeCompare(b.ticker));
}

// ---------- county FIPS for TRI plants ----------

const normCounty = (s: string) =>
  s.toLowerCase().replace(/\bsaint\b/g, "st").replace(/[.']/g, "").replace(/\s+(county|parish|borough|census area|city and borough|municipality|municipio)$/, "").replace(/\s+/g, " ").trim();

/** Census national_county2020.txt ("STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|…") → lookup(state, TRI county name) → FIPS. */
export function countyLookup(censusText: string): (state: string, county: string) => string | null {
  const m = new Map<string, string>();
  const cities = new Map<string, string>();
  for (const line of censusText.split("\n").slice(1)) {
    const [st, sf, cf, , name] = line.split("|");
    if (!st || !sf || !cf || !name) continue;
    const fips = sf + cf;
    if (/ city$/i.test(name)) cities.set(`${st}|${normCounty(name.replace(/ city$/i, ""))}`, fips);
    const k = `${st}|${normCounty(name)}`;
    if (!m.has(k)) m.set(k, fips);
  }
  return (state: string, county: string) => {
    const c = county.trim();
    if (!c) return null;
    const city = /\(CITY\)|\bCITY$/i.test(c);
    const k = `${state}|${normCounty(c.replace(/\(CITY\)/i, "").replace(/\bCITY$/i, ""))}`;
    return (city ? cities.get(k) : null) ?? m.get(k) ?? cities.get(k) ?? null;
  };
}

/** A human-readable page for a hazard at a plant: USGS event page for quakes, else the NWS point forecast (lists the warnings in force there). */
export function hazardLink(h: { kind: HazardKind; url: string }, p: { la: number | null; lo: number | null }) {
  if (h.kind === "Earthquake" || p.la == null || p.lo == null) return h.url;
  return `https://forecast.weather.gov/MapClick.php?lat=${p.la.toFixed(4)}&lon=${p.lo.toFixed(4)}`;
}
