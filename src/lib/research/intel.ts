// Executors for the assistant tools that read what the Filed Under pipeline has already computed: KPIs extracted
// from company documents (each value with its document, page and printed quote), KPI signals, earnings previews and
// scorecards, the quant read, correlation peers, short interest, special situations, the 30-day brief and the tables
// parsed out of IR PDFs. These are the facts the pipeline spends hours producing; the assistant should start here
// before re-deriving anything from raw filings or the web.
import type { QueryClient } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";
import { kpiFileQuery, type KpiFile, type KpiItem, type KpiValue } from "@/lib/statements/filed";
import { kpiInsightsQuery, kpiInsightsIndexQuery, type KpiInsightsFile, type KpiSource } from "@/lib/insights/kpi";
import { previewQuery, scoreQuery, seasonQuery } from "@/lib/earnings/workflow";
import { flowsQuery, quantReadQuery, signalsQuery, statesQuery } from "@/lib/technicals/data";
import { peersQuery } from "@/lib/technicals/cross";
import { situationQuery } from "@/lib/situations/data";
import { briefQuery } from "@/lib/insights/brief";
import { storeIndexQuery } from "@/lib/ir/store";

const MAX = 9000;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}\n…[truncated]` : s);
const safe = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

export interface IntelRun {
  output: string;
  summary: string;
}

/* ---------------------------------------------------------------- formatting */

/** Analyst shorthand to the words companies print in supplements. */
const SYNONYMS: [RegExp, string][] = [
  [/\bnim\b|net interest margin/i, "net yield on interest-earning assets"],
  [/\bcet ?1\b/i, "common equity tier 1"],
  [/\bncos?\b/i, "net charge-off"],
  [/\broe\b/i, "return on equity"],
  [/\brotce\b/i, "return on tangible common equity"],
  [/\befficiency ratio\b/i, "overhead ratio"],
  [/\barpu\b/i, "average revenue per user"],
  [/\bsss\b|same.store sales/i, "comparable sales"],
  [/\bnrr\b/i, "net revenue retention"],
  [/\brpo\b/i, "remaining performance obligations"],
];
const expand = (q: string) => [q, ...SYNONYMS.filter(([re]) => re.test(q)).map(([re, to]) => q.replace(re, to))];

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 1);

/** Score text against query words: every word must appear; earlier and denser matches rank higher. */
function matchScore(text: string, q: string[]): number {
  if (!q.length) return 1;
  const t = text.toLowerCase();
  let s = 0;
  for (const w of q) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    s += 1 + 1 / (1 + i / 40);
  }
  return s;
}

export function fmtKpi(v: number, unit: string | undefined): string {
  const u = (unit ?? "").toUpperCase();
  if (u === "%" || u === "PCT" || u === "PERCENT") return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;
  if (u === "USD" || u === "$") {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(2)}`;
  }
  if (u === "USD/SHARE" || u === "USDPERSHARE") return `$${v.toFixed(2)}`;
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B${unit ? ` ${unit}` : ""}`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M${unit ? ` ${unit}` : ""}`;
  return `${Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2)}${unit ? ` ${unit}` : ""}`;
}

/** Some extracted titles repeat themselves ("3Q26 Earnings Supplement 3Q26 Earnings Supplement PDF"). */
export const docTitle = (t: string | undefined) => {
  if (!t) return "document";
  const s = t.replace(/\s+PDF\s*$/i, "").trim();
  const half = s.length / 2;
  return Number.isInteger(half - 0.5) && s.slice(0, half - 0.5) === s.slice(half + 0.5) ? s.slice(0, half - 0.5) : s;
};

const cite = (x: { url?: string; page?: number | string | null; doc_title?: string }) =>
  x.url ? ` <${x.url}${x.page ? `#page=${x.page}` : ""}>` : "";

const pctChange = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : NaN);

/* ---------------------------------------------------------------- KPIs */

type Freq = "Q" | "A";
type Vals = Record<string, KpiValue & { page?: number | string; doc?: string }>;

/** A KPI's series for a frequency. Balances and ratios (CET1, deposits, loans) are stored as point-in-time values
 * under "I" and some companies' trailing figures under "T"; for quarterly reads they stand in when there is no "Q". */
export function seriesOf(item: KpiItem, freq: Freq): { vals: Vals; basis: string } {
  const v = (item.values ?? {}) as Record<string, Vals | undefined>;
  const has = (k: string) => Object.keys(v[k] ?? {}).length > 0;
  if (freq === "A") return { vals: v.A ?? {}, basis: "annual" };
  if (has("Q")) return { vals: v.Q as Vals, basis: "quarterly" };
  if (has("I")) return { vals: v.I as Vals, basis: "point in time" };
  if (has("T")) return { vals: v.T as Vals, basis: "trailing" };
  return { vals: {}, basis: "quarterly" };
}

/** Table-of-contents sheets of a workbook hold page numbers, not figures. */
const isIndexGroup = (g: KpiFile["groups"][number]) => /^workbook:\s*(index|contents|toc)\b/i.test(g.category.trim());

/** One line per period, newest first, with the printed figure, its page and a short verbatim quote. */
export function kpiLines(item: KpiItem, freq: Freq, periods: number): string[] {
  const { vals } = seriesOf(item, freq);
  const ends = Object.keys(vals).sort().reverse().slice(0, periods);
  return ends.map((end, i) => {
    const v = vals[end] as KpiValue & { page?: number | string; sheet?: string | null; cell?: string | null };
    const prior = vals[ends[i + 1]];
    const yearAgoEnd = freq === "Q" ? ends[i + 4] : ends[i + 1];
    const yearAgo = yearAgoEnd ? vals[yearAgoEnd] : undefined;
    const chg: string[] = [];
    if (prior && freq === "Q") chg.push(`QoQ ${fmtDelta(v.v, prior.v, item.unit)}`);
    if (yearAgo) chg.push(`YoY ${fmtDelta(v.v, yearAgo.v, item.unit)}`);
    const quote = v.quote ? ` "${v.quote.replace(/\s+/g, " ").slice(0, 110)}"` : "";
    return `  ${v.label ?? end} (${end}): ${fmtKpi(v.v, item.unit)}${chg.length ? ` [${chg.join(", ")}]` : ""} — ${docTitle(v.doc_title)}${v.page ? ` p.${v.page}` : v.sheet ? ` sheet "${v.sheet}"${v.cell ? ` ${v.cell}` : ""}` : ""}${quote}${cite(v)}`;
  });
}

function fmtDelta(a: number, b: number, unit: string | undefined): string {
  const u = (unit ?? "").toUpperCase();
  if (u === "%" || u === "PCT" || u === "PERCENT") {
    const d = a - b;
    return `${d >= 0 ? "+" : ""}${d.toFixed(2)} pp`;
  }
  const c = pctChange(a, b);
  return Number.isFinite(c) ? `${c >= 0 ? "+" : ""}${(c * 100).toFixed(1)}%` : "n/a";
}

function latestEnd(item: KpiItem): string {
  let last = "";
  for (const d of Object.values((item.values ?? {}) as Record<string, Vals | undefined>)) for (const k of Object.keys(d ?? {})) if (k > last) last = k;
  return last;
}

/** Items still reported (latest value within a year of the newest in the file), so legacy segments rank below current ones. */
function current(file: KpiFile): { newest: string; isCurrent: (it: KpiItem) => boolean } {
  let newest = "";
  for (const g of file.groups) for (const it of g.items) newest = latestEnd(it) > newest ? latestEnd(it) : newest;
  const cutoff = newest ? `${Number(newest.slice(0, 4)) - 1}${newest.slice(4)}` : "";
  return { newest, isCurrent: (it) => latestEnd(it) >= cutoff };
}

export async function getKpis(qc: QueryClient, args: Record<string, unknown>): Promise<IntelRun> {
  const t = String(args.ticker).toUpperCase();
  const file = await safe(qc.fetchQuery(kpiFileQuery(t)));
  if (!file?.groups?.length)
    return { output: `No document-extracted KPIs for ${t} yet. Use get_financials (XBRL) or search_documents instead.`, summary: "no KPIs" };
  const freq: Freq = args.frequency === "annual" ? "A" : "Q";
  const periods = Math.max(1, Math.min(Number(args.periods) || 5, 20));
  const q = words(String(args.query ?? ""));
  const { newest, isCurrent } = current(file);
  const idxDropped = file.groups.filter(isIndexGroup).length;
  const groups = file.groups.filter((g) => !isIndexGroup(g));
  const nValues = groups.reduce((n, g) => n + g.items.reduce((m, it) => m + Object.values((it.values ?? {}) as Record<string, Vals | undefined>).reduce((k, d) => k + Object.keys(d ?? {}).length, 0), 0), 0);

  if (!q.length) {
    // No query: a map of what exists, so the next call can be precise.
    const lines = [
      `${t}: ${groups.reduce((n, g) => n + g.items.length, 0)} KPIs, ${nValues.toLocaleString("en-US")} values extracted from the company's own releases and supplements, latest period ${newest}. Every value carries its document, page and printed quote.`,
      "Categories (current items / all items; sample of current items):",
      ...groups.map((g) => {
        const cur = g.items.filter(isCurrent);
        return `- ${g.category}${g.subcategory ? ` / ${g.subcategory}` : ""}: ${cur.length}/${g.items.length} — ${cur
          .filter((it) => !it.parent || it.is_total)
          .slice(0, 8)
          .map((it) => it.name)
          .join("; ")}`;
      }),
      "Call get_kpis again with query (e.g. 'net interest margin', 'CET1', 'card net charge-off') to get the values.",
    ];
    return { output: clip(lines.join("\n")), summary: `${t} KPI map` };
  }

  const variants = expand(String(args.query)).map(words);
  const hay = (it: KpiItem, g: KpiFile["groups"][number]) => `${it.name} ${g.category} ${g.subcategory ?? ""} ${it.description ?? ""}`;
  // Every word must match in some phrasing; if none does, fall back to the items matching the most words.
  let scored0 = groups.flatMap((g) => g.items.map((it) => ({ it, g, s: Math.max(...variants.map((v) => matchScore(hay(it, g), v))) })));
  const hasVals = (it: KpiItem) => Object.keys(seriesOf(it, freq).vals).length > 0;
  if (!scored0.some((x) => x.s > 0 && hasVals(x.it)) && q.length > 1)
    scored0 = scored0.map((x) => ({ ...x, s: q.filter((w) => hay(x.it, x.g).toLowerCase().includes(w)).length >= Math.ceil(q.length / 2) ? q.filter((w) => hay(x.it, x.g).toLowerCase().includes(w)).length / 2 : 0 }));
  const scored = scored0
    .filter((x) => x.s > 0 && hasVals(x.it))
    .map((x) => ({ ...x, s: x.s + (isCurrent(x.it) ? 6 : 0) + (x.it.is_total ? 0.5 : 0) + (variants.some((v) => matchScore(x.it.name, v)) ? 1.5 : 0) - x.it.name.length / 400 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, Math.min(Number(args.max_items) || 8, 20)));
  if (!scored.length)
    return { output: `No ${t} KPI matches "${args.query}" (${freq === "Q" ? "quarterly" : "annual"}). Call get_kpis with a null query to see the categories.`, summary: "no match" };
  const out = [`${t} KPIs matching "${args.query}" (${freq === "Q" ? "quarterly" : "annual"}, newest first). Cite as the document link with its page; a value with no page is from a workbook cell or a curated series.${idxDropped ? " Workbook contents pages are excluded." : ""}`];
  for (const { it, g } of scored) {
    out.push(`${it.name} [${g.category}${it.parent ? ` > child of ${it.parent}` : ""}${isCurrent(it) ? "" : ", no longer reported"}] id ${it.id}, unit ${it.unit ?? "n/a"}, ${seriesOf(it, freq).basis}${it.description && it.description !== it.subcategory ? ` — ${it.description.slice(0, 160)}` : ""}`);
    out.push(...kpiLines(it, freq, periods));
  }
  return { output: clip(out.join("\n")), summary: `${scored.length} ${t} KPIs` };
}

/* ---------------------------------------------------------------- KPI signals */

const srcLine = (s: KpiSource) => `${docTitle(s.doc_title ?? s.label)} p.${s.page ?? "?"}${s.quote ? ` "${s.quote.slice(0, 100)}"` : ""}${s.url ? ` <${s.url}${s.page ? `#page=${s.page}` : ""}>` : ""}`;

export async function getKpiSignals(qc: QueryClient, args: Record<string, unknown>): Promise<IntelRun> {
  if (args.ticker) {
    const t = String(args.ticker).toUpperCase();
    const f = await safe(qc.fetchQuery(kpiInsightsQuery(t)));
    if (!f) return { output: `No KPI signals computed for ${t}.`, summary: "none" };
    return { output: clip(renderSignals(f, 12)), summary: `${f.signals.length} signals for ${t}` };
  }
  const idx = await safe(qc.fetchQuery(kpiInsightsIndexQuery));
  if (!idx) return { output: "The KPI signal index is not available.", summary: "none" };
  const kind = args.kind ? String(args.kind) : null;
  const sector = args.sector ? String(args.sector).toLowerCase() : null;
  const rows = idx.order
    .map((t) => idx.companies[t])
    .filter((r) => r && r.n_signals > 0)
    .filter((r) => !kind || r.kinds.includes(kind as never))
    .filter((r) => !sector || (r.sector ?? "").toLowerCase().includes(sector))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 40);
  const out = [
    `Strongest KPI signals across ${idx.count} companies (${idx.method}). Strength is the size of the move against that KPI's own usual move. Call get_kpi_signals with a ticker for the figures and their sources.`,
    ...rows.map(
      (r) =>
        `${r.ticker} ${r.name ?? ""} [${r.sector ?? "?"}] strength ${r.strength.toFixed(1)}: ${r.signals
          .slice(0, 3)
          .map((s) => `${s.kind}: ${s.reason}`)
          .join(" | ")}${r.top ? ` — headline: ${r.top.title}` : ""}`,
    ),
  ];
  return { output: clip(out.join("\n")), summary: `${rows.length} companies with signals` };
}

export function renderSignals(f: KpiInsightsFile, n: number): string {
  const out = [`${f.ticker} ${f.name} — KPI signals (${f.label}), generated ${f.generated.slice(0, 10)}`];
  for (const ins of f.insights.slice(0, 5)) out.push(`INSIGHT [${ins.kind}] ${ins.title}: ${ins.text}`);
  for (const s of [...f.signals].sort((a, b) => b.strength - a.strength).slice(0, n)) {
    out.push(`SIGNAL [${s.kind}] strength ${s.strength.toFixed(1)}: ${s.reason}`);
    for (const id of s.facts) {
      const fact = f.facts[id];
      if (!fact) continue;
      out.push(`  fact: ${fact.text}`);
      for (const src of fact.sources.slice(0, 2)) out.push(`    source: ${srcLine(src)}`);
    }
  }
  return out.join("\n");
}

/* ---------------------------------------------------------------- earnings */

/** Compact any JSON for the model: long arrays are cut, long strings shortened. */
export function compact(v: unknown, arr = 8, str = 400, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.length > arr ? [...v.slice(0, arr).map((x) => compact(x, arr, str, depth + 1)), `…+${v.length - arr} more`] : v.map((x) => compact(x, arr, str, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, compact(x, arr, str, depth + 1)]));
  if (typeof v === "string" && v.length > str) return `${v.slice(0, str)}…`;
  if (typeof v === "number" && !Number.isInteger(v)) return Number(v.toPrecision(5));
  return v;
}

export async function getEarningsWorkup(qc: QueryClient, args: Record<string, unknown>): Promise<IntelRun> {
  const t = String(args.ticker).toUpperCase();
  const [preview, score, season] = await Promise.all([safe(qc.fetchQuery(previewQuery(t))), safe(qc.fetchQuery(scoreQuery(t))), safe(qc.fetchQuery(seasonQuery))]);
  const out: string[] = [];
  const up = season?.upcoming?.find((r: { ticker: string }) => r.ticker === t);
  const rep = season?.reported?.find((r: { ticker: string }) => r.ticker === t);
  if (up) out.push(`NEXT REPORT: ${JSON.stringify(compact(up))}`);
  if (rep) out.push(`LAST REPORT (season tracker; move = next-day stock move, excess = vs SPY): ${JSON.stringify(compact(rep))}`);
  if (preview) out.push(`PREVIEW (consensus, last report, KPIs to watch with quotes): ${JSON.stringify(compact(preview, 6, 300))}`);
  if (score) out.push(`SCORECARD of the latest results filing (actuals vs consensus, guidance given, guided-for-quarter outcome): ${JSON.stringify(compact(score, 10, 300))}`);
  if (!out.length) return { output: `No earnings preview or scorecard for ${t}. Use get_estimates, get_earnings_call and list_ir_documents.`, summary: "none" };
  const sec = season?.sectors?.find((s: { sector: string }) => s.sector === (preview?.sector ?? up?.sector ?? rep?.sector));
  if (sec) out.push(`SECTOR THIS SEASON: ${JSON.stringify(compact(sec))}`);
  return { output: clip(out.join("\n")), summary: `earnings workup for ${t}` };
}

export async function getEarningsSeason(qc: QueryClient, args: Record<string, unknown>): Promise<IntelRun> {
  const season = await safe(qc.fetchQuery(seasonQuery));
  if (!season) return { output: "Earnings season tracker unavailable.", summary: "none" };
  const sector = args.sector ? String(args.sector).toLowerCase() : null;
  const bySector = <T extends { sector?: string }>(rows: T[]) => rows.filter((r) => !sector || (r.sector ?? "").toLowerCase().includes(sector));
  const reported = bySector(season.reported ?? []);
  const upcoming = bySector(season.upcoming ?? []);
  const rows = reported as unknown as Record<string, unknown>[];
  const ex = rows.filter((r) => typeof r.excess === "number").sort((a, b) => (b.excess as number) - (a.excess as number));
  const out = [
    `Earnings season as of ${season.as_of} (window ${season.window_days} days): ${reported.length} reported, ${upcoming.length} upcoming${sector ? ` in sectors matching "${args.sector}"` : ""}.`,
    `SECTORS: ${JSON.stringify(compact(season.sectors, 12))}`,
    `BIGGEST POSITIVE REACTIONS vs SPY: ${JSON.stringify(compact(ex.slice(0, 10)))}`,
    `BIGGEST NEGATIVE REACTIONS vs SPY: ${JSON.stringify(compact(ex.slice(-10).reverse()))}`,
    `NEXT TO REPORT: ${JSON.stringify(compact([...upcoming].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 20)))}`,
  ];
  if (season.drivers) out.push(`DRIVERS: ${JSON.stringify(compact(season.drivers, 8))}`);
  const moves = (season as unknown as { kpi_moves?: unknown }).kpi_moves;
  if (moves) out.push(`KPI MOVES: ${JSON.stringify(compact(moves, 10))}`);
  return { output: clip(out.join("\n")), summary: `${reported.length} reported, ${upcoming.length} upcoming` };
}

/* ---------------------------------------------------------------- market profile */

export async function getQuantProfile(qc: QueryClient, args: Record<string, unknown>): Promise<IntelRun> {
  const t = String(args.ticker).toUpperCase();
  const [read, peers, flows, states, signals, sit, brief] = await Promise.all([
    safe(qc.fetchQuery(quantReadQuery(t))),
    safe(qc.fetchQuery(peersQuery(t))),
    safe(qc.fetchQuery(flowsQuery(t))),
    safe(qc.fetchQuery(statesQuery)),
    safe(qc.fetchQuery(signalsQuery)),
    safe(qc.fetchQuery(situationQuery(t))),
    safe(qc.fetchQuery(briefQuery(t))),
  ]);
  const out: string[] = [];
  if (read) {
    out.push(`QUANT READ as of ${read.as_of}: ${read.sentences.map((s: { text: string }) => s.text).join(" ")}`);
    out.push(`  stats: ${Object.entries(read.facts ?? {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v[0] : v}`).join(", ")}`);
  }
  const st = (states as unknown as { rows?: ({ t: string; events?: [string, string][] } & Record<string, unknown>)[] } | null)?.rows?.find((r) => r.t === t);
  if (st) {
    const { events, ...rest } = st;
    out.push(`TECHNICAL STATE (vs50/vs200/from_hi/r21/r63/r252 are fractions; vol21_pct is a percentile): ${JSON.stringify(compact(rest))}`);
    // Each recent event with its historical forward return across all tracked stocks since 2008 (base rate, not a forecast).
    const base = (signals as unknown as { signals?: Record<string, Record<string, { n?: number; mean?: number; hit?: number; excess?: number }>> } | null)?.signals ?? {};
    for (const [name, date] of events ?? []) {
      const b = base[name];
      const h = b?.["20"] ?? b?.["5"];
      out.push(`  event ${name} on ${date}${h ? `: historically ${h.n} events, 20-day mean return ${((h.mean ?? 0) * 100).toFixed(2)}%, hit rate ${((h.hit ?? 0) * 100).toFixed(0)}%, excess vs all stocks ${((h.excess ?? 0) * 100).toFixed(2)}%` : ""}`);
    }
  }
  if (peers) {
    out.push(`MOST CORRELATED (${peers.window}): ${peers.top.slice(0, 8).map((p: [string, number, string]) => `${p[0]} ${p[1].toFixed(2)}`).join(", ")}; sector median ${peers.sector_median?.toFixed?.(2)}, all-stock median ${peers.all_median?.toFixed?.(2)}`);
    out.push(`LEAST CORRELATED: ${peers.bottom.slice(0, 5).map((p: [string, number, string]) => `${p[0]} ${p[1].toFixed(2)}`).join(", ")}`);
  }
  const si = (flows?.short_interest ?? []).filter((r) => r.short != null);
  if (si.length) {
    const last = si[si.length - 1];
    const now = last.short as number;
    const yr = si.find((r) => r.date >= `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}`) ?? si[0];
    const yrChg = yr && yr !== last && yr.short ? pctChange(now, yr.short) : NaN;
    out.push(
      `SHORT INTEREST (FINRA): ${now.toLocaleString("en-US")} shares on ${last.date}, ${last.dtc ?? "?"} days to cover${last.chg_pct != null ? `, ${last.chg_pct >= 0 ? "+" : ""}${last.chg_pct}% vs prior report` : ""}${Number.isFinite(yrChg) ? `; ${yrChg >= 0 ? "+" : ""}${(yrChg * 100).toFixed(0)}% vs ${yr.date}` : ""}`,
    );
  }
  const wk = (flows?.ats_weekly ?? []).filter((w) => w.offex_share != null);
  if (wk.length) {
    const w = wk[wk.length - 1];
    out.push(`OFF-EXCHANGE: week of ${w.week}, ${((w.offex_share as number) * 100).toFixed(1)}% of volume off-exchange${w.ats_share != null ? ` (ATS ${(w.ats_share * 100).toFixed(1)}%)` : ""}`);
  }
  if (sit) out.push(`SPECIAL SITUATION COMPONENTS (as of ${sit.as_of}): ${JSON.stringify(compact(sit.components, 4, 240))}`);
  if (brief?.sentences?.length) out.push(`30-DAY BRIEF (${brief.label}): ${brief.sentences.map((s: { text: string }) => s.text).join(" ")}`);
  if (!out.length) return { output: `No computed market profile for ${t}. Use get_price_history.`, summary: "none" };
  return { output: clip(out.join("\n")), summary: `market profile for ${t}` };
}

/* ---------------------------------------------------------------- parsed tables */

interface DocTablesIndex {
  ticker: string;
  documents: { id: string; title: string | null; doc_type: string | null; url: string | null; pages: number | null; n_tables: number }[];
}
interface DocTablesFile {
  id: string;
  title: string | null;
  url: string | null;
  tables: { page: number | null; caption: string | null; n_rows: number; n_cols: number; header: string[][]; rows: string[][] }[];
}

function tableText(tb: DocTablesFile["tables"][number], maxRows: number): string {
  const head = tb.header.map((h) => h.join(" | ")).filter(Boolean);
  const rows = tb.rows.slice(0, maxRows).map((r) => r.map((c) => c.replace(/\s+/g, " ").trim()).join(" | "));
  return [...head, ...rows, ...(tb.rows.length > maxRows ? [`…+${tb.rows.length - maxRows} rows`] : [])].join("\n");
}

export async function searchDocTables(qc: QueryClient, args: Record<string, unknown>): Promise<IntelRun> {
  const t = String(args.ticker).toUpperCase();
  const idx = await safe(partnerFile<DocTablesIndex>(`doctables/${t}/index.json`));
  if (!idx?.documents?.length) return { output: `No parsed tables for ${t}. Use read_ir_document instead.`, summary: "none" };
  const store = await safe(qc.fetchQuery(storeIndexQuery(t)));
  const meta = new Map((store?.documents ?? []).map((d) => [d.id, d]));
  const docQ = words(String(args.doc_query ?? ""));
  const q = words(String(args.query));
  const docs = idx.documents
    .filter((d) => d.n_tables > 0)
    .map((d) => ({ d, m: meta.get(d.id) }))
    .filter(({ d, m }) => !docQ.length || matchScore(`${d.title ?? ""} ${d.doc_type ?? ""} ${m?.fiscal_label ?? ""} ${m?.period_end ?? ""}`, docQ) > 0)
    .sort((a, b) => (b.m?.period_end ?? b.m?.published ?? "").localeCompare(a.m?.period_end ?? a.m?.published ?? ""))
    .slice(0, Math.max(1, Math.min(Number(args.max_docs) || 4, 8)));
  if (!docs.length) return { output: `No ${t} documents with parsed tables match "${args.doc_query}".`, summary: "no documents" };
  const files = await Promise.all(docs.map(({ d }) => safe(partnerFile<DocTablesFile>(`doctables/${t}/${d.id}.json`))));
  const hits: { s: number; doc: (typeof docs)[number]; tb: DocTablesFile["tables"][number] }[] = [];
  files.forEach((f, i) => {
    for (const tb of f?.tables ?? []) {
      const text = `${tb.caption ?? ""} ${tb.header.flat().join(" ")} ${tb.rows.map((r) => r[0] ?? "").join(" ")}`;
      const s = matchScore(text, q) || (q.length > 1 ? matchScore(text, q.slice(0, -1)) * 0.5 : 0);
      if (s > 0) hits.push({ s, doc: docs[i], tb });
    }
  });
  hits.sort((a, b) => b.s - a.s);
  const top = hits.slice(0, Math.max(1, Math.min(Number(args.max_tables) || 3, 6)));
  if (!top.length)
    return { output: `No table in ${docs.map(({ d }) => d.title).join("; ")} matches "${args.query}". Try other words or search_documents.`, summary: "no tables" };
  const out = top.map(
    ({ doc, tb }) =>
      `TABLE from ${docTitle((doc.d.title ?? doc.d.id).split("||")[0])} (${doc.m?.fiscal_label ?? doc.m?.period_end ?? ""}) page ${tb.page ?? "?"}${tb.caption ? `, "${tb.caption}"` : ""}, ${tb.n_rows}x${tb.n_cols} <${doc.d.url ?? ""}${tb.page ? `#page=${tb.page}` : ""}>\n${tableText(tb, 40)}`,
  );
  return { output: clip(out.join("\n\n")), summary: `${top.length} tables` };
}

/* ---------------------------------------------------------------- dossier additions */

/** The computed layer in a few lines, appended to get_company_dossier so the first call already sees it. */
export async function computedDigest(qc: QueryClient, t: string): Promise<string[]> {
  const [ki, brief, sit, read, score] = await Promise.all([
    safe(qc.fetchQuery(kpiInsightsQuery(t))),
    safe(qc.fetchQuery(briefQuery(t))),
    safe(qc.fetchQuery(situationQuery(t))),
    safe(qc.fetchQuery(quantReadQuery(t))),
    safe(qc.fetchQuery(scoreQuery(t))),
  ]);
  const out: string[] = ["FILED UNDER COMPUTED LAYER (drill in with get_kpis, get_kpi_signals, get_earnings_workup, get_quant_profile, search_doc_tables):"];
  if (brief?.sentences?.length) out.push(`BRIEF: ${brief.sentences.map((s: { text: string }) => s.text).join(" ")}`);
  if (ki?.signals?.length)
    out.push(
      "KPI SIGNALS:",
      ...[...ki.signals]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 5)
        .map((s) => `  [${s.kind}] ${s.reason}${s.facts[0] && ki.facts[s.facts[0]]?.sources[0] ? ` — ${srcLine(ki.facts[s.facts[0]].sources[0])}` : ""}`),
    );
  if (score) out.push(`LATEST RESULTS SCORECARD: filed ${score.filed}, quarter ${score.quarter_end ?? "?"}, ${score.metrics.length} metrics, ${score.guidance.length} guidance items <${score.filing_url}>`);
  if (sit) out.push(`SITUATIONS: ${Object.entries(sit.components ?? {}).map(([k, c]) => `${k}: ${(c as { headline?: string; dir?: string }).headline ?? ""} (${(c as { dir?: string }).dir ?? "?"})`).join("; ")}`);
  if (read) out.push(`QUANT: ${read.sentences.map((s: { text: string }) => s.text).join(" ")}`);
  return out.length > 1 ? out : [];
}
