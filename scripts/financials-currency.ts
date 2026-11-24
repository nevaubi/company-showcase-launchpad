/**
 * Financial statement currency check for every covered company. Read-only: it reads SEC EDGAR
 * (submissions index and companyfacts, cached on disk) and local files, prints a report and
 * writes nothing to the database.
 *
 * For each company it records the newest 10-K and 10-Q on EDGAR (every CIK the company files or
 * filed under), the newest earnings release (8-K item 2.02), and what the partner's statement build
 * (`buildStatements`, the same call `scripts/ingest.ts` makes on companyfacts of `historyCik`) holds
 * at the last scheduled rebuild and on today's companyfacts. Then it runs the app's read-time check
 * (`assessCurrency`) on that build plus the EDGAR filing list, and classifies every gap:
 *   awaiting-rebuild   filed on or after the last rebuild; today's companyfacts already has it
 *   registrant-change  filed under a CIK other than the one the statements are built from
 *   no-xbrl            SEC lists the filing without XBRL
 *   not-in-companyfacts XBRL filing, but SEC's companyfacts carries none of its facts
 *   builder            companyfacts has the filing's facts, the builder drops the period
 *   no-statements      the build holds no statements at all (only 10-Qs since listing, no 10-K yet)
 *
 *   bun scripts/financials-currency.ts --cache=DIR [--fetch] [--tickers=AAPL,XOM] [--build-at=2026-11-20T09:17:00Z]
 *     [--today=2026-11-23] [--json=FILE] [--builder=CHECKOUT]
 * DIR holds submissions/CIK##########.json (SEC JSON, or the trimmed form with the same `recent`
 * columns) and companyfacts/CIK##########.json[.gz]. With --fetch, missing files are downloaded
 * from SEC (User-Agent below, at most 5 requests a second) into DIR.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildStatements as repoBuild, type CompanyFacts } from "../src/lib/financials/build";
import { isBankIndustry } from "../src/lib/financials/dataset";
import { assessCurrency, type Currency } from "../src/lib/financials/currency";
import { COVERAGE, companyCiks, historyCik } from "../src/lib/coverage";
import type { CompanyDataset, EarningsRelease, Filing } from "../src/lib/financials/types";

const UA = "FiledUnder Research research@filedunder.ai";
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const flag = (k: string) => process.argv.includes(`--${k}`);
const CACHE = arg("cache") ?? "";
if (!CACHE) throw new Error("--cache=DIR is required");
const FETCH = flag("fetch");
// --builder=DIR measures with another checkout's statement builder (e.g. the one the partner runs today).
const BUILDER = arg("builder");
const buildStatements: typeof repoBuild = BUILDER ? (await import(`${BUILDER}/src/lib/financials/build.ts`)).buildStatements : repoBuild;
const TODAY = arg("today") ?? new Date().toISOString().slice(0, 10);

/** The partner rebuild runs Tuesdays and Fridays at 09:17 UTC (filedunderai .github/workflows/app-datasets.yml). */
export function lastBuild(now: Date): Date {
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i, 9, 17));
    if ((d.getUTCDay() === 2 || d.getUTCDay() === 5) && d <= now) return d;
  }
  throw new Error("no build day in the last week");
}
export function nextBuild(after: Date): Date {
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate() + i, 9, 17));
    if ((d.getUTCDay() === 2 || d.getUTCDay() === 5) && d > after) return d;
  }
  throw new Error("unreachable");
}
const BUILD_AT = new Date(arg("build-at") ?? lastBuild(new Date(`${TODAY}T23:59:00Z`)).toISOString());
const BUILD_DAY = BUILD_AT.toISOString().slice(0, 10);

let lastReq = 0;
async function sec(url: string): Promise<Buffer | null> {
  for (let i = 0; i < 5; i++) {
    const wait = Math.max(0, lastReq + 200 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastReq = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`SEC did not answer ${url}`);
}

const pad = (cik: string) => cik.padStart(10, "0");
async function cachedJson<T>(kind: "submissions" | "companyfacts", cik: string): Promise<T | null> {
  const base = `${CACHE}/${kind}/CIK${pad(cik)}.json`;
  if (existsSync(base)) return JSON.parse(readFileSync(base, "utf8")) as T;
  if (existsSync(`${base}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${base}.gz`)).toString("utf8")) as T;
  if (!FETCH) return null;
  const url = kind === "submissions" ? `https://data.sec.gov/submissions/CIK${pad(cik)}.json` : `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`;
  const body = await sec(url);
  if (!body) return null;
  mkdirSync(`${CACHE}/${kind}`, { recursive: true });
  if (kind === "companyfacts") writeFileSync(`${base}.gz`, gzipSync(body));
  else writeFileSync(base, body);
  return JSON.parse(body.toString("utf8")) as T;
}

interface Recent { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; acceptanceDateTime: string[]; form: string[]; items: string[]; primaryDocument: string[]; isXBRL: number[] }
interface Sub { recent?: Recent; filings?: { recent: Recent } }

interface EdgarFiling { cik: string; accn: string; form: string; filed: string; report: string; accepted: string; items: string; doc: string; xbrl: boolean }
function edgarRows(cik: string, s: Sub | null): EdgarFiling[] {
  const r = s?.recent ?? s?.filings?.recent;
  if (!r) return [];
  return r.accessionNumber.map((accn, i) => ({
    cik, accn, form: r.form[i], filed: r.filingDate[i], report: r.reportDate[i] ?? "", accepted: r.acceptanceDateTime[i] ?? "", items: r.items[i] ?? "", doc: r.primaryDocument[i] ?? "", xbrl: !!r.isXBRL?.[i],
  }));
}

const PERIODIC = /^(10-K|10-KT|10-Q)$/;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);

function factsFiledBefore(cf: CompanyFacts, day: string): CompanyFacts {
  const facts: CompanyFacts["facts"] = {};
  for (const [ns, concepts] of Object.entries(cf.facts)) {
    facts[ns] = {};
    for (const [name, node] of Object.entries(concepts)) {
      const units: Record<string, (typeof node.units)[string]> = {};
      for (const [u, list] of Object.entries(node.units)) units[u] = list.filter((f) => f.filed < day);
      facts[ns][name] = { ...node, units };
    }
  }
  return { facts };
}

function accnsIn(cf: CompanyFacts): Set<string> {
  const out = new Set<string>();
  for (const concepts of Object.values(cf.facts)) for (const node of Object.values(concepts)) for (const list of Object.values(node.units)) for (const f of list) out.add(f.accn);
  return out;
}

type Statements = ReturnType<typeof buildStatements>;
const lastEnd = (s: Statements, f: "annual" | "quarterly") => {
  const ends = [s[f].income, s[f].balance, s[f].cashflow].map((x) => x.periods.at(-1)?.end ?? "").sort();
  return ends.at(-1) || null;
};
const holds = (s: Statements, report: string) =>
  [...s.quarterly.income.periods, ...s.quarterly.cashflow.periods, ...s.quarterly.balance.periods, ...s.annual.income.periods].some((p) => Math.abs(days(p.end, report)) <= 6);

interface Row {
  ticker: string; sector: string; industry: string; ciks: string[]; historyCik: string;
  edgar: { k?: EdgarFiling; q?: EdgarFiling; newest?: EdgarFiling; release?: EdgarFiling };
  built: { q: string | null; a: string | null };
  fresh: { q: string | null; a: string | null };
  newestInFacts: boolean;
  currency: Pick<Currency, "status" | "text"> & { newer: { kind: string; form: string; filed: string; report?: string }[] };
  reason: string;
  /** days since the first 10-K/10-Q the statements do not hold was filed (0 when they hold every one) */
  lagDays: number;
  /** 10-K/10-Q filings for periods after the statements' latest period */
  missingReports: number;
  /** The first of those, which decides the reason */
  firstMissing?: { form: string; report: string; filed: string; accn: string; cik: string };
  /** release-to-statements timeline for the newest periodic report */
  cycle?: { release?: string; filed: string; releaseToFiling?: number; filingToBuildHours: number; build: string };
  error?: string;
}

async function check(c: (typeof COVERAGE)[number]): Promise<Row> {
  const ciks = companyCiks(c);
  const hist = String(Number(historyCik(c)));
  const all: EdgarFiling[] = [];
  for (const k of ciks) all.push(...edgarRows(k, await cachedJson<Sub>("submissions", k)));
  const seen = new Set<string>();
  const filings = all.filter((f) => !seen.has(f.accn) && (seen.add(f.accn), true)).sort((a, b) => b.accepted.localeCompare(a.accepted) || b.filed.localeCompare(a.filed));
  const periodic = filings.filter((f) => PERIODIC.test(f.form));
  const k = periodic.find((f) => f.form.startsWith("10-K"));
  const q = periodic.find((f) => f.form === "10-Q");
  const newest = [...periodic].sort((a, b) => b.report.localeCompare(a.report) || b.filed.localeCompare(a.filed))[0];
  const releases = filings.filter((f) => /^8-K/.test(f.form) && /(^|,)\s*2\.02/.test(f.items));
  const row: Row = {
    ticker: c.ticker, sector: c.sector, industry: c.industry, ciks, historyCik: hist,
    edgar: { k, q, newest, release: releases[0] },
    built: { q: null, a: null }, fresh: { q: null, a: null }, newestInFacts: false,
    currency: { status: "unknown", text: "", newer: [] }, reason: "", lagDays: 0, missingReports: 0,
  };
  const cf = await cachedJson<CompanyFacts>("companyfacts", hist);
  if (!cf?.facts) {
    row.reason = "no-companyfacts";
    return row;
  }
  const bank = isBankIndustry(c.industry);
  const fresh = buildStatements(cf, { bank });
  const built = buildStatements(factsFiledBefore(cf, BUILD_DAY), { bank });
  row.fresh = { q: lastEnd(fresh, "quarterly"), a: lastEnd(fresh, "annual") };
  row.built = { q: lastEnd(built, "quarterly"), a: lastEnd(built, "annual") };
  const inFactsAll = accnsIn(cf);
  row.newestInFacts = !!newest && inFactsAll.has(newest.accn);

  // The app's own check, on the statements as of the last rebuild and the filings SEC lists today.
  const toFiling = (f: EdgarFiling): Filing => ({ accn: f.accn, form: f.form, filed: f.filed, ...(f.report ? { report: f.report } : {}), doc: f.doc, items: f.items });
  const ds = {
    generatedAt: BUILD_AT.toISOString(),
    profile: { ticker: c.ticker, cik: pad(hist) } as CompanyDataset["profile"],
    filings: filings.filter((f) => f.form !== "4").map(toFiling),
    statements: built,
    segments: [], insiders: [],
    earningsReleases: releases.map((r): EarningsRelease => ({ accn: r.accn, filed: r.filed, doc: r.doc, title: "Earnings release" })),
  } as CompanyDataset;
  const cur = assessCurrency(ds, { ciks });
  row.currency = { status: cur.status, text: cur.text, newer: cur.newer.map((n) => ({ kind: n.kind, form: n.form, filed: n.filed, ...(n.report ? { report: n.report } : {}) })) };

  const gap = cur.newer.find((n) => n.kind !== "release");
  // No statements at all (the builder places fiscal years from 10-K facts; a company listed since its
  // last 10-K has only 10-Qs): never "current".
  if (cur.status === "unknown") row.reason = "no-statements";
  else if (!gap) row.reason = cur.newer.length ? "release-only" : "current";
  else {
    const latest = [row.built.q, row.built.a].filter(Boolean).sort().at(-1) ?? "";
    const missing = periodic.filter((x) => x.report && days(latest, x.report) > 6).sort((a, b) => a.filed.localeCompare(b.filed));
    row.missingReports = missing.length;
    row.lagDays = days(missing[0]?.filed ?? gap.filed, TODAY);
    // The reason is the first report the statements miss: everything after it follows from it.
    const f = missing[0] ?? periodic.find((x) => x.accn === gap.accn)!;
    const inFacts = inFactsAll;
    if (f.filed >= BUILD_DAY && holds(fresh, f.report)) row.reason = "awaiting-rebuild";
    else if (f.cik !== hist && !inFacts.has(f.accn)) row.reason = "registrant-change";
    else if (!f.xbrl) row.reason = "no-xbrl";
    else if (!inFacts.has(f.accn)) row.reason = "not-in-companyfacts";
    else if (!holds(fresh, f.report)) row.reason = "builder";
    else row.reason = "awaiting-rebuild";
    row.firstMissing = { form: f.form, report: f.report, filed: f.filed, accn: f.accn, cik: f.cik };
  }
  if (newest?.accepted) {
    const acc = new Date(newest.accepted);
    const b = nextBuild(acc);
    const rel = releases.find((r) => r.filed <= newest.filed && days(r.filed, newest.filed) <= 75);
    row.cycle = {
      ...(rel ? { release: rel.filed, releaseToFiling: days(rel.filed, newest.filed) } : {}),
      filed: newest.filed,
      filingToBuildHours: Math.round((b.getTime() - acc.getTime()) / 3_600_000),
      build: b.toISOString().slice(0, 16),
    };
  }
  return row;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  const only = (arg("tickers") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const list = COVERAGE.filter((c) => !only.length || only.includes(c.ticker));
  const rows: Row[] = [];
  for (const c of list) {
    try {
      rows.push(await check(c));
    } catch (e) {
      rows.push({ ticker: c.ticker, sector: c.sector, industry: c.industry, ciks: companyCiks(c), historyCik: historyCik(c), edgar: {}, built: { q: null, a: null }, fresh: { q: null, a: null }, newestInFacts: false, currency: { status: "unknown", text: "", newer: [] }, reason: "error", lagDays: 0, missingReports: 0, error: (e as Error).message });
    }
  }
  const json = arg("json");
  if (json) writeFileSync(json, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const out: string[] = [];
  out.push(`# Financial statement currency, ${TODAY}`, "", `Companies: ${rows.length}. Statements as of the partner rebuild started ${BUILD_AT.toISOString().slice(0, 16)}Z (facts filed before ${BUILD_DAY}).`, "");
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.reason, [...(by.get(r.reason) ?? []), r]);
  out.push("| Verdict | Companies | Lag days since the missing report was filed (median / p90 / max) |", "|---|---:|---|");
  for (const [k, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    const lags = rs.filter((r) => r.lagDays > 0).map((r) => r.lagDays);
    out.push(`| ${k} | ${rs.length} | ${lags.length ? `${pct(lags, 50)} / ${pct(lags, 90)} / ${Math.max(...lags)}` : "–"} |`);
  }
  const behind = rows.filter((r) => !["current", "release-only"].includes(r.reason));
  out.push("", "## Companies whose statements miss a filed 10-K or 10-Q", "", "| Ticker | Reason | Statements through (Q / FY) | First missing report (form, period, filed) | Newest missing report | Reports missing | Days since the first was filed |", "|---|---|---|---|---|---:|---:|");
  for (const r of behind.sort((a, b) => a.reason.localeCompare(b.reason) || b.lagDays - a.lagDays || a.ticker.localeCompare(b.ticker))) {
    const n = r.currency.newer.find((x) => x.kind !== "release");
    const m = r.firstMissing;
    out.push(`| ${r.ticker} | ${r.reason} | ${r.built.q ?? "–"} / ${r.built.a ?? "–"} | ${m ? `${m.form} ${m.report} filed ${m.filed}` : "–"} | ${n ? `${n.form} ${n.report ?? "?"} filed ${n.filed}` : r.error ?? "–"} | ${r.missingReports} | ${r.lagDays} |`);
  }
  const rel = rows.filter((r) => r.currency.newer.some((n) => n.kind === "release"));
  out.push("", `## Earnings released, report not yet in the statements: ${rel.length}`, "", rel.map((r) => `${r.ticker} (${r.currency.newer.find((n) => n.kind === "release")!.filed})`).sort().join(", "));
  const cyc = rows.map((r) => r.cycle).filter((x): x is NonNullable<Row["cycle"]> => !!x && x.filed >= "2026-09-25");
  const r2f = cyc.filter((x) => x.releaseToFiling != null).map((x) => x.releaseToFiling!);
  const f2b = cyc.map((x) => x.filingToBuildHours);
  out.push(
    "",
    "## Design lag (newest report per company, filed since 25 Sep 2026)",
    "",
    `Earnings release to 10-Q/10-K filing, days: n=${r2f.length}, median ${pct(r2f, 50)}, p75 ${pct(r2f, 75)}, p90 ${pct(r2f, 90)}, max ${Math.max(...r2f)}; same day ${r2f.filter((x) => x === 0).length}.`,
    `Filing acceptance to the next scheduled rebuild start, hours: n=${f2b.length}, median ${pct(f2b, 50)}, p90 ${pct(f2b, 90)}, max ${Math.max(...f2b)}.`,
  );
  console.log(out.join("\n"));
}

if (import.meta.main) await main();
