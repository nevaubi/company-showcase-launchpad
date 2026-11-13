// Pure duplicate detection between copies of the same release (an IR-site PDF or text copy and
// the SEC 8-K exhibit of the same results). Reading both costs twice and adds nothing, so the
// copy whose figures are (almost) all printed in the SEC exhibit is skipped; the SEC copy is kept
// because it carries the accession and exact filing date.

/** Distinct figures with at least three digits ("1,234.5" and "(1,234.5)" both → "1234.5"). */
export function figureSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = m[0].replace(/,/g, "").replace(/^0+(?=\d)/, "");
    if (n.replace(/\D/g, "").length >= 3) out.add(n);
  }
  return out;
}

/** Share of `a`'s figures that also appear in `b`. */
export function figureOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / a.size;
}

/**
 * The SEC copy that duplicates `candidate`, if any: at least `minFigures` figures and `share` of
 * them printed in that copy.
 */
export function duplicateOf<T extends { figures: Set<string> }>(candidate: Set<string>, others: T[], share = 0.9, minFigures = 40): T | null {
  if (candidate.size < minFigures) return null;
  let best: { o: T; s: number } | null = null;
  for (const o of others) {
    const s = figureOverlap(candidate, o.figures);
    if (s >= share && (!best || s > best.s)) best = { o, s };
  }
  return best?.o ?? null;
}
