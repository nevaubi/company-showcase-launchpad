/**
 * Fix period ends a reader guessed as a calendar month-end for a 52/53-week period (COST "12 Weeks
 * Ended November 23, 2025" stored as 2025-11-30): only facts whose document never prints that date
 * and prints exactly one period-end date within ten days of it (src/lib/ir/dates.ts) are moved.
 *   bun scripts/ir-fix-dates.ts [--tickers=COST,KR] [--dry]
 * Companies are checked from their stored series: only those with two quarter columns a few days
 * apart (one on a month-end) are read.
 */
import { fixRowDates, printedDates } from "@/lib/ir/dates";
import { rebuildCompany } from "@/lib/ir/rebuild.server";
import { decodeHtml } from "@/lib/ir/tables";
import { args, dbGate, log, sb } from "./lib/supa";

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const monthEnd = (d: string) => new Date(t(d) + DAY).getUTCDate() === 1;
const dry = args.dry !== undefined;

async function tickers(): Promise<string[]> {
  if (args.tickers) return args.tickers.split(",");
  const { data } = await sb.from("ir_company_series").select("ticker").order("ticker").limit(5000);
  return (data ?? []).map((r) => r.ticker);
}

/** Month-end columns sitting 3–20 days from another column of the same grid. */
function suspects(dates: string[]) {
  return dates.filter((d) => monthEnd(d) && dates.some((o) => o !== d && Math.abs(t(o) - t(d)) >= 3 * DAY && Math.abs(t(o) - t(d)) <= 20 * DAY));
}

let moved = 0;
for (const ticker of await tickers()) {
  const { data: file } = await sb.storage.from("ir-documents").download(`series/${ticker}.json`);
  if (!file) continue;
  const p = JSON.parse(await file.text()) as { quarters: string[]; years: string[] };
  const odd = [...new Set([...suspects(p.quarters ?? []), ...suspects(p.years ?? [])])];
  if (!odd.length) continue;
  await dbGate("ir-fix-dates");
  const { data: facts } = await sb.from("ir_kpi_facts").select("id, document_id, period_start, period_end, months, period_label").eq("ticker", ticker).in("period_end", odd).limit(20_000);
  const byDoc = new Map<string, NonNullable<typeof facts>>();
  for (const f of facts ?? []) if (f.document_id) byDoc.set(f.document_id, [...(byDoc.get(f.document_id) ?? []), f]);
  let n = 0;
  for (const [docId, rows] of byDoc) {
    const { data: doc } = await sb.from("ir_documents").select("path, rendition_path").eq("id", docId).maybeSingle();
    const path = doc?.rendition_path || doc?.path;
    if (!path) continue;
    const { data: body } = await sb.storage.from("ir-documents").download(path);
    if (!body) continue;
    const ends = printedDates(decodeHtml((await body.text()).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "), true);
    const changes = new Map<string, { patch: { period_end: string; period_start: string | null; period_label: string }; ids: string[] }>();
    for (const r of rows) {
      const fixed = fixRowDates({ ...r, period_label: r.period_label ?? "" }, ends);
      if (fixed.period_end === r.period_end) continue;
      const key = `${fixed.period_end}|${fixed.period_start}|${fixed.period_label}`;
      const c = changes.get(key) ?? { patch: { period_end: fixed.period_end, period_start: fixed.period_start, period_label: fixed.period_label }, ids: [] };
      c.ids.push(r.id);
      changes.set(key, c);
    }
    for (const { patch, ids } of changes.values()) {
      n += ids.length;
      if (dry) log(`${ticker} ${docId.slice(0, 8)}: ${ids.length} facts ${rows.find((r) => r.id === ids[0])?.period_end} → ${patch.period_end}`);
      else for (let i = 0; i < ids.length; i += 200) await sb.from("ir_kpi_facts").update(patch).in("id", ids.slice(i, i + 200));
    }
  }
  if (n) {
    moved += n;
    log(`${ticker}: ${n} facts moved to the period end their document prints${dry ? " (dry run)" : ""}`);
    if (!dry) await rebuildCompany(ticker);
  }
}
log(`done — ${moved} facts ${dry ? "would move" : "moved"}`);
process.exit(0);
