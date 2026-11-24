// How a quoted sentence is shown when it may have been cut (stored quotes are capped in length, and some panels show a
// shorter part): whole when it is whole, otherwise cut at a word boundary with an ellipsis, never in the middle of a word
// (review p5 M9: "presumption of denia", "We gen"). The full sentence opens with its source. Pure, no browser/Node APIs.

/** A sentence that ends as a sentence ends: a stop, a question or exclamation mark, a closing quote or bracket after one. */
const WHOLE = /[.!?;:][)"'”’\]]*\s*$/;

/**
 * The part of `quote` to show: the whole sentence when it is whole and within `max` characters, else the longest run of
 * whole words within `max` (or within what is stored, when the stored quote itself was cut), with "…" after it.
 */
export function quoteShown(quote: string, max = Infinity): string {
  const q = quote.replace(/\s+/g, " ").trim();
  if (q.length <= max && WHOLE.test(q)) return q;
  const room = Math.min(max, q.length);
  /* a cut that falls on a space keeps every word before it; otherwise back to the last space, dropping the broken word */
  let end = room < q.length && q[room] === " " ? room : q.lastIndexOf(" ", room);
  if (room >= q.length && q.length <= max) end = q.lastIndexOf(" ");
  if (end <= 0) return `${q.slice(0, room)}…`;
  return `${q.slice(0, end).replace(/[\s,;:(–-]+$/, "")}…`;
}
