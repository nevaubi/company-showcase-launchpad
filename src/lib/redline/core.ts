// Build a ranked filing redline: section split → paragraph diff → materiality score. Pure.
import { htmlToBlocks, SECTION_DEFS, splitSections, type Block } from "./extract";
import { diffBlocks, opWords, type Op } from "./diff";

export const REDLINE_VERSION = 1;

export interface FilingRef { accn: string; doc: string; form: string; filed: string; report?: string }

export type Level = "high" | "medium" | "low";

export interface Change {
  id: string;
  section: string;
  type: "added" | "removed" | "changed";
  /** New/removed risk-factor or note heading */
  isHeading: boolean;
  /** Closest heading above the paragraph in the newer (or older, for removals) filing */
  context: string | null;
  before?: string;
  after?: string;
  ops?: Op[];
  figuresOnly: boolean;
  wordsAdded: number;
  wordsRemoved: number;
  score: number;
  level: Level;
  why: string[];
  terms: string[];
}

export interface SectionStats { key: string; title: string; added: number; removed: number; changed: number; figuresOnly: number; unchanged: number; moved: number; wordsAdded: number; wordsRemoved: number; high: number; medium: number; found: "both" | "old" | "new" }

export interface Redline {
  version: number;
  ticker: string;
  form: "10-K" | "10-Q";
  from: FilingRef;
  to: FilingRef;
  sections: SectionStats[];
  changes: Change[];
  createdAt: string;
}

/** Topics that make a change worth reading first. `w` = points when newly mentioned. */
const TERMS: { label: string; re: RegExp; w: number }[] = [
  { label: "material weakness", re: /material weakness/i, w: 40 },
  { label: "going concern", re: /going concern/i, w: 40 },
  { label: "restatement", re: /\brestat(e|ed|ement)/i, w: 30 },
  { label: "investigation", re: /\b(investigation|subpoena|civil investigative demand|wells notice)\b/i, w: 22 },
  { label: "regulator", re: /\b(SEC|DOJ|Department of Justice|FTC|Federal Trade Commission|European Commission|CFPB|FDA warning)\b/, w: 12 },
  { label: "litigation", re: /\b(lawsuit|class action|complaint was filed|litigation|arbitration|jury|verdict)\b/i, w: 12 },
  { label: "settlement", re: /\bsettle(ment|d)\b/i, w: 10 },
  { label: "antitrust", re: /\b(antitrust|anti-competitive|competition authorit)/i, w: 15 },
  { label: "impairment", re: /\bimpair(ment|ed)\b/i, w: 15 },
  { label: "covenant / default", re: /\b(covenant|event of default|acceleration of)\b/i, w: 15 },
  { label: "liquidity", re: /\b(liquidity|refinanc|credit facility|downgrade)/i, w: 8 },
  { label: "tariffs / trade", re: /\b(tariff|export control|export restriction|entity list|sanction|trade restriction)/i, w: 15 },
  { label: "China / Taiwan", re: /\b(China|Chinese|PRC|Taiwan|Hong Kong)\b/, w: 10 },
  { label: "geopolitics", re: /\b(Russia|Ukraine|Israel|Middle East|war|hostilities|conflict)\b/, w: 8 },
  { label: "cybersecurity", re: /\b(cyber|ransomware|data breach|security incident|unauthorized access)/i, w: 10 },
  { label: "AI", re: /\b(artificial intelligence|generative AI|\bAI\b|machine learning)/, w: 8 },
  { label: "regulation", re: /\b(regulat(ion|ory)|legislation|executive order|rulemaking)\b/i, w: 6 },
  { label: "customer concentration", re: /\b(significant customer|largest customer|customer concentration|accounted for \d+%|single customer)\b/i, w: 14 },
  { label: "supplier dependence", re: /\b(sole source|single source|limited number of suppliers|key supplier|supply constraint|shortage)/i, w: 12 },
  { label: "restructuring", re: /\b(restructur|layoff|workforce reduction|severance|exit activit)/i, w: 12 },
  { label: "guidance / outlook", re: /\b(we expect|outlook|guidance)\b/i, w: 5 },
  { label: "pricing / demand", re: /\b(price increase|pricing pressure|demand (weak|soft|declin)|inventory (build|correction))/i, w: 10 },
  { label: "accounting change", re: /\b(change in accounting|critical accounting estimate|new accounting standard|ASU \d{4}-\d{2})/i, w: 8 },
  { label: "insider trading plans", re: /\b(10b5-1|trading arrangement)/i, w: 6 },
  { label: "dividends / buybacks", re: /\b(repurchase program|share repurchase|dividend)\b/i, w: 5 },
  { label: "climate", re: /\b(climate|emissions|greenhouse)/i, w: 4 },
];

const SECTION_WEIGHT = new Map(Object.values(SECTION_DEFS).flat().map((d) => [d.key, d.weight]));

function termsIn(t: string | undefined): Set<string> {
  const s = new Set<string>();
  if (!t) return s;
  for (const x of TERMS) if (x.re.test(t)) s.add(x.label);
  return s;
}

/** Score a change 0–100 with the reasons shown to the user. */
export function scoreChange(c: Omit<Change, "score" | "level" | "why" | "terms" | "id">): { score: number; level: Level; why: string[]; terms: string[] } {
  const why: string[] = [];
  let s = 0;
  const risk = c.section === "1A" || c.section === "II-1A";
  if (c.figuresOnly) {
    s = 3;
    why.push("Updated figures or dates only");
  } else if (c.type === "added") {
    if (c.isHeading) { s = risk ? 45 : 22; why.push(risk ? "New risk factor" : "New heading"); }
    else { s = 12 + Math.min(25, c.wordsAdded / 8); why.push(`New paragraph (${c.wordsAdded} words)`); }
  } else if (c.type === "removed") {
    if (c.isHeading) { s = risk ? 32 : 15; why.push(risk ? "Risk factor removed" : "Heading removed"); }
    else { s = 8 + Math.min(20, c.wordsRemoved / 10); why.push(`Paragraph removed (${c.wordsRemoved} words)`); }
  } else {
    const n = c.wordsAdded + c.wordsRemoved;
    s = Math.min(35, n / 2.5);
    if (c.isHeading) { s += risk ? 15 : 6; why.push(risk ? "Risk factor reworded" : "Heading reworded"); }
    else why.push(`Rewritten (${c.wordsAdded} words added, ${c.wordsRemoved} removed)`);
  }
  // Topics newly mentioned (or dropped).
  const addedText = c.type === "added" ? c.after : c.ops?.filter((o) => o.t === "+").map((o) => o.s).join(" ");
  const removedText = c.type === "removed" ? c.before : c.ops?.filter((o) => o.t === "-").map((o) => o.s).join(" ");
  const had = termsIn(c.before), now = termsIn(c.after);
  const newly = c.figuresOnly ? new Set<string>() : new Set([...termsIn(addedText)].filter((t) => c.type === "added" || !had.has(t)));
  const dropped = c.figuresOnly ? new Set<string>() : new Set([...termsIn(removedText)].filter((t) => c.type === "removed" || !now.has(t)));
  let bonus = 0;
  for (const t of newly) bonus += TERMS.find((x) => x.label === t)!.w;
  for (const t of dropped) bonus += TERMS.find((x) => x.label === t)!.w / 2;
  s += Math.min(40, bonus);
  if (newly.size) why.push(`Now mentions ${[...newly].join(", ")}`);
  if (dropped.size) why.push(`No longer mentions ${[...dropped].join(", ")}`);
  // Hedged language hardening into fact ("may" → "has experienced").
  const HEDGE = /\b(may|could|might|potential(ly)?|possible|if)\b/i;
  const FACT = /\b((have|has|had)\s+(experienced|been|seen|incurred|identified|imposed|received|lost)|(is|are)\s+(now\s+)?subject to|imposed|announced|enacted|implemented|became effective|went into effect|was filed|were filed)\b/i;
  if (c.type === "changed" && HEDGE.test(removedText ?? "") && FACT.test(addedText ?? "")) {
    s += 12;
    why.push("Hypothetical risk now described as having happened");
  }
  s *= SECTION_WEIGHT.get(c.section) ?? 1;
  const score = Math.round(Math.max(0, Math.min(100, s)));
  return { score, level: score >= 50 ? "high" : score >= 22 ? "medium" : "low", why, terms: [...new Set([...newly, ...(c.type === "removed" ? [] : now)])] };
}

function contextFor(blocks: Block[], idx: number | undefined): string | null {
  if (idx == null) return null;
  for (let i = idx - 1; i >= 0 && i >= idx - 60; i--) if (blocks[i].heading && blocks[i].text.length > 8) return blocks[i].text;
  return null;
}

/** Compare two filings of the same form. */
export function buildRedline(p: { ticker: string; form: "10-K" | "10-Q"; from: FilingRef; to: FilingRef; oldHtml: string; newHtml: string; now?: string }): Redline {
  const oldS = splitSections(htmlToBlocks(p.oldHtml), p.form);
  const newS = splitSections(htmlToBlocks(p.newHtml), p.form);
  const stats: SectionStats[] = [];
  const changes: Change[] = [];
  for (const def of SECTION_DEFS[p.form]) {
    const a = oldS.find((s) => s.key === def.key), b = newS.find((s) => s.key === def.key);
    if (!a && !b) continue;
    const st: SectionStats = { key: def.key, title: def.title, added: 0, removed: 0, changed: 0, figuresOnly: 0, unchanged: 0, moved: 0, wordsAdded: 0, wordsRemoved: 0, high: 0, medium: 0, found: a && b ? "both" : a ? "old" : "new" };
    if (!a || !b) { stats.push(st); continue; }
    const d = diffBlocks(a.blocks, b.blocks);
    st.unchanged = d.unchanged; st.moved = d.moved;
    d.changes.forEach((rc, k) => {
      const wordsAdded = rc.type === "added" ? (rc.after?.match(/\S+/g)?.length ?? 0) : rc.ops ? opWords(rc.ops, "+") : 0;
      const wordsRemoved = rc.type === "removed" ? (rc.before?.match(/\S+/g)?.length ?? 0) : rc.ops ? opWords(rc.ops, "-") : 0;
      const base = {
        section: def.key, type: rc.type, isHeading: rc.heading,
        context: rc.type === "removed" ? contextFor(a.blocks, rc.ai) : contextFor(b.blocks, rc.bi),
        before: rc.before, after: rc.after, ops: rc.ops, figuresOnly: rc.figuresOnly, wordsAdded, wordsRemoved,
      };
      const sc = scoreChange(base);
      const ch: Change = { id: `${def.key}-${k + 1}`, ...base, ...sc };
      changes.push(ch);
      if (rc.figuresOnly) st.figuresOnly++;
      else if (rc.type === "added") st.added++;
      else if (rc.type === "removed") st.removed++;
      else st.changed++;
      st.wordsAdded += wordsAdded; st.wordsRemoved += wordsRemoved;
      if (sc.level === "high") st.high++; else if (sc.level === "medium") st.medium++;
    });
    stats.push(st);
  }
  return { version: REDLINE_VERSION, ticker: p.ticker, form: p.form, from: p.from, to: p.to, sections: stats, changes, createdAt: p.now ?? new Date().toISOString() };
}

/** The filing to compare against: prior annual for a 10-K, same quarter a year earlier for a 10-Q. */
export function defaultBase<F extends { form: string; filed: string; report?: string; accn: string }>(filings: F[], target: F): F | null {
  const same = filings.filter((f) => f.form === target.form && f.filed < target.filed).sort((a, b) => b.filed.localeCompare(a.filed));
  if (target.form !== "10-Q" || !target.report) return same[0] ?? null;
  const t = Date.parse(target.report);
  const yearAgo = same.find((f) => f.report && Math.abs(t - Date.parse(f.report) - 365 * 86400_000) < 40 * 86400_000);
  return yearAgo ?? same[0] ?? null;
}

/** Old and new text of a change (changed paragraphs store only their word diff). */
export function textsOf(c: Pick<Change, "before" | "after" | "ops">): { before: string | null; after: string | null } {
  if (!c.ops) return { before: c.before ?? null, after: c.after ?? null };
  return {
    before: c.ops.filter((o) => o.t !== "+").map((o) => o.s).join(""),
    after: c.ops.filter((o) => o.t !== "-").map((o) => o.s).join(""),
  };
}

/** Drop text that the word diff already carries, to keep stored comparisons small. */
export function compactRedline(r: Redline): Redline {
  return { ...r, changes: r.changes.map((c) => (c.ops ? { ...c, before: undefined, after: undefined } : c)) };
}
