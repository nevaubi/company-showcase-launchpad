// How a call's topic term is written on screen. Pure.
//
// Topic terms are counted in lower case (src/lib/transcripts/insights.ts), so "iphone duo" and "gross margin"
// reach the page without their casing. The display form is the casing the transcript itself uses most often
// for that phrase outside a sentence start ("iPhone Duo", "MacBook Neo", "AI"), and otherwise the term with
// its first letter capitalised (sentence case: "Gross margin").

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Index of the first letter of each sentence in `text` (after ". ", "? ", "! " or at the start). */
const sentenceStart = (text: string, at: number) => {
  let k = at - 1;
  while (k >= 0 && /[\s"'“(]/.test(text[k])) k--;
  return k < 0 || /[.?!:]/.test(text[k]);
};

/** Casing for each lower-case term, read from the transcript's texts. */
export function termCasing(terms: string[], texts: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const term of terms) {
    const lower = term.toLowerCase();
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(lower).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    const tally = new Map<string, number>();
    for (const text of texts) {
      for (const m of text.matchAll(re)) {
        const form = m[0].replace(/\s+/g, " ");
        // a capital forced by the start of a sentence says nothing about the word
        if (sentenceStart(text, m.index!) && form.slice(1) === lower.slice(1)) continue;
        if (form === lower) continue;
        tally.set(form, (tally.get(form) ?? 0) + 1);
      }
    }
    // the cased form must be the usual one: "AI" said 30 times beats "Ai" once; a stray capital in a title is not enough
    let best: string | null = null;
    let n = 0;
    for (const [form, c] of tally) if (c > n) [best, n] = [form, c];
    const plain = texts.reduce((s, t) => s + [...t.matchAll(re)].filter((m) => m[0].replace(/\s+/g, " ") === lower).length, 0);
    out.set(term, best && n >= plain ? best : sentenceCase(term));
  }
  return out;
}

/** First letter upper case, the rest as given. */
export const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
