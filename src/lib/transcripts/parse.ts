// Earnings-call transcript parsing. Pure (no I/O) so the server function, tests and any
// script share it. Handles the two layouts used by Motley Fool transcript pages (as
// markdown): inline "**Name:** text" turns, and "**Name** -- _Role_" headers followed by
// paragraphs with "Prepared Remarks" / "Questions & Answers" headings.

/**
 * Who a speaker is. "unidentified" when neither the call's participant list, a stated role, the
 * operator's introductions nor the speaker's place in the call establishes it: shown as such, never guessed.
 */
export type SpeakerKind = "management" | "analyst" | "operator" | "unidentified";

export interface TranscriptSpeaker {
  name: string;
  role: string | null;
  firm: string | null;
  kind: SpeakerKind;
  turns: number;
  words: number;
}

export interface TranscriptTurn {
  i: number;
  speaker: string;
  kind: SpeakerKind;
  section: "prepared" | "qa";
  text: string;
  words: number;
}

export interface ParsedTranscript {
  speakers: TranscriptSpeaker[];
  turns: TranscriptTurn[];
  words: number;
  /** Index of the first Q&A turn, or null when the call has no Q&A. */
  qaStart: number | null;
  /** The page's own summary and takeaways (third-party), when present. Older cached transcripts lack it. */
  digest?: TranscriptDigest | null;
}

export interface TranscriptRef {
  url: string;
  /** e.g. "Q3 2026" — the company's fiscal quarter as named on the page */
  quarter: string | null;
  fq: number | null;
  fy: number | null;
  /** Call date (YYYY-MM-DD) from the page URL. */
  date: string | null;
}

const NOT_A_NAME = /^(ad|alert|note|disclaimer|operator instructions|image source|summary|takeaways|risks)$/i;

/** Strip markdown decoration: links → label, images removed, escapes and emphasis dropped. */
export function cleanInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([-*_.()[\]#!+&])/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)_([^_]+)_(?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Parse "**Name:** text", "**Name**: text", "**Name** -- _Role_" or a bare "**Operator**". */
function speakerLine(line: string): { name: string; role: string | null; rest: string } | null {
  const inline = line.match(/^\*\*([^*]{2,60}?):\*\*\s*(.*)$/) ?? line.match(/^\*\*([^*]{2,60}?)\*\*:\s*(.*)$/);
  if (inline) {
    const name = cleanInline(inline[1]);
    if (!NOT_A_NAME.test(name) && looksLikeName(name)) return { name, role: null, rest: inline[2] };
  }
  const header = line.match(/^\*\*([^*]{2,60}?)\*\*\s*(?:\\?-\\?-|—|–)\s*(.+)$/);
  if (header) {
    const name = cleanInline(header[1]);
    if (looksLikeName(name)) return { name, role: cleanInline(header[2]), rest: "" };
  }
  const bare = line.match(/^\*\*([^*]{2,40}?)\*\*\s*$/);
  if (bare) {
    const name = cleanInline(bare[1]);
    if (/^operator$/i.test(name) || (!NOT_A_NAME.test(name) && looksLikeName(name) && name.split(" ").length <= 4)) return { name, role: null, rest: "" };
  }
  return null;
}

function looksLikeName(s: string) {
  if (/^operator$/i.test(s)) return true;
  if (s.length > 48 || /[.?!]$/.test(s) || /\d{2,}/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 6) return false;
  // Every word capitalised (allow particles/initials like "de", "van", "J.")
  return words.every((w) => /^[A-Z\u00C0-\u024F][\w\u00C0-\u024F.'’-]*$/.test(w) || /^(de|da|van|von|der|la|le|di|du|bin)$/.test(w));
}

const isQaHeading = (l: string) => /^#{2,3}\s*(questions?\s*(&|and)\s*answers?|q\s*&\s*a)\b/i.test(l);
const isPreparedHeading = (l: string) => /^#{2,3}\s*(prepared remarks|full conference call transcript)\b/i.test(l);
const isEnd = (l: string) =>
  /^#{1,3}\s/.test(l) ||
  /^(\**duration:|\**call participants:|more [a-z]+ analysis|all earnings call transcripts|this article is a transcript|\*\*ad\*\*$)/i.test(l);
const isJunk = (l: string) =>
  !l ||
  /^!\[/.test(l) ||
  /^\[[^\]]*\]\([^)]*\)$/.test(l) ||
  /^\[!\[/.test(l) ||
  /^[-*_]{3,}$/.test(l) ||
  /^(advertisement|ad)$/i.test(l);

/** "- CEO - John Ternus" → { name, role } from a CALL PARTICIPANTS list. */
export function participantsFrom(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const m = md.match(/#{2,3}\s*call participants:?\s*\n([\s\S]*?)(?:\n#{2,3}\s|\n\n\n)/i);
  if (!m) return out;
  for (const raw of m[1].split("\n")) {
    const l = cleanInline(raw.replace(/^\s*[-*]\s*/, ""));
    const parts = l.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) out.set(parts[parts.length - 1], parts.slice(0, -1).join(" - "));
  }
  return out;
}

/** Analyst → firm from operator lines like "Our next question is from Erik Woodring from Morgan Stanley." */
function firmsFromOperator(turns: { speaker: string; text: string }[]) {
  const firms = new Map<string, string>();
  for (const t of turns) {
    if (!/^operator$/i.test(t.speaker)) continue;
    // Case-sensitive on purpose: names and firms are the capitalised runs around "from/of/with".
    const re =
      /(?:[Qq]uestion|[Ll]ine)\s+(?:(?:is|will be|comes)\s+)?(?:from|of)\s+(?:the line of\s+)?([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})\s+(?:of|from|with|at)\s+([A-Z][\w&.,'’ -]{1,60}?)(?=\.(?:\s+(?:[Yy]our|[Pp]lease|[Gg]o|[Tt]he|[Ww]e|[Oo]ur|[Yy]ou|[Tt]hank|M[rs]|[Nn]ow)\b|\s*$)|[,;]|\s+(?:[Pp]lease|[Yy]our|[Gg]o ahead)|$)/g;
    for (const m of t.text.matchAll(re)) {
      firms.set(m[1].trim(), m[2].replace(/[.,]$/, "").replace(/\.\s+(?=[A-Z]{2,}\b)/g, " ").trim());
    }
  }
  return firms;
}

export function parseTranscript(markdown: string): ParsedTranscript {
  const lines = markdown.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const participants = participantsFrom(markdown);

  let start = lines.findIndex(isPreparedHeading);
  if (start < 0) start = lines.findIndex((l) => !!speakerLine(l));
  if (start < 0) return { speakers: [], turns: [], words: 0, qaStart: null };

  const raw: { speaker: string; role: string | null; section: "prepared" | "qa" | null; paras: string[] }[] = [];
  let section: "prepared" | "qa" | null = null;
  let explicitQa = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (isQaHeading(l)) {
      section = "qa";
      explicitQa = true;
      continue;
    }
    if (isPreparedHeading(l)) {
      if (/prepared/i.test(l)) section = "prepared";
      continue;
    }
    if (isEnd(l) && raw.length) break;
    const sp = speakerLine(l);
    if (sp) {
      raw.push({ speaker: sp.name, role: sp.role, section, paras: sp.rest ? [cleanInline(sp.rest)] : [] });
      continue;
    }
    if (isJunk(l) || !raw.length) continue;
    const text = cleanInline(l);
    if (text) raw[raw.length - 1].paras.push(text);
  }

  const turnsRaw = raw.filter((t) => t.paras.length);
  const firms = firmsFromOperator(turnsRaw.map((t) => ({ speaker: t.speaker, text: t.paras.join(" ") })));

  // Who is who, most certain first: explicit roles ("-- Analyst"), the participants list (exact name,
  // then surname, because pages spell names differently: "Jensen Huang" listed, "Jen-Hsun Huang" speaking),
  // the operator's introductions, then the speaker's place in the call (anyone who speaks in the prepared
  // remarks or answers an analyst belongs to the company). Whoever is left is unidentified.
  const roleOf = new Map<string, string | null>();
  for (const t of turnsRaw) if (t.role && !roleOf.get(t.speaker)) roleOf.set(t.speaker, t.role);
  const mgmtSurnames = new Set<string>();
  const analystSurnames = new Set<string>();
  for (const [name, role] of participants) (/analyst/i.test(role) ? analystSurnames : mgmtSurnames).add(surnameOf(name));
  for (const name of firms.keys()) analystSurnames.add(surnameOf(name));
  const certain = (name: string): SpeakerKind | null => {
    if (/^operator$/i.test(name)) return "operator";
    const role = roleOf.get(name) ?? participants.get(name) ?? null;
    if (role && /analyst/i.test(role)) return "analyst";
    if (participants.has(name)) return "management";
    if (firms.has(name)) return "analyst";
    if (role) return "management";
    const sn = surnameOf(name);
    const m = mgmtSurnames.has(sn);
    const a = analystSurnames.has(sn);
    if (m && !a) return "management";
    if (a && !m) return "analyst";
    return null;
  };
  const decided = new Map<string, SpeakerKind | null>();
  for (const t of turnsRaw) if (!decided.has(t.speaker)) decided.set(t.speaker, certain(t.speaker));

  let qaStart: number | null = null;
  if (explicitQa) {
    const k = turnsRaw.findIndex((t) => t.section === "qa");
    qaStart = k >= 0 ? k : null;
  } else {
    // The first analyst: a known one, or a speaker the operator has just introduced by name who is not
    // known to be management ("take our first from Erik Woodring with Morgan Stanley").
    const firstAnalyst = turnsRaw.findIndex((t, i) => {
      const k = decided.get(t.speaker);
      if (k === "analyst") return true;
      if (k != null || i === 0 || decided.get(turnsRaw[i - 1].speaker) !== "operator") return false;
      const sn = surnameOf(t.speaker);
      return sn.length > 1 && turnsRaw[i - 1].paras.join(" ").toLowerCase().includes(sn);
    });
    if (firstAnalyst >= 0) {
      // Q&A opens with the operator introducing the first analyst.
      qaStart = firstAnalyst > 0 && decided.get(turnsRaw[firstAnalyst - 1].speaker) === "operator" ? firstAnalyst - 1 : firstAnalyst;
    }
  }
  const byPlace = new Map<string, SpeakerKind>();
  const firmAlias = new Map<string, string>();
  const speaking = new Set(turnsRaw.map((t) => t.speaker));
  turnsRaw.forEach((t, i) => {
    if (decided.get(t.speaker) != null || byPlace.get(t.speaker) === "management") return;
    const prevKind = i > 0 ? decided.get(turnsRaw[i - 1].speaker) : null;
    if (qaStart == null || i < qaStart) byPlace.set(t.speaker, "management");
    else if (qaStart != null && i >= qaStart && prevKind === "analyst") byPlace.set(t.speaker, "management");
    else if (qaStart != null && i >= qaStart && prevKind === "operator") {
      // The operator has just introduced a questioner ("Our next question is from Krish Sankar from TD
      // Cowen", "We will now go to Ben Bollin of Cleveland Research"), who speaks next, sometimes under a
      // fuller name ("Sreekrishnan Sankarnarayanan"). A closing remark introduces nobody.
      const intro = turnsRaw[i - 1].paras.join(" ");
      if (/conclud|end of (the|today)|thank you for (joining|participating|attending)|disconnect/i.test(intro)) return;
      byPlace.set(t.speaker, "analyst");
      const named = [...firms.keys()].filter((n) => intro.includes(n) && !speaking.has(n));
      if (named.length === 1 && !firmAlias.has(t.speaker)) firmAlias.set(t.speaker, firms.get(named[0])!);
    }
  });
  const kindOf = (name: string): SpeakerKind => decided.get(name) ?? byPlace.get(name) ?? "unidentified";

  const turns: TranscriptTurn[] = turnsRaw.map((t, i) => {
    const kind = kindOf(t.speaker);
    const text = t.paras.join("\n\n");
    return { i, speaker: t.speaker, kind, section: "prepared", text, words: wordCount(text) };
  });
  if (qaStart != null) for (let i = qaStart; i < turns.length; i++) turns[i].section = "qa";

  const bySpeaker = new Map<string, TranscriptSpeaker>();
  for (const t of turns) {
    const s =
      bySpeaker.get(t.speaker) ??
      bySpeaker
        .set(t.speaker, {
          name: t.speaker,
          role: cleanRole(roleOf.get(t.speaker) ?? participants.get(t.speaker) ?? null),
          firm: firms.get(t.speaker) ?? firmAlias.get(t.speaker) ?? firmFromRole(roleOf.get(t.speaker) ?? null),
          kind: t.kind,
          turns: 0,
          words: 0,
        })
        .get(t.speaker)!;
    s.turns++;
    s.words += t.words;
  }
  const order: Record<SpeakerKind, number> = { management: 0, analyst: 1, unidentified: 2, operator: 3 };
  const speakers = [...bySpeaker.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.words - a.words);
  return { speakers, turns, words: turns.reduce((s, t) => s + t.words, 0), qaStart, digest: digestFrom(markdown) };
}

/** Lower-case surname for matching spellings of one person ("Jen-Hsun Huang" and "Jensen Huang"), ignoring suffixes. */
function surnameOf(name: string): string {
  const w = name
    .replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return (w[w.length - 1] ?? "").toLowerCase().replace(/[^a-z\u00e0-\u024f-]/g, "");
}

/** "_Barclays -- Analyst_" → "Barclays" */
function firmFromRole(role: string | null): string | null {
  if (!role) return null;
  const m = role.match(/^(.+?)\s*(?:--|—|–)\s*analyst$/i);
  return m ? m[1].trim() : null;
}
function cleanRole(role: string | null): string | null {
  if (!role) return null;
  if (/analyst$/i.test(role)) return "Analyst";
  return role;
}

/** Transcript page URL → quarter and date, e.g. ".../2026/10/13/jpmorgan-chase-jpm-q3-2026-earnings-call-transcript". */
export function transcriptRef(url: string): TranscriptRef {
  const m = url.match(/call-transcripts\/(\d{4})\/(\d{2})\/(\d{2})\/([^/?#]+)/);
  const slug = m?.[4] ?? url;
  const q = slug.match(/-q([1-4])-(\d{4})-/);
  return {
    url: url.replace(/\.aspx$/, "").replace(/\/$/, ""),
    quarter: q ? `Q${q[1]} ${q[2]}` : null,
    fq: q ? Number(q[1]) : null,
    fy: q ? Number(q[2]) : null,
    date: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
  };
}

/**
 * Does this transcript URL belong to the company? Slugs read "<name>-<ticker>-q<n>-<year>-...". The ticker
 * token decides when there is one: a slug that starts with the company's first name word but carries another
 * ticker ("apple-hospitality-aple-q3-2026" for AAPL) is another company. Share classes match by prefix
 * ("goog" for GOOGL). Older slugs without a ticker ("apple-q4-2025") fall back to the first name word.
 */
export function transcriptMatches(url: string, ticker: string, name: string, altTickers: string[] = []): boolean {
  const slug = url.match(/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/([^/?#]+)/)?.[1]?.toLowerCase();
  if (!slug || !/transcri/.test(slug)) return false;
  const tickers = [ticker, ...altTickers].map((t) => t.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);
  if (tickers.some((t) => slug.includes(`-${t}-q`) || slug.startsWith(`${t}-q`))) return true;
  const head = slug.match(/^(.*?)-q[1-4]-\d{4}-/)?.[1];
  if (!head) return false;
  const words = head.split("-");
  const first = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")[0];
  if (!first || first.length <= 2 || words[0] !== first) return false;
  const token = words[words.length - 1];
  if (words.length === 1 || token === first) return true;
  // The token before "-q" is the slug's ticker when it is short and not part of the company's name.
  const nameWords = new Set(name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/));
  if (nameWords.has(token) || token.length > 5) return true;
  return tickers.some((t) => t.startsWith(token) || token.startsWith(t));
}

export interface TranscriptDigest {
  /** The page's own summary paragraph (third-party editorial, not company words). */
  summary: string | null;
  /** "Label -- text" bullets from the page's takeaways list. */
  takeaways: { label: string; text: string }[];
  risks: { label: string; text: string }[];
}

function bullets(md: string, heading: RegExp): { label: string; text: string }[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => heading.test(l.trim()));
  if (start < 0) return [];
  const out: { label: string; text: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#{1,3}\s/.test(l)) break;
    if (!/^[-*]\s+/.test(l)) continue;
    const m = l.replace(/^[-*]\s+/, "").match(/^\*\*(.+?)\*\*\s*(?:\\?-\\?-|—|–|:)\s*(.+)$/);
    if (m) out.push({ label: cleanInline(m[1]), text: cleanInline(m[2]) });
    else out.push({ label: "", text: cleanInline(l.replace(/^[-*]\s+/, "")) });
  }
  return out.filter((b) => b.text.length > 3);
}

/** The transcript page's summary, takeaways and risks sections, when it has them. */
export function digestFrom(md: string): TranscriptDigest | null {
  const lines = md.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => /^#{2,3}\s*summary:?\s*$/i.test(l));
  let summary: string | null = null;
  if (at >= 0) {
    const paras: string[] = [];
    for (let i = at + 1; i < lines.length; i++) {
      if (/^#{1,3}\s/.test(lines[i])) break;
      // The summary paragraph only: bullet lists under it repeat quotes and figures shown elsewhere.
      if (/^[-*]\s/.test(lines[i])) break;
      if (lines[i]) paras.push(cleanInline(lines[i]));
    }
    // Drop the page's live price tags, e.g. "Apple Inc. (AAPL +2.46%)".
    summary = paras.join(" ").replace(/\s*\((?:NASDAQ:|NYSE:)?\s*[A-Z.]{1,6}\s*[+\-−]?\d+(?:\.\d+)?%\)/g, "").replace(/\s+/g, " ").trim() || null;
  }
  const takeaways = bullets(md, /^#{2,3}\s*takeaways:?\s*$/i);
  const risks = bullets(md, /^#{2,3}\s*risks:?\s*$/i);
  return summary || takeaways.length || risks.length ? { summary, takeaways, risks } : null;
}

/** Share classes whose calls are published under another ticker (same table as the server's search). */
export const SHARE_CLASS_TICKERS: Record<string, string[]> = { GOOGL: ["GOOG"], "BRK-B": ["BRK"], META: ["FB"] };
