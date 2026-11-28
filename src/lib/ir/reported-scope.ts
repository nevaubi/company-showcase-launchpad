/** Operating charts show reported outcomes. Source documents retain scenarios, guidance and targets. */
export interface SourceScope {
  id: string;
  title?: string | null;
  source_url?: string | null;
}

export function scenarioDocument(source: Omit<SourceScope, "id">): boolean {
  const name = (source.title ?? "")
    .split("||")[0]
    .replace(/[‐‑–—-]/g, " ")
    .trim();
  return (
    /^(?:\d{4}\s+)?(?:(?:annual|company run|supervisory|dodd frank act)\s+)*stress tests? (?:results?|disclosures?|scenarios?)\b/i.test(
      name,
    ) || /\/stress-test-results\/[^/?]+\.(?:pdf|html?)(?:[?#]|$)/i.test(source.source_url ?? "")
  );
}

/**
 * A document that introduces itself as pro forma financial information (an acquisition or disposal exhibit):
 * its tables combine this company with another, or print the other company's results under this company's
 * statement names, so none of it is a reported figure of this company. Entegris' 8-K of April 4, 2022 printed
 * CMC Materials' quarter beside its own under "Revenues" and "Cost of sales". Decided from the opening of the
 * document's text, where such an exhibit names itself.
 */
const PRO_FORMA_DOCUMENT =
  /\b(?:unaudited\s+)?pro\s*forma\s+(?:condensed\s+)?(?:combined|consolidated)\s+(?:condensed\s+)?financial\s+(?:information|statements?|data)\b/i;
export function proFormaDocument(opening: string | null | undefined): boolean {
  return PRO_FORMA_DOCUMENT.test((opening ?? "").slice(0, 1200));
}

/**
 * Whether an exhibit's stored title says its 8-K reported results (Item 2.02, "Results of Operations and
 * Financial Condition"): true or false for a title listing the 8-K's items ("8-K 2022-04-04 ex99-2.htm (Items
 * 7.01,8.01,9.01)"), null for a document whose title lists none (an IR-site file).
 */
export function resultsExhibit(title: string | null | undefined): boolean | null {
  const m = /^8-K(?:\/A)?\b.*\(Items?\s+([^)]*)\)/i.exec((title ?? "").split("||")[0]);
  if (!m) return null;
  return m[1].split(/[,\s]+/).includes("2.02");
}

const SCENARIO_MEASURE =
  /\b(?:pro forma stressed (?:capital|loss|income|balance)|(?:supervisory |severely )?adverse scenario|under (?:a |the )?stress(?:ed)? scenario|stress[- ]test (?:projections?|scenarios?))\b/i;
const TARGET_MEASURE =
  /\btargeting\s+(?:a\s+|an\s+)?\d|(?:^|[.:;]\s*)target\s+(?:a\s+|an\s+)?\d|\b(?:medium[- ]term|long[- ]term) (?:financial )?(?:targets?|goals?|objectives?)\b|\b(?:target|goal)\s*[:=]\s*\d|\b(?:ROTCE|ROE|CET1|capital ratio) (?:target|goal)\b/i;

export function projectedMeasure(text?: string | null): boolean {
  return !!text && (SCENARIO_MEASURE.test(text) || TARGET_MEASURE.test(text));
}

export function isReportedMeasure(f: {
  label: string;
  parent?: string | null;
  breakdown?: string | null;
  locator?: unknown;
  value?: number;
}): boolean {
  const at = f.locator as { q?: string; text?: string } | null | undefined;
  if ([f.label, f.parent, f.breakdown].some(projectedMeasure)) return false;
  for (const sentence of [at?.q, at?.text]) {
    if (!sentence) continue;
    if (SCENARIO_MEASURE.test(sentence)) return false;
    const marker = TARGET_MEASURE.exec(sentence);
    if (!marker) continue;
    // An issuer can report an achieved rate, then mention its goal in the same sentence.
    // Only the number explicitly attributed to the target clause is a target observation.
    const clause = sentence
      .slice(marker.index)
      .split(/[;.!?](?=\s)|,\s+(?:while|but|compared|versus)\b/i)[0];
    const targets = [...clause.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((n) => Math.abs(Number(n[0])));
    if (
      targets.length &&
      (f.value == null || targets.some((n) => Math.abs(n - Math.abs(f.value!)) < 1e-8))
    )
      return false;
  }
  return true;
}

/** Readback of the actual serialized chart, including any source represented only as a prior printing. */
export function reportedChartAudit(
  payload: { docs: { id: string }[]; series: { label: string; bd?: string | null }[] },
  scenarioIds: Set<string>,
) {
  return {
    scenarioSources: payload.docs.filter((d) => scenarioIds.has(d.id)).map((d) => d.id),
    projectionSeries: payload.series.filter(
      (s) => projectedMeasure(s.label) || projectedMeasure(s.bd),
    ).length,
  };
}
