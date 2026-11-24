// EPA Toxics Release Inventory (TRI): every US industrial facility that handles listed chemicals
// files a yearly form with its parent company, location, releases and a production ratio (this
// year's activity for that chemical ÷ last year's). Rolled up per covered company: its plants by
// state, releases, chemicals and a production index. Pure: the script downloads the yearly files.
import { parseCsvLine } from "./csv";

export const TRI_PAGE = "https://www.epa.gov/toxics-release-inventory-tri-program/tri-basic-data-files-calendar-years-1987-present";
export const triFileUrl = (year: number) => `https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/${year}_US/csv`;
/** A facility's EPA compliance page (ECHO) when it has a registry id, else its TRI forms for the year. */
export const facilityUrl = (trifd: string, frs: string, year: number) =>
  frs ? `https://echo.epa.gov/detailed-facility-report?fid=${frs}` : `https://data.epa.gov/efservice/tri_reporting_form/tri_facility_id/${trifd}/reporting_year/${year}/JSON`;

export const TRI_DATASET = "tri";
export const TRI_FACILITIES = "TRI facilities";
export const TRI_RELEASES = "Toxic releases (TRI)";
export const TRI_PRODUCTION = "TRI production index";

/** One chemical form at one facility in one year. */
export interface TriRec {
  year: number;
  trifd: string;
  frs: string;
  facility: string;
  city: string;
  county: string;
  state: string;
  lat: number | null;
  lon: number | null;
  parent: string;
  sector: string;
  naics: string;
  chemical: string;
  carcinogen: boolean;
  pfas: boolean;
  /** Pounds (dioxin-class chemicals reported in grams are converted). */
  releases: number;
  onsite: number;
  offsite: number;
  waste: number;
  /** This year's production (or activity) ÷ last year's for this chemical; null when not reported. */
  ratio: number | null;
  ratioKind: "PRODUCTION" | "ACTIVITY" | "";
}

const n = (v: string | undefined) => {
  const x = Number(v);
  return v != null && v !== "" && Number.isFinite(x) ? x : 0;
};

/** The yearly basic file ("1. YEAR", "2. TRIFD", …) → records. Headers are matched by name, so column moves don't matter. */
export function parseTri(text: string): TriRec[] {
  const lines = text.split("\n");
  const head = parseCsvLine(lines[0] ?? "").map((h) => h.replace(/^\uFEFF/, "").replace(/^\d+\.\s*/, "").trim());
  const ix = (k: string) => head.indexOf(k);
  const C = {
    year: ix("YEAR"), trifd: ix("TRIFD"), frs: ix("FRS ID"), name: ix("FACILITY NAME"), city: ix("CITY"), county: ix("COUNTY"), st: ix("ST"), lat: ix("LATITUDE"), lon: ix("LONGITUDE"),
    parent: ix("PARENT CO NAME"), std: ix("STANDARD PARENT CO NAME"), sector: ix("INDUSTRY SECTOR"), naics: ix("PRIMARY NAICS"), chem: ix("CHEMICAL"),
    carc: ix("CARCINOGEN"), pfas: ix("PFAS"), unit: ix("UNIT OF MEASURE"), on: ix("ON-SITE RELEASE TOTAL"), off: ix("OFF-SITE RELEASE TOTAL"), tot: ix("TOTAL RELEASES"),
    waste: ix("PRODUCTION WSTE (8.1-8.7)"), kind: head.findIndex((h) => h.replace(/\s+/g, "") === "PROD_RATIO_OR_ACTIVITY"), ratio: ix("8.9 - PRODUCTION RATIO"),
  };
  if ([C.year, C.trifd, C.st, C.chem, C.tot].some((i) => i < 0)) throw new Error("unexpected TRI columns: " + head.slice(0, 20).join(","));
  const out: TriRec[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const r = parseCsvLine(lines[i]);
    if (r.length < head.length - 2) continue;
    const g = r[C.unit] === "Grams" ? 1 / 453.592 : 1;
    const std = (r[C.std] ?? "").trim();
    const raw = (r[C.parent] ?? "").trim();
    const kind = (r[C.kind] ?? "").trim().toUpperCase();
    const ratio = r[C.ratio] === "" || r[C.ratio] == null ? null : Number(r[C.ratio]);
    out.push({
      year: n(r[C.year]),
      trifd: r[C.trifd],
      frs: (r[C.frs] ?? "").trim(),
      facility: (r[C.name] ?? "").trim(),
      city: (r[C.city] ?? "").trim(),
      county: C.county >= 0 ? (r[C.county] ?? "").trim() : "",
      state: (r[C.st] ?? "").trim(),
      lat: r[C.lat] ? Number(r[C.lat]) : null,
      lon: r[C.lon] ? Number(r[C.lon]) : null,
      parent: std && std !== "NA" ? std : raw && raw !== "NA" ? raw : "",
      sector: (r[C.sector] ?? "").trim(),
      naics: (r[C.naics] ?? "").trim(),
      chemical: (r[C.chem] ?? "").trim(),
      carcinogen: r[C.carc] === "YES",
      pfas: r[C.pfas] === "YES",
      releases: n(r[C.tot]) * g,
      onsite: n(r[C.on]) * g,
      offsite: n(r[C.off]) * g,
      waste: C.waste >= 0 ? n(r[C.waste]) * g : 0,
      ratio: ratio != null && Number.isFinite(ratio) ? ratio : null,
      ratioKind: kind === "PRODUCTION" || kind === "ACTIVITY" ? kind : "",
    });
  }
  return out;
}

// ---------- matching TRI parent companies to covered companies ----------

const STOP = /\b(the|inc|incorporated|corp|corporation|co|cos|company|companies|llc|lp|llp|ltd|plc|limited|holdings?|group|nv|sa|ag|se|usa|us|of)\b/g;
export const normParent = (s: string) =>
  s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(n v|l p|s a|p l c)$/, " ").replace(STOP, " ").replace(/\s+/g, " ").trim();
/** Descriptors a subsidiary adds to the parent's name ("Halliburton Energy Services", "CRH Americas"). */
const TRAIL = /\s(americas|north america|operating|finance|energy services|international|intl|industries|enterprises|manufacturing|mfg)$/;
/** Industries without TRI plants: a one-word name match there is someone else (a bank called Banner vs Banner Industries). */
const NO_PLANTS = /^(banks|diversified banks|insurance|capital markets|investment banking|financial services|consumer finance|financial exchanges|transaction & payment|.*reits|real estate management|software|application software|systems software|it services|it consulting|interactive media|media|entertainment|movies|health care providers|managed health care|health care technology|hotels|restaurants|telecommunication|integrated telecommunication|commercial & professional services)/i;
/** Common words that also name unrelated private manufacturers. */
const COMMON = new Set(["williams", "banner", "sabre", "universal", "southern", "frontier", "reliance", "alliance", "morningstar", "general", "american", "national", "united", "standard", "premier", "pioneer", "summit", "apex", "liberty", "eagle", "atlas", "phoenix", "titan", "mission", "century", "central", "pacific", "atlantic", "western", "eastern", "northern", "continental", "global", "advanced", "andersen", "graham", "southwest", "midwest"]);

export interface TriCo {
  ticker: string;
  shortName: string;
  legal?: string;
  industry?: string;
}

/**
 * parent name → ticker (or null). Exact normalized match on legal names and multi-word short names;
 * then with a subsidiary descriptor dropped; then a multi-word legal name the parent starts with.
 * One-word names never match companies in plant-less industries or common words, and a name two
 * companies share matches neither. `aliases` (normalized parent → ticker) are hand-checked and win.
 */
export function triMatcher(cos: TriCo[], aliases: Record<string, string> = {}): (parent: string) => string | null {
  const by = new Map<string, Set<string>>();
  const legal = new Set<string>();
  const info = new Map(cos.map((c) => [c.ticker, c]));
  for (const c of cos)
    for (const nm of [c.shortName, c.legal]) {
      if (!nm) continue;
      const k = normParent(nm);
      if (k.length < 2 || (nm !== c.legal && !k.includes(" "))) continue;
      (by.get(k) ?? by.set(k, new Set()).get(k)!).add(c.ticker);
      if (nm === c.legal) {
        legal.add(k);
        // "LyondellBasell Industries" is also filed as plain "LyondellBasell …"
        const bare = k.replace(TRAIL, "").trim();
        if (bare !== k && bare.length >= 6) (by.get(bare) ?? by.set(bare, new Set()).get(bare)!).add(c.ticker);
      }
    }
  const prefixKeys = [...by.keys()].filter((k) => legal.has(k) && k.includes(" "));
  const ok = (k: string, t: string) => k.includes(" ") || (!NO_PLANTS.test(info.get(t)?.industry ?? "") && !COMMON.has(k));
  const one = (k: string) => {
    const s = by.get(k);
    if (!s || s.size !== 1) return null;
    const t = [...s][0];
    return ok(k, t) ? t : null;
  };
  const memo = new Map<string, string | null>();
  return (parent: string) => {
    if (memo.has(parent)) return memo.get(parent)!;
    let res: string | null = null;
    let k = normParent(parent);
    if (aliases[k]) res = aliases[k];
    else {
      res = one(k);
      for (let i = 0; !res && i < 2 && TRAIL.test(` ${k}`); i++) {
        k = k.replace(TRAIL, "").trim();
        const t = one(k);
        // a dropped descriptor on a one-word name needs a distinctive word ("polaris", not "sabre")
        if (t && (k.includes(" ") || k.length >= 6)) res = t;
      }
      if (!res) {
        const full = normParent(parent);
        const hits = new Set<string>();
        for (const pk of prefixKeys) if (full.startsWith(pk + " ")) for (const t of by.get(pk)!) if (!NO_PLANTS.test(info.get(t)?.industry ?? "")) hits.add(t);
        res = hits.size === 1 ? [...hits][0] : null;
      }
    }
    memo.set(parent, res);
    return res;
  };
}

// ---------- per-company rows ----------

interface Row {
  uid: string;
  ticker: string;
  dataset: string;
  kind: string;
  date: string;
  title: string;
  value: number;
  unit: string;
  meta: Record<string, unknown>;
  source: string;
  source_url: string;
}

export interface TriFacility {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number | null;
  lon: number | null;
  sector: string;
  naics: string;
  parent: string;
  releases: number;
  chemicals: number;
  /** Median production ratio over its PRODUCTION-basis forms (0 < r ≤ 10). */
  ratio: number | null;
  url: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Rows for one year: facility count (with the plant list, states and chemicals in meta), total
 * releases and the production index (median of the facilities' production ratios) per company.
 */
export function triRows(year: number, recs: TriRec[], match: (parent: string) => string | null, opts: { maxFacilities?: number } = {}): Row[] {
  const maxF = opts.maxFacilities ?? 400;
  const per = new Map<string, Map<string, { f: TriFacility; ratios: number[]; chems: Set<string> } & Omit<TriRec, "ratio">>>();
  const chem = new Map<string, Map<string, number>>();
  const tot = new Map<string, { on: number; off: number; carc: number; pfas: number; waste: number; parents: Set<string> }>();
  for (const r of recs) {
    if (r.year !== year || !r.parent || !r.trifd) continue;
    const t = match(r.parent);
    if (!t) continue;
    const fs = per.get(t) ?? per.set(t, new Map()).get(t)!;
    let f = fs.get(r.trifd);
    if (!f) {
      f = { ...r, f: { id: r.trifd, name: r.facility, city: r.city, state: r.state, lat: r.lat, lon: r.lon, sector: r.sector, naics: r.naics, parent: r.parent, releases: 0, chemicals: 0, ratio: null, url: facilityUrl(r.trifd, r.frs, year) }, ratios: [], chems: new Set() };
      fs.set(r.trifd, f);
    }
    f.f.releases += r.releases;
    f.chems.add(r.chemical);
    if (r.ratioKind === "PRODUCTION" && r.ratio != null && r.ratio > 0 && r.ratio <= 10) f.ratios.push(r.ratio);
    const cm = chem.get(t) ?? chem.set(t, new Map()).get(t)!;
    cm.set(r.chemical, (cm.get(r.chemical) ?? 0) + r.releases);
    const a = tot.get(t) ?? tot.set(t, { on: 0, off: 0, carc: 0, pfas: 0, waste: 0, parents: new Set() }).get(t)!;
    a.on += r.onsite;
    a.off += r.offsite;
    a.waste += r.waste;
    if (r.carcinogen) a.carc += r.releases;
    if (r.pfas) a.pfas++;
    a.parents.add(r.parent);
  }
  const date = `${year}-12-31`;
  const base = { dataset: TRI_DATASET, kind: "series", date, source: "EPA Toxics Release Inventory", source_url: triFileUrl(year) };
  const out: Row[] = [];
  for (const [t, fs] of per) {
    const facilities = [...fs.values()].map((x) => ({ ...x.f, releases: r1(x.f.releases), chemicals: x.chems.size, ratio: median(x.ratios) }));
    facilities.sort((a, b) => b.releases - a.releases || a.name.localeCompare(b.name));
    const a = tot.get(t)!;
    const releases = facilities.reduce((s, f) => s + f.releases, 0);
    const states = new Map<string, { facilities: number; releases: number }>();
    for (const f of facilities) {
      const s = states.get(f.state) ?? states.set(f.state, { facilities: 0, releases: 0 }).get(f.state)!;
      s.facilities++;
      s.releases += f.releases;
    }
    const ratios = facilities.map((f) => f.ratio).filter((x): x is number => x != null);
    const idx = median(ratios);
    const topChem = [...chem.get(t)!.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([c, v]) => ({ chemical: c, releases: r1(v) }));
    out.push({
      ...base,
      uid: `tri:${t}:${year}:facilities`,
      ticker: t,
      title: TRI_FACILITIES,
      value: facilities.length,
      unit: "facilities",
      meta: {
        year,
        states: [...states.entries()].sort((x, y) => y[1].facilities - x[1].facilities || y[1].releases - x[1].releases).map(([st, s]) => ({ state: st, facilities: s.facilities, releases: r1(s.releases) })),
        facilities: facilities.slice(0, maxF),
        more: Math.max(0, facilities.length - maxF),
        parents: [...a.parents].sort(),
        sectors: [...new Set(facilities.map((f) => f.sector).filter(Boolean))].slice(0, 8),
        top_chemicals: topChem,
      },
    });
    out.push({
      ...base,
      uid: `tri:${t}:${year}:releases`,
      ticker: t,
      title: TRI_RELEASES,
      value: r1(releases),
      unit: "lbs",
      meta: { year, onsite: r1(a.on), offsite: r1(a.off), carcinogens: r1(a.carc), pfas_forms: a.pfas, production_waste: r1(a.waste), facilities: facilities.length },
    });
    if (idx != null)
      out.push({
        ...base,
        uid: `tri:${t}:${year}:production`,
        ticker: t,
        title: TRI_PRODUCTION,
        value: Math.round(idx * 1000) / 1000,
        unit: "ratio",
        meta: { year, facilities: ratios.length, up: ratios.filter((x) => x > 1.02).length, down: ratios.filter((x) => x < 0.98).length, flat: ratios.filter((x) => x >= 0.98 && x <= 1.02).length },
      });
  }
  return out;
}

// ---------- assistant text ----------

interface TextRow {
  date: string | null;
  title: string;
  value: number | null;
  meta: Record<string, any>;
  source_url: string | null;
}

const lbs = (v: number | null | undefined) => (v == null ? "–" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M lb` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K lb` : `${Math.round(v)} lb`);

/** One company's TRI footprint: yearly plants/releases/production index, latest states, largest plants and chemicals. */
export function triText(rows: TextRow[], ticker: string, limit = 20): string {
  const years = [...new Set(rows.map((r) => r.meta?.year as number).filter(Boolean))].sort((a, b) => a - b);
  if (!years.length) return `No EPA Toxics Release Inventory plants matched to ${ticker} (only US plants handling listed chemicals report; parent names are matched conservatively).`;
  const get = (t: string, y: number) => rows.find((r) => r.title === t && r.meta?.year === y);
  const y = years[years.length - 1];
  const fac = get(TRI_FACILITIES, y)!;
  const lines = [
    `${ticker}: EPA Toxics Release Inventory (plants as reported under parent ${(fac.meta.parents ?? []).join("; ")}). Production index = median of plants' reported production ratios (this year ÷ last year per chemical). <${fac.source_url}>`,
    "BY YEAR: " + years.map((yr) => `${yr}: ${get(TRI_FACILITIES, yr)?.value ?? "–"} plants, ${lbs(get(TRI_RELEASES, yr)?.value)} released, production ${get(TRI_PRODUCTION, yr)?.value?.toFixed(3) ?? "–"}`).join(" | "),
    `STATES ${y}: ` + (fac.meta.states ?? []).slice(0, 15).map((s: { state: string; facilities: number; releases: number }) => `${s.state} ${s.facilities} (${lbs(s.releases)})`).join(", "),
    `LARGEST PLANTS ${y}:`,
    ...((fac.meta.facilities ?? []) as TriFacility[]).slice(0, limit).map((f) => `${f.name}, ${f.city} ${f.state} · ${f.sector} · ${lbs(f.releases)} · ${f.chemicals} chemicals${f.ratio != null ? ` · production ratio ${f.ratio.toFixed(2)}` : ""} <${f.url}>`),
    `TOP CHEMICALS ${y}: ` + (fac.meta.top_chemicals ?? []).slice(0, 8).map((c: { chemical: string; releases: number }) => `${c.chemical} ${lbs(c.releases)}`).join("; "),
  ];
  const rel = get(TRI_RELEASES, y);
  if (rel) lines.push(`RELEASES ${y}: on-site ${lbs(rel.meta.onsite)}, off-site ${lbs(rel.meta.offsite)}, carcinogens ${lbs(rel.meta.carcinogens)}, PFAS forms ${rel.meta.pfas_forms}`);
  return lines.join("\n");
}

/** Compact plant index for live hazard checks: one entry per matched plant in the year. */
export function plantIndex(year: number, recs: TriRec[], match: (parent: string) => string | null, fips: (state: string, county: string) => string | null) {
  const out = new Map<string, { t: string; id: string; n: string; c: string; s: string; f: string | null; la: number | null; lo: number | null }>();
  for (const r of recs) {
    if (r.year !== year || !r.parent || out.has(r.trifd)) continue;
    const t = match(r.parent);
    if (!t) continue;
    out.set(r.trifd, { t, id: r.trifd, n: r.facility, c: r.city, s: r.state, f: fips(r.state, r.county), la: r.lat, lo: r.lon });
  }
  return [...out.values()];
}

/** A year's plant detail as the panel draws it (p5-shots M12). */
export interface PlantsView {
  states: { state: string; facilities: number; releases: number }[];
  facilities: TriFacility[];
  /** The tile's sub-line: "in 4 states", or null when the file names no states. */
  where: string | null;
  /** Said once, in place of the empty grid and list, when the file counts plants but names none. */
  note: string | null;
}

/**
 * What the Plants and releases panel shows for one year's "TRI facilities" row. The count comes from the row's
 * value; the states and plant names from its meta. When the meta has neither, the tile shows the count alone and
 * one line says the file names no plants, instead of "in 0 states" beside an unlit grid.
 */
export function plantsView(value: number | null | undefined, meta: Record<string, unknown> | null | undefined, year: number): PlantsView {
  const states = (Array.isArray(meta?.states) ? meta.states : []) as PlantsView["states"];
  const facilities = (Array.isArray(meta?.facilities) ? meta.facilities : []) as TriFacility[];
  const where = states.length ? `in ${states.length} ${states.length === 1 ? "state" : "states"}` : null;
  let note: string | null = null;
  if (!states.length && !facilities.length)
    note = value ? `The EPA file for ${year} counts ${value} ${value === 1 ? "plant" : "plants"} for this company but names none, so there is no map or plant list.` : `The EPA file for ${year} lists no plants for this company.`;
  else if (!facilities.length) note = `The EPA file for ${year} lists no plant names for this company.`;
  return { states, facilities, where, note };
}
