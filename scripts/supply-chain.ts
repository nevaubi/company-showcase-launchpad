// Reads each covered company's latest 10-K and extracts named customers, suppliers, partners and
// competitors. Every link must carry a verbatim quote that is re-checked against the filing text;
// links whose quote is not found are dropped. Usage:
//   IR_AI_PROVIDER=openai bun scripts/supply-chain.ts [--only=AAPL,NVDA] [--concurrency=6] [--years=3] [--dry]
// Reads the latest 10-K + newer 10-Q (current links) and prior 10-Ks (history, is_current=false).
// The extraction itself lives in src/lib/supply/extract.server.ts (shared with the partner job route).
import { readFile } from "node:fs/promises";
import { args, log, sb } from "./lib/supa";
import { readDataset } from "./lib/datasets";
import { extractSupply, type SupplyCo, type SupplyFiling } from "../src/lib/supply/extract.server";

const universe = JSON.parse(await readFile("public/data/universe.json", "utf8")) as {
  companies: SupplyCo[];
};
const covered = universe.companies;
const only = args.only?.toUpperCase().split(",");

async function filingsOf(t: string): Promise<SupplyFiling[]> {
  const d = await readDataset<{ filings: SupplyFiling[] }>("companies", t);
  return d.filings;
}

const queue = covered.filter((c) => !only || only.includes(c.ticker));
const conc = Number(args.concurrency ?? 6);
await Promise.all(
  Array.from({ length: conc }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const r = await extractSupply(sb, c, await filingsOf(c.ticker), covered, {
          years: Number(args.years ?? 3),
          dry: !!args.dry,
          log,
        });
        log(c.ticker, r.status, r.links, r.error ?? "");
      } catch (e) {
        log(c.ticker, "failed", (e as Error).message.slice(0, 200));
      }
    }
  }),
);
log("done");
