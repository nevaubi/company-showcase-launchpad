/**
 * The coverage ledger as the assistant reads it (pure): one line per kind of data for a company,
 * with the state, the count, the newest date and the reason. The closing line is the rule the
 * assistant must keep: "not stored" is a gap in the app, never a fact about the company.
 */
import { CORPORA, STATE_LABEL, corpusOf, day, tally, type CoverageRow } from "./corpora";

export interface CoverageText {
  output: string;
  summary: string;
}

export function coverageText(ticker: string, name: string | undefined, rows: readonly CoverageRow[], checked: string | null): CoverageText {
  if (!rows.length) {
    return {
      output: `The coverage ledger holds no row for ${ticker}. It covers the companies of the coverage list (get_coverage) and is rebuilt once a day; say that what is stored for this company is not known, and use the data tools directly.`,
      summary: "no ledger rows",
    };
  }
  const t = tally(rows.map((r) => r.state));
  const lines = CORPORA.flatMap((def) => {
    const r = rows.find((x) => x.corpus === def.id);
    if (!r) return [];
    const count = r.items ? `, ${r.items.toLocaleString("en-US")} ${r.items === 1 ? "item" : "items"}` : "";
    const newest = r.newest ? `, newest ${day(r.newest)}` : "";
    return [`- ${def.label} [${STATE_LABEL[r.state]}${count}${newest}]: ${r.why}`];
  });
  const head = `What FiledUnder holds for ${name ? `${name} (${ticker})` : ticker}${checked ? `, checked ${day(checked)}` : ""}: ${t.full} complete, ${t.partial} partial, ${t.none} not stored, ${t.held} stopped, ${t.not_applicable} not applicable.`;
  const rule =
    'How to use this: "Not stored" and "Stopped" are gaps in what the app has collected, not facts about the company: say "FiledUnder has not stored this yet", never "the company has none". "Complete" with no items means the source was read and holds none. "Does not apply" means the kind of data does not exist for this company. "Partial" names what is missing or old: say so when you rely on it.';
  return { output: [head, ...lines, rule].join("\n"), summary: `${t.full} complete, ${t.partial} partial, ${t.none + t.held} not stored` };
}

/** One kind of data's line, for a tool that found nothing and wants to say why (null when the ledger has no row). */
export function coverageLine(rows: readonly CoverageRow[], corpus: string): string | null {
  const r = rows.find((x) => x.corpus === corpus);
  const def = corpusOf(corpus);
  return r && def ? `${def.label}: ${STATE_LABEL[r.state]}. ${r.why}` : null;
}
