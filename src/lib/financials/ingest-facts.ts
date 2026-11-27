// Company facts as ingest assembles them before the statement builder runs. SEC's companyfacts misses filings: a
// combined filing of two registrants (Prologis, Inc. with Prologis, L.P.; NextEra with Florida Power & Light) has had
// no fact in it since mid-2026, and a company that changed registrant (Exxon Mobil, CIK 34088 to 2115436) has its
// newest 10-Q under the new CIK only. Ingest merges the companyfacts of every CIK and reads each missing 10-Q/10-K's
// own inline XBRL (factsFromInline, extend.ts) into the facts. Pure: no Node or browser APIs.
import type { CompanyFacts, RawFact } from "./build";

export interface PeriodicFiling {
  accn: string;
  form: string;
  filed: string;
  ixbrl?: boolean;
}

/** Every accession a fact in the set comes from. */
export function accessionsInFacts(cf: CompanyFacts): Set<string> {
  const out = new Set<string>();
  for (const concepts of Object.values(cf.facts))
    for (const node of Object.values(concepts)) for (const list of Object.values(node.units ?? {})) for (const f of list) out.add(f.accn);
  return out;
}

const PERIODIC = /^10-[KQ](\/A)?$/;
const WINDOW_DAYS = 800;

/**
 * Inline-XBRL 10-Qs and 10-Ks of the last two years whose accession has no fact in the company facts: the filings
 * whose figures the statements would otherwise lack. Newest first, as the submissions list them.
 */
export function filingsMissingFromFacts<F extends PeriodicFiling>(filings: F[], cf: CompanyFacts, today: string): F[] {
  const have = accessionsInFacts(cf);
  const from = Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 86_400_000;
  const seen = new Set<string>();
  return filings.filter((f) => {
    if (!PERIODIC.test(f.form) || !f.ixbrl || have.has(f.accn) || seen.has(f.accn)) return false;
    seen.add(f.accn);
    return Date.parse(`${f.filed}T00:00:00Z`) >= from;
  });
}

const sameFact = (a: RawFact, b: RawFact) => a.accn === b.accn && a.start === b.start && a.end === b.end;

/** Adds the facts of `extra` to `cf` in place, a fact already there (same filing and period) kept once. */
export function mergeFactsInto(cf: CompanyFacts, extra: CompanyFacts) {
  for (const [ns, concepts] of Object.entries(extra.facts)) {
    cf.facts[ns] ??= {};
    for (const [local, node] of Object.entries(concepts)) {
      const target = (cf.facts[ns][local] ??= { ...(node.label ? { label: node.label } : {}), units: {} });
      target.units ??= {};
      for (const [unit, list] of Object.entries(node.units ?? {})) {
        const have = (target.units[unit] ??= []);
        for (const f of list) if (!have.some((h) => sameFact(h, f))) have.push(f);
      }
    }
  }
}
