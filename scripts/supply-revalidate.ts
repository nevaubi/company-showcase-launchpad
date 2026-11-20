// Re-checks stored supply links against their own quoted sentence (src/lib/supply/claims.ts) and clears the claims the
// sentence does not state: amount_usd when the quote does not state that dollar figure, single_source when the quote
// has no sole/single/only/exclusive source wording, regions the quote does not name. It never writes a new value.
// Dry run by default (prints what would change); --apply writes.
//   bun scripts/supply-revalidate.ts [--apply] [--current] [--ticker=NVDA] [--samples=20]
import { planRepairs, trustLink, type RepairRow } from "@/lib/supply/claims";
import { args, dbGate, log, sb } from "./lib/supa";

const PAGE = 1000;
const WRITE_BATCH = 200;

interface Row extends RepairRow {
  ticker: string;
  counterparty: string;
  is_current: boolean;
}

async function readRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    await dbGate("supply-revalidate");
    let q = sb
      .from("supply_links")
      .select("id, ticker, counterparty, relation, detail, quote, amount_usd, single_source, regions, is_current")
      .order("id")
      .range(from, from + PAGE - 1);
    if (args.current !== undefined) q = q.eq("is_current", true);
    if (args.ticker) q = q.eq("ticker", args.ticker.toUpperCase());
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const rows = await readRows();
  const plan = planRepairs(rows);
  const current = rows.filter((r) => r.is_current);
  const currentPlan = planRepairs(current);
  log(`${plan.rows} links read (${current.length} current) · ${plan.changed} would change`);
  log(`  amount_usd cleared: ${plan.amountsCleared} of ${rows.filter((r) => r.amount_usd != null).length} (current: ${currentPlan.amountsCleared})`);
  log(`  single_source cleared: ${plan.soleSourceCleared} of ${rows.filter((r) => r.single_source).length} (current: ${currentPlan.soleSourceCleared})`);
  log(`  regions pruned: ${plan.regionsPruned} of ${rows.filter((r) => (r.regions ?? []).length).length} (current: ${currentPlan.regionsPruned})`);
  // what the display would draw from the kept amounts
  const kinds = new Map<string, number>();
  let flows = 0;
  for (const r of current) {
    const t = trustLink(r);
    if (t.amount_kind) kinds.set(t.amount_kind, (kinds.get(t.amount_kind) ?? 0) + 1);
    if (t.flow_usd != null) flows++;
  }
  log(`  current kept amounts by kind: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none"} · flows ${flows}`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const samples = Number(args.samples ?? 20);
  let shown = 0;
  for (const u of plan.updates) {
    for (const id of u.ids) {
      if (shown++ >= samples) break;
      const r = byId.get(id)!;
      log(`  ${r.ticker} ${r.relation} ${r.counterparty}: ${JSON.stringify(u.set)} (was amount ${r.amount_usd ?? "-"}, single ${r.single_source}, regions ${(r.regions ?? []).join(";") || "-"}): "${r.quote.slice(0, 120)}"`);
    }
    if (shown >= samples) break;
  }
  if (args.apply === undefined) {
    log("dry run: nothing written (pass --apply to write)");
    return;
  }
  let written = 0;
  for (const u of plan.updates) {
    for (let i = 0; i < u.ids.length; i += WRITE_BATCH) {
      await dbGate("supply-revalidate");
      const ids = u.ids.slice(i, i + WRITE_BATCH);
      const { error } = await sb.from("supply_links").update(u.set as never).in("id", ids);
      if (error) throw new Error(`update failed after ${written} rows: ${error.message}`);
      written += ids.length;
    }
  }
  log(`done: ${written} rows updated`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
