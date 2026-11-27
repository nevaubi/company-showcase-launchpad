// The printed report cannot open the interactive source drawer. Build a compact document index
// for the facts actually used, including the inputs behind calculated and peer figures.
import { companyCiks, coverageOf } from "@/lib/coverage";
import { filingCik, filingUrl } from "@/lib/financials/currency";
import { chartFactIds } from "./chart-facts";
import { compressRefs, webSourceUrl } from "./present";
import type { FactRef, ReportContent } from "./types";

interface DocumentSource { label: string; url?: string }

export function sourceMark(numbers: number[] = []): string {
  return numbers.length ? `D${compressRefs(numbers)}` : "";
}

export function reportSources(content: ReportContent) {
  const facts = new Map(content.facts.map((f) => [f.id, f]));
  const documents: DocumentSource[] = [];
  const numbers = new Map<string, number>();
  const references = new Map<FactRef, number[]>();

  function number(source: DocumentSource) {
    const key = source.url || source.label;
    const prior = numbers.get(key);
    if (prior) return prior;
    const index = documents.push(source);
    numbers.set(key, index);
    return index;
  }

  function filing(ticker: string, accession: string, doc?: string) {
    const company = coverageOf(ticker);
    const label = `${ticker} · SEC filing ${accession}${doc ? ` · ${doc}` : ""}`;
    if (!company || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return number({ label });
    const cik = filingCik(accession, company.cik, companyCiks(company));
    return number({ label, url: filingUrl(cik, accession, doc) });
  }

  function add(ref: FactRef | undefined): number[] {
    if (!ref) return [];
    const known = references.get(ref);
    if (known) return known;
    references.set(ref, []); // Older saved reports can contain a dangling or circular member.
    let ids: number[];
    switch (ref.kind) {
      case "sec":
      case "filing": {
        const src = ref.kind === "sec" ? ref.src : ref;
        ids = src.accn ? [filing(ref.tk ?? content.ticker, src.accn, src.doc)] : [];
        break;
      }
      case "derived":
        ids = ref.parts.filter((p) => p.accn).map((p) => filing(ref.tk ?? content.ticker, p.accn, p.doc));
        for (const m of ref.market ?? []) ids.push(number({ label: `${m.label} · market data as of ${m.asOf}` }));
        break;
      case "composite":
        ids = ref.members.flatMap((id) => add(facts.get(id)?.ref));
        if (!ids.length || ref.members.some((id) => !facts.has(id))) {
          ids.push(number({ label: `${ref.label} · ${ref.formula} · incomplete source detail in saved report` }));
        }
        break;
      case "web": {
        const url = webSourceUrl(ref.url)?.href;
        ids = [number({ label: [ref.label, ref.date].filter(Boolean).join(" · "), url })];
        break;
      }
      case "market":
      case "firm":
        ids = [number({ label: `${ref.label} · ${ref.kind === "market" ? "market data" : "firm coverage"} as of ${ref.asOf}` })];
        break;
    }
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    references.set(ref, unique);
    return unique;
  }

  for (const tile of content.glance ?? []) if (tile.f) add(facts.get(tile.f)?.ref);
  const charts = new Map((content.charts ?? []).map((c) => [c.id, c]));
  const tables = new Map(content.tables.map((t) => [t.id, t]));
  const chartSources = new Map<string, number[]>();
  for (const s of content.sections) {
    for (const claim of [...s.paragraphs, ...s.bullets]) for (const id of claim.factIds) add(facts.get(id)?.ref);
    for (const id of s.charts ?? []) {
      const chart = charts.get(id);
      if (chart) chartSources.set(id, [...new Set(chartFactIds(chart).flatMap((f) => add(facts.get(f)?.ref)))]);
    }
    for (const id of s.tables) for (const row of tables.get(id)?.rows ?? []) for (const cell of row.cells) add(cell?.ref);
  }
  const forRef = (ref?: FactRef) => ref ? references.get(ref) : undefined;
  return { documents, forRef, chartSources };
}

export type ReportSources = ReturnType<typeof reportSources>;
