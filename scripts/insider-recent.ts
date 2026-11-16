// Recent open-market insider purchases (newer than the SEC's quarterly data sets) from each company
// dataset's parsed Form 4s and the sec job's insider_trades rows, into `insider_buys`.
// Usage: bun scripts/insider-recent.ts [--since=2026-01-01]
import { sb, args, log, dbGate } from "./lib/supa";
import { COVERAGE } from "../src/lib/coverage";
import type { CompanyDataset } from "../src/lib/financials/types";
import { insiderBuyRows } from "../src/lib/signals/events";

const since = String(args.since ?? "2026-01-01");
const sf = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
let rows = 0, done = 0;
const queue = COVERAGE.map((c) => c.ticker);
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let t = queue.shift(); t; t = queue.shift()) {
    try {
      const { data } = await sb.storage.from("datasets").download(`companies/${sf(t)}.json`);
      if (data) {
        const ds = JSON.parse(await data.text()) as CompanyDataset;
        const buys = insiderBuyRows(t, (ds.insiders ?? []).filter((x) => x.filed >= since), "dataset-form4");
        if (buys.length) {
          await dbGate("insider-recent");
          const { error } = await sb.from("insider_buys").upsert(buys, { onConflict: "accn,owner", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
          rows += buys.length;
        }
      }
    } catch (e) {
      log("failed", t, (e as Error).message);
    }
    if (++done % 300 === 0) log("companies", done, "buys", rows);
  }
}));
const { data: jobRows } = await sb.from("insider_trades").select("accn, ticker, filed, owner, role, trade_date, code, shares, price, acquired, plan_10b5").eq("code", "P").gte("filed", since).limit(5000);
const byT = new Map<string, typeof jobRows>();
for (const r of jobRows ?? []) byT.set(r.ticker, [...(byT.get(r.ticker) ?? []), r]);
let fromJob = 0;
for (const [t, list] of byT) {
  const buys = insiderBuyRows(t, list!.map((r) => ({ ...r, date: r.trade_date, plan10b5: r.plan_10b5 })), "sec-form4");
  if (buys.length) await sb.from("insider_buys").upsert(buys, { onConflict: "accn,owner", ignoreDuplicates: true });
  fromJob += buys.length;
}
log("done: dataset buys", rows, "sec job buys", fromJob);
