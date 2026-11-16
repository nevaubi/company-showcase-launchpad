// Query matching shared by the assistant's KPI and IR-series searches (pure).
/** Analyst shorthand to the words companies print in supplements. */
const SYNONYMS: [RegExp, string][] = [
  [/\bnim\b|net interest margin/i, "net yield on interest-earning assets"],
  [/\bcet ?1\b/i, "common equity tier 1"],
  [/\bncos?\b/i, "net charge-off"],
  [/\broe\b/i, "return on equity"],
  [/\brotce\b/i, "return on tangible common equity"],
  [/\befficiency ratio\b/i, "overhead ratio"],
  [/\barpu\b/i, "average revenue per user"],
  [/\bsss\b|same.store sales/i, "comparable sales"],
  [/\bnrr\b/i, "net revenue retention"],
  [/\brpo\b/i, "remaining performance obligations"],
];
export const expand = (q: string) => [q, ...SYNONYMS.filter(([re]) => re.test(q)).map(([re, to]) => q.replace(re, to))];

const STOP = new Set(["the", "and", "for", "of", "on", "in", "to", "a", "an", "by", "per", "vs", "with", "from", "at", "or"]);
export const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w && !STOP.has(w) && (w.length > 2 || /\d/.test(w)));

const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean));

/** Score in 0..~2: every query word must appear as a whole word (or a whole-word prefix for words of 4+ letters);
 * normalised by the number of words so a long phrasing never beats a short one; earlier matches rank higher. */
export function matchScore(text: string, q: string[]): number {
  if (!q.length) return 1;
  const t = text.toLowerCase();
  const toks = [...tokens(text)];
  let s = 0;
  for (const w of q) {
    const hit = toks.some((x) => x === w || (w.length >= 4 && x.startsWith(w)) || (w.endsWith("s") && x === w.slice(0, -1)));
    if (!hit) return 0;
    const i = t.indexOf(w);
    s += 1 + 1 / (1 + Math.max(i, 0) / 40);
  }
  return s / q.length;
}

