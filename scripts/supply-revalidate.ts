// Reports what read-time verification (src/lib/supply/claims.ts, `trustLink`) does to stored supply links: which stated
// amounts are kept as the counterparty's figure (and which of those are flows), which single-source flags carry sole-source
// wording (the rest are shown as stated dependencies), which regions the sentence names, and each link's nature.
// It only reads. Stored rows keep what the model returned, because the app verifies every row when it loads it
// (src/lib/supply/read.ts) and a cleared amount or flag could not be restored while the extraction lanes cannot re-read
// filings. There is no write mode.
//   bun scripts/supply-revalidate.ts [--current] [--ticker=NVDA] [--samples=5]
import { auditClaims, type AuditRow } from "@/lib/supply/claims";
import { args, dbGate, log, sb } from "./lib/supa";

const PAGE = 1000;

interface Row extends AuditRow {
  ticker: string;
  counterparty: string;
}

async function readRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    await dbGate("supply-revalidate");
    // raw stored rows on purpose: this script measures the read-time checks, so it must see what they start from
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

const list = (m: Record<string, number>) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ") || "none";

async function main() {
  if (args.apply !== undefined) {
    console.error("supply-revalidate only reports: stored rows keep what the model returned and are verified when read.");
    process.exit(2);
  }
  const rows = await readRows();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [label, set] of [["all", rows], ["current", rows.filter((r) => r.is_current)]] as const) {
    const a = auditClaims(set, Number(args.samples ?? 5));
    log(`${label}: ${a.rows} links`);
    log(`  amounts: ${a.amounts.kept} of ${a.amounts.stored} kept as the counterparty's stated figure · ${a.amounts.flows} flows · kept by kind: ${list(a.amounts.byKind)}`);
    log(`  amounts not shown: ${list(a.amounts.dropped)}`);
    log(`  single_source: ${a.soleSource.kept} of ${a.soleSource.flagged} with sole-source wording · ${a.soleSource.dependency} shown as stated dependencies`);
    log(`  regions: ${a.regions.pruned} of ${a.regions.links} links pruned · ${a.regions.entriesKept} of ${a.regions.entriesStored} entries named in the sentence`);
    log(`  nature: ${list(a.nature)}`);
    if (label === "current")
      for (const s of a.samples) {
        const r = byId.get(s.id)!;
        log(`  ${r.ticker} ${r.relation} ${r.counterparty}: ${s.change}: "${(r.quote ?? "").slice(0, 120)}"`);
      }
  }
  log("report only: nothing written");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
