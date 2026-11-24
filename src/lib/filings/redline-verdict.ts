// The verdict at the top of Filing changes: how much of the filing changed, which sections drive it,
// and the sections ranked by amount of change. Reads only the stored comparison (src/lib/redline).
import type { Change, Redline, SectionStats } from "@/lib/redline/core";
import { normFor, normLevel, percentileOf, rankPhrase, type FormNorm, type NormLevel } from "./redline-norms";

export interface SectionRank {
  key: string;
  title: string;
  added: number;
  removed: number;
  changed: number;
  /** Paragraphs compared in both filings (changed + figure-only + unchanged + moved), the denominator of `share`. */
  paragraphs: number;
  /** Share of the section's paragraphs added, removed or rewritten (0..1). */
  share: number;
  high: number;
  medium: number;
  /** Sum of the rule-based scores of the section's language changes: what "drives" the change. */
  weight: number;
  found: SectionStats["found"];
}

export interface Verdict {
  /** Paragraphs added, removed or rewritten across the compared sections (figure-only updates left out). */
  changed: number;
  paragraphs: number;
  /** changed / paragraphs, 0..1 */
  share: number;
  high: number;
  medium: number;
  newRisks: number;
  removedRisks: number;
  added: number;
  removed: number;
  rewritten: number;
  wordsAdded: number;
  wordsRemoved: number;
  /**
   * Grade against stored comparisons of the same form (redline-norms.ts): "unusual" is the top 5%,
   * "high" the next 20%, "low" the bottom quarter. "none" when no language changed; "unrated" when
   * nothing of this form is stored to compare with.
   */
  level: NormLevel | "none" | "unrated";
  /** Share of stored comparisons of the same form with less change (0..1), null when unrated. */
  rank: number | null;
  /** "More change than 8 in 10 annual reports", null when unrated or nothing changed. */
  basis: string | null;
  /** The norm the grade came from (sample size and date for the caption). */
  norm: FormNorm | null;
  /** Core sections (Business, Risk factors, MD&A, Financial statements) that were not compared in both filings. */
  notCompared: { key: string; title: string; found: SectionStats["found"] | "missing" }[];
  /** Sections with language changes, by weight (largest first); sections found in one filing only come last. */
  sections: SectionRank[];
  /** The one to three sections that carry most of the weight. */
  drivers: SectionRank[];
}

const language = (c: Change) => !c.figuresOnly;

/** Core sections a reader expects compared, by form. A comparison without one of them says so. */
export const CORE_SECTIONS: Record<string, { key: string; title: string }[]> = {
  "10-K": [
    { key: "1", title: "Business" },
    { key: "1A", title: "Risk factors" },
    { key: "7", title: "MD&A" },
    { key: "8", title: "Financial statements & notes" },
  ],
  "10-Q": [
    { key: "I-1", title: "Financial statements & notes" },
    { key: "I-2", title: "MD&A" },
  ],
};

/** Grade a share of changed paragraphs against stored comparisons of the same form. */
export function gradeShare(form: string, share: number, changed: number): Pick<Verdict, "level" | "rank" | "basis" | "norm"> {
  const norm = normFor(form);
  if (!changed) return { level: "none", rank: norm ? 0 : null, basis: null, norm };
  if (!norm) return { level: "unrated", rank: null, basis: null, norm: null };
  const rank = percentileOf(norm, share);
  return { level: normLevel(rank), rank, basis: rankPhrase(rank, norm.noun), norm };
}

export function redlineVerdict(r: Redline): Verdict {
  const cs = r.changes.filter(language);
  const weightOf = new Map<string, number>();
  for (const c of cs) weightOf.set(c.section, (weightOf.get(c.section) ?? 0) + c.score);
  const sections: SectionRank[] = r.sections.map((s) => {
    const changed = s.added + s.removed + s.changed;
    const paragraphs = changed + s.figuresOnly + s.unchanged + s.moved;
    return {
      key: s.key,
      title: s.title,
      added: s.added,
      removed: s.removed,
      changed: s.changed,
      paragraphs,
      share: paragraphs ? changed / paragraphs : 0,
      high: s.high,
      medium: s.medium,
      weight: Math.round(weightOf.get(s.key) ?? 0),
      found: s.found,
    };
  });
  sections.sort((a, b) => Number(b.found === "both") - Number(a.found === "both") || b.weight - a.weight || b.added + b.removed + b.changed - (a.added + a.removed + a.changed));
  const both = sections.filter((s) => s.found === "both");
  const total = both.reduce((n, s) => n + s.weight, 0);
  // Drivers: the heaviest sections until they hold two thirds of the weight (at most three).
  const drivers: SectionRank[] = [];
  let acc = 0;
  for (const s of both) {
    if (!s.weight || drivers.length === 3 || (drivers.length && acc >= total * 0.67)) break;
    drivers.push(s);
    acc += s.weight;
  }
  const risk = cs.filter((c) => c.section === "1A" || c.section === "II-1A");
  const changed = both.reduce((n, s) => n + s.added + s.removed + s.changed, 0);
  const paragraphs = both.reduce((n, s) => n + s.paragraphs, 0);
  const v = {
    changed,
    paragraphs,
    share: paragraphs ? changed / paragraphs : 0,
    high: cs.filter((c) => c.level === "high").length,
    medium: cs.filter((c) => c.level === "medium").length,
    newRisks: risk.filter((c) => c.type === "added" && c.isHeading).length,
    removedRisks: risk.filter((c) => c.type === "removed" && c.isHeading).length,
    added: cs.filter((c) => c.type === "added").length,
    removed: cs.filter((c) => c.type === "removed").length,
    rewritten: cs.filter((c) => c.type === "changed").length,
    wordsAdded: cs.reduce((n, c) => n + c.wordsAdded, 0),
    wordsRemoved: cs.reduce((n, c) => n + c.wordsRemoved, 0),
    sections,
    drivers,
  };
  // A filer organised by topic is compared as one "Full report" section, which covers every Item.
  const core = r.sections.some((s) => s.key === "ALL") ? [] : (CORE_SECTIONS[r.form] ?? []);
  const notCompared = core
    .map((c) => ({ ...c, found: (r.sections.find((s) => s.key === c.key)?.found ?? "missing") as Verdict["notCompared"][number]["found"] }))
    .filter((c) => c.found !== "both");
  return { ...v, ...gradeShare(r.form, v.share, v.changed), notCompared };
}

export const LEVEL_LABEL: Record<Verdict["level"], string> = {
  unusual: "Unusually large change",
  high: "More change than usual",
  typical: "Typical amount of change",
  low: "Less change than usual",
  none: "No language changes",
  unrated: "Changes",
};

/** "MD&A and Business were not compared: not found in both filings." Null when every core section was compared. */
export function notComparedSentence(v: Verdict): string | null {
  if (!v.notCompared.length) return null;
  const names = v.notCompared.map((c) => c.title);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const one = v.notCompared.every((c) => c.found === "new" || c.found === "old");
  return `${who} ${names.length > 1 ? "were" : "was"} not compared: ${one ? "found in only one of the two filings" : "not found in both filings"}. The share above leaves ${names.length > 1 ? "them" : "it"} out.`;
}

/** One sentence naming what drives the change, e.g. "Driven by Risk factors and MD&A: 26 high-materiality changes, 3 new risk factors." */
export function verdictSentence(v: Verdict): string {
  if (v.level === "none") return "The compared sections read the same; only figures changed.";
  const names = v.drivers.map((d) => d.title);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const facts = [
    v.high ? `${v.high} high-materiality ${v.high === 1 ? "change" : "changes"}` : null,
    v.newRisks ? `${v.newRisks} new risk ${v.newRisks === 1 ? "factor" : "factors"}` : null,
    v.removedRisks ? `${v.removedRisks} risk ${v.removedRisks === 1 ? "factor" : "factors"} removed` : null,
  ].filter(Boolean);
  return `${who ? `Driven by ${who}` : "Spread across sections"}${facts.length ? `: ${facts.join(", ")}` : ""}.`;
}
