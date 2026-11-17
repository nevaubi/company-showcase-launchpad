// Inline XBRL (iXBRL) parsing for 10-K / 10-Q primary documents (pure; no DOM, works in scripts and
// the browser). Reads contexts (periods and dimensions), units, numeric facts and label linkbases.

export interface XbrlContext {
  start?: string;
  end?: string;
  instant?: string;
  /** explicit dimensions as [axis, member] QNames */
  dims: [string, string][];
  typed: boolean;
}

export interface XbrlFact {
  concept: string;
  value: number;
  unit: string;
  context: string;
  /** element id in the document, used to highlight the exact tag in the filing viewer */
  id?: string;
  /** document of a multi-document filing the tag sits in, when it is not the primary document (annual report exhibits) */
  doc?: string;
}

const attrs = (tag: string) => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

export function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function parseContexts(doc: string): Map<string, XbrlContext> {
  const map = new Map<string, XbrlContext>();
  for (const m of doc.matchAll(/<(?:[\w-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?context>/gi)) {
    const id = attrs(m[1]).id;
    if (!id) continue;
    const body = m[2];
    const dims = [...body.matchAll(/<(?:[\w-]+:)?explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</gi)].map((d) => [d[1], d[2]] as [string, string]);
    const get = (t: string) => body.match(new RegExp(`<(?:[\\w-]+:)?${t}>\\s*([^<\\s]+)\\s*<`, "i"))?.[1];
    map.set(id, { start: get("startDate"), end: get("endDate"), instant: get("instant"), dims, typed: /<(?:[\w-]+:)?typedMember/i.test(body) });
  }
  return map;
}

/** Unit id → "USD", "pure", "shares", "USD/shares", … */
export function parseUnits(doc: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of doc.matchAll(/<(?:[\w-]+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?unit>/gi)) {
    const id = attrs(m[1]).id;
    if (!id) continue;
    const measures = [...m[2].matchAll(/<(?:[\w-]+:)?measure>\s*([^<\s]+)\s*</gi)].map((x) => x[1].split(":").pop()!);
    map.set(id, /divide/i.test(m[2]) && measures.length === 2 ? `${measures[0]}/${measures[1]}` : (measures[0] ?? id));
  }
  return map;
}

const WORDS: Record<string, number> = { no: 0, none: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** The number an ix:nonFraction displays, honouring scale, sign and the SEC zero/word formats. */
export function factValue(a: Record<string, string>, inner: string): number | null {
  const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
  const fmt = (a.format ?? "").toLowerCase();
  let v: number;
  if (/zerodash|fixed-zero|fixedzero/.test(fmt) || /^[—–-]+$/.test(text) || text === "") v = 0;
  else if (/numword/.test(fmt) && WORDS[text.toLowerCase()] != null) v = WORDS[text.toLowerCase()];
  else {
    const commaDecimal = /numcommadecimal|num-comma-decimal/.test(fmt);
    const clean = commaDecimal ? text.replace(/[.\s]/g, "").replace(",", ".") : text.replace(/[,\s$€£%]/g, "");
    v = Number(clean.replace(/^\((.*)\)$/, "$1"));
    if (!Number.isFinite(v)) return null;
  }
  v *= Math.pow(10, Number(a.scale ?? 0));
  if (a.sign === "-") v = -v;
  return v;
}

/** Every numeric fact in an inline XBRL document. */
export function parseInlineFacts(html: string, units = parseUnits(html)): XbrlFact[] {
  const out: XbrlFact[] = [];
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const a = attrs(m[1]);
    if (!a.name || !a.contextRef) continue;
    const v = factValue(a, m[2]);
    if (v == null) continue;
    out.push({ concept: a.name, value: v, unit: units.get(a.unitRef ?? "") ?? a.unitRef ?? "", context: a.contextRef, ...(a.id ? { id: a.id } : {}) });
  }
  return out;
}

/** Concept/member QName ("us-gaap:Revenues") → its terse (else standard) label from a _lab.xml linkbase. */
export function parseLabels(xml: string): Map<string, string> {
  const locs = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:link:)?loc\b([^>]*)\/?>/gi)) {
    const a = attrs(m[1]);
    const href = a["xlink:href"];
    if (href && a["xlink:label"]) locs.set(a["xlink:label"], href.split("#")[1]);
  }
  const labels = new Map<string, { role: string; text: string }[]>();
  for (const m of xml.matchAll(/<(?:link:)?label\b([^>]*)>([\s\S]*?)<\/(?:link:)?label>/gi)) {
    const a = attrs(m[1]);
    const arr = labels.get(a["xlink:label"]) ?? [];
    arr.push({ role: a["xlink:role"] ?? "", text: m[2].replace(/<[^>]+>/g, "").trim() });
    labels.set(a["xlink:label"], arr);
  }
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:link:)?labelArc\b([^>]*)\/?>/gi)) {
    const a = attrs(m[1]);
    const href = locs.get(a["xlink:from"]);
    const ls = labels.get(a["xlink:to"]);
    if (!href || !ls) continue;
    const pick = ls.find((l) => l.role.endsWith("terseLabel")) ?? ls.find((l) => l.role.endsWith("/label")) ?? ls[0];
    // Locator hrefs use the element id ("us-gaap_Revenues"); store under the QName.
    const qname = href.replace("_", ":");
    if (!out.has(qname) || pick.role.endsWith("terseLabel")) out.set(qname, decodeEntities(pick.text).replace(/\s*\[(Member|Axis|Domain|Line Items|Table|Abstract)\]\s*$/i, "").trim());
  }
  return out;
}

/** "us-gaap:RevenueFromContractWithCustomerMember" → "Revenue From Contract With Customer". */
export function humanize(qname: string) {
  const local = qname.split(":")[1] ?? qname;
  return local
    .replace(/(Member|Axis|Domain)$/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}
