// The partner worker writes one company index and one immutable set of speaker turns per call.
// Only the company's indexed earnings events can be requested through the reader.
import type { EarningsTranscript } from "../transcripts.functions";
import type { SpeakerKind, TranscriptRef } from "./parse";

interface Speaker {
  idx: number;
  name: string;
  role: string | null;
  firm: string | null;
  kind: string;
  turns: number;
  words: number;
}
interface ArchiveCall {
  call_id: string;
  title?: string;
  ticker: string;
  doc: string;
  date: string;
  kind: string;
  event_type: string;
  themes?: { label: string; summary: string; quotes?: { q: string }[] }[];
  guidance?: { quote?: { q: string } }[];
  exchanges?: { concern?: string; concern_quote?: { q: string } }[];
  label: string | null;
  speakers: Speaker[];
  sha: string;
  summary?: string;
  pending?: boolean;
  analyzed_at?: string;
}
export interface CallBundle {
  ticker: string;
  generated: string;
  docs: Record<string, { url: string; fiscal_label?: string | null }>;
  calls: ArchiveCall[];
}
export interface TurnFile {
  call_id: string;
  turns: { i: number; sp: number; sec: string; x: string; w: number }[];
}
export interface ArchiveEntry extends TranscriptRef {
  archiveId: string;
  archiveKind: "transcript" | "remarks";
  textHash: string;
  speakers: Speaker[];
  summary: string | null;
  analyzedAt: string | null;
  highlights: { label: string; detail: string }[];
  guidance: string[];
  questions: string[];
  generated: string;
}
export function archivedCalls(bundle: CallBundle, ticker: string): ArchiveEntry[] {
  if (bundle?.ticker !== ticker || !Array.isArray(bundle.calls)) return [];
  const entries: ArchiveEntry[] = [];
  for (const c of bundle.calls) {
    if (
      c.ticker !== ticker ||
      c.event_type !== "earnings" ||
      !["remarks", "transcript"].includes(c.kind) ||
      !c.speakers?.length
    )
      continue;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
      !c.call_id.startsWith(ticker + "-" + c.date + "-") ||
      !/^[a-f0-9]{6}$/.test(c.call_id.slice(ticker.length + c.date.length + 2))
    )
      continue;
    const doc = bundle.docs?.[c.doc];
    if (!doc?.url || !/^https?:\/\//i.test(doc.url)) continue;
    // Some old analyses took a historical date mentioned inside an 8-K exhibit as the call date.
    // If both the source quarter and the filing chronology contradict that date, omit the event.
    const filingDate = /^8-K (\d{4}-\d{2}-\d{2})\b/.exec(c.title || "")?.[1];
    if (
      filingDate &&
      doc.fiscal_label &&
      c.label &&
      doc.fiscal_label !== c.label &&
      Math.abs(Date.parse(c.date) - Date.parse(filingDate)) > 14 * 86400_000
    )
      continue;
    const label = doc.fiscal_label || c.label;
    const m = label?.match(/^Q([1-4])\s+(?:FY\s*)?(\d{4}|\d{2})$/i);
    const fy = m ? Number(m[2]) + (m[2].length === 2 ? 2000 : 0) : null;
    entries.push({
      url: doc.url,
      archiveId: c.call_id,
      archiveKind: c.kind === "remarks" ? "remarks" : "transcript",
      quarter: m ? `Q${m[1]} ${fy}` : label || null,
      fq: m ? Number(m[1]) : null,
      fy,
      date: c.date,
      dateBasis: "event",
      textHash: c.sha,
      contentVersion: c.sha,
      speakers: c.speakers,
      summary: !c.pending && c.summary ? c.summary : null,
      analyzedAt: c.analyzed_at || null,
      highlights: (c.pending ? [] : c.themes || [])
        .filter((th) => th.label && th.quotes?.[0]?.q)
        .slice(0, 6)
        .map((th) => ({ label: th.label, detail: th.quotes![0].q })),
      guidance: (c.pending ? [] : c.guidance || [])
        .map((g) => g.quote?.q || "")
        .filter(Boolean)
        .slice(0, 5),
      questions: (c.pending ? [] : c.exchanges || [])
        .map((e) => e.concern_quote?.q || "")
        .filter(Boolean)
        .slice(0, 4),
      generated: bundle.generated,
    });
  }
  return entries.sort((a, b) => b.date!.localeCompare(a.date!));
}

export function listedCall(r: TranscriptRef): TranscriptRef {
  const { url, quarter, fq, fy, date, publishedDate, dateBasis, archiveKind, contentVersion } = r;
  return {
    url,
    quarter,
    fq,
    fy,
    date,
    publishedDate,
    dateBasis,
    ...(archiveKind ? { archiveKind, contentVersion } : {}),
  };
}
export function mergeCalls(archive: TranscriptRef[], published: TranscriptRef[]) {
  const rows = [...archive, ...published].sort((a, b) =>
    (b.date || "").localeCompare(a.date || ""),
  );
  const byPeriod = new Map<string, TranscriptRef>();
  for (const r of rows) {
    const key = r.fy && r.fq ? `${r.fy}-Q${r.fq}` : r.date || r.url;
    const prev = byPeriod.get(key);
    // The fullest account for a given period: issuer transcript, published transcript, prepared remarks.
    const rank = (x: TranscriptRef) =>
      x.archiveKind === "transcript" ? 2 : x.archiveKind === "remarks" ? 0 : 1;
    if (!prev || rank(r) > rank(prev)) byPeriod.set(key, r);
  }
  return [...byPeriod.values()]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 12)
    .map(listedCall);
}
export function fromArchive(
  ticker: string,
  name: string,
  entry: ArchiveEntry,
  file: TurnFile,
): EarningsTranscript | null {
  if (file?.call_id !== entry.archiveId || !file.turns?.length) return null;
  const speakers = entry.speakers.map((s) => ({
    name: s.name,
    role: s.role,
    firm: s.firm,
    kind: (["management", "analyst", "operator"].includes(s.kind)
      ? s.kind
      : "unidentified") as SpeakerKind,
    turns: s.turns,
    words: s.words,
  }));
  const byIndex = new Map(entry.speakers.map((s, i) => [s.idx, speakers[i]]));
  const turns: EarningsTranscript["turns"] = [];
  for (const t of file.turns) {
    const sp = byIndex.get(t.sp);
    if (
      !sp ||
      typeof t.x !== "string" ||
      !["prepared", "qa"].includes(t.sec) ||
      t.i !== turns.length
    )
      return null;
    turns.push({
      i: t.i,
      speaker: sp.name,
      kind: sp.kind,
      section: t.sec as "qa" | "prepared",
      text: t.x,
      words: t.w,
    });
  }
  const qaStart = turns.findIndex((t) => t.section === "qa");
  return {
    ...listedCall(entry),
    ticker,
    speakers,
    turns,
    words: turns.reduce((n, t) => n + t.words, 0),
    qaStart: qaStart < 0 ? null : qaStart,
    source: "Company investor relations",
    fetchedAt: entry.generated,
    title: [
      name,
      entry.quarter || entry.date,
      entry.archiveKind === "remarks" ? "prepared remarks" : "earnings call",
    ].join(" "),
    archiveSummary: entry.summary ? { text: entry.summary, asOf: entry.analyzedAt } : undefined,
  };
}
