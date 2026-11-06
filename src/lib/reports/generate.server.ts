// Report generation: build the fact pack, ask the model for cited prose, keep only verified claims.
import { buildReportData } from "./facts";
import { KINDS, reportInput, reportInstructions, reportSchema, sectionsFor } from "./kinds";
import { vetSections } from "./vet";
import type { Claim, ReportContent, ReportInputs, ReportKind, ReportOptions } from "./types";

export async function generateReportContent(kind: ReportKind, options: ReportOptions, inputs: ReportInputs, firmName: string | null): Promise<ReportContent> {
  const { structured, MODEL } = await import("@/lib/ai.server");
  const built = buildReportData(inputs);
  if (built.facts.length < 12) throw new Error("Not enough sourced data to write this report yet");
  const defs = sectionsFor(kind, options);
  const d = inputs.data;
  const name = d.profile.name;
  const out = await structured<{ title: string; subtitle: string; sections: { id: string; paragraphs: Claim[]; bullets: Claim[] }[] }>({
    name: `report_${kind}`,
    effort: options.length === "deep" ? "high" : "medium",
    instructions: reportInstructions(kind, options, name, d.profile.ticker, firmName),
    input: reportInput(defs, built.facts, built.background, inputs.today),
    schema: reportSchema(defs.map((s) => s.id)),
  });
  const tableIds = new Set(built.tables.map((t) => t.id));
  const { sections, qa } = vetSections(out.sections ?? [], defs, built.facts, tableIds);
  if (!sections.some((s) => s.paragraphs.length || s.bullets.length)) throw new Error("The draft didn't pass source checks; try again");
  const used = new Set(sections.flatMap((s) => [...s.paragraphs, ...s.bullets].flatMap((c) => c.factIds)));
  const usedTables = new Set(sections.flatMap((s) => s.tables));
  const clean = (s: string) => s.replace(/\*\*|__|`|#/g, "").trim();
  return {
    version: 1,
    ticker: d.profile.ticker,
    name,
    kind,
    title: clean(out.title) || `${name}: ${KINDS[kind].label}`,
    subtitle: clean(out.subtitle),
    asOf: inputs.today,
    priceAsOf: inputs.price?.asOf ?? null,
    dataVersion: built.dataVersion,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    options,
    // Keep cited facts plus everything the shown tables rely on; drop the rest to keep rows small.
    facts: built.facts.filter((f) => used.has(f.id)),
    tables: built.tables.filter((t) => usedTables.has(t.id)),
    sections,
    qa,
  };
}
