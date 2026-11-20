// Head-office positions for every covered company, for the supply-chain globe.
//   bun scripts/company-hq.ts [--directory=<path or URL>] [--out=public/data/hq.json]
//
// Sources, in order:
//   1. SEC EDGAR business address (city + state), as carried in universe.json: the bundled file, plus the
//      partner copy when PARTNER_DATA_KEY is set. Used for U.S. states and Canadian provinces.
//   2. scripts/data/hq-verified.json: head offices checked by hand against a filing cover page, each with its sources.
//      It covers places the gazetteer does not list (Abbott Park, Tysons) and directory rows found to be wrong.
//   3. The pipeline's company directory (`headquarters`: "city, region, country").
// Each address is matched to a GeoNames city (cities with 1,000+ people, via the `all-the-cities` package).
// A city that cannot be matched in the right country and state is never guessed: the company is placed at
// country level (the country's largest city, flagged "n") or listed under `missing`.
// The file is published to datasets/analytics/hq.json by `bun scripts/analytics-publish.ts --set=hq`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import cities from "all-the-cities";
import { COVERAGE } from "@/lib/coverage";
import { cityLabel, indexCities, isExonym, matchCity, US_STATES, usState, type GazCity, type HqFile, type HqRow } from "@/lib/supply/geo";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; })) as Record<string, string | undefined>;
const OUT = args.out ?? "public/data/hq.json";
const DIRECTORY = args.directory ?? "https://raw.githubusercontent.com/nevaubi/filedunderai/main/public/data/company-directory.json";
const log = (m: string) => console.log(`[company-hq] ${m}`);

/* ---------- gazetteer ---------- */
interface RawCity { name: string; altName?: string; country: string; adminCode?: string; population: number; loc: { coordinates: [number, number] } }
const gaz: GazCity[] = (cities as unknown as RawCity[]).map((c) => ({ name: c.name, alt: c.altName, country: c.country, admin: c.adminCode, pop: c.population, lon: c.loc.coordinates[0], lat: c.loc.coordinates[1] }));
const index = indexCities(gaz);
const largest = new Map<string, GazCity>();
for (const c of gaz) { const b = largest.get(c.country); if (!b || c.pop > b.pop) largest.set(c.country, c); }

/* ---------- countries ---------- */
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
/** Display names that should match the spelling used across the supply-chain page and the base map. */
const DISPLAY: Record<string, string> = { HK: "Hong Kong", MO: "Macau", TR: "Turkey", CZ: "Czechia", US: "United States", GB: "United Kingdom", KR: "South Korea", TW: "Taiwan", RU: "Russia", VN: "Vietnam" };
const countryName = (iso: string) => DISPLAY[iso] ?? regionNames.of(iso) ?? iso;
const ISO_BY_NAME = new Map<string, string>();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const iso = String.fromCharCode(a, b);
  let name: string | undefined;
  try { name = regionNames.of(iso); } catch { name = undefined; }
  if (name && name !== iso) ISO_BY_NAME.set(name.toLowerCase(), iso);
}
for (const [iso, name] of Object.entries(DISPLAY)) ISO_BY_NAME.set(name.toLowerCase(), iso);
for (const [alias, iso] of Object.entries({
  "united states of america": "US", usa: "US", us: "US", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", "korea, republic of": "KR", "republic of korea": "KR",
  "the netherlands": "NL", holland: "NL", "czech republic": "CZ", "russian federation": "RU", "viet nam": "VN", "hong kong sar china": "HK", "macao sar china": "MO",
  "people's republic of china": "CN", "mainland china": "CN", "cayman islands": "KY", bermuda: "BM", "türkiye": "TR", "u.s.": "US", "u.k.": "GB",
})) ISO_BY_NAME.set(alias, iso);
const isoOf = (name: string): string | null => ISO_BY_NAME.get(name.trim().toLowerCase()) ?? null;

/** SEC EDGAR codes for Canadian provinces, mapped to the province codes GeoNames uses. */
const SEC_CANADA: Record<string, string> = { A0: "01", A1: "02", A2: "03", A3: "04", A4: "05", A5: "07", A6: "08", A7: "09", A8: "10", A9: "11", B0: "12" };

const round = (v: number) => Math.round(v * 1000) / 1000;

/* ---------- inputs ---------- */
interface SecRow { ticker: string; city?: string; state?: string }
interface DirRow { ticker: string; headquarters?: string }
async function readJson<T>(where: string, headers?: Record<string, string>): Promise<T> {
  if (/^https?:\/\//.test(where)) {
    const r = await fetch(where, { headers, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${where}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  return JSON.parse(readFileSync(where, "utf8")) as T;
}
async function secRows(): Promise<Map<string, SecRow>> {
  const out = new Map<string, SecRow>();
  const take = (rows: SecRow[] | undefined) => {
    for (const r of Array.isArray(rows) ? rows : []) if (r && typeof r.ticker === "string" && typeof r.city === "string" && typeof r.state === "string" && r.city && r.state) out.set(r.ticker.toUpperCase(), r);
  };
  if (existsSync("public/data/universe.json")) take((await readJson<{ companies: SecRow[] }>("public/data/universe.json")).companies);
  const key = process.env.PARTNER_DATA_KEY;
  if (key) {
    const base = process.env.PARTNER_DATA_URL || "https://filedunderai.vercel.app/api/app-data";
    /* with the key set this run is expected to use SEC addresses for the whole coverage: publishing without them would quietly swap the source */
    try { take((await readJson<{ companies: SecRow[] }>(`${base}?path=universe.json`, { "x-partner-key": key })).companies); }
    catch (e) { log(`partner universe not read (${(e as Error).message}); leaving the existing file untouched`); process.exit(1); }
  }
  return out;
}
async function directoryRows(): Promise<Map<string, DirRow>> {
  const out = new Map<string, DirRow>();
  try {
    const rows = (await readJson<{ companies?: unknown }>(DIRECTORY)).companies;
    for (const r of Array.isArray(rows) ? (rows as DirRow[]) : []) {
      /* remote file: take only plain, short strings */
      if (!r || typeof r.ticker !== "string" || typeof r.headquarters !== "string" || r.ticker.length > 12 || r.headquarters.length > 160) continue;
      out.set(r.ticker.toUpperCase(), { ticker: r.ticker, headquarters: r.headquarters });
    }
  }
  catch (e) { log(`company directory not read (${(e as Error).message})`); }
  return out;
}

interface VerifiedRow { ticker: string; city: string; region: string; country: string; lat: number; lon: number }
function verifiedRows(): Map<string, HqRow> {
  const out = new Map<string, HqRow>();
  const file = "scripts/data/hq-verified.json";
  if (!existsSync(file)) return out;
  for (const r of (JSON.parse(readFileSync(file, "utf8")) as { rows: VerifiedRow[] }).rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) continue;
    const us = r.country === "United States";
    const country = us && r.region === "PR" ? "Puerto Rico" : r.country;
    out.set(r.ticker.toUpperCase(), [round(r.lat), round(r.lon), us && r.region ? `${r.city}, ${r.region}` : `${r.city}, ${country}`, country, "c", "v"]);
  }
  return out;
}

/* ---------- matching ---------- */
/** "Washington, D.C." reads better as "Washington" in front of the state code. */
const placeName = (c: GazCity) => c.name.split(",")[0];
const row = (c: GazCity, place: string, country: string, precision: "c" | "n", source: "s" | "d"): HqRow => [round(c.lat), round(c.lon), place, country, precision, source];

function fromSec(r: SecRow): HqRow | null {
  const state = (r.state ?? "").toUpperCase(), city = r.city ?? "";
  if (state === "PR") {
    const c = matchCity(index, city, "PR");
    return c ? row(c, `${c.name}, Puerto Rico`, "Puerto Rico", "c", "s") : null;
  }
  if (US_STATES[state]) {
    const c = matchCity(index, city, "US", state);
    return c ? row(c, `${placeName(c)}, ${state}`, "United States", "c", "s") : null;
  }
  const province = SEC_CANADA[state];
  if (province) {
    const c = matchCity(index, city, "CA", province);
    return c ? row(c, `${c.name}, Canada`, "Canada", "c", "s") : null;
  }
  return null;
}
function fromDirectory(r: DirRow): HqRow | null {
  const parts = (r.headquarters ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const iso = isoOf(parts[parts.length - 1]);
  if (!iso) return null;
  const country = countryName(iso), city = parts[0];
  if (iso === "US") {
    const state = parts.length >= 3 ? usState(parts[parts.length - 2]) : null;
    if (state === "PR") {
      const c = matchCity(index, city, "PR");
      if (c) return row(c, `${c.name}, Puerto Rico`, "Puerto Rico", "c", "d");
    }
    const c = state ? matchCity(index, city, "US", state) : null;
    if (c) return row(c, `${placeName(c)}, ${state}`, country, "c", "d");
  } else if (parts.length >= 2) {
    const c = matchCity(index, city, iso);
    if (c) return row(c, `${isExonym(city) ? cityLabel(city) : c.name}, ${country}`, country, "c", "d");
  }
  const big = largest.get(iso);
  return big ? row(big, country, country, "n", "d") : null;
}
const km = (a: HqRow, b: HqRow) => {
  const R = Math.PI / 180, dLat = (b[0] - a[0]) * R, dLon = (b[1] - a[1]) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

const [sec, dir] = await Promise.all([secRows(), directoryRows()]);
const verified = verifiedRows();
log(`inputs: ${sec.size} SEC business addresses, ${verified.size} hand-checked head offices, ${dir.size} directory head offices, ${gaz.length} gazetteer cities`);
if (sec.size + dir.size === 0) { log("no address source could be read; leaving the existing file untouched"); process.exit(1); }

const companies: Record<string, HqRow> = {}, missing: string[] = [];
let city = 0, countryOnly = 0, apart = 0;
for (const t of COVERAGE.map((c) => c.ticker).sort()) {
  const s = sec.get(t), d = dir.get(t);
  const a = s ? fromSec(s) : null, b = d ? fromDirectory(d) : null;
  /* the SEC address wins when it resolves to a city; then a hand-checked head office; then the directory */
  const pick = a ?? verified.get(t) ?? b;
  if (a && b && b[4] === "c" && km(a, b) > 150) apart++;
  if (!pick) { missing.push(t); continue; }
  companies[t] = pick;
  if (pick[4] === "c") city++; else countryOnly++;
  if (s && !a && pick[5] === "d") log(`${t}: SEC address "${cityLabel(s.city ?? "")}, ${s.state}" not matched; used the directory (${pick[2]})`);
}
const total = COVERAGE.length;
const bySource = { sec: 0, verified: 0, directory: 0 };
for (const r of Object.values(companies)) bySource[r[5] === "s" ? "sec" : r[5] === "v" ? "verified" : "directory"]++;
if (city + countryOnly < total * 0.6) { log(`only ${city + countryOnly} of ${total} companies placed; refusing to overwrite the existing file`); process.exit(1); }

const file: HqFile = {
  generatedAt: new Date().toISOString(),
  sources: {
    s: "SEC EDGAR business address (city and state) from universe.json",
    v: "Head office checked by hand against the filing cover page (scripts/data/hq-verified.json, with sources)",
    d: "FiledUnder pipeline company directory (headquarters: city, region, country)",
    gazetteer: "GeoNames cities with 1,000+ inhabitants (all-the-cities 3.1.0); coordinates rounded to 0.001°",
    n: "country-level rows sit at the country's largest city because the city itself could not be matched",
  },
  counts: { companies: total, city, country: countryOnly, missing: missing.length, ...bySource },
  companies,
  missing,
};
writeFileSync(OUT, `${JSON.stringify(file)}\n`);
log(`sources: ${bySource.sec} SEC business address, ${bySource.verified} hand-checked, ${bySource.directory} directory`);
log(`wrote ${OUT}: ${city} to the city, ${countryOnly} to the country, ${missing.length} missing of ${total}; ${apart} companies where the SEC and directory cities are more than 150 km apart (SEC kept)`);
