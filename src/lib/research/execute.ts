// Browser-side executors for the research agent's function tools. Data comes from
// the bundled SEC datasets plus live Yahoo/FRED/EDGAR calls through server functions.
import type { QueryClient } from "@tanstack/react-query";
import { companyQuery, macroQuery, newsQuery, pricesQuery, quotesQuery, universeQuery, type Range } from "@/lib/data";
import { COVERAGE, coverageOf, MACRO_SERIES } from "@/lib/coverage";
import { getFilingDocument, searchFilings } from "@/lib/sec.functions";
import { durationDays } from "@/lib/financials/build";
import type { CompanyDataset, Row } from "@/lib/financials/types";
import { annualizedVol, maxDrawdown, pctChangeOver, returns, sma } from "@/lib/indicators";

const MAX = 9000;
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

export async function runTool(qc: QueryClient, name: string, args: Record<string, unknown>): Promise<ToolRun> {
  switch (name) {
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
      const r = await qc.fetchQuery(newsQuery(String(args.query).slice(0, 60)));
      return {
        output: r.items.map((n) => `${n.publishedAt.slice(0, 10)} | ${n.publisher} | ${n.title} | ${n.link}`).join("\n") || "No headlines.",
        summary: `${r.items.length} headlines for "${args.query}"`,
      };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
