// Cross-company filings feed: the largest disclosure changes in recent 10-K/10-Q filings (redlines/index.json,
// deterministic paragraph alignment against the same filing a year earlier) and, where the filing-insights loop has
// run, its top verified insights per company (insights/index.json).
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export interface RedlineHighlight {
  kind: "annual" | "quarterly";
  form: string;
  filed: string;
  section: string;
  section_id: string;
  change: "added" | "removed" | "modified";
  score: number;
  signals: string[];
  excerpt: string;
  ticker: string;
  name: string;
  /** Present once the index was rebuilt with the filing reference; otherwise resolved from redlines/{T}.json */
  accn?: string;
  doc?: string;
  doc_filed?: string;
  search?: string;
}
export interface RedlineCompany {
  ticker: string;
  name: string;
  generated: string;
  comparisons: {
    kind: string;
    form: string;
    filed: string;
    old_filed: string;
    language_changes: number;
    numbers: number;
    signals: string[];
    top_sections: string[];
  }[];
}
export interface RedlineIndex {
  generated: string;
  count: number;
  recent: RedlineHighlight[];
  companies: Record<string, RedlineCompany>;
}
export interface InsightIndexRow {
  ticker: string;
  name: string | null;
  form: string;
  filed: string;
  accn: string;
  doc: string;
  generated: string;
  n: number;
  top: {
    title: string;
    type: string;
    direction: string;
    score: number;
    quote: string;
    doc: "new" | "old";
  }[];
}
export interface InsightIndex {
  generated: string;
  count: number;
  companies: Record<string, InsightIndexRow>;
}
interface RedlineDoc {
  comparisons: {
    kind: string;
    new: { accn: string; doc: string; filed: string };
    old: { accn: string; doc: string; filed: string };
  }[];
}

const opts = { staleTime: 15 * 60_000, retry: 0 } as const;
export const redlineIndexQuery = queryOptions({
  queryKey: ["filings", "redlines"],
  queryFn: () => partnerFile<RedlineIndex>("redlines/index.json"),
  ...opts,
});
export const insightIndexQuery = queryOptions({
  queryKey: ["filings", "insights"],
  queryFn: () => partnerFile<InsightIndex>("insights/index.json"),
  ...opts,
});
export const redlineDoc = (t: string) => partnerFile<RedlineDoc>(`redlines/${t}.json`);

export interface FeedFilter {
  form: "all" | "10-K" | "10-Q";
  sector: string;
  signal: string;
  days: number;
  q: string;
}

/** Highlights that pass the filters, newest first, then by change score. */
export function filterHighlights(
  rows: RedlineHighlight[],
  f: FeedFilter,
  sectorOf: (t: string) => string | undefined,
  today: string,
): RedlineHighlight[] {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - f.days);
  const from = since.toISOString().slice(0, 10);
  const q = f.q.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        r.filed >= from &&
        (f.form === "all" || r.form === f.form) &&
        (f.sector === "all" || sectorOf(r.ticker) === f.sector) &&
        (f.signal === "all" || r.signals.includes(f.signal)) &&
        (!q ||
          r.ticker.toLowerCase() === q ||
          r.name.toLowerCase().includes(q) ||
          r.excerpt.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.filed.localeCompare(a.filed) || b.score - a.score);
}

/** First words of a passage, used as the viewer's in-document search. */
export const searchPhrase = (s: string, n = 12) =>
  s.replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");

/** The filing that holds a highlight's passage: the new filing, or the prior-year filing for a removed passage. */
export function resolveDoc(h: RedlineHighlight, doc: RedlineDoc | null) {
  if (h.accn && h.doc) return { accn: h.accn, doc: h.doc, filed: h.doc_filed ?? h.filed };
  const c = doc?.comparisons.find((x) => x.kind === h.kind && x.new.filed === h.filed);
  if (!c) return null;
  const side = h.change === "removed" ? c.old : c.new;
  return { accn: side.accn, doc: side.doc, filed: side.filed };
}
