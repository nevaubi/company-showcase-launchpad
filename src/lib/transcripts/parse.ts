// Earnings-call transcript parsing. Pure (no I/O) so the server function, tests and any
// script share it. Handles the two layouts used by Motley Fool transcript pages (as
// markdown): inline "**Name:** text" turns, and "**Name** -- _Role_" headers followed by
// paragraphs with "Prepared Remarks" / "Questions & Answers" headings.

export type SpeakerKind = "management" | "analyst" | "operator";

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
    for (const m of t.text.matchAll(/(?:question|line)\s+(?:(?:is|will be|comes)\s+)?(?:from|of)\s+(?:the line of\s+)?([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})\s+(?:of|from|with|at)\s+([A-Z][\w&.,'’ -]{1,60}?)(?=\.(?:\s+(?:your|please|go|the|we|our|you|thank|mr|ms|now)\b|\s*$)|[,;]|\s+(?:please|your|go ahead)|$)/gi)) {
      firms.set(m[1].trim(), m[2].replace(/[.,]$/, "").trim());
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

  // Who is who: explicit roles ("-- Analyst"), the participants list, then operator-named analysts.
  const roleOf = new Map<string, string | null>();
  for (const t of turnsRaw) if (t.role && !roleOf.get(t.speaker)) roleOf.set(t.speaker, t.role);
  const kindOf = (name: string): SpeakerKind => {
    if (/^operator$/i.test(name)) return "operator";
    const role = roleOf.get(name) ?? participants.get(name) ?? null;
    if (role && /analyst/i.test(role)) return "analyst";
    if (participants.has(name)) return "management";
    if (firms.has(name)) return "analyst";
    if (role) return "management";
    return participants.size ? "analyst" : "management";
  };

  let qaStart: number | null = null;
  const turns: TranscriptTurn[] = turnsRaw.map((t, i) => {
    const kind = kindOf(t.speaker);
    const text = t.paras.join("\n\n");
    return { i, speaker: t.speaker, kind, section: "prepared", text, words: wordCount(text) };
  });
  if (explicitQa) {
    const k = turnsRaw.findIndex((t) => t.section === "qa");
    qaStart = k >= 0 ? k : null;
  } else {
    const firstAnalyst = turns.findIndex((t) => t.kind === "analyst");
    if (firstAnalyst >= 0) {
      // Q&A opens with the operator introducing the first analyst.
      qaStart = firstAnalyst > 0 && turns[firstAnalyst - 1].kind === "operator" ? firstAnalyst - 1 : firstAnalyst;
    }
  }
  if (qaStart != null) for (let i = qaStart; i < turns.length; i++) turns[i].section = "qa";

  const bySpeaker = new Map<string, TranscriptSpeaker>();
  for (const t of turns) {
    const s =
      bySpeaker.get(t.speaker) ??
      bySpeaker
        .set(t.speaker, {
          name: t.speaker,
          role: cleanRole(roleOf.get(t.speaker) ?? participants.get(t.speaker) ?? null),
          firm: firms.get(t.speaker) ?? firmFromRole(roleOf.get(t.speaker) ?? null),
          kind: t.kind,
          turns: 0,
          words: 0,
        })
        .get(t.speaker)!;
    s.turns++;
    s.words += t.words;
  }
  const order: Record<SpeakerKind, number> = { management: 0, analyst: 1, operator: 2 };
  const speakers = [...bySpeaker.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.words - a.words);
  return { speakers, turns, words: turns.reduce((s, t) => s + t.words, 0), qaStart };
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

/** Does this transcript URL belong to the company? Matches the ticker token or the name's first word in the slug. */
export function transcriptMatches(url: string, ticker: string, name: string, altTickers: string[] = []): boolean {
  const slug = url.match(/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/([^/?#]+)/)?.[1]?.toLowerCase();
  if (!slug || !/transcri/.test(slug)) return false;
  const tickers = [ticker, ...altTickers].map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  if (tickers.some((t) => slug.includes(`-${t}-q`) || slug.startsWith(`${t}-q`))) return true;
  const first = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")[0];
  return !!first && first.length > 2 && slug.startsWith(`${first}-`) && /-q[1-4]-\d{4}-/.test(slug);
}
