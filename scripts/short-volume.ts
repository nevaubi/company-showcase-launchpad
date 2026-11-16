// Backfill FINRA daily short-sale volume (consolidated NMS file) for every covered ticker into
// `short_volume`. FINRA's public CDN keeps files from mid-2018; missing days (holidays) are skipped.
// The scheduled setups job adds each new day. Usage: bun scripts/short-volume.ts [--from=2018-08-01] [--to=YYYY-MM-DD]
import { sb, args, log, dbGate, sleep } from "./lib/supa";
import { COVERAGE } from "../src/lib/coverage";
import { FINRA_SHORT_URL, parseShortVolume } from "../src/lib/signals/finra";

const from = String(args.from ?? "2018-08-01");
const to = String(args.to ?? new Date().toISOString().slice(0, 10));
const keep = new Set(COVERAGE.map((c) => c.ticker));

const days: string[] = [];
for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
  const w = d.getUTCDay();
  if (w !== 0 && w !== 6) days.push(d.toISOString().slice(0, 10));
}

// Dates already stored (one ticker that trades every day is a good proxy).
const have = new Set<string>();
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from("short_volume").select("date").eq("symbol", "SPY").range(off, off + 999);
  const { data: d2 } = await sb.from("short_volume").select("date").eq("symbol", "AAPL").range(off, off + 999);
  for (const r of [...(data ?? []), ...(d2 ?? [])]) have.add(r.date);
  if ((data?.length ?? 0) < 1000 && (d2?.length ?? 0) < 1000) break;
}
const todo = days.filter((d) => !have.has(d));
log("days", days.length, "already stored", have.size, "to fetch", todo.length);

let done = 0, rows = 0, missing = 0;
async function one(day: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(FINRA_SHORT_URL(day), { headers: { "user-agent": "Mozilla/5.0 (FiledUnder research)" }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 403 || res.status === 404) return void missing++;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseShortVolume(await res.text(), keep);
      for (let k = 0; k < parsed.length; k += 2000) {
        await dbGate("short-volume");
        const { error } = await sb.from("short_volume").upsert(parsed.slice(k, k + 2000));
        if (error) throw new Error(error.message);
      }
      rows += parsed.length;
      return;
    } catch (e) {
      if (attempt === 3) log("failed", day, (e as Error).message);
      await sleep(2000 * (attempt + 1));
    }
  }
}
const queue = [...todo];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let d = queue.shift(); d; d = queue.shift()) {
    await one(d);
    if (++done % 50 === 0) log("days", done, "/", todo.length, "rows", rows, "missing", missing);
  }
}));
log("done: days", done, "rows", rows, "missing", missing);
