// Plain-text rendering of filing detail for the research assistant (pure).
import { detailPeriodLabel, detailUnit, type DetailTable, type FilingDetail, type StoredDetail } from "@/lib/xbrl/detail";
import { annualWithHistory, periodSources } from "@/lib/xbrl/history";

export const DETAIL_SECTIONS = ["revenue", "segments", "concentration", "geography", "costs", "commitments", "inventory", "other"] as const;
export type DetailSection = (typeof DETAIL_SECTIONS)[number];

const fmt = (v: number, unit: string) => {
  const u = detailUnit(unit);
  if (u === "pct") return `${(v * 100).toFixed(1)}%`;
  if (u === "usd") {
    const a = Math.abs(v);
    const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a).toLocaleString()}`;
    return v < 0 ? `-${s}` : s;
  }
  return Math.round(v * 100) / 100 + (u === "count" ? ` ${unit.replace(/^.*:/, "").toLowerCase()}` : "");
};

function tableText(t: DetailTable, d: FilingDetail): string[] {
  const head = t.periods.map((k) => detailPeriodLabel(d.periods[k])).join(" | ");
  const line = (label: string, values: Record<string, { v: number }>, indent = "") => `${indent}${label}: ${t.periods.map((k) => (values[k] ? fmt(values[k].v, t.unit) : "—")).join(" | ")}`;
  const out = [`### ${t.title} [${head}]`];
  for (const r of t.rows) {
    if (Object.keys(r.values).length) out.push(line(r.label, r.values));
    else out.push(`${r.label}:`);
    for (const s of r.sub ?? []) out.push(line(s.label, s.values, "  "));
  }
  if (t.total) out.push(line("Consolidated total", t.total));
  return out;
}

/** One filing's detail as text, optionally one section, with the citation to use. */
export function detailText(stored: StoredDetail, opts: { section?: DetailSection | null; quarterly?: boolean; maxChars?: number }): string {
  // Annual detail spans the latest 10-K plus the stored earlier 10-Ks (about seven fiscal years).
  const d = (opts.quarterly ? stored.quarterly : annualWithHistory(stored)) ?? annualWithHistory(stored) ?? stored.quarterly;
  if (!d) return `No 10-K or 10-Q detail stored for ${stored.ticker}.`;
  const cite = `filing:${stored.ticker}:${d.accn}:${d.doc}`;
  const sources = d === stored.annual || d === stored.quarterly ? [] : periodSources(d);
  const out = [
    sources.length > 1
      ? `${stored.ticker} ${d.form} for the period ended ${d.reportDate} (filed ${d.filed}) with earlier years from prior 10-Ks. Each column comes from the newest filing that reports it; cite ${sources
          .map((x) => `${[...new Set(x.keys.map((k) => detailPeriodLabel(d.periods[k])).filter((l) => /^FY/.test(l)))].sort().join("/") || "balances"} as filing:${stored.ticker}:${x.accn}:${x.doc}`)
          .join("; ")}.`
      : `${stored.ticker} ${d.form} for the period ended ${d.reportDate} (filed ${d.filed}). Cite values as ${cite}.`,
  ];
  const want = (s: DetailSection) => !opts.section || opts.section === s;
  if (want("segments") && d.segments) {
    const m = d.segments;
    const k = m.periods[m.periods.length - 1];
    out.push(`### Segment P&L ${detailPeriodLabel(d.periods[k])} [${m.segments.map((s) => s.label).join(" | ")}]`);
    for (const r of m.rows) out.push(`${r.label}: ${m.segments.map((s) => (r.values[s.member]?.[k] ? fmt(r.values[s.member][k].v, "USD") : "—")).join(" | ")}`);
  }
  if (want("concentration") && d.concentration.length) {
    out.push("### Concentration (share of the benchmark)");
    for (const r of d.concentration)
      out.push(`${r.kind} · ${r.benchmark === "other" ? r.benchmarkLabel || "share" : `share of ${r.benchmark}`} · ${r.label}: ${Object.entries(r.values).sort(([a], [b]) => (d.periods[a]?.end ?? "").localeCompare(d.periods[b]?.end ?? "")).map(([k, v]) => `${detailPeriodLabel(d.periods[k])} ${fmt(v.v, "pure")}`).join(", ")}`);
  }
  for (const t of d.tables) if (want(t.family as DetailSection)) out.push(...tableText(t, d));
  const text = out.join("\n");
  const max = opts.maxChars ?? 14_000;
  return text.length > max ? `${text.slice(0, max)}\n… (truncated; ask for one section)` : text;
}
