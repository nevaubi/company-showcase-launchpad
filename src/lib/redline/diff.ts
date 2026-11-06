// Paragraph alignment and word-level diffs between two versions of a filing section. Pure.
import type { Block } from "./extract";

export type Op = { t: "=" | "+" | "-"; s: string };

export interface RawChange {
  type: "added" | "removed" | "changed";
  /** Index of the block in the old / new section */
  ai?: number;
  bi?: number;
  before?: string;
  after?: string;
  ops?: Op[];
  heading: boolean;
  /** Only digits changed (dates, amounts, years) */
  figuresOnly: boolean;
}

export const norm = (t: string) =>
  t.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const shape = (t: string) => norm(t).replace(/\d[\d,.]*/g, "#");

function words(t: string): Set<string> {
  return new Set(norm(t).match(/[a-z][a-z'-]{2,}/g) ?? []);
}

/** Dice similarity on word sets. */
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return (2 * n) / (A.size + B.size);
}

/** Longest common subsequence pairs of equal keys (DP; falls back to unique-key anchoring when huge). */
export function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  if (n * m > 4_000_000) return anchorPairs(a, b);
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

function anchorPairs(a: string[], b: string[]): [number, number][] {
  const count = (xs: string[]) => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return c; };
  const ca = count(a), cb = count(b);
  const posB = new Map<string, number>();
  b.forEach((x, j) => { if (cb.get(x) === 1) posB.set(x, j); });
  const out: [number, number][] = [];
  let last = -1;
  a.forEach((x, i) => {
    if (ca.get(x) !== 1) return;
    const j = posB.get(x);
    if (j != null && j > last) { out.push([i, j]); last = j; }
  });
  return out;
}

/** Word-level diff (whitespace kept with the following word). */
export function wordDiff(before: string, after: string): Op[] {
  const A = before.split(/(?=\s)/), B = after.split(/(?=\s)/);
  if (A.length * B.length > 1_500_000) return [{ t: "-", s: before }, { t: "+", s: after }];
  const ka = A.map((x) => norm(x)), kb = B.map((x) => norm(x));
  const pairs = lcsPairs(ka, kb);
  const ops: Op[] = [];
  const push = (t: Op["t"], s: string) => {
    const last = ops[ops.length - 1];
    if (last && last.t === t) last.s += s; else ops.push({ t, s });
  };
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [A.length, B.length] as [number, number]]) {
    while (i < pi) push("-", A[i++]);
    while (j < pj) push("+", B[j++]);
    if (pi < A.length) { push("=", B[pj]); i++; j++; }
  }
  return ops;
}

/** Count of words in ops of a type. */
export const opWords = (ops: Op[], t: Op["t"]) => ops.filter((o) => o.t === t).reduce((n, o) => n + (o.s.match(/\S+/g)?.length ?? 0), 0);

/**
 * Align old and new section blocks: identical paragraphs anchor the alignment; between anchors,
 * removed/added paragraphs that are similar enough become "changed"; identical paragraphs that only
 * moved are ignored.
 */
export function diffBlocks(a: Block[], b: Block[]): { changes: RawChange[]; unchanged: number; moved: number } {
  const ka = a.map((x) => norm(x.text)), kb = b.map((x) => norm(x.text));
  const pairs = lcsPairs(ka, kb);
  const unmatchedA = new Map<string, number[]>();
  const changes: RawChange[] = [];
  let moved = 0;

  // Collect gaps between anchors.
  const gaps: { as: number[]; bs: number[] }[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    const as: number[] = [], bs: number[] = [];
    while (i < pi) as.push(i++);
    while (j < pj) bs.push(j++);
    if (as.length || bs.length) gaps.push({ as, bs });
    i = pi + 1; j = pj + 1;
  }
  for (const g of gaps) for (const x of g.as) { const k = ka[x]; unmatchedA.set(k, [...(unmatchedA.get(k) ?? []), x]); }
  const unmatchedB = new Set(gaps.flatMap((g) => g.bs).map((y) => kb[y]));
  const movedA = new Set<number>(), movedB = new Set<number>();
  for (const g of gaps) for (const y of g.bs) {
    const xs = unmatchedA.get(kb[y]);
    if (xs?.length && unmatchedB.has(kb[y])) { movedA.add(xs.shift()!); movedB.add(y); moved++; }
  }

  for (const g of gaps) {
    const as = g.as.filter((x) => !movedA.has(x)), bs = g.bs.filter((y) => !movedB.has(y));
    // Greedy best-similarity pairing, keeping relative order.
    const cand: { x: number; y: number; s: number }[] = [];
    for (const x of as) for (const y of bs) {
      if (a[x].heading !== b[y].heading) continue;
      const s = shape(a[x].text) === shape(b[y].text) ? 1 : similarity(a[x].text, b[y].text);
      if (s >= 0.5) cand.push({ x, y, s });
    }
    cand.sort((p, q) => q.s - p.s);
    const usedA = new Set<number>(), usedB = new Set<number>();
    const matched: [number, number][] = [];
    for (const c of cand) {
      if (usedA.has(c.x) || usedB.has(c.y)) continue;
      if (matched.some(([mx, my]) => (mx < c.x) !== (my < c.y))) continue;
      usedA.add(c.x); usedB.add(c.y); matched.push([c.x, c.y]);
    }
    const events: { pos: number; c: RawChange }[] = [];
    for (const [x, y] of matched) {
      const figuresOnly = shape(a[x].text) === shape(b[y].text);
      events.push({ pos: y, c: { type: "changed", ai: x, bi: y, before: a[x].text, after: b[y].text, ops: wordDiff(a[x].text, b[y].text), heading: b[y].heading, figuresOnly } });
    }
    for (const x of as) if (!usedA.has(x)) events.push({ pos: bs[0] ?? 1e9, c: { type: "removed", ai: x, before: a[x].text, heading: a[x].heading, figuresOnly: false } });
    for (const y of bs) if (!usedB.has(y)) events.push({ pos: y, c: { type: "added", bi: y, after: b[y].text, heading: b[y].heading, figuresOnly: false } });
    events.sort((p, q) => p.pos - q.pos);
    changes.push(...events.map((e) => e.c));
  }
  return { changes, unchanged: pairs.length, moved };
}
