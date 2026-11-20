// Head-office positions for every covered company, for the supply-chain globe.
//   bun scripts/company-hq.ts [--directory=<path or URL>] [--out=public/data/hq.json] [--sec-cache=<path>]
//
// Sources, in order (the rule is chooseHq in src/lib/sec/address.ts):
//   1. scripts/data/hq-verified.json: head offices checked by hand against a filing cover page, each with its sources.
//      It covers places the gazetteer does not list (Abbott Park, Tysons) and addresses that are not an operating office.
//   2. The SEC business address from SEC's own index (data.sec.gov/submissions), read for every covered CIK, one company at
//      a time at about 4 requests a second. An address care of a registered agent is not placed (see agentAddress).
//   3. The pipeline's company directory (`headquarters`: "city, region, country"), only where SEC gives no usable city.
// Each address is matched to a GeoNames city (cities with 1,000+ people, via the `all-the-cities` package).
// A city that cannot be matched in the right country and state is never guessed: the company is placed at
// country level (the country's largest city, flagged "n") or listed under `missing`.
// The run refuses to overwrite the file when SEC answers for fewer than 90% of companies or fewer than 60% place.
// --sec-cache=<path> keeps SEC's answers in a local file and reuses them for six days (for reruns; the worker does not use it).
// The file is published to datasets/analytics/hq.json by `bun scripts/analytics-publish.ts --set=hq`.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import cities from "all-the-cities";
import { COVERAGE } from "@/lib/coverage";
import { fetchSec } from "@/lib/sec.server";
import { agentAddress, chooseHq, countryIso, countryName, kmApart, readSubmissions, secPlace, type SecProfile } from "@/lib/sec/address";
import { cityLabel, indexCities, isExonym, matchCity, usState, type GazCity, type HqFile, type HqRow } from "@/lib/supply/geo";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; })) as Record<string, string | undefined>;
const OUT = args.out ?? "public/data/hq.json";
const DIRECTORY = args.directory ?? "https://raw.githubusercontent.com/nevaubi/filedunderai/main/public/data/company-directory.json";
const SEC_CACHE = args["sec-cache"];
const log = (m: string) => console.log(`[company-hq] ${m}`);

/* ---------- gazetteer ---------- */
interface RawCity { name: string; altName?: string; country: string; adminCode?: string; population: number; loc: { coordinates: [number, number] } }
const gaz: GazCity[] = (cities as unknown as RawCity[]).map((c) => ({ name: c.name, alt: c.altName, country: c.country, admin: c.adminCode, pop: c.population, lon: c.loc.coordinates[0], lat: c.loc.coordinates[1] }));
const index = indexCities(gaz);
const largest = new Map<string, GazCity>();
for (const c of gaz) { const b = largest.get(c.country); if (!b || c.pop > b.pop) largest.set(c.country, c); }

const round = (v: number) => Math.round(v * 1000) / 1000;

/* ---------- inputs ---------- */
interface DirRow { ticker: string; headquarters?: string }
async function readJson<T>(where: string): Promise<T> {
  if (/^https?:\/\//.test(where)) {
    const r = await fetch(where, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${where}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  return JSON.parse(readFileSync(where, "utf8")) as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** SEC allows 10 requests a second; this run starts at most one every 250 ms and backs off when SEC says 429. */
const GAP_MS = 250;
let lastStart = 0;
async function secProfile(cik: string): Promise<SecProfile | "absent" | "failed"> {
  const url = `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastStart + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    try {
      /* fetchSec already retries quickly three times; a failure here is a sustained 429 or an outage */
      return readSubmissions(await (await fetchSec(url)).json()) ?? "absent";
    } catch (e) {
      const m = (e as Error).message;
      if (/responded 404/.test(m)) return "absent";
      if (attempt < 3) { log(`CIK ${cik}: ${m}; waiting ${5 * 3 ** attempt} s`); await sleep(5_000 * 3 ** attempt); }
    }
  }
  return "failed";
}
interface SecCache { fetchedAt: string; profiles: Record<string, SecProfile | null> }
async function secProfiles(): Promise<{ profiles: Map<string, SecProfile>; asked: number; failed: string[] }> {
  const want = COVERAGE.filter((c) => /^\d{1,10}$/.test(c.cik ?? "")).map((c) => ({ ticker: c.ticker, cik: c.cik.replace(/^0+/, "") }));
  if (SEC_CACHE && existsSync(SEC_CACHE) && Date.now() - statSync(SEC_CACHE).mtimeMs < 6 * 86_400_000) {
    const cached = JSON.parse(readFileSync(SEC_CACHE, "utf8")) as SecCache;
    if (want.every((w) => w.ticker in cached.profiles)) {
      log(`SEC answers from ${SEC_CACHE} (fetched ${cached.fetchedAt})`);
      const profiles = new Map<string, SecProfile>();
      for (const w of want) { const p = cached.profiles[w.ticker]; if (p) profiles.set(w.ticker, p); }
      return { profiles, asked: want.length, failed: [] };
    }
  }
  const profiles = new Map<string, SecProfile>(), failed: string[] = [], byCik = new Map<string, SecProfile | "absent" | "failed">();
  let n = 0;
  for (const w of want) {
    /* share classes (GOOG, GOOGL) share a CIK: one request */
    const got = byCik.get(w.cik) ?? (await secProfile(w.cik));
    byCik.set(w.cik, got);
    if (got === "failed") failed.push(w.ticker);
    else if (got !== "absent") profiles.set(w.ticker, got);
    if (++n % 200 === 0) log(`SEC index: ${n} of ${want.length}`);
  }
  if (SEC_CACHE && !failed.length) {
    const out: SecCache = { fetchedAt: new Date().toISOString(), profiles: Object.fromEntries(want.map((w) => [w.ticker, profiles.get(w.ticker) ?? null])) };
    writeFileSync(SEC_CACHE, JSON.stringify(out));
  }
  return { profiles, asked: want.length, failed };
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

/** First candidate spelling the gazetteer knows in this country (and state or province). */
const firstMatch = (names: string[], iso: string, admin?: string) => { for (const n of names) { const c = matchCity(index, n, iso, admin); if (c) return { c, typed: n }; } return null; };
/** An SEC business address as a row: to the city when it matches, else to the country for foreign addresses; null when unusable. */
function fromSec(p: SecProfile): { row: HqRow | null; why?: string } {
  const at = secPlace(p.business);
  if (at.kind === "none") return { row: null, why: at.why };
  if (at.kind === "us") {
    if (at.state === "PR") { const m = firstMatch(at.cities, "PR"); return m ? { row: row(m.c, `${m.c.name}, Puerto Rico`, "Puerto Rico", "c", "s") } : { row: null, why: "city not in the gazetteer" }; }
    const m = firstMatch(at.cities, "US", at.state);
    return m ? { row: row(m.c, `${placeName(m.c)}, ${at.state}`, "United States", "c", "s") } : { row: null, why: "city not in the gazetteer" };
  }
  if (at.kind === "ca") {
    const m = firstMatch(at.cities, "CA", at.province);
    return m ? { row: row(m.c, `${m.c.name}, Canada`, "Canada", "c", "s") } : { row: null, why: "city not in the gazetteer" };
  }
  const country = countryName(at.iso), m = firstMatch(at.cities, at.iso);
  if (m) return { row: row(m.c, `${isExonym(m.typed) ? cityLabel(m.typed) : m.c.name}, ${country}`, country, "c", "s") };
  const big = largest.get(at.iso);
  return { row: big ? row(big, country, country, "n", "s") : null, why: "city not in the gazetteer" };
}
function fromDirectory(r: DirRow): HqRow | null {
  const parts = (r.headquarters ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const iso = countryIso(parts[parts.length - 1]);
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
const [{ profiles, asked, failed }, dir] = await Promise.all([secProfiles(), directoryRows()]);
const verified = verifiedRows();
log(`inputs: ${profiles.size} SEC index answers for ${asked} companies (${failed.length} failed), ${verified.size} hand-checked head offices, ${dir.size} directory head offices, ${gaz.length} gazetteer cities`);
/* a partial SEC read would quietly swap many companies to the directory: publish only a whole read */
if (profiles.size < asked * 0.9) { log(`SEC answered for only ${profiles.size} of ${asked} companies; leaving the existing file untouched`); process.exit(1); }

const companies: Record<string, HqRow> = {}, missing: string[] = [];
const agents: string[] = [];
let city = 0, countryOnly = 0, apart = 0;
for (const t of COVERAGE.map((c) => c.ticker).sort()) {
  const p = profiles.get(t), d = dir.get(t), v = verified.get(t) ?? null;
  const agent = p ? agentAddress(p.business) : null;
  const s = p && !agent ? fromSec(p) : null;
  const b = d ? fromDirectory(d) : null;
  const pick = chooseHq(v, s?.row, b);
  if (s?.row && b && s.row[4] === "c" && b[4] === "c" && kmApart(s.row, b) > 150) apart++;
  if (agent && !v) agents.push(`${t} (${agent})`);
  if (!pick) { missing.push(t); continue; }
  companies[t] = pick;
  if (pick[4] === "c") city++; else countryOnly++;
  if (p && !v && pick[5] === "d") log(`${t}: SEC address "${cityLabel(p.business?.city ?? "")}, ${p.business?.stateOrCountry ?? p.business?.country ?? ""}" not used (${agent ?? s?.why ?? "no row"}); used the directory (${pick[2]})`);
}
if (agents.length) log(`not placed from SEC, care of a registered agent and not hand-checked yet: ${agents.join("; ")}`);
const total = COVERAGE.length;
const bySource = { sec: 0, verified: 0, directory: 0 };
for (const r of Object.values(companies)) bySource[r[5] === "s" ? "sec" : r[5] === "v" ? "verified" : "directory"]++;
if (city + countryOnly < total * 0.6) { log(`only ${city + countryOnly} of ${total} companies placed; refusing to overwrite the existing file`); process.exit(1); }

const file: HqFile = {
  generatedAt: new Date().toISOString(),
  sources: {
    v: "Head office checked by hand against the filing cover page (scripts/data/hq-verified.json, with sources)",
    s: "SEC EDGAR business address from SEC's submissions index (data.sec.gov), read for each covered CIK",
    d: "FiledUnder pipeline company directory (headquarters: city, region, country), used only where SEC gives no usable city",
    gazetteer: "GeoNames cities with 1,000+ inhabitants (all-the-cities 3.1.0); coordinates rounded to 0.001°",
    n: "country-level rows sit at the country's largest city because the city itself could not be matched",
  },
  counts: { companies: total, city, country: countryOnly, missing: missing.length, ...bySource },
  companies,
  missing,
};
writeFileSync(OUT, `${JSON.stringify(file)}\n`);
log(`sources: ${bySource.verified} hand-checked, ${bySource.sec} SEC business address, ${bySource.directory} directory`);
log(`wrote ${OUT}: ${city} to the city, ${countryOnly} to the country, ${missing.length} missing of ${total}; ${apart} companies where the SEC and directory cities are more than 150 km apart (SEC kept)`);
