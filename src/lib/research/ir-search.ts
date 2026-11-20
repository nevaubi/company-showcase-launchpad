// The assistant's view of a company's investor-relations series (the same payload the IR page shows):
// a category map, or the series matching a query with every value linked to the page that opens its
// source cell (`/app/companies/T/ir?line=…&period=…&freq=…`). Pure.
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import { CATEGORY_LABEL, METRIC_LABEL, fmtIr } from "@/lib/ir/display";
import { heldFor } from "@/lib/ir/periods";
import { expand, matchScore, words } from "@/lib/research/match";

export type IrFreq = "q" | "y" | "m";
export interface IrSearchArgs {
  ticker: string;
  query?: string | null;
  freq?: IrFreq;
  periods?: number;
  maxItems?: number;
}

const MAX = 9000;
const FREQ_WORD: Record<IrFreq, string> = { q: "quarterly", y: "annual", m: "monthly" };
const cellsOf = (s: PayloadSeries, f: IrFreq): Record<string, PayloadCell> => (f === "q" ? s.q : f === "y" ? s.y : (s.mo ?? {}));

/** Value text the model can quote: dollars in $K/$M/$B, everything else as the IR page prints it. */
export function irValue(v: number, unit: string): string {
  if (unit !== "usd") return fmtIr(v, unit, "M");
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export const irLink = (ticker: string, key: string, period: string, freq: IrFreq) =>
  `/app/companies/${ticker}/ir?line=${encodeURIComponent(key)}&period=${period}&freq=${freq}`;

function cellLine(p: IrPayload, s: PayloadSeries, end: string, c: PayloadCell, freq: IrFreq): string {
  const doc = c.d != null ? p.docs[c.d] : undefined;
  const where = c.p ? ` p.${c.p}` : c.sh ? ` sheet "${c.sh}"` : "";
  const src = c.f
    ? `derived: ${c.f.formula}`
    : `${c.x ? `printed "${c.x.slice(0, 60)}"` : "stored cell"}${where}${doc ? `, ${doc.kind ?? "document"} filed ${doc.filed ?? "?"}` : ""}`;
  return `  ${end}: ${irValue(c.v, s.unit)} — ${src} <${irLink(p.ticker, s.k, end, freq)}>`;
}

/** No query: what exists, so the next call can be precise. */
export function irMap(p: IrPayload): string {
  const st = p.stats;
  const head = `${p.ticker}: ${st.series.toLocaleString("en-US")} investor-relations series from ${st.documents.toLocaleString("en-US")} documents (${st.facts.toLocaleString("en-US")} figures), ${st.firstPeriod ?? "?"} to ${st.lastPeriod ?? "?"}; quarterly breakdowns that add up: ${st.checksQ.ok}/${st.checksQ.total}.`;
  const byCat = new Map<string, string[]>();
  for (const g of p.groups) {
    const labels = g.rows.slice(0, 6).map((r) => p.series.find((s) => s.k === r.k)?.label).filter(Boolean);
    const line = `${METRIC_LABEL[g.met] ?? g.met}${g.bd ? ` (${g.bd})` : ""}: ${g.label} — ${labels.join("; ")}${g.rows.length > 6 ? `; +${g.rows.length - 6} more` : ""}`;
    byCat.set(g.cat, [...(byCat.get(g.cat) ?? []), line]);
  }
  const out = [head, "Groups by dimension:"];
  for (const [cat, lines] of byCat) {
    out.push(`- ${CATEGORY_LABEL[cat] ?? cat} (${lines.length} groups):`);
    for (const l of lines.slice(0, 12)) out.push(`  ${l}`);
    if (lines.length > 12) out.push(`  …${lines.length - 12} more groups`);
  }
  if (p.months?.length) out.push(`Monthly figures exist for ${p.months.length} month-ends (use frequency monthly).`);
  out.push("Call again with a query (e.g. 'net deposits', 'funded customers', 'segment operating income') for the values.");
  const body = out.join("\n");
  return body.length > MAX ? `${body.slice(0, MAX - 40)}\n…[more groups]` : body;
}

/** Series matching the query, newest periods first, each value with its source and an in-app link. */
export function irSearch(p: IrPayload, a: IrSearchArgs): { output: string; matched: number } {
  const query = String(a.query ?? "").trim();
  if (!query) return { output: irMap(p), matched: 0 };
  const periods = Math.max(1, Math.min(a.periods ?? 5, 20));
  const maxItems = Math.max(1, Math.min(a.maxItems ?? 8, 20));
  const variants = expand(query).map(words);
  const phrase = query.toLowerCase();
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const latest = p.quarters.at(-1) ?? "";
  const yearAgo = latest ? `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}` : "";
  const hay = (s: PayloadSeries) => `${s.label} ${s.parent ? (byKey.get(s.parent)?.label ?? "") : ""} ${s.bd ?? ""} ${CATEGORY_LABEL[s.cat] ?? s.cat} ${METRIC_LABEL[s.met] ?? s.met}`;
  const rank = (freq: IrFreq) =>
    p.series
      .map((s) => {
        const ends = Object.keys(cellsOf(s, freq)).sort();
        if (!ends.length) return null;
        const m = Math.max(...variants.map((v, k) => matchScore(hay(s), v) * (k === 0 ? 1.25 : 1)));
        if (m <= 0) return null;
        const score = m + (s.label.toLowerCase().includes(phrase) ? 1 : 0) + (ends.at(-1)! >= yearAgo ? 2 : 0) + (s.total ? 0.2 : 0) - s.label.length / 400;
        return { s, ends, score };
      })
      .filter((x): x is { s: PayloadSeries; ends: string[]; score: number } => !!x)
      .sort((x, y) => y.score - x.score);
  let freq: IrFreq = a.freq ?? "q";
  let hits = rank(freq);
  if (!hits.length && freq === "q") {
    // Some lines are only printed for full years or by month.
    for (const f of ["y", "m"] as const) {
      hits = rank(f);
      if (hits.length) {
        freq = f;
        break;
      }
    }
  }
  if (!hits.length) return { output: `No ${p.ticker} investor-relations series matches "${query}". Call with a null query for the map of what exists.`, matched: 0 };
  const out = [
    `${p.ticker} investor-relations series matching "${query}" (${FREQ_WORD[freq]}, newest first). Each value comes from the company's own document; cite it as a markdown link to the <…> path, which opens that cell in the source.`,
  ];
  let shown = 0;
  for (const { s, ends } of hits.slice(0, maxItems)) {
    const parent = s.parent ? byKey.get(s.parent)?.label : null;
    const block = [
      `${s.label}${parent ? ` (part of ${parent})` : ""} [${CATEGORY_LABEL[s.cat] ?? s.cat} / ${METRIC_LABEL[s.met] ?? s.met}${s.bd ? `; ${s.bd}` : ""}${s.pit ? "; point in time" : ""}${s.total ? "; total" : ""}]`,
      ...ends.slice(-periods).reverse().map((e) => cellLine(p, s, e, cellsOf(s, freq)[e], freq)),
      // Figures held back by the display guard (suspect.ts) are named so they are never cited.
      ...Object.entries(heldFor(s, freq))
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, periods)
        .map(([e, c]) => `  ${e}: held back, do not cite (${c.why ?? "its unit or period is contradicted by the documents"})`),
    ].join("\n");
    if (out.join("\n").length + block.length > MAX) break;
    out.push(block);
    shown++;
  }
  if (hits.length > shown) out.push(`…${hits.length - shown} more matching series; narrow the query.`);
  return { output: out.join("\n"), matched: shown };
}
