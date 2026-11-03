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
}

export interface PageWords {
  page: number;
  width: number;
  height: number;
  words: { text: string; box: [number, number, number, number] }[];
}

const NUM = /^\(?[-−–+]?[$€£]?\(?\d[\d,]*(\.\d+)?\)?(%|x|×|[KMB]|bn|mm|m|k)?\)?\*?$/i;

/** Parse a printed token: "$12.3B" → 12.3e9, "(1,234)" → -1234, "45.2%" → 45.2. */
export function parseToken(text: string): { v: number; suffixScale: number | null; pct: boolean } | null {
  const t = text.trim().replace(/[−–]/g, "-").replace(/\*+$/, "");
  if (!NUM.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/[($€£]/g, ""));
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
      i++;
    }
    if (!/\d/.test(text) || !parseToken(text)) continue;
    // Skip bare years and page numbers — they're labels, not data.
    if (/^(19|20)\d{2}$/.test(text) || /^(FY|Q[1-4])/i.test(text)) continue;
    out.push({ w: out.length, text, box });
  }
  return out;
}

export function renderTokens(tokens: PageToken[]) {
  return tokens.map((t) => `w${t.w}: ${t.text} @ (${((t.box[0] + t.box[2]) / 2).toFixed(2)}, ${((t.box[1] + t.box[3]) / 2).toFixed(2)})`).join("\n");
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
  values: { w: number; p: number }[];
}
export interface VisionPanel {
  title: string;
  periods: { p: number; period_start: string; period_end: string; months: number }[];
  rows: VisionRow[];
}
export interface VisionOutput {
  page_kind: "data" | "chart" | "text" | "cover" | "other";
  panels: VisionPanel[];
}

export const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["page_kind", "panels"],
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
                  items: { type: "object", additionalProperties: false, required: ["w", "p"], properties: { w: { type: "integer" }, p: { type: "integer" } } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const VISION_INSTRUCTIONS = `You are a meticulous sell-side data analyst reading one page of a public company's investor-relations material (an earnings slide, a chart, a scanned table or an infographic). You get the page image and a numbered list of every number printed on it ("w<id>: <text> @ (x, y)" — x/y are the token's centre as fractions of the page width/height, origin top-left).

Return every number that is disaggregated or operating data, pointing at its token id:
1. Revenue / sales split by segment, product or service, geography, customer or end market, channel.
2. Segment profit (operating income, adjusted EBITDA, contribution) and segment margins; cost and expense components.
3. Operating KPIs: units, deliveries, subscribers, users, ARPU, backlog, bookings, AUM, deposits, loans, production, realized prices, store counts, headcount, same-store sales.

How to read charts: in a bar or column chart each bar is one period; a stacked bar's printed segment labels are its components and the printed figure above the bar is the total. Use the legend and axis labels to name rows and periods. In a pie/donut, the slices are components of the printed total in the centre or title. Only point at numbers that are actually printed — never estimate values from bar heights.

Hierarchy: the printed total of a breakdown is a row with is_total=true; its components use parent = the total's exact label. When the total isn't printed on this page leave parent "" and is_total=false. Keep separate breakdowns apart with a short "breakdown" name.
Periods: list each period once per panel (p = 0,1,…) with ISO dates, months = 3 for a quarter, 6/9 year-to-date, 12 full year, 0 for point-in-time values. Infer exact dates from the company's fiscal calendar and the document date when the page says "Q3 FY25" or "2024".
Units & scale: scale converts the printed number to absolute units — "$ in billions" or "$12.3B" → 1000000000, "in millions" → 1000000, "in thousands" → 1000; percentages, prices, per-share amounts and ratios use scale 1. unit: usd, pct (as printed, 45.2), bps, count, usdPerShare (per-unit dollars like ARPU or $/barrel), ratio.
SKIP: growth rates and changes (+12% Y/Y, "up 5%"), guidance/outlook, targets, page numbers, footnote numbers, years used as labels, non-GAAP adjustment bridges, per-share EPS and share counts.
Each token may be used once. If the page holds no qualifying data, return its page_kind with "panels": [].`;

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

/** Validate the model's token pointers and turn them into fact rows. */
export function visionFacts(out: VisionOutput, tokens: PageToken[], page: number, filed?: string | null): { rows: VisionFact[]; rejected: number } {
  const byId = new Map(tokens.map((t) => [t.w, t]));
  const used = new Set<number>();
  const rows: VisionFact[] = [];
  let rejected = 0;
  const latest = filed ? Date.parse(filed) + 10 * 86_400_000 : Infinity;
  for (const panel of out.panels ?? []) {
    const periods = new Map(panel.periods.map((p) => [p.p, p]));
    for (const row of panel.rows) {
      const label = clean(row.label);
      for (const ref of row.values) {
        const tok = byId.get(ref.w);
        const per = periods.get(ref.p);
        const parsed = tok ? parseToken(tok.text) : null;
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
          locator: { page, box: tok.box.map((x) => Math.round(x * 10000) / 10000), text: tok.text, w: tok.w },
        });
      }
    }
  }
  return { rows, rejected };
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
export function parseTesseractTsv(tsv: string, width: number, height: number, page = 1): PageWords {
  const words: PageWords["words"] = [];
  for (const line of tsv.split("\n").slice(1)) {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const conf = Number(c[10]);
    const text = c[11]?.trim();
    if (!text || conf < 55) continue;
    const [l, t, w, h] = [Number(c[6]), Number(c[7]), Number(c[8]), Number(c[9])];
    words.push({ text, box: [l / width, t / height, (l + w) / width, (t + h) / height] });
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
