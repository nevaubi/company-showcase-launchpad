// Call analytics beyond talk time: the figures management stated, topics rising or fading against the
// previous call, tone from a fixed word list, who asked about what, and the page's own takeaways kept
// only when their figures appear in what was said. Pure; shared by the calls tab and tests.
import { keyTerms } from "./analyze";
import type { ParsedTranscript, TranscriptTurn } from "./parse";

// ───────────────────────── Sentences and figures

/** Sentences of a turn, verbatim (whitespace collapsed). */
export function sentencesOf(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  // Split after . ? ! followed by a capital or a quote, but not inside numbers ("$1.5 billion") or common abbreviations.
  const parts = flat.split(/(?<=(?<!\b(?:Mr|Ms|Mrs|Dr|Inc|Corp|Co|Ltd|vs|U\.S|e\.g|i\.e))[.?!])\s+(?=[A-Z"“(])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|thousand|trillion|[bmk]\b)?/gi;
const PCT = /\b\d+(?:\.\d+)?\s?(?:%|percent\b|percentage points?\b|basis points?\b)/gi;

/** The figures printed in a sentence ("$114.5 billion", "12%", "40 basis points"). */
export function figuresIn(s: string): string[] {
  return [...(s.match(MONEY) ?? []), ...(s.match(PCT) ?? [])].map((x) => x.replace(/\s+/g, " ").trim());
}

const METRICS: [RegExp, string, number][] = [
  [/\b(revenue|revenues|net sales|sales)\b/i, "Revenue", 5],
  [/\b(earnings per share|eps|per diluted share)\b/i, "EPS", 5],
  [/\b(gross margin|operating margin|margin)\b/i, "Margin", 4],
  [/\b(net income|operating income|earnings|profit)\b/i, "Profit", 4],
  [/\b(net interest income|nii|deposits?|loans?|charge-offs?|credit costs?|cet1)\b/i, "Balance sheet", 4],
  [/\b(guidance|outlook|we expect|expect(?:s|ed)? (?:to|our))\b/i, "Outlook", 4],
  [/\b(free cash flow|operating cash flow|cash flow)\b/i, "Cash flow", 3],
  [/\b(buybacks?|repurchases?|dividends?|returned)\b/i, "Capital return", 3],
  [/\b(operating expenses|opex|expenses|capex|capital expenditures?)\b/i, "Costs", 3],
  [/\b(growth|grew|up|increase|record)\b/i, "Growth", 1],
];

export interface CallFigure {
  /** Turn index, for jumping to it. */
  i: number;
  speaker: string;
  topic: string;
  sentence: string;
  figures: string[];
}

/**
 * Sentences in which management states a figure about a metric, in the order said, from the prepared
 * remarks first. Verbatim, so each line is something the company said on the call.
 */
export function callFigures(t: ParsedTranscript, max = 8): CallFigure[] {
  const out: (CallFigure & { score: number; order: number })[] = [];
  const seen = new Set<string>();
  let order = 0;
  const turns = [...t.turns.filter((x) => x.section === "prepared"), ...t.turns.filter((x) => x.section === "qa")].filter((x) => x.kind === "management");
  for (const x of turns) {
    for (const s of sentencesOf(x.text)) {
      order++;
      if (s.length < 30 || s.length > 320) continue;
      const figs = figuresIn(s);
      if (!figs.length) continue;
      const hit = METRICS.find(([re]) => re.test(s));
      if (!hit) continue;
      const key = figs.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const score = hit[2] + Math.min(figs.length, 3) + (x.section === "prepared" ? 2 : 0) - (/\b(year[- ]to[- ]date|nine months|full[- ]year)\b/i.test(s) ? 2 : 0);
      out.push({ i: x.i, speaker: x.speaker, topic: hit[1], sentence: s, figures: figs, score, order });
    }
  }
  return out
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map(({ score: _s, order: _o, ...f }) => f);
}

// ───────────────────────── Topics against the previous call

const normalize = (s: string) => s.toLowerCase().replace(/[’']s\b/g, "");

/** Occurrences of a term (word or two-word phrase) in the non-operator turns, as whole words. */
export function termCount(t: ParsedTranscript, term: string): number {
  const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[^a-z0-9]+")}(?=$|[^a-z0-9])`, "g");
  let n = 0;
  for (const x of t.turns) if (x.kind !== "operator") n += normalize(x.text).match(re)?.length ?? 0;
  return n;
}

export type TopicTrend = "new" | "rising" | "steady" | "fading" | "dropped";

export interface TopicRow {
  term: string;
  count: number;
  /** Mentions per 10,000 words on this call. */
  rate: number;
  prevCount: number | null;
  prevRate: number | null;
  trend: TopicTrend | null;
}

/**
 * The call's most discussed terms, with their rate per 10,000 words against the previous call. A topic is
 * new when the previous call never used it, rising or fading when its rate moved by half or more (and by at
 * least three mentions), dropped when a top topic of the previous call fell below a quarter of its rate.
 */
export function topicShift(cur: ParsedTranscript, prev: ParsedTranscript | null, n = 12, exclude: string[] = []): TopicRow[] {
  // Names from either call (a CEO addressed as "Tim" on one call and gone on the next is not a topic).
  const nameWords = [...cur.speakers, ...(prev?.speakers ?? [])].flatMap((sp) => sp.name.toLowerCase().split(/\s+/)).filter((w) => w.length >= 3);
  const isName = (term: string) => term.split(" ").some((w) => w.length >= 3 && nameWords.some((nw) => nw === w || nw.startsWith(w)));
  const per = (c: number, words: number) => (words ? (c / words) * 10_000 : 0);
  const terms = keyTerms(cur, n + 4, exclude)
    .map((k) => k.term)
    .filter((term) => !isName(term))
    .slice(0, n);
  const rows: TopicRow[] = terms.map((term) => {
    const count = termCount(cur, term);
    const rate = per(count, cur.words);
    if (!prev) return { term, count, rate, prevCount: null, prevRate: null, trend: null };
    const pc = termCount(prev, term);
    const pr = per(pc, prev.words);
    const trend: TopicTrend = pc === 0 ? "new" : rate >= pr * 1.5 && count - pc >= 3 ? "rising" : rate <= pr / 1.5 && pc - count >= 3 ? "fading" : "steady";
    return { term, count, rate, prevCount: pc, prevRate: pr, trend };
  });
  if (prev) {
    const have = new Set(terms);
    for (const k of keyTerms(prev, n, exclude)) {
      if (have.has(k.term) || isName(k.term)) continue;
      const pc = termCount(prev, k.term);
      const count = termCount(cur, k.term);
      const pr = per(pc, prev.words);
      const rate = per(count, cur.words);
      if (rate < pr / 4 && pc >= 5) rows.push({ term: k.term, count, rate, prevCount: pc, prevRate: pr, trend: "dropped" });
    }
  }
  return rows;
}

// ───────────────────────── Tone

/**
 * A short finance word list in the manner of Loughran and McDonald (2011): words that read positive or
 * negative in company disclosures, plus hedging words. Counted in management's words only.
 */
const POSITIVE = new Set(
  "strong strength stronger strongest record records improve improved improvement improving exceed exceeded exceeding outperform outperformed momentum robust gain gains growing accelerate accelerated accelerating benefit benefited benefits success successful pleased confident confidence opportunity opportunities favorable healthy resilient resilience solid best excellent progress achieve achieved efficient efficiency expand expanded expansion advantage leading".split(" "),
);
const NEGATIVE = new Set(
  "weak weaker weakness decline declined declines declining decrease decreased loss losses headwind headwinds pressure pressures pressured challenging challenge challenges difficult difficulty slowdown slower slowed shortfall miss missed adverse adversely impairment impairments disruption disruptions volatile volatility constrained constraint constraints uncertain risk risks deteriorate deteriorated deterioration concern concerns lower downturn negative unfavorable delays delayed".split(" "),
);
const HEDGE = new Set("may might could possibly approximately uncertain uncertainty depend depends depending believe roughly perhaps assume assumptions".split(" "));

export interface ToneScore {
  words: number;
  positive: number;
  negative: number;
  hedge: number;
  /** (positive − negative) ÷ (positive + negative), −1 to 1. */
  net: number | null;
  /** Hedging words per 1,000 words. */
  hedgeRate: number;
}

function toneOf(turns: TranscriptTurn[]): ToneScore {
  let pos = 0;
  let neg = 0;
  let hedge = 0;
  let words = 0;
  for (const x of turns) {
    for (const w of normalize(x.text).split(/[^a-z-]+/)) {
      if (!w) continue;
      words++;
      if (POSITIVE.has(w)) pos++;
      else if (NEGATIVE.has(w)) neg++;
      if (HEDGE.has(w)) hedge++;
    }
  }
  return { words, positive: pos, negative: neg, hedge, net: pos + neg >= 10 ? (pos - neg) / (pos + neg) : null, hedgeRate: words ? (hedge / words) * 1000 : 0 };
}

/** Management tone in the prepared remarks and in its Q&A answers. */
export function callTone(t: ParsedTranscript): { prepared: ToneScore; qa: ToneScore } {
  const mgmt = t.turns.filter((x) => x.kind === "management");
  return { prepared: toneOf(mgmt.filter((x) => x.section === "prepared")), qa: toneOf(mgmt.filter((x) => x.section === "qa")) };
}

// ───────────────────────── Who asked what

export interface Exchange {
  /** First turn of the analyst's exchange. */
  i: number;
  analyst: string;
  firm: string | null;
  /** The analyst's words across the exchange (follow-ups included). */
  words: number;
  /** Management's words answering, until the next analyst. */
  answerWords: number;
  /** The call's top topics this exchange touched. */
  topics: string[];
  gist: string;
  /** Who answered, most words first. */
  answeredBy: string[];
}

/**
 * One row per analyst exchange, with who answered and the topics that set it apart: of the call's top
 * topics, those mentioned at least twice in the exchange, ranked by the share of the call's mentions that
 * fall in it (so a word used everywhere, like the company's main product, does not tag every question).
 */
export function exchanges(t: ParsedTranscript, topics: string[], gistOf: (text: string) => string): Exchange[] {
  const totals = new Map(topics.map((tp) => [tp, Math.max(1, termCount(t, tp))]));
  const firm = new Map(t.speakers.map((s) => [s.name, s.firm]));
  const out: (Exchange & { text: string; by: Map<string, number> })[] = [];
  let cur: (typeof out)[number] | null = null;
  for (const x of t.turns) {
    // Unidentified speakers are neither a question nor an answer: their words are not attributed.
    if (x.section !== "qa" || x.kind === "operator" || x.kind === "unidentified") continue;
    if (x.kind === "analyst") {
      if (!cur || cur.analyst !== x.speaker) {
        cur = { i: x.i, analyst: x.speaker, firm: firm.get(x.speaker) ?? null, words: 0, answerWords: 0, topics: [], gist: "", answeredBy: [], text: "", by: new Map() };
        out.push(cur);
      }
      cur.words += x.words;
      cur.text += ` ${x.text}`;
    } else if (cur) {
      cur.answerWords += x.words;
      cur.by.set(x.speaker, (cur.by.get(x.speaker) ?? 0) + x.words);
      cur.text += ` ${x.text}`;
    }
  }
  return out.map(({ text, by, ...e }) => {
    const low = normalize(text);
    const analystText = t.turns.filter((x) => x.kind === "analyst" && x.speaker === e.analyst && x.i >= e.i).map((x) => x.text)[0] ?? "";
    return {
      ...e,
      topics: topics
        .map((tp) => ({ tp, c: low.match(new RegExp(`(^|[^a-z0-9])${tp.replace(/ /g, "[^a-z0-9]+")}(?=$|[^a-z0-9])`, "g"))?.length ?? 0 }))
        .filter((x) => x.c >= 2)
        .sort((a, b) => b.c / totals.get(b.tp)! - a.c / totals.get(a.tp)!)
        .slice(0, 3)
        .map((x) => x.tp),
      gist: gistOf(analystText),
      answeredBy: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
    };
  });
}

// ───────────────────────── Machine-written text, checked against the call

/** A number stated in text, normalised: "76.0%" and "76%" are one figure, "$2.5 billion" is 2.5e9 dollars. */
export interface StatedNumber {
  raw: string;
  value: number;
  unit: "usd" | "pct" | "pp" | "bp" | "count";
}

const NUM =
  /(\$\s?)?(?<![A-Za-z\d.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(%|percent\b|percentage points?\b|basis points?\b|bps\b|trillion\b|billion\b|million\b|thousand\b|bn\b|mm\b|[bmkt]\b))?/gi;
const SCALE: Record<string, number> = { trillion: 1e12, t: 1e12, billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mm: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

/**
 * Every number in a sentence, with or without a dollar sign or percent: bare counts ("650,000 accounts",
 * "over 2.5 billion devices") are figures too. Years (1990 to 2049 with no unit), quarter and fiscal-year
 * names ("Q4", "FY26") and numbers that are part of a word ("10-K", "1st") are not.
 */
export function numbersIn(s: string): StatedNumber[] {
  const out: StatedNumber[] = [];
  for (const m of s.matchAll(NUM)) {
    const [raw, dollar, int, frac = "", unitRaw] = m;
    const after = s.slice((m.index ?? 0) + raw.length);
    const u = unitRaw?.toLowerCase().replace(/\s+/g, " ");
    if (!u && /^(?:-?[A-Za-z]|st\b|nd\b|rd\b|th\b)/.test(after)) continue;
    const base = Number(int.replace(/,/g, "") + frac);
    if (!Number.isFinite(base)) continue;
    if (!dollar && !u && !frac && !int.includes(",") && base >= 1990 && base <= 2049) continue;
    let unit: StatedNumber["unit"] = dollar ? "usd" : "count";
    let value = base;
    if (u === "%" || u === "percent") unit = "pct";
    else if (u?.startsWith("percentage point")) unit = "pp";
    else if (u?.startsWith("basis point") || u === "bps") unit = "bp";
    else if (u) value = base * (SCALE[u] ?? 1);
    out.push({ raw: raw.trim(), value, unit });
  }
  return out;
}

const sameNumber = (a: StatedNumber, b: StatedNumber) => {
  // Dollars and bare amounts are interchangeable ("revenue of 102.5 billion"); rates keep their unit.
  const money = (u: StatedNumber["unit"]) => u === "usd" || u === "count";
  const unitOk = a.unit === b.unit || (money(a.unit) && money(b.unit));
  return unitOk && Math.abs(a.value - b.value) <= 1e-9 * Math.max(1, Math.abs(a.value));
};

const STOP = new Set(
  "that this with from have were been about over under than more less into also their there which while what when where will would could should quarter quarters year years fiscal compared versus prior period periods company management total overall approximately around nearly roughly billion million thousand trillion percent basis points point increase increased increasing decrease decreased decreasing growth growing grew reached reaching record high higher lower down level levels across during driven double digits digit".split(
    " ",
  ),
);

/** Content words used to tie a figure to what it is about ("Services gross margin" → services, gross, margin). */
export function keyWords(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).map((w) => w.replace(/(?:ies|es|s)$/, "")).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

interface SaidSentence {
  turn: number;
  nums: StatedNumber[];
  words: Set<string>;
}

function managementSentences(t: ParsedTranscript): SaidSentence[] {
  const out: SaidSentence[] = [];
  for (const x of t.turns) {
    if (x.kind !== "management") continue;
    for (const sen of sentencesOf(x.text)) {
      const nums = numbersIn(sen);
      if (nums.length) out.push({ turn: x.i, nums, words: new Set(keyWords(sen)) });
    }
  }
  return out;
}

export type ClaimStatus = "checked" | "not-found" | "no-figure";

export interface CheckedClaim {
  label: string;
  text: string;
  status: ClaimStatus;
  /** Turn where management said the first figure, when found. */
  i: number | null;
}

/**
 * Check machine-written statements against what management said. A statement is "checked" when every
 * number in it (dollar amounts, rates and bare counts alike) appears in a management sentence that also
 * contains one of the statement's key words: the label's when it has one ("Services gross margin"),
 * otherwise the statement's own. "not-found" when any number is missing; "no-figure" when it states none.
 */
export function checkClaims(t: ParsedTranscript, items: { label: string; text: string }[]): CheckedClaim[] {
  const said = managementSentences(t);
  return items.map((it) => {
    // The publisher's stock-move tag ("(NVDA +32.09%)") is page furniture, not a claim about the call.
    const nums = numbersIn(it.text.replace(/\([A-Z][A-Z.]{0,5}\s?[+\u2212-]\d+(?:\.\d+)?%\)/g, ""));
    if (!nums.length) return { label: it.label, text: it.text, status: "no-figure", i: null };
    const keys = keyWords(it.label || it.text);
    let first: number | null = null;
    for (const n of nums) {
      const hit = said.find((x) => x.nums.some((m) => sameNumber(n, m)) && (!keys.length || keys.some((k) => x.words.has(k))));
      if (!hit) return { label: it.label, text: it.text, status: "not-found", i: null };
      first ??= hit.turn;
    }
    return { label: it.label, text: it.text, status: "checked", i: first };
  });
}

export interface CheckedTakeaway {
  label: string;
  text: string;
  /** Turn where management said the figures. */
  i: number | null;
}

/**
 * The publisher's takeaways that pass `checkClaims`. Only checked ones are kept: a takeaway with a number
 * not found that way, or with no number at all, is left out and counted.
 */
export function checkTakeaways(
  t: ParsedTranscript,
  items: { label: string; text: string }[],
): { kept: CheckedTakeaway[]; dropped: number; notFound: number; noFigure: number } {
  const r = checkClaims(t, items);
  const kept = r.filter((x) => x.status === "checked").map(({ label, text, i }) => ({ label, text, i }));
  const notFound = r.filter((x) => x.status === "not-found").length;
  const noFigure = r.filter((x) => x.status === "no-figure").length;
  return { kept, dropped: notFound + noFigure, notFound, noFigure };
}

/**
 * The publisher's summary, sentence by sentence: sentences with a number not found in management's words
 * are removed. Sentences without a number are kept (the block stays labelled machine-written). Null when
 * fewer than half of the sentences stating a number check, since what is left would misrepresent the call.
 */
export function checkSummary(t: ParsedTranscript, summary: string): { text: string; removed: number; checked: number } | null {
  const sens = sentencesOf(summary);
  const r = checkClaims(
    t,
    sens.map((text) => ({ label: "", text })),
  );
  const withNums = r.filter((x) => x.status !== "no-figure");
  const checked = withNums.filter((x) => x.status === "checked").length;
  if (withNums.length && checked * 2 < withNums.length) return null;
  const keep = r.filter((x) => x.status !== "not-found");
  if (!keep.length) return null;
  return { text: keep.map((x) => x.text).join(" "), removed: r.length - keep.length, checked };
}

// ───────────────────────── Analyst firms that are covered companies

const FIRM_TICKERS: [RegExp, string][] = [
  [/\bgoldman\b/i, "GS"],
  [/\bmorgan stanley\b/i, "MS"],
  [/\b(j\.?\s?p\.?\s?morgan|jpmorgan)\b/i, "JPM"],
  [/\b(bank of america|bofa|merrill)\b/i, "BAC"],
  [/\b(citi|citigroup|citibank)\b/i, "C"],
  [/\bwells fargo\b/i, "WFC"],
  [/\bevercore\b/i, "EVR"],
  [/\braymond james\b/i, "RJF"],
  [/\bpiper sandler\b/i, "PIPR"],
  [/\bjefferies\b/i, "JEF"],
  [/\bstifel\b/i, "SF"],
  [/\bkeybanc\b/i, "KEY"],
  [/\btruist\b/i, "TFC"],
  [/\boppenheimer\b/i, "OPY"],
  [/\bmorningstar\b/i, "MORN"],
  [/\bmoelis\b/i, "MC"],
  [/\bcowen\b/i, "TD"],
  [/\bbmo\b/i, "BMO"],
  [/\b(rbc|royal bank of canada)\b/i, "RY"],
  [/\bubs\b/i, "UBS"],
  [/\bbarclays\b/i, "BCS"],
  [/\bdeutsche\b/i, "DB"],
  [/\bhsbc\b/i, "HSBC"],
  [/\bmizuho\b/i, "MFG"],
];

/** The listed ticker of an analyst's firm when the firm is a covered company, else null. */
export function firmTicker(firm: string | null | undefined, covered: (t: string) => boolean): string | null {
  if (!firm) return null;
  for (const [re, t] of FIRM_TICKERS) if (re.test(firm)) return covered(t) ? t : null;
  return null;
}
