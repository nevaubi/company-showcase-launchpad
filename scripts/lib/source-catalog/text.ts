/**
 * Text helpers for titles read from publisher listings. A listing's words are kept; only the marks
 * below change, each by a rule that can be stated:
 *
 * - HTML entities are decoded and runs of white space close up.
 * - A dash written as two hyphens between words ("matrix--transactions") or as a hyphen, en dash
 *   or em dash set off by spaces ("Total economy - current account") separates two parts of the
 *   title and becomes a comma.
 * - A long dash between two characters with no space is a range and becomes " to ".
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

export function listingTitle(raw: string): string {
  return decodeEntities(raw)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\S)\s*--\s*(\S)/g, "$1, $2")
    .replace(/\s+[-\u2012\u2013\u2014\u2015]\s+/g, ", ")
    .replace(/(\S)[\u2012\u2013\u2014\u2015](\S)/g, "$1 to $2")
    .replace(/\s+,/g, ",");
}
