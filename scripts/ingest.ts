/**
 * Filed Under ingestion pipeline.
 *
 * Pulls real, primary-source data and writes static snapshots to public/data/:
 *   - SEC EDGAR submissions (profile, filing index), companyfacts XBRL (statements),
 *     segment facts from every inline-XBRL 10-K, the latest twelve 10-Qs and legacy
 *     XBRL instance documents of older 10-Ks, Form 4 insider trades, 8-K Item 2.02
 *     earnings releases.
 *   - Yahoo Finance daily bars, ten years (fallback for the live price API).
 *   - FRED series and U.S. Treasury Fiscal Data (fallback for the live macro API).
 *
 * Run: bun scripts/ingest.ts [--only=sec|prices|macro|insiders|manifest] [--tickers=AAPL,MSFT]
 *      [--concurrency=3] [--fresh]   (--fresh re-downloads mutable SEC JSON; filing documents are cached)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { buildStatements, type CompanyFacts } from "../src/lib/financials/build";
import { isBankIndustry, slimDataset } from "../src/lib/financials/dataset";
import { cagr, latest, latestYoY, rowCells, ttm } from "../src/lib/financials/metrics";
import type {
  BalanceKey,
  Bar,
  CompanyDataset,
  CompanyProfile,
  EarningsRelease,
  Filing,
  InsiderTrade,
  MacroSeries,
  PriceSeries,
  SegmentFact,
  SegmentMetric,
  Statement,
  TtmKey,
  Universe,
  UniverseEntry,
  UniverseFundamentals,
} from "../src/lib/financials/types";
import { COVERAGE, BENCHMARKS, MACRO_SERIES, type MacroDef } from "../src/lib/coverage";

const UA = "FiledUnder Research research@filedunder.ai";
const OUT = new URL("../public/data/", import.meta.url).pathname;
const CACHE = "/tmp/ingest/cache";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

// ---------- SEC transport (throttled, cached) ----------
let lastSec = 0;
async function throttle() {
  // SEC fair-access policy: at most 10 requests per second.
  const wait = Math.max(0, lastSec + 130 - Date.now());
  lastSec = Math.max(Date.now(), lastSec + 130);
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function sec(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.ok) return res;
      if (res.status === 404) throw new Error(`404 ${url}`);
      if (res.status === 429 || res.status === 403) await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    } catch (e) {
      if ((e as Error).message.startsWith("404")) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`SEC request failed: ${url}`);
}

/** Archive documents never change, so they're cached on disk; mutable JSON honours --fresh. */
async function secText(url: string): Promise<string> {
  const mutable = url.includes("data.sec.gov");
  const file = `${CACHE}/${createHash("sha1").update(url).digest("hex")}`;
  if (!(mutable && args.fresh)) {
    try {
      const st = await stat(file);
      if (!mutable || Date.now() - st.mtimeMs < 12 * 3600_000) return await readFile(file, "utf8");
    } catch {
      /* not cached */
    }
  }
  const text = await (await sec(url)).text();
  await writeFile(file, text);
  return text;
}
const secJson = async <T>(url: string) => JSON.parse(await secText(url)) as T;

const pad = (cik: string) => cik.padStart(10, "0");
const noDash = (accn: string) => accn.replace(/-/g, "");
const archive = (cik: string, accn: string, doc = "") =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${noDash(accn)}/${doc}`;

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

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
  "20-F",
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

// ---------- XBRL parsing (inline XBRL and legacy instance documents) ----------
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

function parseContexts(doc: string): Map<string, Ctx> {
  const map = new Map<string, Ctx>();
  for (const m of doc.matchAll(/<(?:[\w-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?context>/gi)) {
    const id = attrs(m[1]).id;
    const body = m[2];
    const dims = [...body.matchAll(/<(?:[\w-]+:)?explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</gi)].map(
      (d) => [d[1], d[2]] as [string, string],
    );
    if (/<(?:[\w-]+:)?typedMember/i.test(body)) dims.push(["typed", "typed"]);
    const get = (t: string) => body.match(new RegExp(`<(?:[\\w-]+:)?${t}>\\s*([^<\\s]+)\\s*<`, "i"))?.[1];
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
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
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

/** Segment concepts in priority order; when a filing tags two concepts for the same metric/member/period the earlier wins. */
const SEGMENT_CONCEPTS: [string, SegmentMetric][] = [
  ["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "revenue"],
  ["us-gaap:Revenues", "revenue"],
  ["us-gaap:RevenuesNetOfInterestExpense", "revenue"],
  ["us-gaap:SalesRevenueNet", "revenue"],
  ["us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax", "revenue"],
  ["us-gaap:OperatingIncomeLoss", "operatingIncome"],
  ["us-gaap:GrossProfit", "grossProfit"],
  ["us-gaap:NetIncomeLoss", "netIncome"],
  ["us-gaap:Assets", "assets"],
  ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", "capex"],
  ["us-gaap:PaymentsToAcquireProductiveAssets", "capex"],
  ["us-gaap:SegmentExpenditureAdditionToLongLivedAssets", "capex"],
  ["us-gaap:DepreciationDepletionAndAmortization", "dna"],
  ["us-gaap:DepreciationAndAmortization", "dna"],
  ["us-gaap:DepreciationAmortizationAndAccretionNet", "dna"],
];
const METRIC_OF = new Map(SEGMENT_CONCEPTS);
const RANK = new Map(SEGMENT_CONCEPTS.map(([c], i) => [c, i]));

type RawSegment = SegmentFact & { filed: string; rank: number };

function segmentFact(
  name: string,
  ctx: Ctx | undefined,
  value: number,
  labels: Map<string, string>,
  filing: Filing,
  elementId?: string,
): RawSegment | null {
  const metric = METRIC_OF.get(name);
  if (!metric || !ctx) return null;
  const instant = metric === "assets";
  if (instant ? !ctx.instant : !ctx.start || !ctx.end) return null;
  const dims = ctx.dims.filter(([d, mem]) => !(d === "srt:ConsolidationItemsAxis" && mem === "us-gaap:OperatingSegmentsMember"));
  if (dims.length !== 1) return null;
  const [axis, member] = dims[0];
  if (!AXES[axis] || !Number.isFinite(value)) return null;
  return {
    axis,
    axisLabel: AXES[axis],
    member,
    label: decodeEntities(labels.get(member.replace(":", "_")) ?? humanize(member)),
    metric,
    concept: name,
    ...(instant ? {} : { start: ctx.start }),
    end: (instant ? ctx.instant : ctx.end)!,
    value,
    accn: filing.accn,
    ...(elementId ? { elementId } : {}),
    filed: filing.filed,
    rank: RANK.get(name) ?? 99,
  };
}

function extractInlineSegments(html: string, labels: Map<string, string>, filing: Filing): RawSegment[] {
  const contexts = parseContexts(html);
  const out: RawSegment[] = [];
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const a = attrs(m[1]);
    if (!METRIC_OF.has(a.name)) continue;
    const raw = m[2].replace(/<[^>]+>/g, "").replace(/[,\s$]/g, "");
    let value = raw === "" || /^[—–-]$/.test(raw) ? 0 : Number(raw);
    value *= Math.pow(10, Number(a.scale ?? 0));
    if (a.sign === "-") value = -value;
    const f = segmentFact(a.name, contexts.get(a.contextRef), value, labels, filing, a.id);
    if (f) out.push(f);
  }
  return out;
}

const INSTANCE_RE = new RegExp(
  `<(${SEGMENT_CONCEPTS.map(([c]) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b([^>]*?)>([^<]*)</\\1>`,
  "g",
);

function extractInstanceSegments(xml: string, labels: Map<string, string>, filing: Filing): RawSegment[] {
  const contexts = parseContexts(xml);
  const out: RawSegment[] = [];
  for (const m of xml.matchAll(INSTANCE_RE)) {
    const a = attrs(m[2]);
    const value = Number(m[3].trim());
    const f = segmentFact(m[1], contexts.get(a.contextRef), value, labels, filing, a.id);
    if (f) out.push(f);
  }
  return out;
}

const coverShares = new Map<string, number>();

interface IndexItem {
  name: string;
  size?: string | number;
}

async function filingIndex(cik: string, accn: string): Promise<IndexItem[]> {
  const idx = await secJson<{ directory: { item: IndexItem[] } }>(archive(cik, accn, "index.json"));
  return idx.directory.item;
}

async function labelsFor(cik: string, accn: string, items: IndexItem[]) {
  const lab = items.find((i) => i.name.endsWith("_lab.xml"));
  if (!lab) return new Map<string, string>();
  try {
    return parseLabels(await secText(archive(cik, accn, lab.name)));
  } catch (e) {
    console.warn("  labels unavailable", accn, (e as Error).message);
    return new Map<string, string>();
  }
}

async function segmentsFor(cik: string, filing: Filing): Promise<RawSegment[]> {
  const items = await filingIndex(cik, filing.accn);
  const labels = await labelsFor(cik, filing.accn, items);
  if (filing.ixbrl) {
    const html = await secText(archive(cik, filing.accn, filing.doc));
    const shares = extractCoverShares(html);
    if (shares && !coverShares.has(cik)) coverShares.set(cik, shares);
    return extractInlineSegments(html, labels, filing);
  }
  // Legacy XBRL: the instance document is the largest .xml that isn't a linkbase or the filing summary.
  const instance = items
    .filter((i) => /\.xml$/i.test(i.name) && !/(_cal|_def|_lab|_pre|_ref)\.xml$/i.test(i.name) && !/^FilingSummary|^R\d+/i.test(i.name))
    .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  if (!instance) return [];
  return extractInstanceSegments(await secText(archive(cik, filing.accn, instance.name)), labels, filing);
}

/** Keep one fact per member/metric/period: the most recently filed (recast) value, then the preferred concept. */
function dedupeSegments(all: RawSegment[]): SegmentFact[] {
  const best = new Map<string, RawSegment>();
  for (const s of all) {
    const k = `${s.axis}|${s.member}|${s.metric}|${s.start ?? ""}|${s.end}`;
    const cur = best.get(k);
    if (!cur || s.filed > cur.filed || (s.filed === cur.filed && s.rank < cur.rank)) best.set(k, s);
  }
  // Present each member under the label from its most recent filing.
  const labelOf = new Map<string, { filed: string; label: string }>();
  for (const s of best.values()) {
    const k = `${s.axis}|${s.member}`;
    const cur = labelOf.get(k);
    if (!cur || s.filed > cur.filed) labelOf.set(k, { filed: s.filed, label: s.label });
  }
  return [...best.values()]
    .map(({ filed: _f, rank: _r, ...s }) => ({ ...s, label: labelOf.get(`${s.axis}|${s.member}`)!.label }))
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.member < b.member ? -1 : 1));
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

export function parseForm4(xml: string, f: { accn: string; filed: string; report?: string }, path: string): InsiderTrade[] {
  const out: InsiderTrade[] = [];
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
  return out;
}

async function insidersFor(cik: string, filings: Filing[]): Promise<InsiderTrade[]> {
  const form4 = filings.filter((f) => f.form === "4").slice(0, 40);
  const out: InsiderTrade[] = [];
  for (const f of form4) {
    try {
      const path = f.doc.replace(/^xsl[^/]+\//, "");
      out.push(...parseForm4(await secText(archive(cik, f.accn, path)), f, path));
    } catch (e) {
      console.warn("  form4 failed", f.accn, (e as Error).message);
    }
  }
  return out;
}

// ---------- Earnings releases (8-K Item 2.02, exhibit 99.1) ----------
async function releasesFor(cik: string, filings: Filing[]): Promise<EarningsRelease[]> {
  const eightKs = filings.filter((f) => f.form === "8-K" && f.items?.includes("2.02")).slice(0, 12);
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
      out.push({ accn: f.accn, filed: f.filed, report: f.report, doc, title: `Earnings release · ${f.report ?? f.filed}` });
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
  for (const path of [`../src/assets/logos/${ticker}.svg.asset.json`, `../src/assets/logos/${ticker}.png.asset.json`]) {
    try {
      const raw = await readFile(new URL(path, import.meta.url), "utf8");
      return (JSON.parse(raw) as { url: string }).url;
    } catch {
      /* try next */
    }
  }
  try {
    await stat(new URL(`../public/logos/${ticker}.svg`, import.meta.url));
    return `/logos/${ticker}.svg`;
  } catch {
    return "";
  }
}

function lastValue(st: Statement | undefined, key: string): { v: number; end: string } | null {
  const l = latest(st, key);
  return l ? { v: l.cell.v, end: st!.periods[l.index].end } : null;
}

function fundamentals(statements: CompanyDataset["statements"]): UniverseFundamentals {
  const q = statements.quarterly;
  const a = statements.annual;
  const ttmOf: Record<TtmKey, [Statement, string]> = {
    revenue: [q.income, "revenue"],
    grossProfit: [q.income, "grossProfit"],
    operatingIncome: [q.income, "operatingIncome"],
    ebitda: [q.income, "ebitda"],
    netIncome: [q.income, "netIncome"],
    fcf: [q.cashflow, "fcf"],
    cfo: [q.cashflow, "cfo"],
    capex: [q.cashflow, "capex"],
    sbc: [q.cashflow, "sbc"],
    rnd: [q.income, "rnd"],
    dna: [q.cashflow, "dna"],
    buybacks: [q.cashflow, "buybacks"],
    dividends: [q.cashflow, "dividends"],
    epsDiluted: [q.income, "epsDiluted"],
    interestExpense: [q.income, "interestExpense"],
  };
  const t: UniverseFundamentals["ttm"] = {};
  for (const [k, [st, key]] of Object.entries(ttmOf) as [TtmKey, [Statement, string]][]) {
    const v = ttm(st, key);
    if (v != null) t[k] = k === "epsDiluted" ? Math.round(v * 100) / 100 : v;
  }
  const bs: UniverseFundamentals["bs"] = {};
  const keys: BalanceKey[] = ["cash", "shortTermInvestments", "totalDebt", "netDebt", "equity", "totalAssets", "loans", "deposits"];
  let asOf: string | null = null;
  for (const k of keys) {
    const l = lastValue(q.balance, k) ?? lastValue(a.balance, k);
    if (l) {
      bs[k] = l.v;
      if (k === "totalAssets") asOf = l.end;
    }
  }
  const revRow = rowCells(a.income, "revenue");
  const revenueHistory = a.income.periods
    .map((p, i) => [p.label, revRow[i]?.v] as [string, number | undefined])
    .filter((x): x is [string, number] => x[1] != null)
    .slice(-10);
  const growth = (years: number) => {
    const n = revenueHistory.length;
    return n > years ? cagr(revenueHistory[n - 1 - years][1], revenueHistory[n - 1][1], years) : null;
  };
  const rq = latest(q.income, "revenue");
  return {
    asOf: rq ? q.income.periods[rq.index].end : asOf,
    ttm: t,
    bs,
    revenueHistory,
    revenueCagr3y: growth(3),
    revenueCagr5y: growth(5),
    epsGrowthYoY: latestYoY(q.income, "epsDiluted"),
    dilutedShares: lastValue(q.income, "sharesDiluted")?.v ?? null,
  };
}

async function ingestCompany(cfg: (typeof COVERAGE)[number]): Promise<UniverseEntry> {
  const t0 = Date.now();
  const log = (...m: unknown[]) => console.log(`  [${cfg.ticker}]`, ...m);
  const sub = await secJson<Submissions>(`https://data.sec.gov/submissions/CIK${pad(cfg.cik)}.json`);
  let all = rowsOf(sub.filings.recent);
  for (const file of sub.filings.files) {
    const older = await secJson<RecentFilings>(`https://data.sec.gov/submissions/${file.name}`);
    all = all.concat(rowsOf(older));
  }
  const filings: Filing[] = all.filter((f) => LIST_FORMS.has(f.form) || f.form === "4");

  const cf = await secJson<CompanyFacts & { facts: Record<string, any> }>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cfg.cik)}.json`,
  );
  const bank = isBankIndustry(cfg.industry);
  const statements = buildStatements(cf, { bank });

  // Shares outstanding (sum classes reported on the same cover page)
  const so: { end: string; val: number; accn: string; filed: string }[] =
    cf.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
  const lastFiled = so.reduce((m, f) => (f.filed > m ? f.filed : m), "");
  const cover = so.filter((f) => f.filed === lastFiled);
  let sharesOutstanding = cover.length ? cover.reduce((s, f) => s + f.val, 0) : null;

  // Segment backfill: every inline-XBRL 10-K, the latest twelve 10-Qs, and every other legacy 10-K
  // (each 10-K carries three years of segment history) back to 2009.
  const periodic = filings.filter((f) => f.form === "10-K" || f.form === "10-Q");
  const ixK = periodic.filter((f) => f.form === "10-K" && f.ixbrl);
  const ixQ = periodic.filter((f) => f.form === "10-Q" && f.ixbrl).slice(0, 12);
  const legacyK = periodic.filter((f) => f.form === "10-K" && !f.ixbrl && f.filed >= "2009-06-01").filter((_, i) => i % 2 === 0).slice(0, 6);
  const targets = [...ixK, ...ixQ, ...legacyK];
  const raw: RawSegment[] = [];
  let failed = 0;
  for (const f of targets) {
    try {
      raw.push(...(await segmentsFor(cfg.cik, f)));
    } catch (e) {
      failed++;
      console.warn(`  [${cfg.ticker}] segments failed`, f.form, f.accn, (e as Error).message);
    }
  }
  const segments = dedupeSegments(raw);

  const coverFromHtml = coverShares.get(cfg.cik) ?? null;
  if (coverFromHtml && (!sharesOutstanding || cover[0]?.filed < (ixQ[0]?.filed ?? ""))) sharesOutstanding = coverFromHtml;
  const insiders = await insidersFor(cfg.cik, filings);
  const earningsReleases = await releasesFor(cfg.cik, filings);

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
    segments,
    insiders,
    earningsReleases,
  };
  await writeFile(`${OUT}companies/${cfg.ticker}.json`, JSON.stringify(slimDataset(dataset)));
  log(
    `${statements.annual.income.periods.length}y/${statements.quarterly.income.periods.length}q periods · ${segments.length} segment facts from ${targets.length - failed}/${targets.length} filings · ${insiders.length} insider tx · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );

  const q = statements.quarterly;
  const a = statements.annual;
  const fyRev = latest(a.income, "revenue");
  const fyNi = latest(a.income, "netIncome");
  const revTTM = ttm(q.income, "revenue");
  const gpTTM = ttm(q.income, "grossProfit");
  const lastPeriodic = periodic[0];
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
    f: fundamentals(statements),
  };
}

// ---------- Prices ----------
export const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function ingestPrice(symbol: string, name?: string) {
  let j: any;
  for (const host of ["query1", "query2", "query1", "query2"]) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=div%2Csplits`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } });
    if (res.ok) {
      j = await res.json();
      break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!j) throw new Error(`yahoo ${symbol} failed`);
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
async function fredObservations(s: MacroDef): Promise<[string, number][]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.id}&cosd=${s.since}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`fred ${s.id} ${res.status}`);
  const observations: [string, number][] = [];
  for (const line of (await res.text()).trim().split("\n").slice(1)) {
    const [d, v] = line.split(",");
    const n = Number(v);
    if (v && v !== "." && Number.isFinite(n)) observations.push([d, n]);
  }
  return observations;
}

const FISCAL_API = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const TREASURY: Record<string, { path: string; field: string; filter?: string }> = {
  TSY_DEBT: { path: "/v2/accounting/od/debt_to_penny", field: "tot_pub_debt_out_amt" },
  TSY_DEBT_PUBLIC: { path: "/v2/accounting/od/debt_to_penny", field: "debt_held_public_amt" },
  TSY_AVG_RATE: { path: "/v2/accounting/od/avg_interest_rates", field: "avg_interest_rate_amt", filter: "security_desc:eq:Total Interest-bearing Debt" },
};

export async function treasuryObservations(id: string, since: string): Promise<[string, number][]> {
  const spec = TREASURY[id];
  if (!spec) throw new Error(`unknown treasury series ${id}`);
  const out: [string, number][] = [];
  for (let page = 1; page < 50; page++) {
    const filter = [`record_date:gte:${since}`, spec.filter].filter(Boolean).join(",");
    const url = `${FISCAL_API}${spec.path}?fields=record_date,${spec.field}&filter=${encodeURIComponent(filter)}&sort=record_date&page[number]=${page}&page[size]=10000`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`treasury ${id} ${res.status}`);
    const j = (await res.json()) as { data: Record<string, string>[]; meta: { "total-pages": number } };
    for (const r of j.data) {
      const n = Number(r[spec.field]);
      if (Number.isFinite(n)) out.push([r.record_date, n]);
    }
    if (page >= j.meta["total-pages"]) break;
  }
  return out;
}

async function ingestMacro(s: MacroDef) {
  const observations = s.provider === "treasury" ? await treasuryObservations(s.id, s.since) : await fredObservations(s);
  const series: MacroSeries = {
    id: s.id,
    title: s.title,
    units: s.units,
    frequency: s.frequency,
    observations,
    fetchedAt: new Date().toISOString(),
    source: "snapshot",
    agency: s.agency,
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

/** Coverage counts used by the landing page and the data-status page. */
async function writeManifest() {
  let filings = 0;
  let segments = 0;
  let statementsCells = 0;
  let periods = 0;
  let oldest = "9999";
  let companies = 0;
  for (const c of COVERAGE) {
    try {
      const d = JSON.parse(await readFile(`${OUT}companies/${c.ticker}.json`, "utf8")) as CompanyDataset;
      companies++;
      filings += d.filings.length;
      segments += d.segments.length;
      for (const freq of ["annual", "quarterly"] as const)
        for (const st of Object.values(d.statements[freq])) {
          if (!st) continue;
          for (const r of st.rows) statementsCells += r.cells.filter(Boolean).length;
        }
      periods += d.statements.annual.income.periods.length;
      const first = d.statements.annual.income.periods[0]?.end;
      if (first && first < oldest) oldest = first;
    } catch {
      /* not ingested */
    }
  }
  const insiders = JSON.parse(await readFile(`${OUT}insiders.json`, "utf8")) as { trades: unknown[] };
  const manifest = {
    generatedAt: new Date().toISOString(),
    companies,
    filings,
    segmentFacts: segments,
    statementValues: statementsCells,
    fiscalYears: periods,
    oldestFiscalYearEnd: oldest,
    insiderTransactions: insiders.trades.length,
    macroSeries: MACRO_SERIES.length,
    priceSymbols: COVERAGE.length + BENCHMARKS.length,
  };
  await writeFile(`${OUT}manifest.json`, JSON.stringify(manifest, null, 1));
  console.log("  manifest", manifest);
}

async function main() {
  await mkdir(`${OUT}companies`, { recursive: true });
  await mkdir(`${OUT}prices`, { recursive: true });
  await mkdir(`${OUT}macro`, { recursive: true });
  await mkdir(CACHE, { recursive: true });
  const only = args.only as string | undefined;
  const tickers = args.tickers ? String(args.tickers).split(",") : null;

  if (!only || only === "sec") {
    let prev: Universe | null = null;
    try {
      prev = JSON.parse(await readFile(`${OUT}universe.json`, "utf8")) as Universe;
    } catch {
      /* first run */
    }
    const todo = COVERAGE.filter((c) => !tickers || tickers.includes(c.ticker));
    console.log(`▶ SEC: ${todo.length} companies`);
    const fresh = await pool(todo, Number(args.concurrency ?? 3), async (c) => {
      try {
        return await ingestCompany(c);
      } catch (e) {
        console.error(`  [${c.ticker}] FAILED`, (e as Error).message);
        return prev?.companies.find((x) => x.ticker === c.ticker) ?? null;
      }
    });
    const byTicker = new Map(fresh.filter((e): e is UniverseEntry => !!e).map((e) => [e.ticker, e]));
    const entries = COVERAGE.map((c) => byTicker.get(c.ticker) ?? prev?.companies.find((x) => x.ticker === c.ticker)).filter(
      (e): e is UniverseEntry => !!e,
    );
    const universe: Universe = { generatedAt: new Date().toISOString(), companies: entries };
    await writeFile(`${OUT}universe.json`, JSON.stringify(universe));
  }
  if (!only || only === "sec" || only === "insiders") await writeInsiderFeed();
  if (!only || only === "prices") {
    console.log("\n▶ prices");
    const symbols = [...COVERAGE.map((c) => [c.ticker, c.shortName]), ...BENCHMARKS.map((b) => [b.symbol, b.name])].filter(
      ([s]) => !tickers || tickers.includes(s),
    );
    await pool(symbols, 2, async ([s, n]) => {
      try {
        await ingestPrice(s, n);
      } catch (e) {
        console.warn("  price failed", s, (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 400));
    });
  }
  if (!only || only === "macro") {
    console.log("\n▶ macro");
    await pool(MACRO_SERIES, 4, async (s) => {
      try {
        await ingestMacro(s);
      } catch (e) {
        console.warn("  macro failed", s.id, (e as Error).message);
      }
    });
  }
  if (!only || only === "sec" || only === "manifest" || only === "insiders") await writeManifest();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
