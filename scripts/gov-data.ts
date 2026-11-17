// Whole-market government files for every covered company.
//   bun scripts/gov-data.ts --ftd[=24]     SEC fails-to-deliver, the last N months (default 24)
// The scheduled `gov-data` job keeps the latest half-month current after this backfill.
import { COVERAGE } from "@/lib/coverage";
import { ftdRows, ftdUrl, latestLikelyPeriod, parseFtd, periodCode, prevPeriod, unzipText } from "@/lib/alt/ftd";
import { args, dbGate, log, sb, sleep } from "./lib/supa";

const UA = "FiledUnder Research research@filedunder.ai";
const covered = new Set(COVERAGE.map((c) => c.ticker));

async function upsert(rows: { uid: string; meta?: Record<string, unknown> }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await dbGate();
    const { error } = await sb.from("alt_data").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, meta: r.meta ?? {} })) as never, { onConflict: "uid" });
    if (error) throw new Error(error.message);
  }
}

if (args.ftd !== undefined) {
  const months = Number(args.ftd) || 24;
  const latest = latestLikelyPeriod(new Date());
  const periods: string[] = [];
  for (let p = latest; periods.length < months * 2; p = prevPeriod(p)) periods.push(p);
  let newest: string | null = null, total = 0;
  for (const p of periods) {
    const r = await fetch(ftdUrl(p), { headers: { "User-Agent": UA } }).catch(() => null);
    if (!r?.ok) {
      log(p, "not available", r?.status ?? "network");
      continue;
    }
    const rows = ftdRows(parseFtd(await unzipText(new Uint8Array(await r.arrayBuffer())), p, covered));
    await upsert(rows);
    total += rows.length;
    if (!newest) newest = p;
    log(p, rows.length, "stocks");
    await sleep(400);
  }
  if (newest) await sb.from("job_state").upsert({ job: "gov-ftd", cursor: periodCode(newest), updated_at: new Date().toISOString() });
  log("fails-to-deliver done", total, "rows; newest", newest);
}
