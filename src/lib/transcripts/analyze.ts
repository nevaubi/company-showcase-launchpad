// Light analytics over a parsed earnings-call transcript. Pure; shared by the app and tests.
import type { ParsedTranscript } from "./parse";

/** Share of spoken words by speaker group, plus the prepared-remarks share. */
export function talkShare(t: ParsedTranscript) {
  const total = t.words || 1;
  const by = { management: 0, analyst: 0, operator: 0 };
  let prepared = 0;
  for (const x of t.turns) {
    by[x.kind] += x.words;
    if (x.section === "prepared") prepared += x.words;
  }
  return {
    management: by.management / total,
    analyst: by.analyst / total,
    operator: by.operator / total,
    prepared: t.qaStart == null ? 0 : prepared / total,
  };
}

export interface QuestionEntry {
  i: number;
  speaker: string;
  firm: string | null;
  /** First sentence or two of the question */
  gist: string;
}

/** One entry per analyst exchange: an analyst's first turn after someone else spoke. */
export function questionIndex(t: ParsedTranscript): QuestionEntry[] {
  const firm = new Map(t.speakers.map((s) => [s.name, s.firm]));
  const out: QuestionEntry[] = [];
  let lastAnalyst: string | null = null;
  for (const x of t.turns) {
    if (x.kind === "operator") continue;
    if (x.kind === "analyst") {
      if (x.speaker !== lastAnalyst) out.push({ i: x.i, speaker: x.speaker, firm: firm.get(x.speaker) ?? null, gist: gist(x.text) });
      lastAnalyst = x.speaker;
    }
  }
  return out;
}

function gist(text: string) {
  // Skip pleasantries ("Thanks for taking my question.") to reach the substance.
  const sentences = text.replace(/\s+/g, " ").match(/[^.?!]+[.?!]+/g) ?? [text];
  const filler = /^(\s*(hi|hey|hello|good (morning|afternoon|evening)|thank|thanks|great|congrat|yes|yeah|okay|ok|sure|maybe|so|i have two|two questions|i wanted to)\b[^.?!]{0,60}[.?!])$/i;
  const body = sentences.filter((s) => !filler.test(s));
  const pick = (body.length ? body : sentences).slice(0, 2).join(" ").trim();
  return pick.length > 220 ? `${pick.slice(0, 217).trimEnd()}…` : pick;
}

const STOP = new Set(
  (
    "a about above across actually after again against all almost also although always am among an and another any anything are around as ask asked at back based be because been before being below best better between big bit both but by call can continue continued could couple day days did do does doing done down during each early either else end even ever every expect expected first for from further get getting give go going good got great guess had half has have having he hear her here hey hi high higher his how i if important in into is it its itself just keep kind know last later let level like little look looking lot made make making many may maybe me mean might more most much my need new next no not now number obviously of off on once one ones only or other our out over overall part particular particularly people perhaps please point pretty probably put quarter quarters question questions quite rather really right said same saw say saying see seeing seen she should side significant since so some something sort still strong such sure take talk talked talking terms than thank thanks that the their them then there these they thing things think thinking this those though three through time times to today together too took two up us very want wanted was way we well were what when where whether which while who why will with within without would year years yes yet you your yeah okay frankly billion million percent business january february march april june july august september october november december prepared remarks guys folks color"
  ).split(" "),
);

/** Most frequent content words and two-word phrases across the call (management + analysts). */
export function keyTerms(t: ParsedTranscript, n = 12, exclude: string[] = []): { term: string; count: number }[] {
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  // Speaker names and the company's own name say nothing about the call's topics.
  const names = new Set([...t.speakers.flatMap((s) => s.name.toLowerCase().split(/\s+/)), ...exclude.flatMap((e) => e.toLowerCase().split(/\s+/))]);
  for (const x of t.turns) {
    if (x.kind === "operator") continue;
    const words = x.text
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .split(/[^a-z0-9+&-]+/)
      .filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const ok = (s: string) => s.length > 2 && !STOP.has(s) && !names.has(s) && !/^\d+$/.test(s) && !/^-|-$/.test(s);
      if (ok(w)) uni.set(w, (uni.get(w) ?? 0) + 1);
      const v = words[i + 1];
      if (v && ok(w) && ok(v)) bi.set(`${w} ${v}`, (bi.get(`${w} ${v}`) ?? 0) + 1);
    }
  }
  const phrases = [...bi.entries()].filter(([, c]) => c >= 4).sort((a, b) => b[1] - a[1]).slice(0, Math.ceil(n / 2));
  const covered = new Set(phrases.flatMap(([p]) => p.split(" ")));
  const singles = [...uni.entries()].filter(([w, c]) => c >= 5 && !covered.has(w)).sort((a, b) => b[1] - a[1]);
  return [...phrases, ...singles]
    .slice(0, n)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count);
}
