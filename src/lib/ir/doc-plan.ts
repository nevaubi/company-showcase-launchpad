// Pure: which of a company's stored documents a rebuild loads facts from. A bank stores thousands of files (the
// same supplement as SEC exhibit, IR-site PDF and spreadsheet; decks; page images; decades of releases), and loading
// every fact of them made payloads of 47 MB and rebuilds of 27 GB. The plan keeps what the page shows:
// - the newest 37 months: every document, one copy per document family (the same exhibit stored twice or in
//   several formats: filed within 3 days, same kind, same title or period), the SEC HTML exhibit first, then an
//   HTML copy, then a rendition, then anything else; decks and page images only for the newest 8 quarters;
// - older, up to 15 years: per calendar quarter of filing only the primary statement documents (the financial
//   supplements when the company files one that quarter, else the earnings releases), one copy each;
// - nothing older than 15 years.
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
}

export type PlanSkip = "copy" | "deck" | "older" | "too-old" | "undated";

export interface DocPlan {
  /** documents whose facts are loaded, newest first */
  load: string[];
  counts: { stored: number; loaded: number; left: Partial<Record<PlanSkip, number>> };
}

/** Months of full history. */
export const PLAN_FULL_MONTHS = 37;
/** Months in which decks and page images are kept. */
export const PLAN_DECK_MONTHS = 24;
/** Years of primary statement history. */
export const PLAN_YEARS = 15;
/** Days apart two copies of one document may be filed. */
const COPY_DAYS = 3;

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

/** The rebuild's document plan from the company's document rows. */
export function planDocuments(rows: readonly PlanDocRow[]): DocPlan {
  const left: Partial<Record<PlanSkip, number>> = {};
  const skip = (why: PlanSkip, n = 1) => {
    if (n) left[why] = (left[why] ?? 0) + n;
  };
  const dated = rows.filter((r) => r.filed);
  skip("undated", rows.length - dated.length);
  if (!dated.length) return { load: [], counts: { stored: rows.length, loaded: 0, left } };
  const newest = dated.reduce((m, r) => (r.filed! > m ? r.filed! : m), "");
  const full = monthsBack(newest, PLAN_FULL_MONTHS);
  const decks = monthsBack(newest, PLAN_DECK_MONTHS);
  const oldest = monthsBack(newest, PLAN_YEARS * 12);

  // Families: same kind, filed within 3 days, same title or same period.
  const families: PlanDocRow[][] = [];
  const open = new Map<string, PlanDocRow[][]>();
  for (const r of [...dated].sort(
    (a, b) => a.filed!.localeCompare(b.filed!) || a.id.localeCompare(b.id),
  )) {
    const kind = r.kind ?? "";
    const list = open.get(kind) ?? [];
    const hit = list.find((f) =>
      f.some(
        (x) =>
          Math.abs(time(x.filed!) - time(r.filed!)) <= COPY_DAYS * DAY &&
          ((norm(x.title) && norm(x.title) === norm(r.title)) ||
            (!!x.period && x.period === r.period)),
      ),
    );
    if (hit) hit.push(r);
    else {
      const f = [r];
      families.push(f);
      list.push(f);
      open.set(kind, list);
    }
  }
  // Supplements by quarter of filing (for the older history's primary documents).
  const supQuarters = new Set(
    families.filter((f) => f[0].kind === "supplement").map((f) => quarterOf(f[0].filed!)),
  );
  const load: { id: string; filed: string }[] = [];
  for (const f of families) {
    const best = [...f].sort(
      (a, b) => rank(a) - rank(b) || b.filed!.localeCompare(a.filed!) || a.id.localeCompare(b.id),
    )[0];
    skip("copy", f.length - 1);
    const filed = f.reduce((m, x) => (x.filed! > m ? x.filed! : m), "");
    if (filed < oldest) {
      skip("too-old");
      continue;
    }
    if (isDeck(best) && filed < decks) {
      skip("deck");
      continue;
    }
    if (filed < full) {
      const primary = supQuarters.has(quarterOf(filed))
        ? best.kind === "supplement"
        : best.kind === "press-release";
      if (!primary) {
        skip("older");
        continue;
      }
    }
    load.push({ id: best.id, filed });
  }
  load.sort((a, b) => b.filed.localeCompare(a.filed) || a.id.localeCompare(b.id));
  return {
    load: load.map((x) => x.id),
    counts: { stored: rows.length, loaded: load.length, left },
  };
}
