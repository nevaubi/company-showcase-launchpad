// Backfill earnings announcement dates (8-K item 2.02 filings) for every covered company into
// `earnings_events`, from each company dataset's filing index. The scheduled `sec` job adds new
// announcements as they're filed. Usage: bun scripts/earnings-events.ts [--tickers=A,B]
import { sb, args, log, dbGate } from "./lib/supa";
import { COVERAGE } from "../src/lib/coverage";
import type { CompanyDataset } from "../src/lib/financials/types";

const list = args.tickers ? String(args.tickers).split(",") : COVERAGE.map((c) => c.ticker);
const sf = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
let done = 0, rows = 0, missing = 0;
const queue = [...list];
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let t = queue.shift(); t; t = queue.shift()) {
    try {
      const { data } = await sb.storage.from("datasets").download(`companies/${sf(t)}.json`);
      if (!data) { missing++; continue; }
      const ds = JSON.parse(await data.text()) as CompanyDataset;
      const ev = (ds.filings ?? [])
        .filter((f) => /^8-K/.test(f.form) && /(^|,)\s*2\.02/.test(f.items ?? ""))
        .map((f) => ({ ticker: t, accn: f.accn, filed: f.filed, source: "sec-8k-2.02" }));
      if (ev.length) {
        await dbGate("earnings-events");
        const { error } = await sb.from("earnings_events").upsert(ev);
        if (error) throw new Error(error.message);
      }
      rows += ev.length;
    } catch (e) {
      log("failed", t, (e as Error).message);
    }
    if (++done % 200 === 0) log("companies", done, "/", list.length, "events", rows);
  }
}));
// New filings the sec job already stored.
const { data: recent } = await sb.from("sec_filings").select("accn, ticker, filed, form, items").like("items", "%2.02%").limit(10000);
const extra = (recent ?? []).filter((f) => /^8-K/.test(f.form)).map((f) => ({ ticker: f.ticker, accn: f.accn, filed: f.filed, source: "sec-8k-2.02" }));
if (extra.length) await sb.from("earnings_events").upsert(extra);
log("done: companies", done, "events", rows, "from sec job", extra.length, "missing datasets", missing);
