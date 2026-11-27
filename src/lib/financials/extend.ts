// Read-time extension of the statements with reports the partner build has not picked up yet.
// Pure (no DOM, no fetch): the caller hands in each new 10-Q/10-K's inline XBRL primary document
// (getFilingDocument already serves it, mirrored copy first).
//
// How: the dataset's cells keep every XBRL fact they were built from (SourceRef on reported cells,
// and on every part of a derived cell: year-to-date totals, components). Those facts, plus the new
// filing's own non-dimensional facts, are exactly what the repo's builder needs to place the new
// period, so `buildStatements` runs again on that set and only the periods after the dataset's
// latest one are taken from its output. Earlier columns stay as served. Every new value is a fact
// the new filing tagged (accession, concept, period) or a derived cell whose parts are such facts,
// so click-to-source opens the filing like any other value.
import { buildKpis, buildStatements, type CompanyFacts, type RawFact } from "./build";
import { statementOptions } from "./dataset";
import type { Cell, CompanyDataset, Period, Row, Statement, StatementKey, Unit } from "./types";
import { factValue, parseContexts, parseUnits } from "../xbrl/inline";

export interface FiledReport {
  accn: string;
  form: string;
  filed: string;
  report?: string;
  doc: string;
}

/** Marks a period column that was read from a filing at view time, not built by the scheduled ingest. */
export interface ReadPeriod extends Period {
  readFrom?: { accn: string; form: string; filed: string; doc: string };
}

const UNIT_KEY: Partial<Record<Unit, string>> = { usd: "USD", usdPerShare: "USD/shares", shares: "shares" };
const KEEP_UNITS = new Set(["USD", "USD/shares", "shares"]);

function add(cf: CompanyFacts, concept: string, unit: string, f: RawFact) {
  const i = concept.indexOf(":");
  const ns = i < 0 ? "us-gaap" : concept.slice(0, i);
  const local = i < 0 ? concept : concept.slice(i + 1);
  const node = ((cf.facts[ns] ??= {})[local] ??= { units: {} });
  const list = (node.units[unit] ??= []);
  if (!list.some((x) => x.accn === f.accn && x.start === f.start && x.end === f.end && x.val === f.val)) list.push(f);
}

const attrsOf = (tag: string) => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

/**
 * Every ix:nonFraction, nested ones included: filers wrap one figure in two tags (Apple tags
 * "14,608,963" as both CommonStockSharesIssued and CommonStockSharesOutstanding), and a single
 * non-greedy match per element would read only the outer one.
 */
export function inlineNumbers(html: string, units = parseUnits(html)) {
  const out: { concept: string; value: number; unit: string; context: string; decimals: number }[] = [];
  const open = /<ix:nonFraction\b([^>]*)>/gi;
  for (const m of html.matchAll(open)) {
    const a = attrsOf(m[1]);
    if (!a.name || !a.contextRef) continue;
    const from = m.index! + m[0].length;
    const close = html.indexOf("</ix:nonFraction>", from);
    if (close < 0) continue;
    const v = factValue(a, html.slice(from, close));
    if (v == null) continue;
    const decimals = a.decimals === "INF" ? Infinity : Number(a.decimals ?? -Infinity);
    out.push({ concept: a.name, value: v, unit: units.get(a.unitRef ?? "") ?? a.unitRef ?? "", context: a.contextRef, decimals: Number.isNaN(decimals) ? -Infinity : decimals });
  }
  return out;
}

/**
 * Non-dimensional numeric facts of an inline XBRL document, in companyfacts form. A figure shown
 * twice at different precision (Adobe: 395.5 million diluted shares in the statements, "395
 * million" in the discussion) keeps the most precise value, as SEC's companyfacts does.
 */
export function factsFromInline(html: string, filing: FiledReport): CompanyFacts {
  const contexts = parseContexts(html);
  const units = parseUnits(html);
  const best = new Map<string, { concept: string; unit: string; fact: RawFact; decimals: number }>();
  for (const fact of inlineNumbers(html, units)) {
    if (!KEEP_UNITS.has(fact.unit)) continue;
    const ctx = contexts.get(fact.context);
    if (!ctx || ctx.dims.length || ctx.typed) continue;
    const end = ctx.end ?? ctx.instant;
    if (!end) continue;
    const key = `${fact.concept}|${fact.unit}|${ctx.start ?? ""}|${end}`;
    const prev = best.get(key);
    if (prev && prev.decimals >= fact.decimals) continue;
    best.set(key, { concept: fact.concept, unit: fact.unit, decimals: fact.decimals, fact: { ...(ctx.start ? { start: ctx.start } : {}), end, val: fact.value, accn: filing.accn, form: filing.form, filed: filing.filed } });
  }
  const cf: CompanyFacts = { facts: {} };
  for (const b of best.values()) add(cf, b.concept, b.unit, b.fact);
  return cf;
}

/** Every XBRL fact the dataset's statement cells cite, in companyfacts form (forms and dates from its filing list). */
export function factsFromDataset(d: CompanyDataset): CompanyFacts {
  const cf: CompanyFacts = { facts: {} };
  const byAccn = new Map(d.filings.map((f) => [f.accn, f]));
  const take = (unit: string, r: { accn: string; concept: string; start?: string; end: string; value: number }) => {
    const f = byAccn.get(r.accn);
    if (!Number.isFinite(r.value) || (f && !/^10-[KQ]/.test(f.form))) return;
    // A cited fact whose filing is not in the list (a trimmed filing list) still counts: statement
    // cells cite only 10-K/10-Q facts, and a year-long duration can only come from a 10-K. Without
    // it the builder cannot place the year's quarters, and a 10-K read here adds no fourth quarter.
    const yearLong = !!r.start && Math.abs(Date.parse(r.end) - Date.parse(r.start)) > 300 * 86_400_000;
    const form = f?.form ?? (yearLong ? "10-K" : "10-Q");
    add(cf, r.concept, unit, { ...(r.start ? { start: r.start } : {}), end: r.end, val: r.value, accn: r.accn, form, filed: f?.filed ?? r.end });
  };
  for (const freq of ["annual", "quarterly"] as const)
    for (const key of ["income", "balance", "cashflow"] as const)
      for (const row of d.statements[freq][key].rows) {
        const unit = UNIT_KEY[row.unit];
        if (!unit) continue;
        for (const c of row.cells) {
          if (!c) continue;
          if (c.src) take(unit, c.src);
          for (const p of c.derived?.parts ?? []) take(unit, p);
        }
      }
  return cf;
}

export function mergeFacts(...sets: CompanyFacts[]): CompanyFacts {
  const out: CompanyFacts = { facts: {} };
  for (const s of sets)
    for (const [ns, concepts] of Object.entries(s.facts))
      for (const [local, node] of Object.entries(concepts))
        for (const [unit, list] of Object.entries(node.units)) for (const f of list) add(out, `${ns}:${local}`, unit, f);
  return out;
}

const STATEMENTS: Exclude<StatementKey, "kpis">[] = ["income", "balance", "cashflow"];

/** Old statement plus the new periods of `fresh`, rows matched by key (rows new to the company keep their place). */
function splice(old: Statement, fresh: Statement, added: ReadPeriod[]): Statement {
  const idx = added.map((p) => fresh.periods.findIndex((q) => q.key === p.key));
  const rows: Row[] = old.rows.map((r) => {
    const f = fresh.rows.find((x) => x.key === r.key);
    return { ...r, cells: [...r.cells, ...idx.map((i) => (f ? (f.cells[i] ?? null) : null))] };
  });
  fresh.rows.forEach((f, at) => {
    if (rows.some((r) => r.key === f.key) || !idx.some((i) => f.cells[i])) return;
    const prevKey = fresh.rows.slice(0, at).reverse().find((x) => rows.some((r) => r.key === x.key))?.key;
    const pos = prevKey ? rows.findIndex((r) => r.key === prevKey) + 1 : rows.length;
    rows.splice(pos, 0, { ...f, cells: [...old.periods.map(() => null as Cell | null), ...idx.map((i) => f.cells[i] ?? null)] });
  });
  return { periods: [...old.periods, ...added], rows };
}

export interface Extension {
  dataset: CompanyDataset;
  /** Period keys added per filing read */
  added: { accn: string; form: string; filed: string; annual: string[]; quarterly: string[] }[];
}

/**
 * The dataset with the periods each filing reports after the statements' latest period. Filings
 * are applied oldest first (Citigroup's 2026 10-Qs are all missing from SEC companyfacts); a filing
 * whose facts add no period is ignored.
 */
export function extendStatements(d: CompanyDataset, reads: { filing: FiledReport; html: string }[]): Extension {
  const options = statementOptions(d.profile);
  const bank = !!options.bank;
  let cur = d;
  const added: Extension["added"] = [];
  // Facts of every filing read so far stay in the set: a 10-K's fourth quarter is the year minus the
  // nine months its Q3 10-Q reported, so the caller passes that 10-Q too (it adds no period itself).
  let read: CompanyFacts = { facts: {} };
  for (const { filing, html } of [...reads].sort((a, b) => a.filing.filed.localeCompare(b.filing.filed))) {
    const filings = cur.filings.some((f) => f.accn === filing.accn) ? cur.filings : [{ ...filing }, ...cur.filings];
    const base = { ...cur, filings };
    read = mergeFacts(read, factsFromInline(html, filing));
    const fresh = buildStatements(mergeFacts(factsFromDataset(base), read), options);
    const statements = { annual: { ...cur.statements.annual }, quarterly: { ...cur.statements.quarterly } };
    const got = { annual: [] as string[], quarterly: [] as string[] };
    for (const freq of ["annual", "quarterly"] as const) {
      const old = cur.statements[freq];
      const lastEnd = STATEMENTS.map((k) => old[k].periods.at(-1)?.end ?? "").sort().at(-1) ?? "";
      const known = new Set(STATEMENTS.flatMap((k) => old[k].periods.map((p) => p.key)));
      const newPeriods: ReadPeriod[] = fresh[freq].income.periods
        .filter((p) => !known.has(p.key) && p.end > lastEnd)
        // Only periods this filing reports: a column must hold at least one of its facts.
        .filter((p) => STATEMENTS.some((k) => {
          const i = fresh[freq][k].periods.findIndex((q) => q.key === p.key);
          return i >= 0 && fresh[freq][k].rows.some((r) => cites(r.cells[i], filing.accn));
        }))
        .map((p) => ({ ...p, readFrom: { accn: filing.accn, form: filing.form, filed: filing.filed, doc: filing.doc } }));
      if (!newPeriods.length) continue;
      got[freq] = newPeriods.map((p) => p.key);
      const income = splice(old.income, fresh[freq].income, newPeriods);
      const balance = splice(old.balance, fresh[freq].balance, newPeriods);
      const cashflow = splice(old.cashflow, fresh[freq].cashflow, newPeriods);
      const kpis: Statement = { periods: income.periods, rows: buildKpis(income.rows, balance.rows, cashflow.rows, income.periods, freq, { bank }) };
      statements[freq] = { income, balance, cashflow, kpis };
    }
    if (!got.annual.length && !got.quarterly.length) {
      cur = base;
      continue;
    }
    added.push({ accn: filing.accn, form: filing.form, filed: filing.filed, ...got });
    cur = { ...base, statements };
  }
  return { dataset: cur, added };
}

function cites(c: Cell | null | undefined, accn: string) {
  return !!c && (c.src?.accn === accn || !!c.derived?.parts.some((p) => p.accn === accn));
}
