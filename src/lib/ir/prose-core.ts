// Pure core of reading figures stated in the running text of an IR document ("ended the quarter
// with 1,234 stores", "paid memberships of 301.6 million", "backlog of $4.3 billion").
// Table readers never see these sentences. The text is split into blocks, every number in it gets a
// token id, the model says what each qualifying number means and points at its id, and the value is
// re-read from the token — so a stored fact can never carry a number that isn't printed in the text.
// Each fact cites the sentence it was read from, which the source viewer finds and highlights.
import { CATEGORIES, METRICS, PERIOD_MONTHS, UNITS, monthSpanOk } from "@/lib/ir/extract-core";
import { stockKind } from "@/lib/ir/stock";
import { decodeHtml, parseNumber } from "@/lib/ir/tables";

export interface ProseBlock {
  b: number;
  text: string;
}
export interface ProseToken {
  n: number;
  b: number;
  /** the number as printed, with its currency sign, % and scale word ("$4.3 billion") */
  text: string;
  /** offset of the token in its block */
  at: number;
  v: number;
  scale: number | null;
  pct: boolean;
}

const clean = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/[\s\u00a0\u200b]+/g, " ").trim();
const numericCell = (c: string) => parseNumber(c) != null;

/**
 * Tables the table reader reads (several numeric cells, short cells) are dropped; layout tables that
 * hold sentences or bullet lists keep their text. Innermost tables are resolved first.
 */
function dropDataTables(html: string): string {
  let s = html;
  const inner = /<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/i;
  for (let guard = 0; guard < 5000; guard++) {
    const m = inner.exec(s);
    if (!m) break;
    const cells = [...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|<\/table>)/gi)].map((x) => clean(x[1])).filter(Boolean);
    const numeric = cells.filter(numericCell).length;
    const long = cells.filter((c) => c.length > 80).length;
    const data = numeric >= 4 && long * 4 < cells.length;
    const text = data ? "\n" : `\n${cells.join("\n")}\n`;
    s = s.slice(0, m.index) + text.replace(/</g, "&lt;") + s.slice(m.index + m[0].length);
  }
  return s;
}

/** Headings after which a release is boilerplate (safe harbor, company profile, contacts). */
const STOP = /^(forward[- ]looking statements?|cautionary (note|statement|language)|safe harbor|about [A-Z][\w.&' -]{1,60}$|investor (relations )?contacts?|media contacts?|contacts?:)/i;

/** Text blocks of an HTML document outside its data tables, in reading order, up to the boilerplate. */
export function proseBlocks(html: string, maxChars = 120_000): ProseBlock[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, "");
  const text = dropDataTables(body)
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|br|tr|section|article|blockquote|center)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const out: ProseBlock[] = [];
  let size = 0;
  for (const raw of decodeHtml(text).split("\n")) {
    const t = raw.replace(/[\s\u00a0\u200b]+/g, " ").trim();
    if (!t) continue;
    if (STOP.test(t) && out.length > 2) break;
    if (!/\d/.test(t) || !/[a-z]{3}/i.test(t)) continue;
    if (size + t.length > maxChars) break;
    out.push({ b: out.length, text: t });
    size += t.length;
  }
  return out;
}

const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s*$/i;
const SCALE_WORDS: Record<string, number> = { trillion: 1e12, billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mm: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };
const TOKEN = /(?:[$€£]\s?)?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?(?:\s?(?:%|percent\b|per cent\b))?(?:\s?(?:trillion|billion|million|thousand|bn|mm)\b|[BMK]\b)?/gi;

/** Every number in the blocks that could be a figure: not a year, a day of the month, a phone number or a footnote mark. */
export function proseTokens(blocks: ProseBlock[], max = 600): ProseToken[] {
  const out: ProseToken[] = [];
  for (const { b, text } of blocks) {
    for (const m of text.matchAll(TOKEN)) {
      if (out.length >= max) return out;
      let raw = m[0].trim();
      let at = m.index! + (m[0].length - m[0].trimStart().length);
      // An opening parenthesis without its closing one is punctuation, not an accounting negative.
      if (raw.startsWith("(") && !raw.endsWith(")")) {
        raw = raw.slice(1);
        at += 1;
      } else if (raw.endsWith(")") && !raw.includes("(")) raw = raw.slice(0, -1);
      const before = text[at - 1] ?? " ";
      const after = text[at + raw.length] ?? " ";
      if (/[A-Za-z0-9.\-/#’'_]/.test(before) || /[A-Za-z0-9\-/’_]/.test(after)) continue;
      // "Exhibit 99.1", "Item 2.02", "Section 13": document furniture.
      if (/\b(exhibit|item|section|rule|form|note|page|no\.?|nos\.?)\s*$/i.test(text.slice(Math.max(0, at - 10), at))) continue;
      const money = /[$€£]/.test(raw);
      const pct = /%|percent|per cent/i.test(raw);
      const word = raw.match(/(trillion|billion|million|thousand|bn|mm|[BMK])$/i)?.[1]?.toLowerCase();
      const scale = word ? SCALE_WORDS[word] : null;
      const digits = raw.replace(/[^\d.]/g, "");
      const v0 = Number(digits.replace(/\.$/, ""));
      if (!Number.isFinite(v0)) continue;
      // Years, days of the month, footnote marks "(1)", phone numbers and times are not figures.
      if (!money && !pct && !scale && /^(19|20)\d{2}$/.test(digits)) continue;
      if (!money && !pct && !scale && MONTH.test(text.slice(Math.max(0, at - 12), at))) continue;
      if (/^\(\d{1,2}\)$/.test(raw)) continue;
      if (/^\d{3}$/.test(digits) && /^[-.]\d{3}[-.]\d{4}/.test(text.slice(at + raw.length))) continue;
      if (/^:\d{2}/.test(text.slice(at + raw.length)) || /\d:$/.test(text.slice(Math.max(0, at - 3), at))) continue;
      if (/^\s?(a\.m\.|p\.m\.|am\b|pm\b|et\b|est\b|edt\b)/i.test(text.slice(at + raw.length))) continue;
      const neg = /^\(.*\)$/.test(raw.replace(/[$€£\s]/g, "")) || /^-/.test(raw.replace(/[$€£\s]/g, ""));
      out.push({ n: out.length, b, text: raw, at, v: neg ? -v0 : v0, scale, pct });
    }
  }
  return out;
}

/** Blocks as the model reads them: each number preceded by its id, e.g. "grew to ⟦n12⟧301.6 million paid memberships". */
export function renderProse(blocks: ProseBlock[], tokens: ProseToken[]): string {
  const byBlock = new Map<number, ProseToken[]>();
  for (const t of tokens) byBlock.set(t.b, [...(byBlock.get(t.b) ?? []), t]);
  return blocks
    .filter((bl) => byBlock.has(bl.b))
    .map((bl) => {
      let s = bl.text;
      for (const t of [...byBlock.get(bl.b)!].sort((a, z) => z.at - a.at)) s = `${s.slice(0, t.at)}⟦n${t.n}⟧${s.slice(t.at)}`;
      return `B${bl.b}: ${s}`;
    })
    .join("\n");
}

/** Prompt parts of about `size` characters, whole blocks only. */
export function proseChunks(blocks: ProseBlock[], tokens: ProseToken[], size = 14_000): { blocks: ProseBlock[]; tokens: ProseToken[] }[] {
  const out: { blocks: ProseBlock[]; tokens: ProseToken[] }[] = [];
  const has = new Set(tokens.map((t) => t.b));
  let cur: ProseBlock[] = [];
  let len = 0;
  const flush = () => {
    if (!cur.length) return;
    const ids = new Set(cur.map((b) => b.b));
    out.push({ blocks: cur, tokens: tokens.filter((t) => ids.has(t.b)) });
    cur = [];
    len = 0;
  };
  for (const bl of blocks) {
    if (!has.has(bl.b)) continue;
    if (len + bl.text.length > size) flush();
    cur.push(bl);
    len += bl.text.length;
  }
  flush();
  return out;
}

/**
 * The sentence (or, for a long one, the stretch around the number) that cites a token: verbatim text of
 * its block, so the viewer can find it.
 */
export function quoteOf(block: string, t: Pick<ProseToken, "at" | "text">, max = 220): string {
  const starts = [0, ...[...block.matchAll(/[.!?;]\s+(?=[A-Z(•])|\s[•·▪]\s/g)].map((m) => m.index! + m[0].length)];
  const start = Math.max(...starts.filter((x) => x <= t.at));
  const endRel = block.slice(t.at + t.text.length).search(/[.!?;](\s|$)|\s[•·▪]\s/);
  const end = endRel < 0 ? block.length : t.at + t.text.length + endRel + 1;
  let q = block.slice(start, end).trim();
  if (q.length > max) {
    const from = Math.max(start, block.lastIndexOf(" ", Math.max(start, t.at - Math.floor(max / 2))) + 1);
    const to = block.indexOf(" ", Math.min(block.length, from + max));
    q = block.slice(from, to < 0 ? block.length : to).trim();
  }
  return q;
}

export interface ProseRow {
  label: string;
  parent: string;
  breakdown: string;
  category: (typeof CATEGORIES)[number];
  metric: (typeof METRICS)[number];
  unit: (typeof UNITS)[number];
  scale: number;
  is_total: boolean;
  /** n = token id, p = period index, read = the number exactly as printed */
  values: { n: number; p: number; read: string }[];
}
export interface ProseOutput {
  periods: { p: number; period_start: string; period_end: string; months: number }[];
  rows: ProseRow[];
}

export const PROSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["periods", "rows"],
  properties: {
    periods: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["p", "period_start", "period_end", "months"],
        properties: { p: { type: "integer" }, period_start: { type: "string" }, period_end: { type: "string" }, months: { type: "integer" } },
      },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "parent", "breakdown", "category", "metric", "unit", "scale", "is_total", "values"],
        properties: {
          label: { type: "string" },
          parent: { type: "string" },
          breakdown: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          metric: { type: "string", enum: [...METRICS] },
          unit: { type: "string", enum: [...UNITS] },
          scale: { type: "number" },
          is_total: { type: "boolean" },
          values: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["n", "p", "read"],
              properties: { n: { type: "integer" }, p: { type: "integer" }, read: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export const PROSE_INSTRUCTIONS = `You are a meticulous sell-side data analyst reading the running text of a public company's investor-relations document (earnings release, shareholder letter, supplement or presentation notes). Its tables are read separately; your job is the figures stated in sentences and bullet points, which analysts would otherwise miss.

INPUT: blocks "B<b>: text", where every number is preceded by its id, e.g. "ended the quarter with ⟦n41⟧1,234 stores". Point at ids; never invent one, never use one twice.

STORE every operating or disaggregated figure the text states for a reported period:
- Operating KPIs: subscribers, paid members, users (MAU/DAU), accounts, customers, units shipped or delivered, production and sales volumes, store / restaurant / branch counts and openings, backlog, bookings, RPO, AUM/AUA, net new assets, deposits, loans, net interest margin, charge-off rate, same-store / comparable sales, ARPU and other per-unit figures, realized prices, load factor, occupancy, utilization, headcount, prescriptions, membership, claims, etc. (category "kpi", or "balance" for balances such as loans or deposits).
- Revenue, profit or margin of one segment, product line, region, customer type or channel (categories "segment", "product", "geography", "customer", "channel"), and the cost of one component (category "cost").
SKIP: growth rates and changes ("up 12%", "increased $40 million", "+300 bps"; comparable / same-store sales and net additions are KPIs, not changes); guidance, outlook, targets, expectations and ranges; per-share amounts, share counts, buybacks and dividends; consolidated company-wide statement lines (total revenue, operating income, net income, EPS, cash flow, capex, cash, debt) unless the sentence states them for a segment, product or region; non-GAAP adjustments; one-off transaction values (acquisition prices, contract awards, financings); prices of individual products, items or menu items; rounded descriptive figures in a company profile or boilerplate ("approximately 9,000 pharmacies", "more than 30,000 employees worldwide") unless the text reports them for the period; dates, years, ages, percentages of ownership, rankings, phone numbers.

FIELDS:
- periods: each distinct reported period once (p = 0, 1, …). months = 3 for the quarter, 12 for the full year, 6 / 9 for year-to-date, 1 for a single month, 0 for point-in-time balances and counts ("as of", "ended the quarter with", "at quarter-end"). Default to the document's reporting period; prior-year comparisons in the same sentence ("compared with 1,180 a year ago") are the prior period and qualify too. ISO dates; period_start is the first day of the period ("" when months = 0).
- label: the figure's name as the text says it, as a short noun phrase ("Paid memberships", "Vehicle deliveries", "Stores at quarter-end", "Backlog"); prefix the segment, product or region it belongs to ("Data Center — revenue", "International — paid memberships").
- parent: the label of a total this figure is a part of when the same text states that total; else "". is_total: true for such a total.
- breakdown: a short name of the dimension ("Revenue by segment", "Operating statistics").
- unit: usd, pct (as printed, 45.2), bps, count, usdPerShare (per-unit dollars like ARPU or price per barrel), ratio, other. scale: multiplier to absolute units when the number has no scale word of its own ("in millions" context → 1000000), else 1; a scale word printed with the number ("$4.3 billion", "301.6 million") is applied automatically.
- read: the number exactly as printed ("$4.3 billion", "1,234", "3.2%").

Return {"periods": [], "rows": []} when the text states no qualifying figure.`;

export interface ProseFact {
  category: string;
  metric: string;
  breakdown: string | null;
  parent: string | null;
  is_total: boolean;
  label: string;
  period_label: string;
  period_start: string | null;
  period_end: string;
  months: number;
  value: number;
  unit: string;
  /** q = the sentence that states it (verbatim text of the document), text = the number as printed */
  locator: { q: string; text: string; n: number; b: number };
  /** rounding of the printed figure ("$2.2 billion" = ±$50 million): how far a table's exact value may differ */
  tol: number;
}

// Not "expected" (expected credit losses) or "plan" (health plans, plan assets).
const FORECAST = /\b(forecast(?:ed|s)?|guidance|outlook|projected|projections?)\b/i;
const AT_END = /^\S*(?:\s+\S+){0,8}?\s+(?:at|as of)\s+(?:the\s+)?(?:quarter[- ]end|year[- ]end|end of the (?:quarter|year|period)|period[- ]end|(?:june|september|december|march)\s+\d{1,2})|^\S*\s+(?:at|as of)\s+(?:the\s+)?(?:quarter|year)[- ]end/i;
const VAGUE = /\b(approximately|approx\.|nearly|almost|more than|over|up to|about|roughly|around|some|at least|in excess of|upwards of|close to)\s*[$€£]?\s*$|~\s*[$€£]?\s*$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SCALES = new Set([1, 1e3, 1e6, 1e9]);
const digits = (s: string) => s.replace(/\D/g, "");
const PERIOD_WORDS = /\s*[(,–—-]?\s*\(?(?:(?:(?:first|second|third|fourth|march|june|september|december)\s+)?quarter(?:[- ]end)?|q[1-4](?:\s*(?:fy)?['’]?\d{2,4})?|fy\s*['’]?\d{2,4}|year[- ]to[- ]date|ytd|full[- ]year|(?:19|20)\d{2})\)?\s*$/i;
const PERIOD_PREFIX = /^(?:(?:(?:first|second|third|fourth|march|june|september|december)\s+)?quarter(?:[- ]end)?|q[1-4](?:\s*(?:fy)?['’]?\d{2,4})?|fy\s*['’]?\d{2,4}|year[- ]to[- ]date|ytd|full[- ]year|(?:19|20)\d{2})\s*[-–—:,]\s*/i;
const cleanLabel = (s: string) =>
  s
    .replace(PERIOD_PREFIX, "")
    .replace(PERIOD_WORDS, "")
    .replace(PERIOD_WORDS, "")
    .replace(/\s*\((\d|[a-z])\)\s*$/i, "")
    .replace(/[*†‡]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** Validate the model's token pointers and turn them into fact rows that quote their sentence. */
export function proseFacts(out: ProseOutput, blocks: ProseBlock[], tokens: ProseToken[], filed?: string | null): { rows: ProseFact[]; rejected: number } {
  const byId = new Map(tokens.map((t) => [t.n, t]));
  const text = new Map(blocks.map((b) => [b.b, b.text]));
  const periods = new Map((out.periods ?? []).map((p) => [p.p, p]));
  const used = new Set<number>();
  const rows: ProseFact[] = [];
  let rejected = 0;
  const latest = Math.min(filed ? Date.parse(filed) + 10 * 86_400_000 : Infinity, Date.now() + 10 * 86_400_000);
  for (const row of out.rows ?? []) {
    const label = cleanLabel(row.label);
    // Guidance is not a reported figure (and a "forecast" label on an actual misnames it).
    if (FORECAST.test(row.label) || FORECAST.test(row.breakdown ?? "")) {
      rejected += row.values?.length ?? 0;
      continue;
    }
    for (const ref of row.values ?? []) {
      const tok = byId.get(ref.n);
      const per = periods.get(ref.p);
      const okPeriod = !!per && PERIOD_MONTHS.includes(per.months) && ISO.test(per.period_end) && Date.parse(per.period_end) <= latest && monthSpanOk(per);
      // The model's reading must be the printed number: same digits.
      const agrees = !!tok && !!ref.read && digits(ref.read) === digits(tok.text);
      if (!tok || !agrees || used.has(ref.n) || !okPeriod || !label) {
        rejected++;
        continue;
      }
      let scale = row.unit === "usd" || row.unit === "count" || row.unit === "other" ? (tok.scale ?? row.scale) : 1;
      if (!SCALES.has(scale) && tok.scale !== 1e12) {
        rejected++;
        continue;
      }
      // A "%" can only be a percentage, and a percentage can't be "$4.2 billion".
      if ((tok.pct && row.unit !== "pct") || (row.unit === "pct" && (!tok.pct || tok.scale))) {
        rejected++;
        continue;
      }
      if (row.unit === "pct") scale = 1;
      // "more than 30,000 pharmacists", "approximately $2.9 trillion": not a reported figure.
      const lead = (text.get(tok.b) ?? "").slice(Math.max(0, tok.at - 24), tok.at);
      if (VAGUE.test(lead)) continue;
      used.add(ref.n);
      // A count or balance at quarter-end ("ended the quarter with 939 warehouses") is a point in time.
      const sentence = text.get(tok.b) ?? "";
      const point =
        per!.months !== 0 &&
        ((row.unit === "count" && stockKind({ category: row.category, metric: row.metric, label }) === "point") ||
          // "Liquidity of $6.9 billion at quarter-end": the sentence says it's a balance.
          (row.unit === "usd" && AT_END.test(sentence.slice(tok.at, tok.at + 90)) && !/\b(paid|payments?|repaid|repurchased|returned|spent|invested|generated|raised)\b/i.test(label)));
      const months = point ? 0 : per!.months;
      rows.push({
        category: row.category,
        metric: row.metric,
        breakdown: row.breakdown?.trim() || null,
        parent: cleanLabel(row.parent) || null,
        is_total: row.is_total,
        label,
        period_label: months ? `${months}M ending ${per!.period_end}` : `As of ${per!.period_end}`,
        period_start: months && ISO.test(per!.period_start) ? per!.period_start : null,
        period_end: per!.period_end,
        months,
        value: tok.v * scale,
        unit: row.unit,
        locator: { q: quoteOf(text.get(tok.b) ?? "", tok), text: tok.text, n: tok.n, b: tok.b },
        tol: 0.5 * 10 ** -(tok.text.match(/\.(\d+)/)?.[1].length ?? 0) * scale,
      });
    }
  }
  // One figure per line and period: a sentence that repeats an earlier one adds nothing.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${r.label.toLowerCase()}|${r.breakdown ?? ""}|${r.period_end}|${r.months}|${r.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { rows: unique, rejected };
}

/**
 * A figure the document also prints in a table (same period and value) is already stored with its
 * cell; the sentence adds nothing.
 */
export function dropTableDuplicates<T extends { period_end: string; months: number; value: number; unit?: string; tol?: number }>(rows: T[], existing: { period_end: string; months: number; value: number; unit?: string | null }[]): T[] {
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 6 * 86_400_000;
  // A balance printed at quarter-end in a table may be tagged as the quarter (3 months) there.
  const sameSpan = (a: number, b: number) => a === b || a * b === 0;
  return rows.filter(
    (r) =>
      !existing.some(
        (e) =>
          sameSpan(e.months, r.months) &&
          (!e.unit || !r.unit || e.unit === r.unit) &&
          near(e.period_end, r.period_end) &&
          Math.abs(Math.abs(e.value) - Math.abs(r.value)) <= Math.max(r.tol ?? 0, Math.abs(r.value) * 0.0005, 1e-9),
      ),
  );
}
