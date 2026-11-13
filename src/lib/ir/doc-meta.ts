// Pure metadata inference for imported IR documents (partner copies arrive without filing dates).
// `filed` decides which vintage of a restated figure wins, so it is only set from evidence:
// the partner's publish date, the SEC filing date in an 8-K exhibit title, or a date printed in
// the document itself that falls shortly after the period it reports.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAY = 86_400_000;

/** SEC archive URL → accession number (0000064803-26-000107). */
export function accnFromSecUrl(url: string): string | null {
  const m = /\/Archives\/edgar\/data\/\d+\/(\d{10})(\d{2})(\d{6})\//.exec(url);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "8-K 2024-05-01 cvs_ex99x1q1-24.htm (Items 2.02,9.01)" → 2024-05-01. */
export function filedFromTitle(title: string): string | null {
  const m = /\b(?:8-K|6-K|10-Q|10-K)(?:\/A)?\s+(\d{4}-\d{2}-\d{2})\b/.exec(title);
  return m && valid(m[1]) ? m[1] : null;
}

const valid = (iso: string) => !Number.isNaN(Date.parse(`${iso}T00:00:00Z`));
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

/** Every calendar date printed in the text, in order of appearance. */
export function datesInText(text: string): string[] {
  const out: { at: number; d: string }[] = [];
  const month = MONTHS.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join("|");
  for (const m of text.matchAll(new RegExp(`\\b(${month})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"))) {
    const d = iso(Number(m[3]), MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3))) + 1, Number(m[2]));
    if (d) out.push({ at: m.index!, d });
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${month})\\.?,?\\s+(\\d{4})\\b`, "gi"))) {
    const d = iso(Number(m[3]), MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3))) + 1, Number(m[1]));
    if (d) out.push({ at: m.index!, d });
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const d = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) out.push({ at: m.index!, d });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.d);
}

export type FiledBasis = "published" | "sec-title" | "document-date";

/**
 * Best evidence of when a document was published. A printed date counts only when it falls within
 * `windowDays` after the reported period end (an earnings release is dated a few weeks after the
 * quarter); without a known period end the first printed date in the opening text is used only if
 * it is not in the future of `today`.
 */
export function inferFiled(o: { published?: string | null; title?: string | null; url?: string | null; text?: string | null; periodEnd?: string | null; today?: string; windowDays?: number }): { filed: string | null; basis: FiledBasis | null } {
  if (o.published && valid(o.published.slice(0, 10))) return { filed: o.published.slice(0, 10), basis: "published" };
  const fromTitle = o.title ? filedFromTitle(o.title) : null;
  if (fromTitle) return { filed: fromTitle, basis: "sec-title" };
  const dates = o.text ? datesInText(o.text.slice(0, 6000)) : [];
  const today = Date.parse(`${o.today ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (o.periodEnd && valid(o.periodEnd)) {
    const end = Date.parse(`${o.periodEnd}T00:00:00Z`);
    const hit = dates.find((d) => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return t > end && t - end <= (o.windowDays ?? 120) * DAY && t <= today;
    });
    return hit ? { filed: hit, basis: "document-date" } : { filed: null, basis: null };
  }
  return { filed: null, basis: null };
}
