// Pure core of slide / chart / scanned-page reading. The page image goes to a vision model
// together with a numbered list of the number tokens found on the page (from the PDF text layer,
// or OCR for images). The model describes what each number *means* and points at its token id;
// the value is re-read from that token and the highlight box is the token's box, so a stored fact
// can never carry a number that isn't printed on the page.
import { CATEGORIES, METRICS, UNITS } from "@/lib/ir/extract-core";

export interface PageToken {
  /** token id, unique on the page */
  w: number;
  text: string;
  /** [x0, y0, x1, y1] as fractions of the page */
  box: [number, number, number, number];
  /** low OCR confidence: only usable when the model's reading has the same digits */
  weak?: boolean;
}

export interface PageWords {
  page: number;
  width: number;
  height: number;
  words: { text: string; box: [number, number, number, number]; weak?: boolean }[];
}

const NUM = /^\(?[-−–+]?[$€£]?\(?\d[\d,]*(\.\d+)?\)?(%|x|×|[KMB]|bn|mm|m|k)?\)?\*?$/i;

/** Parse a printed token: "$12.3B" → 12.3e9, "(1,234)" → -1234, "45.2%" → 45.2. */
export function parseToken(text: string): { v: number; suffixScale: number | null; pct: boolean } | null {
  const t = text.trim().replace(/[−–]/g, "-").replace(/\*+$/, "");
  if (!NUM.test(t)) return null;
  // Accounting negatives: "(1,234)", "$(404)", "(12.3%)", "-$5", "$-5".
  const neg = /\(.*\d.*\)/.test(t) || /^[($€£]*-/.test(t);
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const digits = m[1].replace(/,/g, "");
  // "1,23" or "12,3456" aren't thousands groupings — reject garbled OCR.
  if (/,/.test(m[1]) && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m[1])) return null;
  const v = Number(digits);
  if (!Number.isFinite(v)) return null;
  const suf = t.match(/(bn|mm|[KMB]|k|m)\)?$/i)?.[1]?.toLowerCase();
  const suffixScale = suf === "b" || suf === "bn" ? 1e9 : suf === "m" || suf === "mm" ? 1e6 : suf === "k" ? 1e3 : null;
  return { v: neg ? -v : v, suffixScale, pct: /%\)?$/.test(t) };
}

/** Number tokens on a page, merging "$" / "%" / "B" fragments that OCR or the text layer split off. */
export function numberTokens(page: PageWords, max = 400): PageToken[] {
  const out: PageToken[] = [];
  const ws = page.words;
  for (let i = 0; i < ws.length && out.length < max; i++) {
    let text = ws[i].text;
    let box = ws[i].box;
    let weak = !!ws[i].weak;
    const prev = ws[i - 1];
    const next = ws[i + 1];
    const near = (a: PageWords["words"][number], b: PageWords["words"][number]) => Math.abs(a.box[1] - b.box[1]) < 0.01 && b.box[0] - a.box[2] < 0.012;
    if (prev && /^[$€£(]$/.test(prev.text) && near(prev, ws[i])) {
      text = prev.text + text;
      box = [prev.box[0], Math.min(prev.box[1], box[1]), box[2], Math.max(prev.box[3], box[3])];
    }
    if (next && /^(%|B|M|K|bn|mm|x|\))$/i.test(next.text) && near(ws[i], next)) {
      text = text + next.text;
      box = [box[0], Math.min(box[1], next.box[1]), next.box[2], Math.max(box[3], next.box[3])];
      weak ||= !!next.weak;
      i++;
    }
    if (!/\d/.test(text) || !parseToken(text)) continue;
    // Skip bare years and page numbers — they're labels, not data.
    if (/^(19|20)\d{2}$/.test(text) || /^(FY|Q[1-4])/i.test(text)) continue;
    out.push(weak ? { w: out.length, text, box, weak } : { w: out.length, text, box });
  }
  return out;
}

export function renderTokens(tokens: PageToken[]) {
  return tokens.map((t) => `w${t.w}: ${t.text}${t.weak ? " ?" : ""} @ (${((t.box[0] + t.box[2]) / 2).toFixed(2)}, ${((t.box[1] + t.box[3]) / 2).toFixed(2)})`).join("\n");
}

export interface VisionRow {
  label: string;
  parent: string;
  breakdown: string;
  category: (typeof CATEGORIES)[number];
  metric: (typeof METRICS)[number];
  unit: (typeof UNITS)[number];
  scale: number;
  is_total: boolean;
  /** w = token id, p = period index, read = the number exactly as the model reads it on the image */
  values: { w: number; p: number; read: string }[];
}
export interface VisionPanel {
  title: string;
  periods: { p: number; period_start: string; period_end: string; months: number }[];
  rows: VisionRow[];
}
export const SKIP_REASONS = [
  "growth_or_change",
  "guidance_or_target",
  "per_share_or_share_count",
  "share_of_total",
  "adjustment_bridge",
  "consolidated_line",
  "annualized_or_derived",
  "label_year_or_date",
  "axis_tick",
  "page_or_footnote_number",
  "duplicate",
  "text_or_non_data",
  "unreadable",
] as const;

export interface VisionSkip {
  w: number;
  why: (typeof SKIP_REASONS)[number];
}
export interface VisionOutput {
  page_kind: "data" | "chart" | "text" | "cover" | "other";
  panels: VisionPanel[];
  /** every listed token that isn't a stored value, with the reason (completeness accounting) */
  skipped?: VisionSkip[];
}

const ROW_SCHEMA = {
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
        required: ["w", "p", "read"],
        properties: { w: { type: "integer" }, p: { type: "integer" }, read: { type: "string" } },
      },
    },
  },
} as const;

export const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["page_kind", "panels", "skipped"],
  properties: {
    page_kind: { type: "string", enum: ["data", "chart", "text", "cover", "other"] },
    panels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "periods", "rows"],
        properties: {
          title: { type: "string" },
          periods: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["p", "period_start", "period_end", "months"],
              properties: { p: { type: "integer" }, period_start: { type: "string" }, period_end: { type: "string" }, months: { type: "integer" } },
            },
          },
          rows: { type: "array", items: ROW_SCHEMA },
        },
      },
    },
    skipped: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["w", "why"],
        properties: { w: { type: "integer" }, why: { type: "string", enum: [...SKIP_REASONS] } },
      },
    },
  },
} as const;

export const VISION_INSTRUCTIONS = `You are a meticulous sell-side data analyst transcribing one page of a public company's investor-relations material (an earnings slide, chart, KPI dashboard, scanned table or infographic) into structured data. Your output is stored as reported figures that analysts rely on, so a qualifying number that is left out is an error, and so is a number filed under the wrong label, period, unit or scale.

<inputs>
- The page image.
- Context: company, document title, filing date, page number.
- A numbered list of every number token printed on the page, found by the PDF text layer or by OCR: "w<id>: <text> @ (x, y)". x and y are the token's centre as fractions of the page width and height, origin top-left, so you can find each token on the image. A token marked "?" was read with low OCR confidence: look at the image and give your own reading in "read".
</inputs>

<task>
Account for every token in the list exactly once: either as a value inside a row of a panel (a stored fact), or in "skipped" with the reason it is not a qualifying fact. Never use a token twice, never invent token ids.
</task>

<what_to_store>
Disaggregated and operating data, plus the printed totals they add up to:
1. Revenue / net sales split by reportable or operating segment, product or service line, geography, customer type or end market, sales channel.
2. Segment profit measures (operating income, segment profit, adjusted EBITDA by segment, contribution), segment margins and segment costs.
3. Cost and expense components whose parts sum to a printed total (category "cost").
4. Operating KPIs: units shipped, deliveries, subscribers, paid members, MAU/DAU, ARPU, same-store / comparable sales, store counts, backlog, bookings, RPO, AUM/AUA, deposits, loans, net interest margin, production volumes, realized prices, load factor, utilization, headcount (category "kpi", or "balance" for balance-type breakdowns such as loans or deposits by type).
5. The consolidated total that a breakdown on this page sums to (e.g. total revenue printed next to segment bars), as the breakdown's is_total row.
</what_to_store>

<skip>
Put these in "skipped" with the matching reason: growth rates, Y/Y or Q/Q changes and variances (growth_or_change; comparable / same-store sales are KPIs, not changes); guidance, outlook, targets and ranges (guidance_or_target); EPS, per-share amounts and share counts (per_share_or_share_count); "% of total" or mix shares derived from other numbers on the page (share_of_total); non-GAAP adjustment bridges, including "as reported / FX impact / adjusted" and "GAAP to non-GAAP" tables (adjustment_bridge — but as-reported segment, product or KPI values in such a table still qualify; only the adjustment and adjusted lines are skipped); company-wide lines that are not the total of a breakdown on this page — consolidated revenue, operating expenses, operating profit or margin, net income, cash flow, capex, and balance sheet lines such as cash, receivables, inventory, PP&E, accrued or other liabilities, debt, total assets and equity — because they come from the financial statements (consolidated_line; banks' and brokers' loans, deposits, AUM and capital ratios are KPIs and still qualify); annualized run-rates ("annualized NOI", quarter × 4), pro-forma and other figures computed from other numbers rather than reported for a period (annualized_or_derived); years, quarters and dates used as labels (label_year_or_date); chart axis tick labels and gridline values (axis_tick); page numbers and footnote markers (page_or_footnote_number); the same figure printed a second time on the page (duplicate); numbers in running text, phone numbers, addresses, rankings and other non-data (text_or_non_data); tokens you cannot make out on the image (unreadable).
</skip>

<how_to_read>
- Work panel by panel: a slide often holds several charts, tables or KPI tiles. For each, find its title, legend, period labels (axis, column headers, or the document's reporting period) and units note ("$ in millions"), then walk its numbers.
- Bar / column charts: each bar or bar group is one period; the x-axis labels name the periods. In stacked bars the printed segment labels are the components and the figure above the bar is the total. Use the legend to name each series.
- Pie / donut charts: printed slice amounts are components of the printed total (centre or title). Slices printed only as percentages of the whole are share_of_total unless no amounts are printed at all, in which case store them as pct rows labelled "<slice> share of <total>".
- KPI tiles and callouts ("245M paid memberships", "$4.3B backlog"): one row each, period = the period the document reports, months = 0 for point-in-time balances and counts.
- Tables: each row is a line item, each column a period.
- Only store numbers that are printed. Never estimate values from bar heights or gridlines.
</how_to_read>

<fields>
- Periods: list each period once per panel (p = 0, 1, …) with ISO dates. months = 3 for a quarter, 6 / 9 for year-to-date, 12 for a full year or a trailing-twelve-months / trailing-four-quarters figure, 0 only for point-in-time values (balances and counts at a date: assets, loans, deposits, AUM, backlog, subscribers, stores, headcount). Flows — revenue, NOI, income, expenses, volumes produced or sold — always cover a period (3 / 6 / 9 / 12); use the document's reporting period when the page doesn't print one; period_start is the first day of the period ("" when months = 0). When the page says "Q3 FY25" or "2024", infer exact dates from the company's fiscal calendar and the document date.
- Units & scale: scale converts the printed number to absolute units — "$ in billions" or "$12.3B" → 1000000000, "in millions" → 1000000, "in thousands" → 1000; percentages, prices, per-unit amounts and ratios use scale 1. unit: usd, pct (as printed, 45.2), bps, count, usdPerShare (per-unit dollars such as ARPU or realized price per barrel), ratio.
- Hierarchy: the printed total of a breakdown is a row with is_total = true and its components use parent = the total's exact label. When the total isn't printed on this page, leave parent "" and is_total = false. Keep different breakdowns apart with a short "breakdown" name such as "Revenue by segment".
- Labels exactly as printed, without footnote markers. When the same line name appears under more than one heading on the page, prefix the heading so every label in a panel is unique ("Americas — iPhone", "North America — Copper sales (mm lbs)").
- read: the number exactly as you see it printed on the image, with its $, %, decimal point and suffix ("$2.71", "41.2%", "$4.3B"). OCR sometimes drops a decimal point or comma; your reading is compared with the token.
</fields>

If the page holds no qualifying data, return its page_kind with "panels": [] and every token in "skipped".

Think the problem through before you answer: identify every panel and its periods and units, then go through the token list in order and decide for each token which row and period it belongs to, or why it is skipped.`;

/** Tokens the model neither stored nor skipped. */
export function unaccounted(out: VisionOutput, tokens: PageToken[]): PageToken[] {
  const seen = new Set<number>();
  for (const panel of out.panels ?? []) for (const row of panel.rows) for (const v of row.values) seen.add(v.w);
  for (const s of out.skipped ?? []) seen.add(s.w);
  return tokens.filter((t) => !seen.has(t.w));
}

/** Second-turn prompt for tokens the first answer left out. */
export function followUpPrompt(missing: PageToken[]) {
  return `Your answer did not account for ${missing.length} token${missing.length === 1 ? "" : "s"}:\n${renderTokens(missing)}\n\nLook at each of them on the image again. Return JSON in the same format that covers ONLY these tokens: new panels/rows for the ones that qualify (repeat a panel's title, periods and the row's label, parent and breakdown when a token belongs to a row you already returned) and "skipped" entries for the rest. Do not repeat values you already returned.`;
}

/** Combine the first answer with a follow-up answer (earlier pointers win in visionFacts). */
export function mergeVision(a: VisionOutput, b: VisionOutput): VisionOutput {
  return { page_kind: a.page_kind, panels: [...(a.panels ?? []), ...(b.panels ?? [])], skipped: [...(a.skipped ?? []), ...(b.skipped ?? [])] };
}

export interface VisionFact {
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
  locator: { page: number; box: number[]; text: string; w: number };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SCALES = new Set([1, 1e3, 1e6, 1e9]);
const clean = (s: string) =>
  s
    .replace(/\s*\((\d|[a-z])\)\s*$/i, "")
    .replace(/[*†‡]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Value for one pointer. Text-layer tokens are exact, so the model's reading must agree with them.
 * OCR tokens can lose a decimal point or comma: when the model's reading has the same digit
 * sequence, its punctuation wins; any other disagreement rejects the value.
 */
export function resolveValue(tokenText: string, read: string | undefined, ocr: boolean) {
  const tok = parseToken(tokenText);
  const rd = read ? parseToken(read) : null;
  if (!tok) return null;
  if (!rd) return ocr ? null : tok;
  if (rd.v === tok.v && rd.pct === tok.pct) return { ...tok, suffixScale: tok.suffixScale ?? rd.suffixScale };
  if (ocr && digits(tokenText) === digits(read!) && digits(read!).length > 0) return { ...rd, suffixScale: rd.suffixScale ?? tok.suffixScale, pct: rd.pct || tok.pct };
  return null;
}

/** Validate the model's token pointers and turn them into fact rows. */
export function visionFacts(out: VisionOutput, tokens: PageToken[], page: number, filed?: string | null, ocr = false): { rows: VisionFact[]; rejected: number } {
  const byId = new Map(tokens.map((t) => [t.w, t]));
  const used = new Set<number>();
  const rows: VisionFact[] = [];
  let rejected = 0;
  // Nothing reported can end after the filing (or, for undated files, after today): later periods are guidance.
  const latest = Math.min(filed ? Date.parse(filed) + 10 * 86_400_000 : Infinity, Date.now() + 10 * 86_400_000);
  for (const panel of out.panels ?? []) {
    const periods = new Map(panel.periods.map((p) => [p.p, p]));
    for (const row of panel.rows) {
      const label = clean(row.label);
      for (const ref of row.values) {
        const tok = byId.get(ref.w);
        const per = periods.get(ref.p);
        const parsed = tok ? resolveValue(tok.text, ref.read, ocr) : null;
        const okPeriod = !!per && [0, 3, 6, 9, 12].includes(per.months) && ISO.test(per.period_end) && Date.parse(per.period_end) <= latest;
        if (!tok || !parsed || used.has(ref.w) || !okPeriod || !label) {
          rejected++;
          continue;
        }
        let scale = row.unit === "usd" || row.unit === "count" || row.unit === "other" ? (parsed.suffixScale ?? row.scale) : 1;
        if (!SCALES.has(scale)) {
          rejected++;
          continue;
        }
        // A "%" token can only be a percentage; a percentage row can't point at "$4.2B".
        if ((parsed.pct && row.unit !== "pct") || (row.unit === "pct" && (parsed.suffixScale || /[$€£]/.test(tok.text)))) {
          rejected++;
          continue;
        }
        if (row.unit === "pct") scale = 1;
        used.add(ref.w);
        rows.push({
          category: row.category,
          metric: row.metric,
          breakdown: row.breakdown?.trim() || panel.title?.trim() || null,
          parent: clean(row.parent) || null,
          is_total: row.is_total,
          label,
          period_label: per!.months ? `${per!.months}M ending ${per!.period_end}` : `As of ${per!.period_end}`,
          period_start: per!.months && ISO.test(per!.period_start) ? per!.period_start : null,
          period_end: per!.period_end,
          months: per!.months,
          value: parsed.v * scale,
          unit: row.unit,
          locator: { page, box: tok.box.map((x) => Math.round(x * 10000) / 10000), text: ocr && ref.read ? ref.read : tok.text, w: tok.w },
        });
      }
    }
  }
  const kept = dropScaleOutliers(rows);
  return { rows: kept, rejected: rejected + rows.length - kept.length };
}

/**
 * A line on one page doesn't jump ~1,000× between periods: a value that far from the line's median
 * is a scale slip ("$22,334" read as billions next to millions) and is dropped.
 */
export function dropScaleOutliers(rows: VisionFact[]): VisionFact[] {
  const groups = new Map<string, number[]>();
  const keyOf = (f: VisionFact) => `${f.breakdown ?? ""}|${f.label}|${f.unit}|${f.months}`;
  for (const f of rows) if (f.value) (groups.get(keyOf(f)) ?? groups.set(keyOf(f), []).get(keyOf(f))!).push(Math.abs(f.value));
  return rows.filter((f) => {
    const vals = groups.get(keyOf(f));
    if (!f.value || !vals || vals.length < 3) return true;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const ratio = Math.abs(f.value) / median;
    return ratio < 300 && ratio > 1 / 300;
  });
}

/** pdftotext -bbox output → words per page (boxes as page fractions). */
export function parseBboxHtml(html: string): PageWords[] {
  const pages: PageWords[] = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = pageRe.exec(html))) {
    n++;
    const W = Number(m[1]);
    const H = Number(m[2]);
    const words: PageWords["words"] = [];
    const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
    let w: RegExpExecArray | null;
    while ((w = wordRe.exec(m[3])))
      words.push({ text: decodeEntities(w[5]), box: [Number(w[1]) / W, Number(w[2]) / H, Number(w[3]) / W, Number(w[4]) / H] });
    pages.push({ page: n, width: W, height: H, words });
  }
  return pages;
}

/** tesseract TSV output → words (boxes as image fractions). Low-confidence words are dropped. */
export function parseTesseractTsv(tsv: string, width: number, height: number, page = 1, opts: { minConf?: number; weakBelow?: number } = {}): PageWords {
  const minConf = opts.minConf ?? 55;
  const weakBelow = opts.weakBelow ?? minConf;
  const words: PageWords["words"] = [];
  for (const line of tsv.split("\n").slice(1)) {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const conf = Number(c[10]);
    const text = c[11]?.trim();
    if (!text || conf < minConf) continue;
    const [l, t, w, h] = [Number(c[6]), Number(c[7]), Number(c[8]), Number(c[9])];
    const box: [number, number, number, number] = [l / width, t / height, (l + w) / width, (t + h) / height];
    words.push(conf < weakBelow ? { text, box, weak: true } : { text, box });
  }
  return { page, width, height, words };
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
