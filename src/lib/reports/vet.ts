// Citation and number checks for model-written report text. Pure.
// A claim keeps a sentence only if every number in it matches a number in one of the cited
// facts (or, failing that, in another fact, which is then added to the citation).
import type { Claim, Fact, ReportQa, ReportSection } from "./types";

/** dir: direction the wording asserts (−1 "fell 5%", +1 "+5%"/"grew 5%", 0 neutral like "fell to $5B"). */
export interface NumToken { raw: string; value: number; kind: "money" | "pct" | "mult" | "plain"; dir: -1 | 0 | 1 }

const NEG_CUE = /\b(fell|falls|fall|declin\w*|decreas\w*|down|dropp?\w*|slid|slipp?\w*|contract\w*|shr[ai]nk\w*|lower(?:ed)?|loss(?:es)?|negative|compress\w*|weaken\w*|cut)\b/gi;
const POS_CUE = /\b(rose|rise|rises|grew|grow\w*|up|increas\w*|gain\w*|expand\w*|climb\w*|jump\w*|higher|improv\w*|accelerat\w*)\b/gi;

/** Direction asserted by the closest cue word in the few words before a number. */
function direction(before: string): -1 | 0 | 1 {
  const last = (re: RegExp) => { let m: RegExpExecArray | null, at = -1, len = 0; re.lastIndex = 0; while ((m = re.exec(before))) { at = m.index; len = m[0].length; } return { at, end: at + len }; };
  const n = last(NEG_CUE), p = last(POS_CUE);
  const cue = n.at > p.at ? { ...n, d: -1 as const } : p.at >= 0 ? { ...p, d: 1 as const } : null;
  if (!cue) return 0;
  const gap = before.slice(cue.end);
  if (/\b(to|from|at|than|vs\.?|versus)\b/i.test(gap) || gap.trim().split(/\s+/).filter(Boolean).length > 4) return 0;
  return cue.d;
}

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, bn: 1e9, mn: 1e6 };
const NUM_RE = /([+\-−–]?)(\$?)(\d[\d,]*(?:\.\d+)?)\s?(%|x\b|×|bps\b|basis points|(?:thousand|million|billion|trillion|bn|mn)\b|[KMBT]\b)?/gi;

/** Numbers that need a source. Years, quarter/fiscal labels, dates and small counts are exempt. */
export function numbersIn(text: string): NumToken[] {
  const out: NumToken[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(NUM_RE)) {
    const [raw, sign, dollar, digits, unitRaw] = m;
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 3), idx);
    const after = text.slice(idx + raw.length, idx + raw.length + 1);
    if (/(Q|FY|H|W)$/i.test(before) || /^[-/]/.test(after) || /[-/]$/.test(before) || /\d$/.test(before)) continue; // Q3, FY2025, 2025-09-27
    const unit = (unitRaw ?? "").toLowerCase();
    const n = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const neg = sign === "-" || sign === "−" || sign === "–";
    if (!dollar && !unit) {
      if (Number.isInteger(n) && n >= 1900 && n <= 2100 && !digits.includes(",")) continue; // a year
      if (n <= 12 && !digits.includes(".")) continue; // small counts ("three segments", "5 analysts")
    }
    let kind: NumToken["kind"] = dollar ? "money" : "plain";
    let value = n;
    if (unit === "%") { kind = "pct"; value = n / 100; }
    else if (unit === "x" || unit === "×") kind = "mult";
    else if (unit === "bps" || unit === "basis points") { kind = "pct"; value = n / 10000; }
    else if (SCALE[unit]) { value = n * SCALE[unit]; if (!dollar) kind = "money"; }
    const plus = sign === "+";
    const dir: NumToken["dir"] = neg ? -1 : plus ? 1 : direction(text.slice(Math.max(lastEnd, idx - 48), idx));
    lastEnd = idx + raw.length;
    out.push({ raw: raw.trim(), value: neg ? -value : value, kind, dir });
  }
  return out;
}

/** a = number in model text, b = number in a source fact. Size must match and so must direction when the text asserts one. */
function close(a: NumToken, b: NumToken): boolean {
  if (a.dir !== 0 && b.value !== 0 && Math.sign(b.value) !== a.dir) return false;
  const sameKind = a.kind === b.kind || (a.kind === "plain" && b.kind !== "pct") || (b.kind === "plain" && a.kind !== "pct");
  if (!sameKind) return false;
  if (a.kind === "pct" || b.kind === "pct") return Math.abs(Math.abs(a.value) - Math.abs(b.value)) <= 0.0006;
  const x = Math.abs(a.value), y = Math.abs(b.value);
  if (x === 0 || y === 0) return x === y;
  return Math.abs(x - y) / Math.max(x, y) <= 0.006;
}

const STOP = new Set(["this", "that", "with", "from", "were", "have", "than", "over", "into", "versus", "which", "while", "their", "also", "about", "after", "before", "year", "years", "quarter", "quarters", "fiscal", "reported", "period", "ended", "total", "latest", "prior", "compared", "against", "same", "most", "more", "less"]);
/** Topic words (4-letter stems) used to check that a fallback source is about the same thing. */
function stems(t: string): Set<string> {
  const out = new Set<string>();
  for (const w of t.toLowerCase().match(/[a-z][a-z&-]{3,}/g) ?? []) if (!STOP.has(w)) out.add(w.slice(0, 4));
  return out;
}

/** Split on sentence ends only (a period inside "$416.2B" is not one). */
export const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z"'(“$+\-−\d])/).map((s) => s.trim()).filter(Boolean);

export interface VetResult { claim: Claim | null; numbers: number; verified: number; removed: { text: string; reason: string }[] }

/** Names a sentence must use before it may quote a peer's figure (ticker, full name, distinctive first word). */
const GENERIC = new Set(["bank", "the", "first", "general", "american", "united", "international", "national", "global", "capital"]);
export function companyAliases(ticker: string, name: string): string[] {
  const first = name.split(/[\s,.]+/)[0] ?? "";
  const core = name.replace(/,?\s+(inc|corp|corporation|co|company|plc|ltd|holdings|group)\.?$/i, "");
  return [...new Set([ticker, name, core, ...(first.length >= 4 && !GENERIC.has(first.toLowerCase()) ? [first] : [])].filter(Boolean))];
}
const mentions = (s: string, alias: string) => new RegExp(`(^|[^A-Za-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i").test(s);

/**
 * owners: facts about another company (a peer) → names the sentence must mention for that fact to count,
 * so a peer's number can't be passed off as the subject company's.
 */
export function vetClaim(c: Claim, facts: Map<string, Fact>, factNums: Map<string, NumToken[]>, owners?: Map<string, string[]>): VetResult {
  const cited = new Set(c.factIds.filter((id) => facts.has(id)));
  const text = c.text.replace(/\s*\[(?:F\d+(?:,\s*)?)+\]/g, "").replace(/\*\*|__|`/g, "").trim();
  const kept: string[] = [];
  const removed: VetResult["removed"] = [];
  let numbers = 0, verified = 0;
  let prev = "";
  for (const s of sentences(text)) {
    const nums = numbersIn(s);
    let ok = true;
    // The peer may be named in this sentence or the one before ("Microsoft leads. Its margin is 47%.").
    const ctx = `${prev} ${s}`;
    prev = s;
    const owned = (id: string) => { const a = owners?.get(id); return !a || a.some((x) => mentions(ctx, x)); };
    for (const n of nums) {
      numbers++;
      const inCited = [...cited].some((id) => owned(id) && factNums.get(id)!.some((m) => close(n, m)));
      if (inCited) { verified++; continue; }
      // Not in the cited facts: accept another fact only if it is about the same thing.
      const words = stems(s);
      let best: { id: string; score: number } | null = null;
      for (const [id, ms] of factNums) {
        if (!owned(id) || !ms.some((m) => close(n, m))) continue;
        const fw = stems(facts.get(id)!.text);
        let score = 0;
        for (const w of fw) if (words.has(w)) score++;
        if (score > 0 && (!best || score > best.score)) best = { id, score };
      }
      if (best) { cited.add(best.id); verified++; continue; }
      ok = false;
      removed.push({ text: s, reason: `"${n.raw}" doesn't match any source` });
      break;
    }
    if (ok) kept.push(s);
  }
  if (!kept.length) return { claim: null, numbers, verified, removed };
  if (!cited.size && kept.some((s) => numbersIn(s).length)) return { claim: null, numbers, verified, removed: [...removed, { text, reason: "no valid citation" }] };
  return { claim: { text: kept.join(" "), factIds: [...cited] }, numbers, verified, removed };
}

export function vetSections(
  raw: { id: string; paragraphs: Claim[]; bullets: Claim[] }[],
  defs: { id: string; title: string; tables?: string[]; charts?: string[] }[],
  facts: Fact[],
  tableIds: Set<string>,
  chartIds: Set<string> = new Set(),
  /** The report's company and its peers' names, for the peer-attribution check. */
  subject?: { ticker: string; peers: { ticker: string; name: string }[] },
): { sections: ReportSection[]; qa: ReportQa } {
  // Plot-only facts were never shown to the writer, so they can't be cited.
  const citable = facts.filter((f) => !f.chart);
  const byId = new Map(citable.map((f) => [f.id, f]));
  const nums = new Map(citable.map((f) => [f.id, numbersIn(f.text)]));
  const owners = new Map<string, string[]>();
  if (subject) {
    const names = new Map(subject.peers.map((p) => [p.ticker, companyAliases(p.ticker, p.name)]));
    for (const f of citable) {
      const tk = "tk" in f.ref ? f.ref.tk : undefined;
      if (tk && tk !== subject.ticker) owners.set(f.id, names.get(tk) ?? [tk]);
    }
  }
  const qa: ReportQa = { claims: 0, citedClaims: 0, numbers: 0, verifiedNumbers: 0, removed: [] };
  const sections: ReportSection[] = [];
  for (const def of defs) {
    const r = raw.find((x) => x.id === def.id);
    const vet = (list: Claim[]) => list.flatMap((c) => {
      if (!c.text?.trim()) return [];
      const v = vetClaim(c, byId, nums, owners);
      qa.claims++;
      qa.numbers += v.numbers;
      qa.verifiedNumbers += v.verified;
      qa.removed.push(...v.removed);
      if (!v.claim) return [];
      if (v.claim.factIds.length) qa.citedClaims++;
      return [v.claim];
    });
    const paragraphs = r ? vet(r.paragraphs) : [];
    const bullets = r ? vet(r.bullets) : [];
    const tables = (def.tables ?? []).filter((t) => tableIds.has(t));
    const charts = (def.charts ?? []).filter((c) => chartIds.has(c));
    if (!paragraphs.length && !bullets.length && !tables.length && !charts.length) continue;
    sections.push({ id: def.id, title: def.title, paragraphs, bullets, tables, ...(charts.length ? { charts } : {}) });
  }
  return { sections, qa };
}

/** Display numbering: facts in order of first citation, then by table use. */
export function citationOrder(sections: ReportSection[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const s of sections) for (const c of [...s.paragraphs, ...s.bullets]) for (const id of c.factIds) if (!order.has(id)) order.set(id, order.size + 1);
  return order;
}
