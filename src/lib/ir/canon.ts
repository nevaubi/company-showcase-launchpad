// Pure helpers for the cross-document "canonical line" pass. A reasoning model reviews every
// distinct extracted line of a company (across all releases since 2008) and returns how each maps
// onto one consistent hierarchy: renamed lines merge, mis-filed dimensions move, parents are fixed so
// parts add to totals, and duplicates / non-breakdown lines are dropped. It never touches numbers;
// every proposal is re-verified by rebuilding the series and counting reconciliation failures.
import { buildIrSeries, normLabel, rawKey, type IrFact, type LabelMapEntry } from "@/lib/ir/kpis";
import { CATEGORIES, METRICS } from "@/lib/ir/extract-core";

export interface RawLine {
  id: number;
  key: string;
  category: string;
  metric: string;
  unit: string;
  label: string;
  parent: string;
  is_total: boolean;
  breakdowns: string[];
  periods: number;
  first: string;
  last: string;
  /** latest quarterly (or annual) values as printed, newest last: [period end, value] */
  sample: [string, number][];
}

export function rawLines(facts: IrFact[]): RawLine[] {
  const by = new Map<string, IrFact[]>();
  for (const f of facts) {
    const k = rawKey(f);
    by.set(k, [...(by.get(k) ?? []), f]);
  }
  let id = 0;
  return [...by.entries()].map(([key, fs]) => {
    const ends = [...new Set(fs.map((f) => f.period_end))].sort();
    const q = fs.filter((f) => f.months === 3 || f.months === 0);
    const pool = (q.length ? q : fs).sort((a, b) => a.period_end.localeCompare(b.period_end) || (a.filed ?? "").localeCompare(b.filed ?? ""));
    const byEnd = new Map<string, number>();
    for (const f of pool) byEnd.set(f.period_end, f.value);
    const f0 = fs[fs.length - 1];
    return {
      id: id++,
      key,
      category: f0.category,
      metric: f0.metric,
      unit: f0.unit,
      label: f0.label,
      parent: f0.parent ?? "",
      is_total: fs.filter((f) => f.is_total).length * 2 >= fs.length,
      breakdowns: [...new Set(fs.map((f) => f.breakdown).filter(Boolean) as string[])].slice(0, 3),
      periods: ends.length,
      first: ends[0],
      last: ends.at(-1)!,
      sample: [...byEnd.entries()].slice(-4),
    };
  });
}

const fmt = (v: number, unit: string) => (unit === "usd" ? `${+(v / 1e6).toFixed(1)}M` : String(+v.toFixed(2)));

/** Prompt text for one batch of raw lines plus the reconciliation failures they're involved in. */
export function renderLines(lines: RawLine[], failures: string[]): string {
  const rows = lines.map(
    (l) =>
      `#${l.id} [${l.category}/${l.metric}/${l.unit}] "${l.label}" parent="${l.parent}"${l.is_total ? " TOTAL" : ""}${l.breakdowns.length ? ` breakdown="${l.breakdowns.join("; ")}"` : ""} · ${l.periods}p ${l.first}→${l.last} · ${l.sample.map(([e, v]) => `${e}:${fmt(v, l.unit)}`).join(" ")}`,
  );
  return `${rows.join("\n")}${failures.length ? `\n\nRECONCILIATION FAILURES (parts printed in one release vs. the printed total):\n${failures.join("\n")}` : ""}`;
}

export const CANON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "metric", "label", "parent", "is_total", "drop", "reason"],
        properties: {
          id: { type: "integer" },
          category: { type: "string", enum: [...CATEGORIES] },
          metric: { type: "string", enum: [...METRICS] },
          label: { type: "string" },
          parent: { type: "string" },
          is_total: { type: "boolean" },
          drop: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export const CANON_INSTRUCTIONS = `You are a senior equity-research data engineer. You receive every distinct line that was extracted from one company's earnings releases, supplements and presentations across many years, each with its dimension (category/metric/unit), printed label, printed parent total, period coverage and recent values. Your job: map every line onto ONE clean, consistent hierarchy so that, in every period, the parts of each breakdown add up to its total.

Return one entry per input id with the canonical category, metric, label, parent label and is_total, or drop=true.
RULES
- Merge lines that are the same economic item under different wording or formatting (e.g. "Intelligent Cloud — Revenue" and "Intelligent Cloud", "Total net sales" and "Net sales", "Total — Operating income" and "Total operating income"): give them the identical canonical label, category, metric and parent. Prefer the company's most recent printed wording, without prefixes like "Total —" unless the line IS the total ("Total revenue").
- Totals: the top line of each breakdown is is_total=true with parent "". Children carry the canonical label of their total as parent. Subtotals (e.g. "Products" = iPhone + Mac + iPad + Wearables; "Google advertising" = Search + YouTube ads + Network) are is_total=true with their own parent.
- One breakdown per category+metric+total: if a total has two different sets of parts (e.g. revenue by segment AND revenue by product type), put each set in a different category ("segment" vs "product"). Both sets simply name the same total label as parent — the total is shared across categories automatically, so map the total line itself only once.
- Use the values and the RECONCILIATION FAILURES to reason about arithmetic: a child set must sum to its parent. If a line equals the sum of other lines it is a subtotal; if two lines are duplicates of each other only one may be a child of the same total (drop the duplicate).
- Segment structures change over time (new segments, recasts). Do NOT merge different segments just because one replaced the other; renamed-but-identical segments (same business, new name) should be merged.
- drop=true for lines that are not part of a breakdown or KPI series: consolidated statement lines that aren't the total of a breakdown, per-share data, percentages of change, guidance, duplicate copies, and obviously garbled labels.
- Never change units; keep metric consistent within a breakdown. "reason" is a few words (e.g. "rename of #12", "subtotal of Products", "duplicate").`;

/** Turn model output into label-map entries keyed by raw line key. */
export function mapFromModel(lines: RawLine[], out: { lines: { id: number; category: string; metric: string; label: string; parent: string; is_total: boolean; drop: boolean }[] }) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const map: Record<string, LabelMapEntry> = {};
  for (const o of out.lines) {
    const l = byId.get(o.id);
    if (!l || !o.label.trim()) continue;
    map[l.key] = { category: o.category, metric: o.metric, label: o.label.trim(), parent: o.parent.trim() || null, is_total: o.is_total, ...(o.drop ? { drop: true } : {}) };
  }
  return map;
}

/** Failure descriptions for the prompt, per period, with the printed parts. */
export function failureNotes(facts: IrFact[], map?: Record<string, LabelMapEntry>, limit = 60): { notes: string[]; failed: number; total: number } {
  const { series, checks } = buildIrSeries(facts, { labelMap: map });
  const bad = checks.filter((c) => !c.ok);
  const notes: string[] = [];
  const byKey = new Map(series.map((s) => [s.key, s]));
  for (const c of bad.slice(0, limit)) {
    const tot = byKey.get(c.totalKey);
    if (!tot) continue;
    const kids = series.filter((s) => s.parent && normLabel(s.parent) === normLabel(tot.label) && s.category === tot.category && s.metric === tot.metric);
    const cells = c.kind === "q" ? (s: typeof tot) => s.cells : (s: typeof tot) => s.annual;
    const parts = kids.filter((k) => cells(k)[c.period]).map((k) => `"${k.label}" ${fmt(cells(k)[c.period].v, k.unit)}`);
    notes.push(`[${tot.category}/${tot.metric}] "${tot.label}" ${c.kind === "q" ? "quarter" : "year"} ending ${c.period}: total ${fmt(c.total, tot.unit)} vs parts sum ${fmt(c.sum, tot.unit)} — parts: ${parts.join(", ")}`);
  }
  return { notes, failed: bad.length, total: checks.length };
}
