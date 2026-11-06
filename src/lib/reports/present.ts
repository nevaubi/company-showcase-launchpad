// Presentation helpers for report facts shared by the on-screen document and the Word export. Pure.
import type { SourceTarget } from "@/components/source/source-context";
import type { FactRef } from "./types";
import { numbersIn } from "./vet";
import { fmtDate } from "@/lib/format";

function marketNote(m: { label: string; value: number; asOf: string }[] | undefined): string {
  return m?.length ? ` · uses ${m.map((x) => `${x.label.toLowerCase()} $${x.value.toFixed(2)} as of ${x.asOf} (market data)`).join(", ")}` : "";
}

/** Turn a fact/cell reference into a source-panel target (null for market/firm data, shown as a note). */
export function refTarget(ref: FactRef, ticker: string, text: string): SourceTarget | null {
  const n = numbersIn(text).at(-1);
  const unit = !n ? "usd" : n.kind === "pct" ? "pct" : n.kind === "mult" ? "ratio" : /\$\d+\.\d{2}$/.test(n.raw) && Math.abs(n.value) < 5000 ? "usdPerShare" : "usd";
  const label = text.length > 90 ? `${text.slice(0, 88)}…` : text;
  switch (ref.kind) {
    case "sec": return { ticker, label, unit, value: ref.src.value, src: ref.src };
    case "derived": return { ticker, label, unit, value: n?.value ?? 0, derived: { formula: `${ref.formula}${marketNote(ref.market)}`, parts: ref.parts } };
    case "filing": return { ticker, label: ref.label, unit: "usd", value: 0, doc: { accn: ref.accn, doc: ref.doc, form: ref.form, filed: ref.filed, title: ref.label } };
    case "web": return { ticker, label: ref.label, unit: "usd", value: 0, external: { url: ref.url, quote: ref.quote, date: ref.date, confidence: "Verbatim quote checked against the transcript" } };
    default: return null;
  }
}

export function refCaption(ref: FactRef): string {
  switch (ref.kind) {
    case "sec": return `SEC XBRL · ${ref.src.concept} · ${ref.src.start ? `${ref.src.start} → ` : ""}${ref.src.end} · ${ref.src.accn}`;
    case "derived": return `Calculated · ${ref.formula}${marketNote(ref.market)}`;
    case "filing": return `${ref.form === "4" ? "Form 4" : `Form ${ref.form}`} filed ${ref.filed} · ${ref.accn}`;
    case "web": return `${ref.label}${ref.url ? ` · ${new URL(ref.url).hostname.replace(/^www\./, "")}` : ""}`;
    case "market": return `Market data as of ${ref.asOf} (third-party; not from SEC filings)`;
    case "firm": return `Firm coverage record as of ${ref.asOf}`;
  }
}

/** "1,2,3,5" → "1–3, 5" */
export function compressRefs(ns: number[]): string {
  const xs = [...new Set(ns)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    out.push(j - i >= 2 ? `${xs[i]}–${xs[j]}` : j > i ? `${xs[i]},${xs[j]}` : `${xs[i]}`);
    i = j;
  }
  return out.join(",");
}

/** Show ISO dates in prose as "Nov 17, 2026" (the checks run on the stored text). */
export const readableDates = (t: string) => t.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => fmtDate(d));

