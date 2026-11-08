// Browser-side executors for the research agent's function tools. Data comes from
// the bundled SEC datasets plus live Yahoo/FRED/EDGAR calls through server functions.
import { getEstimates } from "@/lib/estimates.functions";
import { PERIOD_LABEL, actionSummary, ratingLabel } from "@/lib/estimates/core";
import type { QueryClient } from "@tanstack/react-query";
import { companyQuery, macroQuery, newsQuery, pricesQuery, quotesQuery, universeQuery, type Range } from "@/lib/data";
import { COVERAGE, coverageOf, MACRO_SERIES } from "@/lib/coverage";
import { getFilingDocument, searchFilings } from "@/lib/sec.functions";
import { crawlSite, extractFromPage, fetchUrl, mapSite, readWebpage, webSearch } from "@/lib/web.functions";
import { getEarningsTranscript, listEarningsCalls } from "@/lib/transcripts.functions";
import { getPromises } from "@/lib/earnings.functions";
import { credibility } from "@/lib/earnings/promises";
import { alertsQuery } from "@/components/app/alerts-bell";
import { durationDays } from "@/lib/financials/build";
import type { CompanyDataset, Row } from "@/lib/financials/types";
import { runSandbox } from "@/lib/research/sandbox";
import { supplyLinksQuery } from "@/lib/supply/query";
import { supabase } from "@/integrations/supabase/client";
import { fmtAlt } from "@/lib/alt/query";
import { focusGraph, linkDollars, simulateShock, type RiskLink } from "@/lib/supply/core";
import type { UniverseEntry } from "@/lib/financials/types";
import { allSeries, auctionsQuery, crowding, gauges, hedgeFundsQuery } from "@/lib/hedge/query";
import { mostUnusual, readAuctions, seriesStats } from "@/lib/hedge/core";
import { annualizedVol, maxDrawdown, pctChangeOver, returns, sma } from "@/lib/indicators";
import { agentRoot, highlight, locate, outline, readRegion, regionOf, safeClick, bringIntoView, type LocateKind } from "@/lib/research/dom-agent";
import { canvas, checkView, parseOrRepair, parseViewSpec } from "@/lib/research/views";
import { viewLabel } from "@/lib/research/view-spec";
import { partnerFile } from "@/lib/data";
import type { CommentsFile, Form144File } from "@/lib/filings/review";
import { passages, storeIndexQuery, storeText } from "@/lib/ir/store";
import { buildFile, fmtBytes, type Cell, type FileFormat } from "@/lib/research/files";
import { browserFiles, browserStart, browserStatus, browserStop } from "@/lib/browser.functions";

const MAX = 9000;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}\n…[truncated]` : s);

export interface ToolRun {
  output: string;
  /** Short human summary for the step list */
  summary: string;
  /** Filings referenced, for citation chips */
  refs?: { ticker: string; accn: string; doc?: string; label: string }[];
}

function fmtVal(v: number, unit: Row["unit"]) {
  if (unit === "pct") return `${(v * 100).toFixed(1)}%`;
  if (unit === "ratio") return v.toFixed(2);
  if (unit === "usdPerShare") return `$${v.toFixed(2)}`;
  if (unit === "shares") return `${(v / 1e6).toFixed(1)}M sh`;
  return `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
}

async function dataset(qc: QueryClient, ticker: string): Promise<CompanyDataset> {
  const t = ticker.toUpperCase();
  if (!coverageOf(t)) throw new Error(`${t} is not in coverage. Covered: ${COVERAGE.map((c) => c.ticker).join(", ")}. Use web_search for other companies.`);
  return qc.fetchQuery(companyQuery(t));
}

function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, ix\\:header, [style*='display:none'], [style*='display: none']").forEach((e) => e.remove());
  doc.querySelectorAll("tr").forEach((tr) => tr.append(doc.createTextNode("\n")));
  doc.querySelectorAll("td, th").forEach((td) => td.append(doc.createTextNode(" | ")));
  doc.querySelectorAll("p, div, br, h1, h2, h3, h4, li").forEach((e) => e.append(doc.createTextNode("\n")));
  return (doc.body?.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/( \| )+\n/g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** App hooks available to the side-panel assistant. */
export interface AgentCtx {
  navigate?: (href: string) => void;
}

const PAGE_PATH: Record<string, (t: string) => string> = {
  dashboard: () => "/app",
  companies: () => "/app/companies",
  company: (t) => `/app/companies/${t}`,
  financials: (t) => `/app/companies/${t}/financials`,
  segments: (t) => `/app/companies/${t}/ir`,
  valuation: (t) => `/app/companies/${t}/valuation`,
  filings: (t) => `/app/companies/${t}/filings`,
  filing_changes: (t) => `/app/companies/${t}/redline`,
  reports: (t) => (t ? `/app/companies/${t}/reports` : "/app/reports"),
  insiders: (t) => `/app/companies/${t}/insiders`,
  calls: (t) => `/app/companies/${t}/calls`,
  ir: (t) => `/app/companies/${t}/ir`,
  supply_chain: (t) => (t ? `/app/supply-chain?t=${t}` : "/app/supply-chain"),
  ideas: () => "/app/ideas",
  markets: () => "/app/markets",
  macro: () => "/app/macro",
  sectors: () => "/app/sectors",
  research: () => "/app/research",
  theses: () => "/app/theses",
  docs: () => "/app/docs",
  hedge_funds: () => "/app/hedge-funds",
  alt_data: () => "/app/alt-data",
};

/** Flat TTM metrics per company — shared by screen_companies and run_code. */
export function flatUniverse(companies: UniverseEntry[]) {
  return companies.map((c) => {
    const t = c.f?.ttm ?? {};
    const b = c.f?.bs ?? {};
    const rev = t.revenue ?? c.revenueTTM ?? null;
    const div = (a: number | undefined | null) => (a != null && rev ? a / rev : null);
    return {
      ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry, asOf: c.f?.asOf ?? null,
      ...t, ...b, revenue: rev,
      grossMargin: c.grossMarginTTM ?? div(t.grossProfit), operatingMargin: div(t.operatingIncome), netMargin: div(t.netIncome), fcfMargin: div(t.fcf),
      rndIntensity: div(t.rnd), capexIntensity: div(t.capex != null ? Math.abs(t.capex) : null),
      revenueGrowthYoY: c.revenueGrowthYoY, revenueCagr3y: c.f?.revenueCagr3y ?? null, revenueCagr5y: c.f?.revenueCagr5y ?? null, epsGrowthYoY: c.f?.epsGrowthYoY ?? null,
    } as Record<string, string | number | null>;
  });
}

const fmtMetric = (k: string, v: unknown) =>
  typeof v !== "number" ? String(v ?? "—") : /Margin|Growth|Cagr|Intensity/.test(k) ? `${(v * 100).toFixed(1)}%` : k === "epsDiluted" ? `$${v.toFixed(2)}` : `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;

export async function runTool(qc: QueryClient, name: string, args: Record<string, unknown>, ctx: AgentCtx = {}): Promise<ToolRun> {
  switch (name) {
    case "screen_companies": {
      const u = await qc.fetchQuery(universeQuery);
      let rows = flatUniverse(u.companies);
      const sector = typeof args.sector === "string" ? args.sector.toLowerCase() : "";
      if (sector) rows = rows.filter((r) => `${r.sector} ${r.industry}`.toLowerCase().includes(sector));
      for (const f of (args.filters as { metric: string; op: string; value: number }[]) ?? []) {
        rows = rows.filter((r) => {
          const v = r[f.metric];
          if (typeof v !== "number") return false;
          return f.op === ">" ? v > f.value : f.op === ">=" ? v >= f.value : f.op === "<" ? v < f.value : f.op === "<=" ? v <= f.value : v === f.value;
        });
      }
      const sk = String(args.sort_by ?? "revenue");
      rows.sort((a, b) => ((Number(b[sk]) || -Infinity) - (Number(a[sk]) || -Infinity)) * (args.descending === false ? -1 : 1));
      const cols = [...new Set([sk, ...((args.columns as string[]) ?? [])])].slice(0, 8);
      const n = Math.max(1, Math.min(78, Number(args.limit) || 15));
      const lines = rows.slice(0, n).map((r) => `${r.ticker} ${r.name} | ${cols.map((c) => `${c} ${fmtMetric(c, r[c])}`).join(" | ")}`);
      return { output: `${rows.length} companies match (TTM, from SEC statements).\n${lines.join("\n")}`, summary: `${rows.length} matches` };
    }
    case "run_code": {
      const u = await qc.fetchQuery(universeQuery);
      const companies: Record<string, unknown> = {};
      for (const t of ((args.tickers as string[]) ?? []).slice(0, 12)) {
        const d = await dataset(qc, t);
        const pack = (st: { periods: { label: string }[]; rows: Row[] }) => ({ periods: st.periods.map((p) => p.label), rows: Object.fromEntries(st.rows.map((r) => [r.key, r.cells.map((c) => c?.v ?? null)])) });
        companies[t.toUpperCase()] = Object.fromEntries((["income", "balance", "cashflow", "kpis"] as const).map((k) => [k, { annual: d.statements.annual[k] ? pack(d.statements.annual[k]) : null, quarterly: d.statements.quarterly[k] ? pack(d.statements.quarterly[k]) : null }]));
      }
      const prices: Record<string, [string, number][]> = {};
      for (const s of ((args.price_symbols as string[]) ?? []).slice(0, 8)) {
        const p = await qc.fetchQuery(pricesQuery(s.toUpperCase(), "2y", "1d")).catch(() => null);
        if (p) prices[s.toUpperCase()] = p.bars.map((b) => [b[0], b[5]]);
      }
      const r = await runSandbox(String(args.code ?? ""), { universe: flatUniverse(u.companies), companies, prices });
      const out = [r.logs.length ? `console:\n${r.logs.join("\n")}` : "", r.result ? `result:\n${r.result}` : "", r.error ? `ERROR: ${r.error}` : ""].filter(Boolean).join("\n\n");
      const extra: string[] = [];
      if (args.show_in_canvas) {
        canvas.addView({ type: "code", title: typeof args.title === "string" && args.title ? args.title : "Code run", code: String(args.code ?? "").slice(0, 12000), stdout: r.logs.join("\n").slice(0, 20000) || undefined, result: r.result.slice(0, 20000) || undefined, error: r.error?.slice(0, 4000) });
        extra.push("Code and output shown in the canvas.");
      }
      // A returned {view: <spec>} (or {views: [...]}) renders straight into the canvas.
      if (r.ok && r.result) {
        try {
          const parsed = JSON.parse(r.result) as { view?: unknown; views?: unknown[] };
          for (const v of [...(parsed.view ? [parsed.view] : []), ...(Array.isArray(parsed.views) ? parsed.views : [])].slice(0, 8)) {
            const pv = parseViewSpec(v);
            if (pv.ok) {
              canvas.addView(pv.spec);
              extra.push(`Rendered ${pv.spec.type} view.`);
            } else extra.push(`View rejected: ${pv.error}`);
          }
        } catch {
          /* plain result */
        }
      }
      return {
        output: clip([out || "(no output — use return or console.log)", ...extra].join("\n\n")),
        summary: r.ok ? `ran in ${r.ms}ms` : `error: ${r.error?.split("\n")[0].slice(0, 80)}`,
      };
    }
    case "get_alt_data": {
      let q = supabase.from("alt_data").select("ticker,dataset,kind,date,title,value,unit,meta,source_url").order("date", { ascending: false }).limit(400);
      if (args.ticker) q = q.eq("ticker", String(args.ticker).toUpperCase());
      if (args.dataset) q = q.eq("dataset", String(args.dataset));
      if (args.since) q = q.gte("date", String(args.since));
      const { data, error } = await q;
      if (error) return { output: `Error: ${error.message}`, summary: "alt data failed" };
      const lines = (data ?? []).map((r: any) => `${r.date} ${r.ticker} [${r.dataset}${r.kind === "series" ? " series" : ""}] ${r.title}${r.value != null ? ` = ${fmtAlt(r.value, r.unit)}` : ""}${r.meta?.category ? ` (${r.meta.category})` : ""}${r.meta?.filers ? ` filers: ${r.meta.filers.slice(0, 3).join("; ")}` : ""}${r.meta?.agencies?.length ? ` agencies: ${r.meta.agencies.join("; ")}` : ""} <${r.source_url}>`);
      return { output: clip(lines.join("\n") || "No alt data rows match."), summary: `${data?.length ?? 0} alt-data rows` };
    }
    case "get_hedge_fund_data": {
      const p = await qc.fetchQuery(hedgeFundsQuery);
      const all = allSeries(p);
      const terms = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      if (!terms.length || terms.includes("overview") || terms.includes("crowding")) {
        const gs = gauges(p); const cr = crowding(gs);
        lines.push(`CROWDING COMPOSITE ${cr.score?.toFixed(2)}σ (avg signed z of leverage/funding gauges)`);
        for (const g of gs) { const s = seriesStats(g.data, g.unit)!; lines.push(`${g.label}: ${s.latest[1].toPrecision(4)} ${g.unit} (${s.latest[0]}) z=${s.z?.toFixed(2)} pct=${s.percentile.toFixed(0)}${s.record ? ` RECORD ${s.record}` : ""} yoy=${JSON.stringify(s.yoy)} [${g.formula ?? g.sources[0]}]`); }
        const cutoff = new Date(Date.now() - 200 * 86400_000).toISOString().slice(0, 10);
        lines.push("MOST UNUSUAL:", ...mostUnusual(all, cutoff, 15).map((u) => `${u.m} ${u.name} z=${u.z.toFixed(2)}${u.record ? ` record ${u.record}` : ""} (${u.date})`));
      } else {
        const hits = all.filter((s) => terms.every((t) => `${s.m} ${s.name}`.toLowerCase().includes(t))).slice(0, 12);
        for (const s of hits) {
          const st = seriesStats(s.data, s.unit)!;
          lines.push(`${s.m} — ${s.name} [${s.unit}, ${s.freq}] latest ${s.data.at(-1)![1]} (${st.latest[0]}) z=${st.z?.toFixed(2)} pct=${st.percentile.toFixed(0)} high ${st.high[1]} (${st.high[0]}) low ${st.low[1]} (${st.low[0]}) last8: ${s.data.slice(-8).map((d) => `${d[0]}=${d[1]}`).join(", ")} <${s.url}>`);
        }
      }
      return { output: clip(lines.join("\n") || "No hedge fund series match; try fewer words."), summary: `${lines.length} hedge fund lines` };
    }
    case "get_promises": {
      const t = String(args.ticker).toUpperCase();
      const r = await getPromises({ data: { ticker: t } });
      if (!r.promises.length) return { output: r.error ?? "No promises found", summary: "no promises" };
      const c = credibility(r.promises);
      return {
        output: clip([`${t} credibility ${c.score != null ? Math.round(c.score * 100) : "n/a"} (kept ${c.kept}, partial ${c.partial}, missed ${c.missed}, pending ${c.pending})`, ...r.promises.map((p) => `${p.callDate} [${p.status}] ${p.summary} — "${p.quote}" <${p.callUrl}>${p.outcomeQuote ? ` → ${p.outcomeCallDate}: "${p.outcomeQuote}" <${p.outcomeUrl}>` : ""}`)].join("\n")),
        summary: `${r.promises.length} promises`,
      };
    }
    case "get_filing_changes": {
      const t = String(args.ticker).toUpperCase();
      const form = args.form === "10-Q" ? "10-Q" : "10-K";
      const { REDLINE_VERSION, textsOf } = await import("@/lib/redline/core");
      const { data: row } = await supabase.from("filing_redlines").select("payload").eq("ticker", t).eq("form", form).eq("version", REDLINE_VERSION).order("to_filed", { ascending: false }).limit(1).maybeSingle();
      if (!row) return { output: `No stored ${form} comparison for ${t}. Open /app/companies/${t}/redline to compare filings on the spot.`, summary: "no comparison" };
      const r = row.payload as unknown as import("@/lib/redline/core").Redline;
      const titles = new Map(r.sections.map((x) => [x.key, x.title]));
      const top = r.changes.filter((c) => !c.figuresOnly && c.level !== "low").sort((a, b) => b.score - a.score).slice(0, 25);
      const cut = (x: string | null, n: number) => (!x ? "" : x.length > n ? `${x.slice(0, n)}…` : x);
      const lines = [
        `${t} ${form} filed ${r.to.filed} (accn ${r.to.accn}) vs ${r.from.filed} (accn ${r.from.accn}).`,
        `Sections: ${r.sections.map((x) => `${x.title} +${x.added}/-${x.removed}/~${x.changed} (high ${x.high})`).join("; ")}`,
        ...top.map((c) => {
          const tx = textsOf(c);
          const added = c.ops ? c.ops.filter((o) => o.t === "+").map((o) => o.s.trim()).join(" … ") : "";
          return [
            `[${c.level} ${c.score}] ${titles.get(c.section) ?? c.section} · ${c.type}${c.isHeading ? " (heading)" : ""}${c.context ? ` under "${cut(c.context, 100)}"` : ""} — ${c.why.join("; ")}`,
            c.type === "removed" ? `  OLD (accn ${r.from.accn}): "${cut(tx.before, 500)}"` : `  NEW (accn ${r.to.accn}): "${cut(tx.after, 500)}"`,
            c.type === "changed" ? `  ADDED WORDS: "${cut(added, 300)}"` : "",
          ].filter(Boolean).join("\n");
        }),
      ];
      return { output: clip(lines.join("\n")), summary: `${top.length} material changes` };
    }
    case "get_estimates": {
      const t = String(args.ticker).toUpperCase();
      const r = await getEstimates({ data: { ticker: t } });
      const e = r.estimates;
      if (!e) return { output: r.error ?? "No estimates", summary: "no estimates" };
      const s = actionSummary(e.actions, new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10));
      const lines = [
        `${t} consensus (third-party, as of ${e.asOf}): rating ${ratingLabel(e.rating.mean)} (${e.rating.mean?.toFixed(2) ?? "n/a"}), price ${e.price}, target mean ${e.target.mean} median ${e.target.median} range ${e.target.low}-${e.target.high} (${e.target.analysts} analysts)`,
        ...e.periods.map((p) => `${PERIOD_LABEL[p.code]} (ending ${p.endDate}): EPS ${p.eps.avg} [${p.eps.low}-${p.eps.high}, n=${p.eps.analysts}, yr-ago ${p.eps.yearAgo}], revenue ${p.revenue.avg} [${p.revenue.low}-${p.revenue.high}, yr-ago ${p.revenue.yearAgo}]; EPS trend now ${p.trend.current} / 7d ${p.trend.d7} / 30d ${p.trend.d30} / 90d ${p.trend.d90}; revisions 30d up ${p.revisions.up30} down ${p.revisions.down30}`),
        `Surprises: ${e.surprises.map((x) => `${x.quarter} ${x.actual} vs ${x.estimate} (${x.surprisePct})`).join("; ")}`,
        `Last 90d: ${s.upgrades} upgrades, ${s.downgrades} downgrades, ${s.targetRaises} target raises, ${s.targetCuts} cuts`,
        ...e.actions.slice(0, 15).map((a) => `${a.date} ${a.firm} ${a.action} ${a.fromGrade}->${a.toGrade} PT ${a.priorTarget ?? ""}->${a.target ?? ""}`),
      ];
      return { output: clip(lines.join("\n")), summary: `${t} estimates` };
    }
    case "get_alerts": {
      const { data: wl } = await supabase.from("watchlist").select("ticker");
      const tickers = (wl ?? []).map((w) => w.ticker).sort();
      if (!tickers.length) return { output: "Watchlist is empty.", summary: "no watchlist" };
      const all = await qc.fetchQuery(alertsQuery(tickers));
      const rows = all.filter((a) => !args.ticker || a.ticker === String(args.ticker).toUpperCase()).slice(0, 60);
      return { output: clip(rows.map((a) => `${a.at.slice(0, 10)} ${a.ticker} [${a.kind}] ${a.title}${a.detail ? ` — ${a.detail}` : ""}${a.filing ? ` accn ${a.filing.accn}` : a.url ? ` <${a.url}>` : ""}`).join("\n") || "No alerts."), summary: `${rows.length} alerts` };
    }
    case "list_ir_documents": {
      const t = String(args.ticker).toUpperCase();
      const idx = await qc.fetchQuery(storeIndexQuery(t)).catch(() => null);
      if (!idx) return { output: `No stored IR documents for ${t}.`, summary: "none" };
      const needle = String(args.query ?? "").trim().toLowerCase();
      const rows = idx.documents
        .filter((d) => !args.doc_type || d.doc_type === args.doc_type)
        .filter((d) => !needle || `${d.title ?? ""} ${d.fiscal_label ?? ""}`.toLowerCase().includes(needle))
        .sort((a, b) => (b.published ?? b.period_end ?? "").localeCompare(a.published ?? a.period_end ?? ""))
        .slice(0, 60);
      return {
        output: clip(
          rows
            .map((d) => `${d.id} | ${d.doc_type ?? "other"} | ${d.fiscal_label ?? ""} | period ${d.period_end ?? "?"} | published ${d.published ?? "?"} | ${d.pages ?? "?"}pp | ${(d.title ?? "").split("||")[0].slice(0, 100)} | ${d.text_path ? "text" : "no text"} <${d.url}>`)
            .join("\n") || "No documents match.",
        ),
        summary: `${rows.length} of ${idx.documents.length} documents`,
      };
    }
    case "read_ir_document": {
      const t = String(args.ticker).toUpperCase();
      const idx = await qc.fetchQuery(storeIndexQuery(t));
      const d = idx.documents.find((x) => x.id === String(args.doc_id));
      if (!d) return { output: `Unknown document ${args.doc_id} for ${t}; call list_ir_documents first.`, summary: "not found" };
      const pages = await storeText(d);
      const head = `${(d.title ?? "").split("||")[0]} (${d.doc_type ?? "document"}, ${d.fiscal_label ?? d.period_end ?? ""}) <${d.url}>`;
      if (args.query) {
        const hits = passages(pages, String(args.query));
        return { output: clip(`${head}\n` + (hits.map((h) => `[page ${h.page}] ${h.text}`).join("\n---\n") || `No match for "${args.query}".`)), summary: `${hits.length} passages` };
      }
      return { output: clip(`${head}\n` + pages.map((p, i) => `[page ${i + 1}] ${p}`).join("\n")), summary: `${pages.length} pages` };
    }
    case "get_treasury_auctions": {
      const a = await qc.fetchQuery(auctionsQuery);
      const reads = readAuctions(a.auctions).filter((r) => !args.term || r.term === args.term).slice(0, 25);
      return { output: clip(reads.map((r) => `${r.date} ${r.term} ${r.type} ${r.cusip} yield ${r.rate}% btc ${r.btc} (avg ${r.avgBtc?.toFixed(2)}) indirect ${r.indirect}% (avg ${r.avgIndirect?.toFixed(1)}) dealers ${r.dealer}% (avg ${r.avgDealer?.toFixed(1)}) → ${r.verdict ?? "n/a"} ${r.score?.toFixed(1) ?? ""}`).join("\n") + `\nSource: ${a.sourceUrl}`), summary: `${reads.length} auctions` };
    }
    case "get_company_dossier": {
      const t = String(args.ticker).toUpperCase();
      const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
      const [d, links, alt, sig, ideas, f144, review] = await Promise.all([
        dataset(qc, t),
        qc.fetchQuery(supplyLinksQuery),
        supabase.from("alt_data").select("dataset,kind,date,title,value,unit,source_url").eq("ticker", t).eq("kind", "event").gte("date", since).order("date", { ascending: false }).limit(60),
        supabase.from("supply_signals").select("kind,title,detail,impact,quote,filed,form,accn,url").eq("ticker", t).order("filed", { ascending: false }).limit(40),
        fetch("/data/signals.json").then((r) => r.json()).catch(() => null),
        partnerFile<Form144File>(`form144/${t}.json`).catch(() => null),
        partnerFile<CommentsFile>(`comments/${t}.json`).catch(() => null),
      ]);
      const out: string[] = [`DOSSIER ${t} — everything Filed Under knows, last 12 months`];
      const u = (await qc.fetchQuery(universeQuery)).companies.find((c) => c.ticker === t);
      if (u) out.push(`SNAPSHOT: ${JSON.stringify(flatUniverse([u])[0]).slice(0, 600)}`);
      out.push("FILINGS:", ...d.filings.filter((f) => f.filed >= since).slice(0, 15).map((f) => `${f.filed} ${f.form} ${f.desc ?? ""} ${f.items ? `items ${f.items}` : ""} accn ${f.accn}`));
      out.push("INSIDERS (open market):", ...d.insiders.filter((x) => (x.code === "P" || x.code === "S") && x.date >= since).slice(0, 12).map((x) => `${x.date} ${x.owner} (${x.role}) ${x.code === "P" ? "BUY" : "SELL"} ${x.shares} @ ${x.price ?? "?"}${x.plan10b5 ? " 10b5-1" : ""} accn ${x.accn}`));
      if (f144?.notices.length)
        out.push(
          `PROPOSED INSIDER SALES (Form 144; open = no matching Form 4 sale yet): open $${Math.round(f144.summary.open.value).toLocaleString()} · 90d ${f144.summary.d90.n} notices $${Math.round(f144.summary.d90.value).toLocaleString()}`,
          ...f144.notices.slice(0, 10).map((n) => `${n.filed} ${n.person ?? "?"} (${n.relationship ?? "affiliate"}) $${Math.round(n.value ?? 0).toLocaleString()} sale ~${n.sale_date ?? "?"} ${n.plan ? `10b5-1 adopted ${n.plan_adopted[0] ?? "?"}` : "no plan"} [${n.status}] <${n.url ?? ""}>`),
        );
      if (review?.threads.length)
        out.push(
          "SEC COMMENT LETTERS:",
          ...review.threads.slice(0, 4).map((th) => `${th.first}..${th.last} ${th.form ?? ""} ${th.period ?? ""} [${th.status}] topics: ${th.topics.map((k) => review.topics[k] ?? k).join(", ") || "n/a"}; ${th.letters.flatMap((l) => l.comments ?? []).slice(0, 3).map((c) => `"${c.text.slice(0, 160)}"`).join(" ")} <${th.letters[0]?.url ?? ""}>`),
        );
      out.push("ALT DATA EVENTS:", ...(alt.data ?? []).map((r: any) => `${r.date} [${r.dataset}] ${r.title}${r.value != null ? ` = ${fmtAlt(r.value, r.unit)}` : ""} <${r.source_url}>`));
      out.push("SUPPLY-CHAIN INTEL (verbatim-verified):", ...(sig.data ?? []).map((r: any) => `${r.filed ?? ""} [${r.kind}/${r.impact}] ${r.title}: "${String(r.quote).slice(0, 220)}" ${r.accn ? `accn ${r.accn}` : r.url ?? ""}`));
      const g = focusGraph(t, links, Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName])));
      out.push(`SUPPLY LINKS: ${g.slice(0, 25).map((n) => `${n.relation}:${n.name}${n.links[0].share_pct != null ? `(${n.links[0].share_pct}%)` : ""}${(n.links[0] as RiskLink).single_source ? "[single-source]" : ""}`).join("; ")}`);
      const myIdeas = (ideas?.ideas ?? []).filter((i: any) => i.ticker === t);
      if (myIdeas.length) out.push("RULE-BASED TRADE IDEAS:", ...myIdeas.map((i: any) => JSON.stringify(i).slice(0, 400)));
      return { output: clip(out.join("\n")), summary: `dossier for ${t}`, refs: d.filings.slice(0, 3).map((f) => ({ ticker: t, accn: f.accn, doc: f.doc, label: f.form })) };
    }
    case "get_supply_chain": {
      const t = String(args.ticker).toUpperCase();
      const [links, u] = await Promise.all([qc.fetchQuery(supplyLinksQuery), qc.fetchQuery(universeQuery)]);
      const names = Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName]));
      const revenue = Object.fromEntries(u.companies.map((c) => [c.ticker, c.revenueTTM ?? undefined]));
      const g = focusGraph(t, links, names).filter((n) => !args.relation || n.relation === args.relation);
      const lines = g.slice(0, 60).map((n) => {
        const l = n.links[0] as RiskLink;
        const d = linkDollars(l, revenue);
        return `${n.relation.toUpperCase()} ${n.name}${n.ticker ? ` (${n.ticker})` : ""}: ${l.detail}${l.share_pct != null ? ` | share ${l.share_pct}%` : ""}${d != null ? ` | ≈$${(d / 1e6).toFixed(0)}M` : ""}${l.single_source ? " | SINGLE SOURCE" : ""}${l.regions?.length ? ` | regions ${l.regions.join(", ")}` : ""}${l.risk ? ` | risk: ${l.risk}` : ""} | per ${l.ticker} ${l.form} ${l.accn}: "${l.quote}"`;
      });
      return { output: clip(lines.join("\n") || `No named links for ${t}.`), summary: `${g.length} links for ${t}`, refs: g.slice(0, 5).map((n) => ({ ticker: n.links[0].ticker, accn: n.links[0].accn, label: n.name })) };
    }
    case "simulate_supply_shock": {
      const t = String(args.ticker).toUpperCase();
      const shock = Math.max(1, Math.min(100, Number(args.shock_pct) || 20)) / 100;
      const [links, u] = await Promise.all([qc.fetchQuery(supplyLinksQuery), qc.fetchQuery(universeQuery)]);
      const names = Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName]));
      const revenue = Object.fromEntries(u.companies.map((c) => [c.ticker, c.revenueTTM ?? undefined]));
      const r = simulateShock(t, shock, links, names, revenue);
      const lines = r.slice(0, 30).map((i) => `${i.name}${i.ticker ? ` (${i.ticker})` : ""} | ${i.channel} | ${i.severity} | hop ${i.hop}${i.revenuePct != null ? ` | ${(i.revenuePct * 100).toFixed(2)}% of revenue` : ""}${i.dollars != null ? ` ≈$${(i.dollars / 1e6).toFixed(0)}M` : ""} | path ${i.path.join(" → ")} | source ${i.link.ticker} ${i.link.form} ${i.link.accn}`);
      return { output: `Shock: ${names[t] ?? t} −${shock * 100}%. Mechanical estimate from disclosed shares.\n${lines.join("\n") || "No linked companies."}`, summary: `${r.length} companies affected` };
    }
    case "navigate_to": {
      const page = String(args.page);
      const t = typeof args.ticker === "string" ? args.ticker.toUpperCase() : "";
      const mk = PAGE_PATH[page];
      if (!mk) throw new Error(`Unknown page ${page}`);
      if (/^(company|financials|segments|valuation|filings|insiders|calls|ir)$/.test(page) && !coverageOf(t)) throw new Error(`${t || "A ticker"} is required and must be covered`);
      const href = mk(t);
      if (!ctx.navigate) return { output: "Navigation is only available in the side-panel assistant. Give the user this link instead: " + href, summary: href };
      ctx.navigate(href);
      return { output: `Opened ${href} for the user.`, summary: href };
    }
    case "get_page_context": {
      const main = agentRoot();
      const text = (main?.innerText ?? "").replace(/\n{2,}/g, "\n").slice(0, 6000);
      const sections = outline(main);
      return {
        output: `URL: ${location.pathname}${location.search}\nTitle: ${document.title}\nSections (targets for scroll_to/highlight/read_section): ${sections.join(" · ") || "none found"}\nVisible content:\n${text}`,
        summary: location.pathname,
      };
    }
    case "get_coverage": {
      const u = await qc.fetchQuery(universeQuery);
      const lines = u.companies.map(
        (c) =>
          `${c.ticker} ${c.name} | ${c.industry} | FY ends ${c.fiscalYearEnd} | revenue TTM ${fmtVal(c.revenueTTM ?? NaN, "usd")} | net income TTM ${fmtVal(c.netIncomeTTM ?? NaN, "usd")} | FCF TTM ${fmtVal(c.fcfTTM ?? NaN, "usd")} | gross margin TTM ${fmtVal(c.grossMarginTTM ?? NaN, "pct")} | rev growth (latest qtr YoY) ${fmtVal(c.revenueGrowthYoY ?? NaN, "pct")} | last filing ${c.lastFiling?.form} ${c.lastFiling?.filed}`,
      );
      return { output: lines.join("\n"), summary: `${u.companies.length} covered companies` };
    }
    case "get_financials": {
      const d = await dataset(qc, String(args.ticker));
      const freq = args.frequency === "quarterly" ? "quarterly" : "annual";
      const st = d.statements[freq][(args.statement as "income") ?? "income"];
      const n = Math.max(1, Math.min(16, Number(args.periods) || 8));
      const start = Math.max(0, st.periods.length - n);
      const periods = st.periods.slice(start);
      const metrics = (args.metrics as string[] | null)?.map((m) => m.toLowerCase());
      const rows = st.rows.filter((r) => !metrics || metrics.includes(r.key.toLowerCase()) || metrics.includes(r.label.toLowerCase()));
      const accns = new Set<string>();
      const header = `${d.profile.ticker} ${args.statement} (${freq}). Columns: ${periods.map((p) => `${p.label} [${p.start ?? ""}→${p.end}]`).join(", ")}`;
      const body = rows.map((r) => {
        const vals = r.cells.slice(start).map((c) => {
          if (!c) return "—";
          if (c.src) accns.add(c.src.accn);
          return `${fmtVal(c.v, r.unit)}${c.derived ? "*" : ""}`;
        });
        return `${r.label} [${r.key}]: ${vals.join(" | ")}`;
      });
      const filings = d.filings.filter((f) => accns.has(f.accn)).map((f) => `${f.accn} = ${f.form} for period ${f.report} filed ${f.filed}`);
      const out = `${header}\n${body.join("\n")}\n(* = calculated from other reported values)\nSource filings (cite as filing:${d.profile.ticker}:ACCESSION):\n${filings.slice(0, 20).join("\n")}`;
      return {
        output: clip(out),
        summary: `${d.profile.ticker} ${args.statement}, ${periods.length} ${freq} periods`,
        refs: d.filings.filter((f) => accns.has(f.accn)).slice(0, 4).map((f) => ({ ticker: d.profile.ticker, accn: f.accn, label: `${f.form} ${f.report?.slice(0, 7)}` })),
      };
    }
    case "get_segments": {
      const d = await dataset(qc, String(args.ticker));
      const annual = args.frequency !== "quarterly";
      const facts = d.segments.filter((s) => {
        if (!s.start) return false;
        const days = durationDays(s.start, s.end);
        return annual ? days > 350 && days < 380 : days > 80 && days < 100;
      });
      const groups = new Map<string, string[]>();
      const ends = [...new Set(facts.map((f) => f.end))].sort().slice(-6);
      for (const f of facts.filter((x) => ends.includes(x.end))) {
        const k = `${f.axisLabel} · ${f.metric}`;
        const arr = groups.get(k) ?? [];
        arr.push(`${f.label} ${f.start}→${f.end}: ${fmtVal(f.value, "usd")} (filing:${d.profile.ticker}:${f.accn})`);
        groups.set(k, arr);
      }
      const out = [...groups.entries()].map(([k, v]) => `## ${k}\n${[...new Set(v)].join("\n")}`).join("\n\n");
      return { output: clip(out || "No segment facts found."), summary: `${d.profile.ticker} ${annual ? "annual" : "quarterly"} segments` };
    }
    case "list_filings": {
      const d = await dataset(qc, String(args.ticker));
      const forms = (args.forms as string[] | null)?.map((f) => f.toUpperCase());
      const list = d.filings.filter((f) => !forms || forms.includes(f.form.toUpperCase())).slice(0, Math.min(40, Number(args.limit) || 15));
      return {
        output: list.map((f) => `${f.accn} | ${f.form}${f.items ? ` items ${f.items}` : ""} | period ${f.report ?? "—"} | filed ${f.filed} | primary doc ${f.doc}`).join("\n") +
          (d.earningsReleases.length ? `\nEarnings press releases (8-K exhibit 99.1):\n${d.earningsReleases.slice(0, 6).map((r) => `${r.accn} | filed ${r.filed} | document ${r.doc}`).join("\n")}` : ""),
        summary: `${list.length} ${d.profile.ticker} filings`,
      };
    }
    case "read_filing": {
      const d = await dataset(qc, String(args.ticker));
      const accn = String(args.accession);
      const filing = d.filings.find((f) => f.accn === accn);
      const docName = (args.document as string | null) || filing?.doc;
      if (!docName) throw new Error(`Unknown accession ${accn} for ${d.profile.ticker}; call list_filings first.`);
      const res = await getFilingDocument({ data: { cik: String(Number(d.profile.cik)), accn, doc: docName } });
      const text = htmlToText(res.html);
      const q = String(args.query ?? "").trim().toLowerCase();
      const lower = text.toLowerCase();
      const windows: string[] = [];
      let from = 0;
      const terms = q ? [q, ...q.split(/\s+/).filter((w) => w.length > 4)] : [];
      for (const term of terms) {
        from = 0;
        while (windows.length < 6) {
          const i = lower.indexOf(term, from);
          if (i < 0) break;
          windows.push(text.slice(Math.max(0, i - 500), i + 1100));
          from = i + 1600;
        }
        if (windows.length) break;
      }
      const out = `${filing?.form ?? "Filing"} ${accn} (${docName}), filed ${filing?.filed ?? "?"}, ${text.length.toLocaleString()} characters. Cite as filing:${d.profile.ticker}:${accn}${args.document ? `:${docName}` : ""}\n\n${
        windows.length ? windows.map((w, i) => `--- passage ${i + 1} ---\n${w}`).join("\n\n") : `No match for "${q}". Opening text:\n${text.slice(0, 5000)}`
      }`;
      return {
        output: clip(out),
        summary: `${d.profile.ticker} ${filing?.form ?? ""} — "${q}" (${windows.length} passages)`,
        refs: [{ ticker: d.profile.ticker, accn, doc: args.document ? docName : undefined, label: `${filing?.form ?? "Filing"} ${filing?.filed ?? ""}` }],
      };
    }
    case "search_filings": {
      const t = args.ticker ? coverageOf(String(args.ticker)) : undefined;
      const r = await searchFilings({ data: { q: String(args.query).slice(0, 200), ciks: t ? [t.cik] : undefined } });
      return {
        output: `${r.total} documents match.\n` + r.hits.map((h) => `${h.company} | ${h.form} | filed ${h.filed} | accession ${h.accn} | doc ${h.doc} | ${h.description ?? ""}`).join("\n"),
        summary: `"${args.query}" — ${r.total.toLocaleString()} hits`,
      };
    }
    case "get_price_history": {
      const sym = String(args.symbol).toUpperCase();
      const p = await qc.fetchQuery(pricesQuery(sym, (args.range as Range) ?? "1y", "1d"));
      const c = p.bars.map((b) => b[5]);
      if (c.length < 5) throw new Error(`No price history for ${sym}`);
      const s50 = sma(c, 50).at(-1);
      const s200 = sma(c, 200).at(-1);
      const monthly: string[] = [];
      let lastMonth = "";
      for (const b of p.bars) {
        const m = b[0].slice(0, 7);
        if (m !== lastMonth) {
          monthly.push(`${b[0]}: ${b[4].toFixed(2)}`);
          lastMonth = m;
        }
      }
      const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
      const out = `${sym} (${p.source === "yahoo-live" ? "live Yahoo Finance" : "snapshot"}), ${p.bars[0][0]} → ${p.bars.at(-1)![0]}. Last close ${p.bars.at(-1)![4].toFixed(2)}.
Returns: 1M ${pct(pctChangeOver(c, 21))}, 3M ${pct(pctChangeOver(c, 63))}, 6M ${pct(pctChangeOver(c, 126))}, period ${pct(c.at(-1)! / c[0] - 1)}.
Annualized volatility ${pct(annualizedVol(returns(c)))}, max drawdown ${pct(maxDrawdown(c))}. 50-day SMA ${s50?.toFixed(2) ?? "n/a"}, 200-day SMA ${s200?.toFixed(2) ?? "n/a"}.
High ${Math.max(...p.bars.map((b) => b[2])).toFixed(2)}, low ${Math.min(...p.bars.map((b) => b[3])).toFixed(2)}.
Month-start closes:\n${monthly.join("\n")}`;
      return { output: clip(out), summary: `${sym} ${args.range} price history` };
    }
    case "get_quotes": {
      const syms = (args.symbols as string[]).slice(0, 10).map((s) => s.toUpperCase());
      const r = await qc.fetchQuery(quotesQuery(syms));
      return {
        output: r.quotes.map((q) => `${q.symbol}: ${q.price.toFixed(2)} (${(q.changePct * 100).toFixed(2)}% today) as of ${q.marketTime ?? "n/a"}`).join("\n"),
        summary: syms.join(", "),
      };
    }
    case "get_insider_trades": {
      const d = await dataset(qc, String(args.ticker));
      const list = d.insiders.filter((t) => !args.open_market_only || t.code === "P" || t.code === "S").slice(0, Math.min(40, Number(args.limit) || 20));
      return {
        output: list
          .map((t) => `${t.date} | ${t.owner} (${t.role}) | code ${t.code} | ${t.acquired ? "+" : "-"}${t.shares.toLocaleString()} sh @ ${t.price ?? "n/a"} | owned after ${t.ownedAfter?.toLocaleString() ?? "n/a"} | ${t.plan10b5 ? "10b5-1 plan" : ""} | filing:${d.profile.ticker}:${t.accn}`)
          .join("\n"),
        summary: `${list.length} ${d.profile.ticker} insider transactions`,
      };
    }
    case "get_macro": {
      const id = String(args.series_id).toUpperCase();
      const def = MACRO_SERIES.find((m) => m.id === id) ?? { id, title: id, units: "", frequency: "" };
      const years = Math.max(1, Math.min(30, Number(args.years) || 5));
      const since = new Date(Date.now() - years * 365.25 * 86400000).toISOString().slice(0, 10);
      const s = await qc.fetchQuery(macroQuery({ ...def, since }));
      const obs = s.observations;
      const step = Math.max(1, Math.floor(obs.length / 60));
      const sampled = obs.filter((_, i) => i % step === 0 || i === obs.length - 1);
      return {
        output: clip(`${s.title || id} (${s.units}, ${s.frequency}). Source: https://fred.stlouisfed.org/series/${id}\nLatest ${obs.at(-1)?.[0]}: ${obs.at(-1)?.[1]}\n${sampled.map(([d, v]) => `${d}: ${v}`).join("\n")}`),
        summary: `${id}, ${years}y`,
      };
    }
    case "get_news": {
      const r = await qc.fetchQuery(newsQuery(String(args.query).slice(0, 60))).catch(() => null);
      if (!r || !r.items.length)
        return {
          output: "The headline feed is unavailable or returned nothing right now. Use web_search for recent news coverage instead.",
          summary: `No feed headlines for "${args.query}" — switching to web search`,
        };
      return {
        output: r.items.map((n) => `${n.publishedAt.slice(0, 10)} | ${n.publisher} | ${n.title} | ${n.link}`).join("\n"),
        summary: `${r.items.length} headlines for "${args.query}"`,
      };
    }
    case "web_research": {
      const r = await webSearch({
        data: {
          query: String(args.query).slice(0, 400),
          topic: (args.topic as "general" | "news" | "finance") ?? "general",
          days: typeof args.days === "number" ? Math.min(365, Math.max(1, args.days)) : undefined,
          maxResults: 8,
        },
      });
      if (!r.results.length) return { output: `No web results${"error" in r && r.error ? ` (${r.error})` : ""}. Try web_search.`, summary: `No results for "${args.query}"` };
      return {
        output: clip(r.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}${x.publishedAt ? ` · ${x.publishedAt}` : ""}\n${x.content}`).join("\n\n")),
        summary: `${r.results.length} web results for "${args.query}"`,
      };
    }
    case "get_earnings_call": {
      const t = String(args.ticker).toUpperCase();
      if (!coverageOf(t)) return { output: `${t} is not in coverage; use web_research for its transcript.`, summary: `${t} not covered` };
      const list = await qc.fetchQuery({ queryKey: ["earnings-calls", t], queryFn: () => listEarningsCalls({ data: { ticker: t } }), staleTime: 6 * 3600_000 });
      if (!list.calls.length) return { output: `No transcripts found for ${t}${list.error ? ` (${list.error})` : ""}. Try web_research.`, summary: `No transcripts for ${t}` };
      const want = typeof args.quarter === "string" ? args.quarter.trim().toUpperCase().replace(/\s+/g, " ") : "";
      const call = (want && list.calls.find((c) => (c.quarter ?? "").toUpperCase() === want)) || list.calls[0];
      const r = await qc.fetchQuery({ queryKey: ["transcript", call.url], queryFn: () => getEarningsTranscript({ data: { ticker: t, url: call.url } }), staleTime: Infinity });
      const tr = r.transcript;
      if (!tr) return { output: `Couldn't read the ${call.quarter ?? ""} transcript (${r.error ?? "unknown error"}). Source: ${call.url}`, summary: "Couldn't read transcript" };
      const who = new Map(tr.speakers.map((sp) => [sp.name, sp.kind === "analyst" ? `${sp.firm ?? "analyst"}` : (sp.role ?? sp.kind)]));
      const section = args.section === "prepared" || args.section === "qa" ? args.section : "all";
      const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      let turns = tr.turns.filter((x) => x.kind !== "operator" && (section === "all" || x.section === section));
      if (q) {
        const words = q.split(/\s+/).filter((w) => w.length > 2);
        turns = turns.filter((x) => {
          const l = x.text.toLowerCase();
          return l.includes(q) || (words.length > 1 && words.every((w) => l.includes(w)));
        });
      }
      const head = [
        `${tr.title} — ${tr.date ?? ""} — ${tr.url}`,
        `Speakers: ${tr.speakers.filter((s) => s.kind !== "operator").map((s) => `${s.name} (${who.get(s.name)})`).join("; ")}`,
        `Other quarters available: ${list.calls.filter((c) => c.url !== call.url).map((c) => c.quarter ?? c.date).join(", ")}`,
        q ? `${turns.length} turns mention "${q}"${section !== "all" ? ` in ${section}` : ""}:` : `${section === "all" ? "Transcript" : section === "qa" ? "Q&A" : "Prepared remarks"}:`,
      ].join("\n");
      const body = turns.map((x) => `[${x.section === "qa" ? "Q&A" : "Remarks"}] ${x.speaker} (${who.get(x.speaker)}): ${x.text}`).join("\n\n");
      return { output: clip(`${head}\n\n${body || "(no matching turns)"}`), summary: `${tr.title}${q ? ` · "${q}"` : ""}` };
    }
    case "read_webpage": {
      const r = await readWebpage({ data: { url: String(args.url) } });
      if (!r.markdown) return { output: `Couldn't read ${args.url}${"error" in r && r.error ? `: ${r.error}` : ""}.`, summary: `Couldn't read page` };
      let text = r.markdown;
      const q = typeof args.query === "string" ? args.query.trim() : "";
      if (q) {
        const lower = text.toLowerCase();
        const hits: string[] = [];
        let i = lower.indexOf(q.toLowerCase());
        while (i >= 0 && hits.length < 6) {
          hits.push(text.slice(Math.max(0, i - 900), i + 1500));
          i = lower.indexOf(q.toLowerCase(), i + 1500);
        }
        if (hits.length) text = hits.join("\n…\n");
      }
      let host = String(args.url);
      try { host = new URL(host).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
      return { output: clip(`${"title" in r && r.title ? r.title : ""} — ${r.url}\n\n${text}`), summary: `Read ${host}` };
    }
    case "web_map": {
      const r = await mapSite({ data: { url: String(args.url), search: typeof args.search === "string" && args.search ? args.search : undefined, limit: 120 } });
      if (!r.links.length) return { output: `No URLs found${"error" in r && r.error ? ` (${r.error})` : ""}.`, summary: "No URLs found" };
      return { output: clip(r.links.join("\n")), summary: `${r.links.length} URLs on ${hostOf(String(args.url))}` };
    }
    case "web_crawl": {
      const inc = Array.isArray(args.include_paths) ? (args.include_paths as string[]) : undefined;
      const r = await crawlSite({ data: { url: String(args.url), limit: Math.max(1, Math.min(25, Number(args.limit) || 8)), includePaths: inc } });
      if (!r.pages.length) return { output: `Crawl ${r.status}${"error" in r && r.error ? `: ${r.error}` : ""}; no pages.`, summary: "Crawl returned nothing" };
      const per = Math.floor(MAX * 2 / r.pages.length);
      return { output: r.pages.map((p) => `## ${p.title ?? ""} — ${p.url}\n${p.markdown.slice(0, per)}`).join("\n\n").slice(0, MAX * 2), summary: `${r.pages.length} pages from ${hostOf(String(args.url))}${r.status !== "completed" ? " (partial)" : ""}` };
    }
    case "web_extract": {
      const r = await extractFromPage({ data: { url: String(args.url), prompt: String(args.prompt) } });
      if (!r.json) return { output: `Extraction failed${"error" in r && r.error ? `: ${r.error}` : ""}.`, summary: "Extraction failed" };
      return { output: clip(`Source: ${r.url}\n${r.json}`), summary: `Extracted from ${hostOf(r.url)}` };
    }
    case "fetch_url": {
      const r = await fetchUrl({ data: { url: String(args.url) } });
      if ("error" in r && r.error) return { output: `Fetch failed: ${r.error}`, summary: "Fetch failed" };
      return { output: clip(`HTTP ${r.status} ${r.contentType} — ${r.url}\n${r.body}`), summary: `HTTP ${r.status} · ${hostOf(r.url)}` };
    }
    case "scroll_to":
    case "highlight":
    case "read_section": {
      const target = String(args.target ?? "");
      const hit = locate(target, (args.kind as LocateKind) ?? "auto");
      if (!hit) throw new Error(`Nothing matching "${target}" on this page. Sections here: ${outline().slice(0, 25).join(" · ") || "none"}`);
      const region = regionOf(hit.el);
      const moved = name === "read_section" ? null : await bringIntoView(name === "highlight" ? hit.el : region);
      const note = moved ? ` (${moved})` : "";
      if (name === "scroll_to") return { output: `Scrolled to "${hit.label}" (${hit.how} match), clear of the assistant panel${note}.`, summary: hit.label };
      if (name === "highlight") {
        const label = String(args.label ?? hit.label);
        highlight(hit.how === "text" ? hit.el : region, label);
        return { output: `Highlighted "${hit.label}" for the user${note}.`, summary: label };
      }
      const text = readRegion(hit.el, 8000);
      return { output: `Section "${hit.label}":\n${text || "(no text)"}`, summary: hit.label };
    }
    case "click": {
      const target = String(args.target ?? "");
      const hit = locate(target, "auto");
      if (!hit) throw new Error(`No control labelled "${target}" on this page`);
      const r = safeClick(hit.el);
      if (!r.ok) throw new Error(`Not pressed: ${r.reason}`);
      await new Promise((res) => setTimeout(res, 350));
      return { output: `Pressed "${r.label || hit.label}". Call read_section or get_page_context to see the result.`, summary: r.label || hit.label };
    }
    case "show_canvas": {
      const tab = (args.tab as "views" | "browser" | "files") ?? "views";
      if (args.open === false) canvas.hide();
      else canvas.show(tab);
      return { output: args.open === false ? "Canvas closed." : `Canvas open on ${tab}.`, summary: args.open === false ? "closed" : tab };
    }
    case "render_view": {
      let raw: unknown = args.spec;
      canvas.setBuilding(viewLabel(raw).title || "Building view");
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch (e) {
          canvas.setBuilding(null);
          throw new Error(`spec is not valid JSON: ${(e as Error).message}. Send the spec as one JSON object string.`);
        }
      }
      // One automatic repair pass (numeric strings, missing x/series, type aliases); else a short fix hint.
      const r = parseOrRepair(raw);
      if (!r.ok) canvas.setBuilding(null);
      if (!r.ok) throw new Error(`View rejected: ${r.error}.${r.hint ? ` Fix: ${r.hint}` : ""}`);
      if (r.spec.type === "file" && !canvas.file(r.spec.fileId)) canvas.setBuilding(null);
      if (r.spec.type === "file" && !canvas.file(r.spec.fileId)) throw new Error(`No file with id ${r.spec.fileId}; create_file returns the id`);
      const v = canvas.addView(r.spec);
      canvas.setBuilding(null);
      // Self-check: wait for the canvas to draw it, then look for problems a reader would notice.
      const drawn = await canvas.waitRender(v.id, JSON.stringify(r.spec).includes('"mermaid"') ? 4000 : 1200);
      const problems = [...(drawn && !drawn.ok ? [`render failed: ${drawn.error}`] : []), ...checkView(r.spec)];
      if (drawn && !drawn.ok) canvas.removeView(v.id);
      const notes = [
        r.repaired?.length ? `Auto-fixed: ${r.repaired.join("; ")}.` : "",
        problems.length ? `Self-check found: ${problems.join("; ")}. ${drawn && !drawn.ok ? "The view was removed; send a corrected spec." : "Consider re-rendering a corrected view."}` : "Self-check passed.",
      ].filter(Boolean);
      return { output: `${drawn && !drawn.ok ? "View failed to render" : `Rendered ${r.spec.type} view "${r.spec.title ?? r.spec.type}" (${v.id}) in the canvas`}. ${notes.join(" ")}`, summary: r.spec.title ?? r.spec.type };
    }
    case "create_file": {
      const built = await buildFile({
        format: String(args.format) as FileFormat,
        name: String(args.name ?? "file"),
        columns: (args.columns as string[] | null) ?? null,
        rows: (args.rows as Cell[][] | null) ?? null,
        content: (args.content as string | null) ?? null,
      });
      const f = canvas.addFile({ name: built.name, mime: built.mime, size: built.size, url: URL.createObjectURL(built.blob), source: "assistant", preview: built.preview });
      canvas.show("files");
      return {
        output: `Created ${f.name} (${fmtBytes(f.size)}), file id ${f.id}. The user can download it from the canvas; render_view {"type":"file","fileId":"${f.id}"} shows it in a dashboard.`,
        summary: `${f.name} · ${fmtBytes(f.size)}`,
      };
    }
    case "browser_task": {
      const tasks = ((args.tasks as { goal: string; start_url: string | null; screenshot?: boolean }[]) ?? []).slice(0, 4);
      if (!tasks.length) throw new Error("Give at least one task");
      const r = await browserStart({
        data: { tasks: tasks.map((t) => ({ goal: t.goal, start_url: t.start_url || null, screenshot: !!t.screenshot })), mode: args.mode === "thorough" ? "thorough" : "fast" },
      });
      const ok = r.runs.filter((x) => x.id);
      const failed = r.runs.filter((x) => !x.id);
      if (!ok.length) throw new Error(failed[0]?.error ?? "Browser Use did not start");
      canvas.upsertRuns(ok.map((x) => ({ id: x.id, token: x.token, goal: x.goal, status: x.status, done: false, startedAt: Date.now() })));
      canvas.show("browser");
      return {
        output: `Started ${ok.length} browser task(s): ${ok.map((x) => `${x.id} (${x.goal.slice(0, 60)})`).join("; ")}${failed.length ? `. Failed to start: ${failed.map((f) => f.error).join("; ")}` : ""}. Poll browser_status with these ids.`,
        summary: `${ok.length} browser${ok.length === 1 ? "" : "s"} live`,
      };
    }
    case "browser_status": {
      const ids = ((args.task_ids as string[]) ?? []).slice(0, 6);
      const handles = ids.map((id) => canvas.run(id)).filter((r): r is NonNullable<typeof r> => !!r && !!r.token);
      if (!handles.length) throw new Error("Unknown task ids; use the ids browser_task returned");
      const sig = (r: { status: string; steps?: unknown[] }) => `${r.status}:${r.steps?.length ?? 0}`;
      const before = new Map(handles.map((h) => [h.id, sig(h)]));
      const deadline = Date.now() + 25_000;
      let runs: BrowserRunInfo[] = [];
      for (;;) {
        runs = (await browserStatus({ data: { runs: handles.map((h) => ({ id: h.id, token: h.token })) } })).runs as BrowserRunInfo[];
        canvas.upsertRuns(runs);
        const changed = runs.some((r) => r.done || before.get(r.id) !== sig(r));
        if (changed || Date.now() > deadline) break;
        await new Promise((res) => setTimeout(res, 4000));
      }
      const lines = runs.map((r) => {
        const last = (r.steps ?? []).slice(-4).map((s) => `  · ${s.tool}: ${s.input.replace(/\s+/g, " ").slice(0, 120)}${s.output ? ` → ${s.output.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
        return [
          `${r.id}: ${r.status}${r.done ? " (done)" : ""}${r.currentUrl ? ` · at ${r.currentUrl}` : ""}${r.pageTitle ? ` (${r.pageTitle})` : ""}`,
          ...last,
          r.texts?.length ? `  text: ${r.texts[r.texts.length - 1].slice(0, 1500)}` : "",
          r.result ? `  RESULT: ${r.result.slice(0, 4000)}` : "",
          r.error ? `  ERROR: ${r.error}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      });
      const done = runs.filter((r) => r.done).length;
      return { output: clip(lines.join("\n\n")), summary: `${done}/${runs.length} done` };
    }
    case "browser_files": {
      const h = canvas.run(String(args.task_id ?? ""));
      if (!h?.token) throw new Error("Unknown task id");
      const { files } = await browserFiles({ data: { id: h.id, token: h.token } });
      const added: string[] = [];
      const inline: string[] = [];
      for (const f of files) {
        if (!f.url && !f.data) continue;
        const mime = mimeOf(f.name);
        let preview: string | undefined;
        let url = f.url ?? "";
        // Small files arrive inline (presigned URLs expire within a minute); keep a local copy.
        if (f.data) {
          const bin = atob(f.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          if (mime.startsWith("text/") || mime === "application/json") {
            preview = new TextDecoder().decode(bytes.subarray(0, 16000)).slice(0, 4000);
            inline.push(`--- ${f.name} ---\n${preview}`);
          }
        }
        const cf = canvas.addFile({ name: f.name, mime, size: f.size, url, source: "browser", preview });
        added.push(`${cf.name} (${fmtBytes(cf.size)}, id ${cf.id})`);
        if (mime.startsWith("image/")) canvas.addView({ type: "file", title: f.name, fileId: cf.id });
      }
      if (added.length) canvas.show("files");
      return {
        output: added.length ? `Added ${added.length} file(s) to the canvas: ${added.join("; ")}${inline.length ? `\n\n${clip(inline.join("\n\n"))}` : ""}` : "No files saved by this task yet.",
        summary: `${added.length} file${added.length === 1 ? "" : "s"}`,
      };
    }
    case "browser_stop": {
      const h = canvas.run(String(args.task_id ?? ""));
      if (!h?.token) throw new Error("Unknown task id");
      await browserStop({ data: { id: h.id, token: h.token } });
      canvas.upsertRuns([{ id: h.id, status: "cancelled", done: true }]);
      return { output: `Stopped ${h.id}.`, summary: "stopped" };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

interface BrowserRunInfo {
  id: string;
  token: string;
  status: string;
  done: boolean;
  task?: string;
  liveUrl?: string | null;
  currentUrl?: string | null;
  pageTitle?: string | null;
  result?: string | null;
  error?: string | null;
  steps?: { id: number; tool: string; input: string; output: string; status: string }[];
  texts?: string[];
  costUsd?: string | null;
}

function mimeOf(name: string) {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.(md|txt)$/i.test(name)) return "text/plain";
  if (/\.xlsx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

