/**
 * Filed Under ingestion pipeline.
 *
 * Pulls real, primary-source data and writes static snapshots to public/data/:
 *   - SEC EDGAR submissions (profile, filing index), companyfacts XBRL (statements),
 *     inline-XBRL segment facts from the latest 10-K/10-Q, Form 4 insider trades,
 *     8-K Item 2.02 earnings releases.
 *   - Yahoo Finance daily bars (fallback for the live price API).
 *   - FRED series (fallback for the live macro API).
 *
 * Run: bun scripts/ingest.ts [--only=sec|prices|macro] [--tickers=AAPL,MSFT]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildStatements, type CompanyFacts } from "../src/lib/financials/build";
import { latest, latestYoY, ttm } from "../src/lib/financials/metrics";
import type {
  Bar,
  CompanyDataset,
  CompanyProfile,
  EarningsRelease,
  Filing,
  InsiderTrade,
  MacroSeries,
  PriceSeries,
  SegmentFact,
  Universe,
  UniverseEntry,
} from "../src/lib/financials/types";
import { COVERAGE, BENCHMARKS, MACRO_SERIES } from "../src/lib/coverage";

const UA = "FiledUnder Research research@filedunder.ai";
const OUT = new URL("../public/data/", import.meta.url).pathname;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

let lastSec = 0;
async function sec(url: string): Promise<Response> {
  const wait = Math.max(0, lastSec + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastSec = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    if (res.ok) return res;
    if (res.status === 404) throw new Error(`404 ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`SEC request failed: ${url}`);
}
const secJson = async <T>(url: string) => (await (await sec(url)).json()) as T;
const secText = async (url: string) => (await sec(url)).text();

const pad = (cik: string) => cik.padStart(10, "0");
const noDash = (accn: string) => accn.replace(/-/g, "");
const archive = (cik: string, accn: string, doc = "") =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${noDash(accn)}/${doc}`;

interface RecentFilings {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  form: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
  items: string[];
  isInlineXBRL: number[];
  size: number[];
}

interface Submissions {
  name: string;
  sic: string;
  sicDescription: string;
  exchanges: string[];
  fiscalYearEnd: string;
  stateOfIncorporation: string;
  ein: string;
  phone: string;
  category: string;
  addresses: { business: { street1: string; street2: string | null; city: string; stateOrCountry: string; zipCode: string } };
  formerNames: { name: string; from: string; to: string }[];
  filings: { recent: RecentFilings; files: { name: string }[] };
}

const LIST_FORMS = new Set([
  "10-K",
  "10-K/A",
  "10-Q",
  "10-Q/A",
  "8-K",
  "8-K/A",
  "DEF 14A",
  "DEFA14A",
  "ARS",
  "10-KT",
  "SD",
  "11-K",
  "S-8",
  "SC 13G",
  "SC 13G/A",
]);

function rowsOf(r: RecentFilings) {
  return r.accessionNumber.map((accn, i) => ({
    accn,
    form: r.form[i],
    filed: r.filingDate[i],
    report: r.reportDate[i] || undefined,
    doc: r.primaryDocument[i],
    desc: r.primaryDocDescription[i] || undefined,
    items: r.items[i] || undefined,
    ixbrl: !!r.isInlineXBRL[i],
    size: r.size[i],
  }));
}

// ---------- inline XBRL segment extraction ----------
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

interface Ctx {
  start?: string;
  end?: string;
  instant?: string;
  dims: [string, string][];
}

function parseContexts(html: string): Map<string, Ctx> {
  const map = new Map<string, Ctx>();
  for (const m of html.matchAll(/<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi)) {
    const id = attrs(m[1]).id;
    const body = m[2];
    const dims = [...body.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</gi)].map(
      (d) => [d[1], d[2]] as [string, string],
    );
    const get = (t: string) => body.match(new RegExp(`<(?:xbrli:)?${t}>\\s*([^<\\s]+)\\s*<`, "i"))?.[1];
    map.set(id, { start: get("startDate"), end: get("endDate"), instant: get("instant"), dims });
  }
  return map;
}

function parseLabels(xml: string): Map<string, string> {
  const locs = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:link:)?loc\b([^>]*)\/?>/gi)) {
    const a = attrs(m[1]);
    const href = a["xlink:href"];
    if (href && a["xlink:label"]) locs.set(a["xlink:label"], href.split("#")[1]);
  }
  const labels = new Map<string, { role: string; text: string }[]>();
  for (const m of xml.matchAll(/<(?:link:)?label\b([^>]*)>([\s\S]*?)<\/(?:link:)?label>/gi)) {
    const a = attrs(m[1]);
    const arr = labels.get(a["xlink:label"]) ?? [];
    arr.push({ role: a["xlink:role"] ?? "", text: m[2].replace(/<[^>]+>/g, "").trim() });
    labels.set(a["xlink:label"], arr);
  }
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:link:)?labelArc\b([^>]*)\/?>/gi)) {
    const a = attrs(m[1]);
    const concept = locs.get(a["xlink:from"]);
    const ls = labels.get(a["xlink:to"]);
    if (!concept || !ls) continue;
    const pick = ls.find((l) => l.role.endsWith("terseLabel")) ?? ls.find((l) => l.role.endsWith("/label")) ?? ls[0];
    const prev = out.get(concept);
    if (!prev || pick.role.endsWith("terseLabel"))
      out.set(concept, decodeEntities(pick.text).replace(/\s*\[(Member|Axis|Domain)\]\s*$/i, ""));
  }
  return out;
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Sum of every share class tagged on the filing cover page. */
function extractCoverShares(html: string): number | null {
  let total = 0;
  let found = false;
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const a = attrs(m[1]);
    if (a.name !== "dei:EntityCommonStockSharesOutstanding") continue;
    const n = Number(m[2].replace(/<[^>]+>/g, "").replace(/[,\s]/g, "")) * Math.pow(10, Number(a.scale ?? 0));
    if (Number.isFinite(n)) {
      total += n;
      found = true;
    }
  }
  return found ? total : null;
}

function humanize(qname: string) {
  const local = qname.split(":")[1] ?? qname;
  return local
    .replace(/(Member|Segment|Axis)$/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

const AXES: Record<string, string> = {
  "srt:ProductOrServiceAxis": "Product / service",
  "us-gaap:StatementBusinessSegmentsAxis": "Business segment",
  "srt:StatementGeographicalAxis": "Geography",
};
const REVENUE_CONCEPTS = ["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap:Revenues"];
const OPINC_CONCEPTS = ["us-gaap:OperatingIncomeLoss"];

function extractSegments(html: string, labels: Map<string, string>, accn: string): SegmentFact[] {
  const contexts = parseContexts(html);
  const out: SegmentFact[] = [];
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const a = attrs(m[1]);
    const name = a.name;
    const metric = REVENUE_CONCEPTS.includes(name) ? "revenue" : OPINC_CONCEPTS.includes(name) ? "operatingIncome" : null;
    if (!metric) continue;
    const ctx = contexts.get(a.contextRef);
    if (!ctx || !ctx.start || !ctx.end) continue;
    const dims = ctx.dims.filter(
      ([d, mem]) => !(d === "srt:ConsolidationItemsAxis" && mem === "us-gaap:OperatingSegmentsMember"),
    );
    if (dims.length !== 1) continue;
    const [axis, member] = dims[0];
    if (!AXES[axis]) continue;
    const raw = m[2].replace(/<[^>]+>/g, "").replace(/[,\s$]/g, "");
    let value = raw === "" || /^[—–-]$/.test(raw) ? 0 : Number(raw);
    if (!Number.isFinite(value)) continue;
    value *= Math.pow(10, Number(a.scale ?? 0));
    if (a.sign === "-") value = -value;
    const key = member.replace(":", "_");
    out.push({
      axis,
      axisLabel: AXES[axis],
      member,
      label: decodeEntities(labels.get(key) ?? humanize(member)),
      metric,
      concept: name,
      start: ctx.start,
      end: ctx.end,
      value,
      accn,
      ...(a.id ? { elementId: a.id } : {}),
    });
  }
  // de-duplicate (same fact can be tagged in several tables)
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.axis}|${s.member}|${s.metric}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const coverShares = new Map<string, number>();

async function segmentsFor(cik: string, filing: Filing): Promise<SegmentFact[]> {
  const html = await secText(archive(cik, filing.accn, filing.doc));
  const shares = extractCoverShares(html);
  if (shares && !coverShares.has(cik)) coverShares.set(cik, shares);
  let labels = new Map<string, string>();
  try {
    const idx = await secJson<{ directory: { item: { name: string }[] } }>(archive(cik, filing.accn, "index.json"));
    const lab =
      idx.directory.item.find((i) => i.name.endsWith("_lab.xml")) ?? idx.directory.item.find((i) => i.name.endsWith(".xsd"));
    if (lab) labels = parseLabels(await secText(archive(cik, filing.accn, lab.name)));
  } catch (e) {
    console.warn("  labels unavailable", (e as Error).message);
  }
  return extractSegments(html, labels, filing.accn);
}

// ---------- Form 4 ----------
const tagVal = (xml: string, path: string[]): string | undefined => {
  let scope = xml;
  for (const t of path) {
    const m = scope.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"));
    if (!m) return undefined;
    scope = m[1];
  }
  return scope.replace(/<[^>]+>/g, "").trim() || undefined;
};

async function insidersFor(cik: string, filings: Filing[]): Promise<InsiderTrade[]> {
  const form4 = filings.filter((f) => f.form === "4").slice(0, 36);
  const out: InsiderTrade[] = [];
  for (const f of form4) {
    try {
      const path = f.doc.replace(/^xsl[^/]+\//, "");
      const xml = await secText(archive(cik, f.accn, path));
      const owner = tagVal(xml, ["reportingOwnerId", "rptOwnerName"]) ?? "Unknown";
      const rel = xml.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/)?.[1] ?? "";
      const roleParts = [
        tagVal(rel, ["officerTitle"]),
        /<isDirector>(true|1)</.test(rel) ? "Director" : undefined,
        /<isTenPercentOwner>(true|1)</.test(rel) ? "10% owner" : undefined,
      ].filter(Boolean);
      const plan = /<aff10b5One>(true|1)</.test(xml) || /10b5-1/i.test(xml);
      for (const t of xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)) {
        const body = t[1];
        const shares = Number(tagVal(body, ["transactionAmounts", "transactionShares", "value"]) ?? 0);
        const price = tagVal(body, ["transactionAmounts", "transactionPricePerShare", "value"]);
        const after = tagVal(body, ["postTransactionAmounts", "sharesOwnedFollowingTransaction", "value"]);
        out.push({
          accn: f.accn,
          filed: f.filed,
          owner: personName(owner),
          role: roleParts.join(", ") || "Insider",
          date: tagVal(body, ["transactionDate", "value"]) ?? f.report ?? f.filed,
          code: tagVal(body, ["transactionCoding", "transactionCode"]) ?? "?",
          security: tagVal(body, ["securityTitle", "value"]) ?? "Common Stock",
          shares,
          price: price ? Number(price) : null,
          acquired: tagVal(body, ["transactionAmounts", "transactionAcquiredDisposedCode", "value"]) === "A",
          ownedAfter: after ? Number(after) : null,
          direct: tagVal(body, ["ownershipNature", "directOrIndirectOwnership", "value"]) !== "I",
          plan10b5: plan,
          doc: path,
        });
      }
    } catch (e) {
      console.warn("  form4 failed", f.accn, (e as Error).message);
    }
  }
  return out;
}

// ---------- Earnings releases (8-K Item 2.02, exhibit 99.1) ----------
async function releasesFor(cik: string, filings: Filing[]): Promise<EarningsRelease[]> {
  const eightKs = filings.filter((f) => f.form === "8-K" && f.items?.includes("2.02")).slice(0, 10);
  const out: EarningsRelease[] = [];
  for (const f of eightKs) {
    try {
      const idx = await secText(archive(cik, f.accn, `${f.accn}-index.htm`));
      let doc: string | undefined;
      for (const row of idx.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const href = row[1].match(/href="([^"]+)"/)?.[1];
        if (href && /EX-99\.?1\b/i.test(row[1])) {
          doc = href.split("/").pop();
          break;
        }
      }
      if (!doc) continue;
      out.push({
        accn: f.accn,
        filed: f.filed,
        report: f.report,
        doc,
        title: `Earnings release · ${f.report ?? f.filed}`,
      });
    } catch (e) {
      console.warn("  8-K index failed", f.accn, (e as Error).message);
    }
  }
  return out;
}

/** Form 4 owner names are "LAST FIRST MIDDLE"; present them as "First Middle Last". */
export function personName(raw: string) {
  if (!raw || /\b(INC|LLC|LP|L\.P\.|TRUST|FUND|CORP|LTD|FOUNDATION)\b/i.test(raw)) return raw;
  const t = raw.trim().split(/\s+/);
  if (t.length < 2) return raw;
  const ordered = [...t.slice(1), t[0]].join(" ");
  return ordered.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

// ---------- Company ----------
async function loadLogo(ticker: string) {
  try {
    const raw = await readFile(new URL(`../src/assets/logos/${ticker}.svg.asset.json`, import.meta.url), "utf8");
    return (JSON.parse(raw) as { url: string }).url;
  } catch {
    return "";
  }
}

async function ingestCompany(cfg: (typeof COVERAGE)[number]): Promise<UniverseEntry> {
  console.log(`\n▶ ${cfg.ticker}`);
  const sub = await secJson<Submissions>(`https://data.sec.gov/submissions/CIK${pad(cfg.cik)}.json`);
  let all = rowsOf(sub.filings.recent);
  for (const file of sub.filings.files) {
    const older = await secJson<RecentFilings>(`https://data.sec.gov/submissions/${file.name}`);
    all = all.concat(rowsOf(older));
  }
  const filings: Filing[] = all.filter((f) => LIST_FORMS.has(f.form) || f.form === "4");
  console.log(`  ${filings.length} filings`);

  const cf = await secJson<CompanyFacts & { facts: Record<string, any> }>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cfg.cik)}.json`,
  );
  const statements = buildStatements(cf);
  // Bank-only lines (net interest income, deposits…) mislead for non-banks that tag similar concepts.
  if (!/bank|brokerage/i.test(cfg.industry)) {
    const BANK = new Set(["netInterestIncome", "nonInterestIncome", "provisionCreditLosses", "nonInterestExpense", "loans", "deposits"]);
    for (const freq of Object.values(statements) as any[])
      for (const st of Object.values(freq) as any[]) st.rows = st.rows.filter((r: any) => !BANK.has(r.key));
  }
  console.log(
    `  statements: ${statements.annual.income.periods.length} annual / ${statements.quarterly.income.periods.length} quarterly periods`,
  );

  // Shares outstanding (sum classes reported on the same cover page)
  const so: { end: string; val: number; accn: string; filed: string }[] =
    cf.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
  const lastFiled = so.reduce((m, f) => (f.filed > m ? f.filed : m), "");
  const cover = so.filter((f) => f.filed === lastFiled);
  let sharesOutstanding = cover.length ? cover.reduce((s, f) => s + f.val, 0) : null;

  const tenKs = filings.filter((f) => f.form === "10-K" && f.ixbrl);
  const tenQs = filings.filter((f) => f.form === "10-Q" && f.ixbrl);
  const segments: SegmentFact[] = [];
  for (const f of [...tenKs.slice(0, 2), ...tenQs.slice(0, 4)]) {
    try {
      const s = await segmentsFor(cfg.cik, f);
      console.log(`  segments ${f.form} ${f.report}: ${s.length}`);
      segments.push(...s);
    } catch (e) {
      console.warn("  segments failed", f.accn, (e as Error).message);
    }
  }
  const segSeen = new Set<string>();
  const segmentsDedup = segments.filter((s) => {
    const k = `${s.axis}|${s.member}|${s.metric}|${s.start}|${s.end}`;
    if (segSeen.has(k)) return false;
    segSeen.add(k);
    return true;
  });

  const coverFromHtml = coverShares.get(cfg.cik) ?? null;
  if (coverFromHtml && (!sharesOutstanding || cover[0]?.filed < (tenQs[0]?.filed ?? ""))) sharesOutstanding = coverFromHtml;
  const insiders = await insidersFor(cfg.cik, filings);
  console.log(`  insider transactions: ${insiders.length}`);
  const earningsReleases = await releasesFor(cfg.cik, filings);
  console.log(`  earnings releases: ${earningsReleases.length}`);

  const ceo =
    insiders.find((t) => /^(president( and| &|,)? )?(chief executive officer|ceo)$/i.test(t.role.split(", ")[0]))?.owner ??
    insiders.find((t) => /chief executive officer/i.test(t.role) && !/worldwide|segment|division/i.test(t.role))?.owner ??
    "";
  const b = sub.addresses.business;
  const profile: CompanyProfile = {
    ticker: cfg.ticker,
    cik: pad(cfg.cik),
    name: sub.name,
    exchange: sub.exchanges[0] ?? "",
    sic: sub.sic,
    sicDescription: sub.sicDescription,
    sector: cfg.sector,
    industry: cfg.industry,
    fiscalYearEnd: sub.fiscalYearEnd,
    stateOfIncorporation: sub.stateOfIncorporation,
    ein: sub.ein,
    phone: sub.phone,
    address: { street: [b.street1, b.street2].filter(Boolean).join(", "), city: b.city, state: b.stateOrCountry, zip: b.zipCode },
    website: cfg.website,
    investorRelations: cfg.ir,
    description: cfg.description,
    logo: await loadLogo(cfg.ticker),
    founded: cfg.founded,
    ceo,
    sharesOutstanding,
    sharesOutstandingAsOf: cover[0]?.end ?? null,
    sharesOutstandingAccn: cover[0]?.accn ?? null,
    filerCategory: sub.category,
    formerNames: sub.formerNames ?? [],
  };

  const dataset: CompanyDataset = {
    generatedAt: new Date().toISOString(),
    profile,
    filings: filings.filter((f) => f.form !== "4"),
    statements,
    segments: segmentsDedup,
    insiders,
    earningsReleases,
  };
  await writeFile(`${OUT}companies/${cfg.ticker}.json`, JSON.stringify(dataset));

  const q = statements.quarterly;
  const a = statements.annual;
  const fyRev = latest(a.income, "revenue");
  const fyNi = latest(a.income, "netIncome");
  const revTTM = ttm(q.income, "revenue");
  const gpTTM = ttm(q.income, "grossProfit");
  const lastPeriodic = filings.find((f) => f.form === "10-K" || f.form === "10-Q");
  return {
    ticker: cfg.ticker,
    name: sub.name,
    cik: pad(cfg.cik),
    sector: cfg.sector,
    industry: cfg.industry,
    exchange: profile.exchange,
    logo: profile.logo,
    city: b.city,
    state: b.stateOrCountry,
    fiscalYearEnd: sub.fiscalYearEnd,
    latestFY: fyRev ? a.income.periods[fyRev.index].label : "",
    revenueFY: fyRev?.cell.v ?? null,
    netIncomeFY: fyNi?.cell.v ?? null,
    revenueTTM: revTTM,
    netIncomeTTM: ttm(q.income, "netIncome"),
    fcfTTM: ttm(q.cashflow, "fcf"),
    epsTTM: ttm(q.income, "epsDiluted"),
    grossMarginTTM: revTTM && gpTTM ? gpTTM / revTTM : null,
    revenueGrowthYoY: latestYoY(q.income, "revenue"),
    sharesOutstanding,
    lastFiling: lastPeriodic ? { form: lastPeriodic.form, filed: lastPeriodic.filed, accn: lastPeriodic.accn } : null,
  };
}

// ---------- Prices ----------
export const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function ingestPrice(symbol: string, name?: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&events=div%2Csplits`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const j = (await res.json()) as any;
  const r = j.chart.result[0];
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? q.close;
  const bars: Bar[] = [];
  (r.timestamp as number[]).forEach((t, i) => {
    if (q.close[i] == null) return;
    const d = new Date((t + (r.meta.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
    const f = (x: number) => Math.round(x * 10000) / 10000;
    bars.push([d, f(q.open[i]), f(q.high[i]), f(q.low[i]), f(q.close[i]), f(adj[i] ?? q.close[i]), q.volume[i] ?? 0]);
  });
  const series: PriceSeries = {
    symbol,
    name: name ?? r.meta.longName ?? r.meta.shortName,
    currency: r.meta.currency,
    interval: "1d",
    bars,
    fetchedAt: new Date().toISOString(),
    source: "snapshot",
  };
  await writeFile(`${OUT}prices/${symbolFile(symbol)}.json`, JSON.stringify(series));
  console.log(`  ${symbol}: ${bars.length} bars`);
}

// ---------- Macro ----------
async function ingestMacro(s: (typeof MACRO_SERIES)[number]) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.id}&cosd=${s.since}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`fred ${s.id} ${res.status}`);
  const text = await res.text();
  const observations: [string, number][] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const [d, v] = line.split(",");
    const n = Number(v);
    if (v && v !== "." && Number.isFinite(n)) observations.push([d, n]);
  }
  const series: MacroSeries = {
    id: s.id,
    title: s.title,
    units: s.units,
    frequency: s.frequency,
    observations,
    fetchedAt: new Date().toISOString(),
    source: "snapshot",
  };
  await writeFile(`${OUT}macro/${s.id}.json`, JSON.stringify(series));
  console.log(`  ${s.id}: ${observations.length} obs`);
}

/** Slim cross-company Form 4 feed so the insider hub doesn't load every company file. */
async function writeInsiderFeed() {
  const rows: (InsiderTrade & { ticker: string })[] = [];
  for (const c of COVERAGE) {
    try {
      const d = JSON.parse(await readFile(`${OUT}companies/${c.ticker}.json`, "utf8")) as { insiders: InsiderTrade[] };
      for (const t of d.insiders) rows.push({ ...t, ticker: c.ticker });
    } catch {
      /* company not ingested */
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  await writeFile(`${OUT}insiders.json`, JSON.stringify({ generatedAt: new Date().toISOString(), trades: rows }));
  console.log(`  insider feed: ${rows.length} transactions`);
}

async function main() {
  await mkdir(`${OUT}companies`, { recursive: true });
  await mkdir(`${OUT}prices`, { recursive: true });
  await mkdir(`${OUT}macro`, { recursive: true });
  const only = args.only as string | undefined;
  const tickers = args.tickers ? String(args.tickers).split(",") : null;

  if (!only || only === "sec") {
    const entries: UniverseEntry[] = [];
    for (const c of COVERAGE) {
      if (tickers && !tickers.includes(c.ticker)) {
        try {
          const prev = JSON.parse(await readFile(`${OUT}universe.json`, "utf8")) as Universe;
          const e = prev.companies.find((x) => x.ticker === c.ticker);
          if (e) entries.push(e);
        } catch {
          /* first run */
        }
        continue;
      }
      entries.push(await ingestCompany(c));
    }
    const universe: Universe = { generatedAt: new Date().toISOString(), companies: entries };
    await writeFile(`${OUT}universe.json`, JSON.stringify(universe, null, 1));
  }
  if (!only || only === "sec" || only === "insiders") await writeInsiderFeed();
  if (!only || only === "prices") {
    console.log("\n▶ prices");
    for (const c of COVERAGE) await ingestPrice(c.ticker, c.shortName);
    for (const b of BENCHMARKS) {
      try {
        await ingestPrice(b.symbol, b.name);
      } catch (e) {
        console.warn("  price failed", b.symbol, (e as Error).message);
      }
    }
  }
  if (!only || only === "macro") {
    console.log("\n▶ macro");
    for (const s of MACRO_SERIES) {
      try {
        await ingestMacro(s);
      } catch (e) {
        console.warn("  macro failed", s.id, (e as Error).message);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
