// The coverage ledger's daily run: what the app holds, per company and corpus.
//
//   bun scripts/coverage.ts                       measure, judge, store, print the counts
//   bun scripts/coverage.ts --dry                 measure and judge, store nothing
//   bun scripts/coverage.ts --corpus=calls,promises   only these corpora (and those they read from)
//   bun scripts/coverage.ts --ticker=AAPL         print one company's rows (stores nothing)
//
// Measuring is one database call per corpus (`corpus_measure`, migration 0087: counts and newest
// dates from the tables and file lists that already exist) and one partner file (the screener, for
// the headline values of the statements). Judging is pure (src/lib/coverage/corpora.ts). Storing is
// one call per corpus (`corpus_coverage_put`: every covered company's row, and today's count per
// state). No model, no outside call besides the screener file. A corpus that cannot be measured
// keeps yesterday's rows and the run ends with exit 1, so the lane shows a failed run.
import { parseArgs } from "node:util";
import { COVERAGE } from "../src/lib/coverage";
import { CORPORA, COVERAGE_STATES, NO_MEASURE, corpusOf, emptyHeadlines, judge, tally, type CoverageRow, type Ctx, type Measure } from "../src/lib/coverage/corpora";
import { readPartnerFile } from "./lib/datasets";
import { heldLanes } from "./lib/lanes";
import { dbGate, sb } from "./lib/supa";

const { values: args } = parseArgs({ options: { dry: { type: "boolean" }, corpus: { type: "string" }, ticker: { type: "string" } } });
const JOB = "coverage";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

type Measured = Map<string, Measure>;
type Raw = { t: string; n: number; d: string | null; x: Record<string, unknown> | null };

/** One corpus as the database measures it, by ticker. */
async function measure(corpus: string): Promise<Measured> {
  await dbGate(JOB);
  const r = await sb.rpc("corpus_measure" as never, { _corpus: corpus } as never);
  if (r.error) throw new Error(`corpus_measure(${corpus}): ${r.error.message}`);
  const out: Measured = new Map();
  for (const row of (r.data ?? []) as unknown as Raw[]) if (row?.t) out.set(row.t, { n: Number(row.n) || 0, d: row.d ?? null, x: row.x ?? {} });
  return out;
}

interface Screener {
  cols: string[];
  rows: unknown[][];
  generated?: string;
}

async function main() {
  const wanted = (args.corpus ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of wanted) if (!corpusOf(id)) throw new Error(`unknown corpus ${id}; known: ${CORPORA.map((c) => c.id).join(", ")}`);
  const defs = wanted.length ? CORPORA.filter((c) => wanted.includes(c.id)) : CORPORA;
  const needed = new Set([...defs.map((d) => d.id), ...defs.flatMap((d) => (d.from ? [d.from.corpus] : []))]);

  // What every rule is told: today, where the SEC index starts, and the lanes the owner has stopped.
  await dbGate(JOB);
  const first = await sb.from("sec_filings").select("filed").order("filed", { ascending: true }).limit(1).maybeSingle();
  if (first.error) throw new Error(`sec_filings: ${first.error.message}`);
  const ctx: Ctx = { today: new Date().toISOString().slice(0, 10), filingsFrom: (first.data as { filed?: string } | null)?.filed ?? null, held: await heldLanes() };

  const measured = new Map<string, Measured>();
  const failed = new Map<string, string>();
  for (const id of needed) {
    try {
      measured.set(id, await measure(id));
    } catch (e) {
      failed.set(id, (e as Error).message);
      log(`${id}: not measured:`, (e as Error).message);
    }
  }

  // Statements: the screener file says which headline values are empty.
  if (needed.has("statements") && measured.has("statements")) {
    try {
      const s = await readPartnerFile<Screener>("screener.json");
      const ix = s.cols.indexOf("ticker");
      if (ix < 0 || s.rows.length < 1000) throw new Error(`screener file looks incomplete (${s.rows.length} rows)`);
      const files = measured.get("statements")!;
      const byTicker = new Map(COVERAGE.map((c) => [c.ticker, c]));
      for (const raw of s.rows) {
        const t = String(raw[ix]);
        const co = byTicker.get(t);
        if (!co) continue;
        const row = Object.fromEntries(s.cols.map((c, i) => [c, raw[i]]));
        const m = files.get(t) ?? { ...NO_MEASURE, x: {} };
        files.set(t, { ...m, x: { ...m.x, row: true, lq_end: row["lq_end"] ?? null, empty: emptyHeadlines(row, co) } });
      }
    } catch (e) {
      measured.delete("statements");
      failed.set("statements", (e as Error).message);
      log("statements: not measured:", (e as Error).message);
    }
  }

  // Facts one corpus's rule reads from another (`from` in the rules).
  for (const def of defs) {
    if (!def.from) continue;
    const mine = measured.get(def.id);
    const other = measured.get(def.from.corpus);
    if (!mine) continue;
    if (!other) {
      measured.delete(def.id);
      failed.set(def.id, `${def.from.corpus} was not measured`);
      continue;
    }
    for (const c of COVERAGE) {
      const m = mine.get(c.ticker) ?? { ...NO_MEASURE, x: {} };
      mine.set(c.ticker, { ...m, x: { ...m.x, ...def.from.take(other.get(c.ticker)) } });
    }
  }

  if (args.ticker) {
    const co = COVERAGE.find((c) => c.ticker === args.ticker!.toUpperCase());
    if (!co) throw new Error(`${args.ticker} is not a covered company`);
    for (const def of defs) {
      const m = measured.get(def.id);
      if (!m) { console.log(def.id.padEnd(15), "not measured:", failed.get(def.id)); continue; }
      const row = judge(def, m.get(co.ticker), co, ctx);
      console.log(def.id.padEnd(15), row.state.padEnd(15), String(row.items).padStart(8), (row.newest ?? "").padEnd(11), row.why);
    }
    return;
  }

  let stored = 0;
  for (const def of defs) {
    const m = measured.get(def.id);
    if (!m) continue;
    const rows: CoverageRow[] = COVERAGE.map((co) => judge(def, m.get(co.ticker), co, ctx));
    const t = tally(rows.map((r) => r.state));
    const line = COVERAGE_STATES.filter((s) => t[s]).map((s) => `${s} ${t[s]}`).join(", ");
    if (!args.dry) {
      await dbGate(JOB);
      const put = await sb.rpc("corpus_coverage_put" as never, { _corpus: def.id, _rows: rows.map((r) => ({ ticker: r.ticker, state: r.state, items: r.items, newest: r.newest, why: r.why })) } as never);
      if (put.error) {
        failed.set(def.id, put.error.message);
        log(`${def.id}: not stored:`, put.error.message);
        continue;
      }
      stored++;
    }
    log(`${def.id.padEnd(15)} ${line}`);
  }
  log(args.dry ? "dry run: nothing stored" : `stored ${stored} of ${defs.length} corpora for ${COVERAGE.length} companies`);
  if (failed.size) {
    log(`not measured or stored: ${[...failed].map(([k, why]) => `${k} (${why.slice(0, 120)})`).join("; ")}`);
    process.exitCode = 1;
  }
}

await main();
process.exit(process.exitCode ?? 0);
