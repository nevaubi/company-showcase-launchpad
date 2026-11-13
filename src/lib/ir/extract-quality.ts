// Pure quality rules for the IR table reader when a fast model does the first read
// (Gemini 3.1 Flash Lite) and a second model re-reads the parts it got wrong.

/**
 * Re-read a chunk with the escalation model when the first answer was unusable, or when a
 * meaningful share of the cells it pointed at failed validation (wrong cell, bad period, bad scale),
 * which signals it misread the table's layout.
 */
export function needsExtractEscalation(o: { failed?: string | null; kept: number; rejected: number }): boolean {
  if (o.failed) return true;
  return o.rejected >= 3 && o.rejected / Math.max(1, o.kept + o.rejected) >= 0.1;
}

export const EXTRACT_QUALITY_PROMPT = `QUALITY CHECKLIST (follow before answering):
1. Work table by table and row by row from top to bottom. Return every qualifying row of every table in this part, including long tables, later pages and repeated segment blocks; never sample or stop early.
2. Periods: read the full column header, which may span several rows ("Three Months Ended" above "June 30," above "2026"). A converted table repeats a spanning header in each column it covers. Map each number cell to the period of its own column index; check that the year/quarter above it matches. Never map a "Change", "% Change", "Variance", "B/(W)" or "Favorable" column.
3. Units: take the scale from the table caption, the first rows ("In millions, except per share amounts", "Dollars in thousands"), or the opening text; row labels override it ("(in thousands)" members, "%", "bps", "per share"). Percentages, ratios, per-unit amounts and per-share amounts use scale 1.
4. Labels and hierarchy: copy the printed row label; prefix indented rows with their section heading when the label alone is ambiguous ("Health Care Benefits — Medical membership"). Use the segment and product names exactly as printed. A subtotal is a total (is_total=true) whose parent is the next total above it.
5. Operating KPIs matter as much as revenue: membership, prescriptions filled, medical benefit ratio, same-store sales, units, deliveries, wholesale volumes, average selling price, revenue per unit, load factor, average daily volume, net interest margin, charge-off rates, deposits and loans by type, book value per share. Use category "kpi" (or "balance" for balance breakdowns) and metric "other" when no metric enum fits exactly; never force an unrelated metric.
6. Signs: parentheses or a leading minus mean negative only where the number is printed that way; eliminations and adjustments keep their printed sign.
7. Never point at an empty cell, a "$" or "%" cell, a footnote marker, a year in a header row, or the same cell twice.`;

export interface MissedRow {
  t: number;
  r: number;
  label: string;
}

const YEAR = /^(19|20)\d{2}$/;

/**
 * Rows of a prompt chunk ("## T<t>" / "r<r>: c<c>=text | ...") that hold at least two numbers but
 * that the answer neither returned nor could have skipped silently. Header rows of years are ignored.
 */
export function missedRows(chunk: string, answered: { t: number; rows: { r: number }[] }[], isNumber: (s: string) => boolean): MissedRow[] {
  const got = new Set(answered.flatMap((tb) => tb.rows.map((r) => `${tb.t}:${r.r}`)));
  const out: MissedRow[] = [];
  let t = -1;
  for (const line of chunk.split("\n")) {
    const head = /^## T(\d+)$/.exec(line);
    if (head) {
      t = Number(head[1]);
      continue;
    }
    const m = /^r(\d+): (.*)$/.exec(line);
    if (!m || t < 0) continue;
    const cells = m[2].split(" | ").map((c) => c.replace(/^c\d+=/, ""));
    const nums = cells.filter((c) => isNumber(c) && !YEAR.test(c.trim()));
    if (nums.length < 2) continue;
    const r = Number(m[1]);
    if (got.has(`${t}:${r}`)) continue;
    const label = cells.find((c) => !isNumber(c) && /[a-z]/i.test(c)) ?? "";
    out.push({ t, r, label: label.slice(0, 80) });
  }
  return out;
}

/** Second turn for the rows a first answer left out; capped so the prompt stays small. */
export function extractFollowUpPrompt(missed: MissedRow[], max = 150): string {
  const list = missed
    .slice(0, max)
    .map((m) => `T${m.t} r${m.r}${m.label ? ` (${m.label})` : ""}`)
    .join("\n");
  return `REVIEW PASS. Your first answer did not include these rows that print two or more numbers:\n${list}\n\nRe-check each one against the rules. Return every row from this list that qualifies (segment, product, geography, customer, channel, cost breakdown, operating KPI or balance breakdown, plus the totals they sum into), with full period mapping. Do not repeat rows you already returned. If none qualify, return {"tables": []}.`;
}

/** Union of two answers' fact rows by cell; the first answer wins a conflict. */
export function mergeFactRows<T extends { locator: { t: number; r: number; c: number } }>(a: T[], b: T[]): T[] {
  const seen = new Set(a.map((f) => `${f.locator.t}:${f.locator.r}:${f.locator.c}`));
  return [...a, ...b.filter((f) => !seen.has(`${f.locator.t}:${f.locator.r}:${f.locator.c}`))];
}
