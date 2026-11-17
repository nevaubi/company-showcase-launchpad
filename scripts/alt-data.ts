// Public alt-data ETL (FactSet-marketplace style, free government/open sources only) for every
// covered company. Every row keeps a link back to the exact public record it came from.
//   bun scripts/alt-data.ts [--only=AAPL,JPM] [--sets=ownership,events,...] [--concurrency=4] [--skip-done]
// Datasets: ownership (SEC 13D/13G), events (8-K items), contracts (USAspending), regulatory
// (Federal Register), fda (recalls, approvals), recalls (NHTSA), complaints (CFPB), bank (FDIC call
// reports), attention (Wikipedia pageviews), capital (SEC capital-markets filings), trials
// (ClinicalTrials.gov), consumer (CPSC). Registry names come from `scripts/alt-registry.ts`.
// A failed source never deletes stored rows (upsert only). --skip-done skips (company, set) pairs
// that already have rows, so a long backfill can resume.
import { COVERAGE } from "@/lib/coverage";
import { appliesTo, REGISTRY_PATH, type AltRegistry } from "@/lib/alt/registry";
import { ADAPTERS, type Co, type Row } from "../src/lib/alt/collect.server";
import { args, dbGate, log, sb } from "./lib/supa";

const only = args.only?.toUpperCase().split(",");
const SETS = (args.sets ?? "ownership,events,contracts,regulatory,fda,recalls,complaints,bank,attention,capital,trials,consumer").split(",");
const { data: regFile } = await sb.storage.from("datasets").download(REGISTRY_PATH);
const reg = (regFile ? JSON.parse(await regFile.text()) : {}) as AltRegistry;

async function save(rows: Row[]) {
  const list = [...new Map(rows.map((r) => [r.uid, r])).values()];
  for (let i = 0; i < list.length; i += 500) {
    await dbGate();
    const { error } = await sb.from("alt_data").upsert(list.slice(i, i + 500).map((r) => ({ ...r, meta: r.meta ?? {} })), { onConflict: "uid" });
    if (error) throw new Error(error.message);
  }
}

// Pairs that already have rows (for --skip-done).
const done = new Set<string>();
if (args["skip-done"] !== undefined) {
  for (const set of SETS) {
    for (let from = 0; ; from += 1000) {
      await dbGate();
      const { data, error } = await sb.from("alt_data").select("ticker").eq("dataset", set).order("uid").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) done.add(`${r.ticker}|${set}`);
      if (!data || data.length < 1000) break;
    }
  }
  log(`skip-done: ${done.size} pairs already stored`);
}

const cos: Co[] = COVERAGE.filter((c) => !only || only.includes(c.ticker)).map((c) => ({ ticker: c.ticker, name: c.shortName, cik: c.cik, sector: c.sector, industry: c.industry, reg: reg[c.ticker] }));
const conc = Number(args.concurrency ?? 4);
let next = 0;
const totals: Record<string, number> = {};
await Promise.all(
  Array.from({ length: conc }, async () => {
    while (next < cos.length) {
      const c = cos[next++];
      for (const s of SETS) {
        if (!appliesTo(s, c, c.reg) || done.has(`${c.ticker}|${s}`)) continue;
        try {
          const rows = await ADAPTERS[s](c);
          if (rows.length) await save(rows);
          totals[s] = (totals[s] ?? 0) + rows.length;
          if (rows.length) log(c.ticker, s, rows.length);
        } catch (e) {
          log(c.ticker, s, "FAILED", (e as Error).message.slice(0, 160));
        }
      }
      if (next % 50 === 0) log(`… ${next}/${cos.length} companies`);
    }
  }),
);
log("done", totals);
