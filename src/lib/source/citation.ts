// Plain-text citation for the evidence open in the source panel, for pasting into notes, memos and emails.
import { fmtDate, fmtValueLong } from "@/lib/format";
import type { SourceTarget } from "@/components/source/source-context";

export interface CitationFiling {
  form?: string;
  filed?: string;
}

export const secArchiveUrl = (cik: string, accn: string, doc?: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc ?? ""}`;

export function buildCitation(
  t: SourceTarget,
  opts: { company?: string; cik?: string; accn?: string; doc?: string; filing?: CitationFiling },
): string {
  const lines: string[] = [];
  const who = opts.company ? `${opts.company} (${t.ticker})` : t.ticker;
  lines.push(`${who}: ${t.label}${t.periodLabel ? `, ${t.periodLabel}` : ""}`);
  const valued = !t.doc && !t.external && Number.isFinite(t.value);
  if (valued) lines.push(`Value: ${fmtValueLong(t.value, t.unit)}${t.approx ? " (approx.)" : ""}`);
  if (t.derived) lines.push(`Calculated: ${t.derived.formula}`);
  const accn = opts.accn ?? t.doc?.accn ?? t.src?.accn;
  const form = opts.filing?.form ?? t.doc?.form;
  const filed = opts.filing?.filed ?? t.doc?.filed;
  if (t.external) {
    lines.push(
      `Source: ${t.external.url}${t.external.date ? ` (${fmtDate(t.external.date)})` : ""}`,
    );
  } else if (accn) {
    const parts = [
      form ? `Form ${form}` : "SEC filing",
      filed ? `filed ${fmtDate(filed)}` : null,
      `accession ${accn}`,
    ].filter(Boolean);
    lines.push(parts.join(", "));
    if (t.src?.concept)
      lines.push(`XBRL: ${t.src.concept}${t.src.end ? `, period ending ${t.src.end}` : ""}`);
    const cik = opts.cik ?? t.doc?.cik;
    if (cik) lines.push(secArchiveUrl(cik, accn, opts.doc ?? t.doc?.doc ?? t.src?.doc));
  }
  const quote = t.external?.quote ?? t.doc?.search;
  if (quote)
    lines.push(
      `${t.external?.quote ? "Quote" : "Passage"}: "${quote.replace(/\s+/g, " ").trim()}"`,
    );
  return lines.join("\n");
}
