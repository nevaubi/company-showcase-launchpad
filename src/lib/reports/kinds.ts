// Report kinds, their sections and the prompt contract. Pure.
import type { ReportKind, ReportOptions } from "./types";

export interface SectionDef { id: string; title: string; brief: string; tables?: string[] }
export interface KindDef { kind: ReportKind; label: string; short: string; description: string; sections: SectionDef[]; tables: string[] }

export const KINDS: Record<ReportKind, KindDef> = {
  primer: {
    kind: "primer",
    label: "Company primer",
    short: "Primer",
    description: "Everything a new analyst needs: the business, how it makes money, financial profile, capital allocation, valuation, debates and risks.",
    tables: ["financials", "segments-1", "segments-2", "valuation", "estimates"],
    sections: [
      { id: "summary", title: "Investment summary", brief: "4-6 bullets: what the company is, what drives the numbers now, the debate, and what matters next." },
      { id: "business", title: "Business overview", brief: "How the company makes money — segments, mix and their trajectory.", tables: ["segments-1", "segments-2"] },
      { id: "financials", title: "Financial profile", brief: "Multi-year growth, margin and cash-flow trajectory; what changed recently.", tables: ["financials"] },
      { id: "capital", title: "Balance sheet & capital allocation", brief: "Cash, debt, buybacks, dividends, capex and stock compensation." },
      { id: "valuation", title: "Valuation & the street", brief: "Current multiples, consensus expectations, rating mix and recent analyst actions.", tables: ["valuation", "estimates"] },
      { id: "debates", title: "Key debates", brief: "3-5 bullets, each framing a bull view and a bear view grounded in the facts." },
      { id: "risks", title: "Risks", brief: "Specific, evidence-based risks (concentration, margins, balance sheet, execution, insiders)." },
      { id: "watch", title: "What to watch", brief: "Upcoming catalysts and the metrics that would change the picture." },
    ],
  },
  preview: {
    kind: "preview",
    label: "Earnings preview",
    short: "Preview",
    description: "Into the print: what the street expects, revisions, the KPIs and promises to check, how the stock usually reacts and questions for management.",
    tables: ["estimates", "quarters", "reactions"],
    sections: [
      { id: "setup", title: "Setup into the print", brief: "Date, recent trend in results and estimates, and the stock's positioning." },
      { id: "street", title: "What the street expects", brief: "Consensus EPS and revenue, the range, revision direction and implied growth.", tables: ["estimates"] },
      { id: "watch", title: "What to watch", brief: "4-6 bullets: specific lines, margins, segments and open management commitments to check.", tables: ["quarters"] },
      { id: "history", title: "How the stock reacts", brief: "Historical earnings-day moves, direction hit rate and post-print drift.", tables: ["reactions"] },
      { id: "scenarios", title: "Scenarios", brief: "Upside and downside paths — what each would require, using only cited numbers." },
      { id: "questions", title: "Questions for management", brief: "5-7 sharp questions tied to cited facts or open promises." },
    ],
  },
  recap: {
    kind: "recap",
    label: "Earnings recap",
    short: "Recap",
    description: "The latest reported quarter: results versus a year ago and versus expectations, drivers, guidance and promises, and the market's reaction.",
    tables: ["quarters", "estimates", "reactions"],
    sections: [
      { id: "headline", title: "Results at a glance", brief: "4-6 bullets with the headline numbers of the latest reported quarter." },
      { id: "vs", title: "Versus expectations", brief: "EPS surprise history and how the quarter compared with consensus." },
      { id: "drivers", title: "Drivers", brief: "What moved revenue and margins year over year; segment mix where available.", tables: ["quarters"] },
      { id: "guidance", title: "Guidance & management commitments", brief: "What management promised and whether earlier promises were kept, with quotes." },
      { id: "reaction", title: "Market reaction", brief: "How the stock reacted to this and prior releases.", tables: ["reactions"] },
      { id: "takeaways", title: "Takeaways", brief: "3-5 bullets on what changed in the investment picture and what to track next." },
    ],
  },
  memo: {
    kind: "memo",
    label: "IC memo",
    short: "IC memo",
    description: "An investment-committee memo: thesis, where we differ from consensus, value drivers, valuation, catalysts, what would make us wrong and open diligence.",
    tables: ["financials", "valuation", "estimates"],
    sections: [
      { id: "recommendation", title: "Thesis", brief: "The core thesis in 3-5 bullets. If a firm rating is cited, frame the thesis around it; otherwise present the balanced case without recommending." },
      { id: "variant", title: "Where we could differ from consensus", brief: "Compare consensus expectations with the trajectory in reported numbers." },
      { id: "drivers", title: "Key value drivers", brief: "The few metrics that determine the outcome and their recent trend.", tables: ["financials"] },
      { id: "valuation", title: "Valuation", brief: "Current multiples, cash generation and street targets.", tables: ["valuation", "estimates"] },
      { id: "catalysts", title: "Catalysts", brief: "Dated events and what each could reveal." },
      { id: "risks", title: "What would make us wrong", brief: "Specific, falsifiable risks with evidence." },
      { id: "diligence", title: "Open diligence", brief: "4-6 questions or checks before acting, tied to facts." },
    ],
  },
};

export const KIND_ORDER: ReportKind[] = ["primer", "preview", "recap", "memo"];

export const DEFAULT_OPTIONS: ReportOptions = { length: "standard", audience: "internal", stance: "balanced", sections: [], focus: "" };

export const LENGTH_LABEL: Record<ReportOptions["length"], string> = { brief: "Brief", standard: "Standard", deep: "In-depth" };
export const AUDIENCE_LABEL: Record<ReportOptions["audience"], string> = { internal: "Internal research", pm: "Portfolio manager", ic: "Investment committee", client: "Client-ready" };
export const STANCE_LABEL: Record<ReportOptions["stance"], string> = { balanced: "Balanced", constructive: "Constructive", skeptical: "Skeptical" };

/** Clamp unknown values to defaults and keep only the kind's section ids. */
export function normalizeOptions(kind: ReportKind, o: Partial<ReportOptions> | null | undefined): ReportOptions {
  const valid = new Set(KINDS[kind].sections.map((s) => s.id));
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  const sections = [...new Set((o?.sections ?? []).filter((s) => valid.has(s)))];
  return {
    length: pick(o?.length, ["brief", "standard", "deep"] as const, "standard"),
    audience: pick(o?.audience, ["internal", "pm", "ic", "client"] as const, "internal"),
    stance: pick(o?.stance, ["balanced", "constructive", "skeptical"] as const, "balanced"),
    sections: sections.length === valid.size && sections.every((s, i) => s === KINDS[kind].sections[i].id) ? [] : sections,
    focus: (o?.focus ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

export const isDefaultOptions = (o: ReportOptions) =>
  o.length === "standard" && o.audience === "internal" && o.stance === "balanced" && !o.sections.length && !o.focus;

/** Stable key for a customized variant ("base" for defaults). */
export function variantKey(o: ReportOptions): string {
  if (isDefaultOptions(o)) return "base";
  const s = JSON.stringify([o.length, o.audience, o.stance, o.sections, o.focus.toLowerCase()]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `v${(h >>> 0).toString(36)}`;
}

export function sectionsFor(kind: ReportKind, o: ReportOptions): SectionDef[] {
  const all = KINDS[kind].sections;
  if (!o.sections.length) return all;
  return o.sections.map((id) => all.find((s) => s.id === id)!).filter(Boolean);
}

const LENGTH_GUIDE: Record<ReportOptions["length"], string> = {
  brief: "Keep it tight: 1 short paragraph or 2-4 bullets per section.",
  standard: "1-2 paragraphs (3-5 sentences each) and/or 3-6 bullets per section.",
  deep: "2-4 substantive paragraphs plus 4-8 bullets per section; connect evidence across areas.",
};
const AUDIENCE_GUIDE: Record<ReportOptions["audience"], string> = {
  internal: "Write for a fellow analyst: direct, technical, no throat-clearing.",
  pm: "Write for a portfolio manager: lead with what matters for the position and the next move.",
  ic: "Write for an investment committee: structured, balanced, explicit about uncertainty.",
  client: "Write for a sophisticated client: polished, plain-English, no internal shorthand, no trading instructions.",
};
const STANCE_GUIDE: Record<ReportOptions["stance"], string> = {
  balanced: "Weigh evidence on both sides evenly.",
  constructive: "Lead with the strongest evidence-based bull case, but still state the material risks.",
  skeptical: "Pressure-test the bull case and lead with the evidence-based risks, but acknowledge strengths.",
};

export function reportInstructions(kind: ReportKind, o: ReportOptions, name: string, ticker: string, firm: string | null): string {
  const def = KINDS[kind];
  return [
    `You are a senior equity research analyst${firm ? ` at ${firm}` : ""} writing a ${def.label.toLowerCase()} on ${name} (${ticker}).`,
    "Use ONLY the numbered facts. Every paragraph and bullet must cite the ids of the facts it relies on in factIds.",
    "Every number you write (dollar amounts, percentages, multiples, per-share values, counts above 12) must appear verbatim in one of the cited facts — copy the figure exactly as the fact formats it. Never compute new numbers, never round differently, never estimate.",
    "Dates may be written as in the facts. Do not invent guidance, events, products or quotes. If the facts don't support a section, write one sentence saying what data is missing.",
    "Third-party consensus and price data are 'street' or 'market' data; SEC figures are 'reported'. Keep that distinction clear.",
    "No price targets or buy/sell recommendations of your own; you may restate a firm rating only if a coverage fact provides it.",
    LENGTH_GUIDE[o.length], AUDIENCE_GUIDE[o.audience], STANCE_GUIDE[o.stance],
    o.focus ? `Emphasis requested by the user: ${o.focus}` : "",
    "Write as the analyst: never mention 'facts', 'supplied data', 'the dataset' or how the information was gathered. Use 'reported' for SEC figures and 'consensus'/'the street' for third-party estimates.",
    "Return a title (short, specific, may name the key theme) and a one-line subtitle. Plain text only: no markdown, no links, no citation brackets in the text.",
  ].filter(Boolean).join("\n");
}

export function reportInput(sections: { id: string; title: string; brief: string }[], facts: { id: string; area: string; text: string }[], background: string, today: string): string {
  return [
    `Today: ${today}.`,
    background ? `Background (context only, not citable, contains no numbers to use): ${background.replace(/\d[\d,.]*/g, "#")}` : "",
    "Sections to write, in order (use these ids):",
    ...sections.map((s) => `- ${s.id} — ${s.title}: ${s.brief}`),
    "",
    "Facts:",
    ...facts.map((f) => `[${f.id}] (${f.area}) ${f.text}`),
  ].filter(Boolean).join("\n");
}

const CLAIM = {
  type: "object", additionalProperties: false, required: ["text", "factIds"],
  properties: { text: { type: "string" }, factIds: { type: "array", items: { type: "string" } } },
} as const;

export function reportSchema(sectionIds: string[]) {
  return {
    type: "object", additionalProperties: false, required: ["title", "subtitle", "sections"],
    properties: {
      title: { type: "string" },
      subtitle: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["id", "paragraphs", "bullets"],
          properties: {
            id: { type: "string", enum: sectionIds },
            paragraphs: { type: "array", items: CLAIM },
            bullets: { type: "array", items: CLAIM },
          },
        },
      },
    },
  };
}
