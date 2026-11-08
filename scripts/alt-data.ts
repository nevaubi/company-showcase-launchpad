// Public alt-data ETL (FactSet-marketplace style, free government/open sources only).
// Every row keeps a link back to the exact public record it came from.
//   bun scripts/alt-data.ts [--only=AAPL,JPM] [--sets=ownership,events,...] [--concurrency=4]
// Datasets: ownership (SEC 13D/13G), events (8-K items: deals, debt, exec changes, restatements…),
// contracts (USAspending federal awards), regulatory (Federal Register), fda (drug/device recalls,
// approvals), recalls (NHTSA vehicle recalls), complaints (CFPB), bank (FDIC call reports),
// attention (Wikipedia pageviews). A failed source never deletes stored rows (upsert only).
import { readFile } from "node:fs/promises";
import { args, log, sb, sleep } from "./lib/supa";
import { ADAPTERS, type Co, type Row } from "../src/lib/alt/collect.server";

const universe = JSON.parse(await readFile("public/data/universe.json", "utf8")) as { companies: Co[] };
const only = args.only?.toUpperCase().split(",");
const SETS = (args.sets ?? "ownership,events,contracts,regulatory,fda,recalls,complaints,bank,attention,capital,trials,consumer").split(",");


async function save(rows: Row[]) {
  const seen = new Map(rows.map((r) => [r.uid, r]));
  const list = [...seen.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await sb.from("alt_data").upsert(list.slice(i, i + 500).map((r) => ({ ...r, meta: r.meta ?? {} })), { onConflict: "uid" });
    if (error) throw new Error(error.message);
  }
}

const cos = universe.companies.filter((c) => !only || only.includes(c.ticker));
const conc = Number(args.concurrency ?? 4);
let next = 0;
const totals: Record<string, number> = {};
await Promise.all(Array.from({ length: conc }, async () => {
  while (next < cos.length) {
    const c = cos[next++];
    for (const s of SETS) {
      try {
        const rows = await ADAPTERS[s](c);
        if (rows.length) await save(rows);
        totals[s] = (totals[s] ?? 0) + rows.length;
        log(c.ticker, s, rows.length);
      } catch (e) { log(c.ticker, s, "FAILED", (e as Error).message.slice(0, 160)); }
    }
  }
}));
log("done", totals);
