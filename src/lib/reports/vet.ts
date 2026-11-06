// Citation and number checks for model-written report text. Pure.
// A claim keeps a sentence only if every number in it matches a number in one of the cited
// facts (or, failing that, in another fact, which is then added to the citation).
import type { Claim, Fact, ReportQa, ReportSection } from "./types";

export interface NumToken { raw: string; value: number; kind: "money" | "pct" | "mult" | "plain" }

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, bn: 1e9, mn: 1e6 };
const NUM_RE = /([+\-−–]?)(\$?)(\d[\d,]*(?:\.\d+)?)\s?(%|x\b|×|bps\b|basis points|(?:thousand|million|billion|trillion|bn|mn)\b|[KMBT]\b)?/gi;

/** Numbers that need a source. Years, quarter/fiscal labels, dates and small counts are exempt. */
export function numbersIn(text: string): NumToken[] {
  const out: NumToken[] = [];
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
    out.push({ raw: raw.trim(), value: neg ? -value : value, kind });
  }
  return out;
}

function close(a: NumToken, b: NumToken): boolean {
  const sameKind = a.kind === b.kind || (a.kind === "plain" && b.kind !== "pct") || (b.kind === "plain" && a.kind !== "pct");
  if (!sameKind) return false;
  if (a.kind === "pct" || b.kind === "pct") return Math.abs(Math.abs(a.value) - Math.abs(b.value)) <= 0.0006;
  const x = Math.abs(a.value), y = Math.abs(b.value);
  if (x === 0 || y === 0) return x === y;
  return Math.abs(x - y) / Math.max(x, y) <= 0.006;
}

/** Split on sentence ends only (a period inside "$416.2B" is not one). */
export const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z"'(“$+\-−\d])/).map((s) => s.trim()).filter(Boolean);

export interface VetResult { claim: Claim | null; numbers: number; verified: number; removed: { text: string; reason: string }[] }

export function vetClaim(c: Claim, facts: Map<string, Fact>, factNums: Map<string, NumToken[]>): VetResult {
  const cited = new Set(c.factIds.filter((id) => facts.has(id)));
  const text = c.text.replace(/\s*\[(?:F\d+(?:,\s*)?)+\]/g, "").replace(/\*\*|__|`/g, "").trim();
  const kept: string[] = [];
  const removed: VetResult["removed"] = [];
  let numbers = 0, verified = 0;
  for (const s of sentences(text)) {
    const nums = numbersIn(s);
    let ok = true;
    for (const n of nums) {
      numbers++;
      const inCited = [...cited].some((id) => factNums.get(id)!.some((m) => close(n, m)));
      if (inCited) { verified++; continue; }
      const other = [...factNums.entries()].find(([, ms]) => ms.some((m) => close(n, m)));
      if (other) { cited.add(other[0]); verified++; continue; }
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
  defs: { id: string; title: string; tables?: string[] }[],
  facts: Fact[],
  tableIds: Set<string>,
): { sections: ReportSection[]; qa: ReportQa } {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const nums = new Map(facts.map((f) => [f.id, numbersIn(f.text)]));
  const qa: ReportQa = { claims: 0, citedClaims: 0, numbers: 0, verifiedNumbers: 0, removed: [] };
  const sections: ReportSection[] = [];
  for (const def of defs) {
    const r = raw.find((x) => x.id === def.id);
    const vet = (list: Claim[]) => list.flatMap((c) => {
      if (!c.text?.trim()) return [];
      const v = vetClaim(c, byId, nums);
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
    if (!paragraphs.length && !bullets.length && !tables.length) continue;
    sections.push({ id: def.id, title: def.title, paragraphs, bullets, tables });
  }
  return { sections, qa };
}

/** Display numbering: facts in order of first citation, then by table use. */
export function citationOrder(sections: ReportSection[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const s of sections) for (const c of [...s.paragraphs, ...s.bullets]) for (const id of c.factIds) if (!order.has(id)) order.set(id, order.size + 1);
  return order;
}
