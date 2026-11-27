// Pure: which of a company's stored documents a rebuild loads facts from. A bank stores thousands of files (the
// same supplement as SEC exhibit, IR-site PDF and spreadsheet; decks; page images; decades of releases), and loading
// every fact of them made payloads of 47 MB and rebuilds of 27 GB. The plan keeps what the page shows:
// - the newest 37 months: every document, one copy per document family, decks and page images only for the
//   newest 8 quarters;
// - older, up to 15 years: per calendar quarter of filing only the primary statement documents (the financial
//   supplements when the company files one that quarter, else the earnings releases), one copy each;
// - nothing older than 15 years.
// Copies are documents of one kind, filed within 3 days, under the same title; among them the copy that carries
// figures wins, then the SEC HTML exhibit, an HTML copy, a rendition, anything else. Two documents that only share
// kind and period are two documents (a filing's release and its supplement are often stored under one kind): the
// plan once dropped Citizens' financial supplement as a copy of the release filed with it.
// A document stored without a filing date is never left out for that (two documents in seven have none): it is
// placed by the date or the quarter its `period` names, the quarter moved by the company's own usual distance
// between a quarter's calendar end and the filing (the median over its dated documents, so a fiscal year named a
// year ahead still lands right), with a quarter's margin in its favour at every window; with no usable period it is
// loaded.
// Counts per reason go to stats.quality.plan.

/** A document row as the store keeps it (ir_documents). */
export interface PlanDocRow {
  id: string;
  kind: string | null;
  ext: string | null;
  filed: string | null;
  title: string | null;
  period: string | null;
  source_url: string | null;
  rendition_path?: string | null;
  /** figures the table and slide readers stored from the document */
  extract_facts?: number | null;
  /** figures the text reader stored from the document */
  prose_facts?: number | null;
}

export type PlanSkip = "copy" | "deck" | "older" | "too-old" | "undated";

export interface DocPlan {
  /** documents whose facts are loaded, newest first */
  load: string[];
  counts: {
    stored: number;
    loaded: number;
    left: Partial<Record<PlanSkip, number>>;
    /** documents loaded that carry no filing date (placed by their period, or kept as they could not be placed) */
    undated?: number;
  };
}

/** Months of full history. */
export const PLAN_FULL_MONTHS = 37;
/** Months in which decks and page images are kept. */
export const PLAN_DECK_MONTHS = 24;
/** Years of primary statement history. */
export const PLAN_YEARS = 15;
/** Days apart two copies of one document may be filed. */
const COPY_DAYS = 3;
/** Days of margin, in its favour, for a document placed by its period instead of a filing date. */
export const PLAN_PLACED_DAYS = 92;
/** Days from a quarter's calendar end to the filing when the company's own documents do not tell. */
const DEFAULT_LAG_DAYS = 30;
/** Dated documents with a quarter label needed before their median lag is used. */
const LAG_SAMPLES = 4;

const DAY = 86_400_000;
const time = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const monthsBack = (d: string, n: number) => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, Math.min(day, 28))).toISOString().slice(0, 10);
};
const norm = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\.(pdf|xlsx?|html?)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const isDeck = (r: PlanDocRow) =>
  /presentation|slides|deck/i.test(r.kind ?? "") || /^(png|jpe?g|gif|webp)$/i.test(r.ext ?? "");
/** Preference among copies: SEC HTML exhibit, HTML, rendition, other. */
const rank = (r: PlanDocRow) => {
  const html = /^html?$/i.test(r.ext ?? "");
  if (html && /(^|\/\/)(www\.)?sec\.gov\//i.test(r.source_url ?? "")) return 0;
  if (html) return 1;
  if (r.rendition_path) return 2;
  return 3;
};
const quarterOf = (d: string) =>
  `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const figures = (r: PlanDocRow) => (r.extract_facts ?? 0) + (r.prose_facts ?? 0);
const fullYear = (s: string) =>
  s.length === 4 ? Number(s) : Number(s) >= 70 ? 1900 + Number(s) : 2000 + Number(s);

/**
 * What a stored `period` says about time: the date it holds ("2026-10-16"), or the calendar end of the quarter
 * or year it names ("Q3 FY26", "FY2026"; not yet the fiscal one, see `placedDate`).
 */
export function periodMark(period: string | null): { date: string; exact: boolean } | null {
  const p = (period ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(p) && !Number.isNaN(time(p))) return { date: p, exact: true };
  const q = /^Q([1-4])\s*FY\s*(\d{4}|\d{2})$/i.exec(p);
  if (q) return { date: iso(Date.UTC(fullYear(q[2]), Number(q[1]) * 3, 0)), exact: false };
  const y = /^FY\s*(\d{4}|\d{2})$/i.exec(p);
  if (y) return { date: `${fullYear(y[1])}-12-31`, exact: false };
  return null;
}

/** Days from a quarter label's calendar end to the filing, the median over the company's dated documents. */
export function filingLag(rows: readonly PlanDocRow[]): number {
  const lags: number[] = [];
  for (const r of rows) {
    if (!r.filed) continue;
    const m = /^Q[1-4]/i.test((r.period ?? "").trim()) ? periodMark(r.period) : null;
    if (m && !m.exact) lags.push(Math.round((time(r.filed) - time(m.date)) / DAY));
  }
  if (lags.length < LAG_SAMPLES) return DEFAULT_LAG_DAYS;
  lags.sort((a, b) => a - b);
  return lags[Math.floor((lags.length - 1) / 2)];
}

/** The date an undated document is placed at: its period's date, or its quarter's end moved by the lag. */
function placedDate(r: PlanDocRow, lag: number): string | null {
  const m = periodMark(r.period);
  if (!m) return null;
  return m.exact ? m.date : iso(time(m.date) + lag * DAY);
}

interface Family {
  rows: PlanDocRow[];
  /** latest filing date of its copies, or the date it is placed at; null when it cannot be placed */
  date: string | null;
  /** placed by its period, not by a filing date */
  placed: boolean;
}

/** The copy whose figures are loaded: one that carries figures, then by format, then the newest, then by id. */
const bestOf = (f: Family) =>
  [...f.rows].sort(
    (a, b) =>
      Number(figures(b) > 0) - Number(figures(a) > 0) ||
      rank(a) - rank(b) ||
      (b.filed ?? "").localeCompare(a.filed ?? "") ||
      a.id.localeCompare(b.id),
  )[0];

/** The rebuild's document plan from the company's document rows. */
export function planDocuments(rows: readonly PlanDocRow[]): DocPlan {
  const left: Partial<Record<PlanSkip, number>> = {};
  const skip = (why: PlanSkip, n = 1) => {
    if (n) left[why] = (left[why] ?? 0) + n;
  };
  const dated = rows.filter((r) => r.filed);
  const undated = rows.filter((r) => !r.filed);
  const lag = filingLag(dated);

  // Families of dated documents: same kind, filed within 3 days, same title.
  const families: Family[] = [];
  const open = new Map<string, Family[]>();
  for (const r of [...dated].sort(
    (a, b) => a.filed!.localeCompare(b.filed!) || a.id.localeCompare(b.id),
  )) {
    const kind = r.kind ?? "";
    const list = open.get(kind) ?? [];
    const title = norm(r.title);
    const hit = title
      ? list.find((f) =>
          f.rows.some(
            (x) =>
              Math.abs(time(x.filed!) - time(r.filed!)) <= COPY_DAYS * DAY &&
              norm(x.title) === title,
          ),
        )
      : undefined;
    if (hit) {
      hit.rows.push(r);
      if (r.filed! > hit.date!) hit.date = r.filed!;
    } else {
      const f: Family = { rows: [r], date: r.filed!, placed: false };
      families.push(f);
      list.push(f);
      open.set(kind, list);
    }
  }
  // Supplements by quarter of filing (for the older history's primary documents): filing dates only.
  const supQuarters = new Set(
    families.filter((f) => f.rows[0].kind === "supplement").map((f) => quarterOf(f.date!)),
  );
  // Undated documents: a copy only of a document of the same kind, period and title; else a family of its own.
  const byName = new Map<string, Family>();
  const nameKey = (r: PlanDocRow) =>
    r.period && norm(r.title) ? `${r.kind ?? ""}\u0000${r.period}\u0000${norm(r.title)}` : "";
  for (const f of families) for (const r of f.rows) if (nameKey(r)) byName.set(nameKey(r), f);
  for (const r of [...undated].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = nameKey(r);
    const hit = key ? byName.get(key) : undefined;
    if (hit) {
      hit.rows.push(r);
      continue;
    }
    const f: Family = { rows: [r], date: placedDate(r, lag), placed: true };
    families.push(f);
    if (key) byName.set(key, f);
  }

  // The newest filing date; a company with none is measured from the newest placed date.
  const newest =
    dated.reduce((m, r) => (r.filed! > m ? r.filed! : m), "") ||
    families.reduce((m, f) => (f.date && f.date > m ? f.date : m), "");
  const full = newest ? monthsBack(newest, PLAN_FULL_MONTHS) : "";
  const decks = newest ? monthsBack(newest, PLAN_DECK_MONTHS) : "";
  const oldest = newest ? monthsBack(newest, PLAN_YEARS * 12) : "";

  const load: { id: string; date: string }[] = [];
  let loadedUndated = 0;
  for (const f of families) {
    const best = bestOf(f);
    skip("copy", f.rows.length - 1);
    if (f.date) {
      // A placed date gets a quarter's margin in the document's favour.
      const at = f.placed ? iso(time(f.date) + PLAN_PLACED_DAYS * DAY) : f.date;
      if (at < oldest) {
        skip("too-old");
        continue;
      }
      if (isDeck(best) && at < decks) {
        skip("deck");
        continue;
      }
      if (at < full) {
        // A placed quarter is not exact enough to say which of the two that quarter's primary document is.
        const primary = f.placed
          ? best.kind === "supplement" || best.kind === "press-release"
          : supQuarters.has(quarterOf(f.date))
            ? best.kind === "supplement"
            : best.kind === "press-release";
        if (!primary) {
          skip("older");
          continue;
        }
      }
    }
    if (!best.filed) loadedUndated++;
    load.push({ id: best.id, date: f.date ?? "" });
  }
  load.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    load: load.map((x) => x.id),
    counts: {
      stored: rows.length,
      loaded: load.length,
      left,
      ...(loadedUndated ? { undated: loadedUndated } : {}),
    },
  };
}
