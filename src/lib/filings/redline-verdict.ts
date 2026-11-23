// The verdict at the top of Filing changes: how much of the filing changed, which sections drive it,
// and the sections ranked by amount of change. Reads only the stored comparison (src/lib/redline).
import type { Change, Redline, SectionStats } from "@/lib/redline/core";

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
  level: "major" | "moderate" | "light" | "none";
  /** Sections with language changes, by weight (largest first); sections found in one filing only come last. */
  sections: SectionRank[];
  /** The one to three sections that carry most of the weight. */
  drivers: SectionRank[];
}

const language = (c: Change) => !c.figuresOnly;

/**
 * Level of the whole comparison. Major: ten or more high-materiality changes, or new or removed risk
 * factors with at least five high ones, or a quarter of compared paragraphs changed. Moderate: any
 * high-materiality change, or 5% of paragraphs. Light: anything else that changed.
 */
export function levelOf(v: Pick<Verdict, "high" | "share" | "newRisks" | "removedRisks" | "changed">): Verdict["level"] {
  if (!v.changed) return "none";
  if (v.high >= 10 || (v.newRisks + v.removedRisks > 0 && v.high >= 5) || v.share >= 0.25) return "major";
  if (v.high > 0 || v.share >= 0.05) return "moderate";
  return "light";
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
  return { ...v, level: levelOf(v) };
}

export const LEVEL_LABEL: Record<Verdict["level"], string> = {
  major: "Major changes",
  moderate: "Moderate changes",
  light: "Light changes",
  none: "No language changes",
};

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
