/**
 * Removes stored federal-contract rows that are not the company's own (round 2 audit F1).
 * `spending_by_award` ignores the `recipient_id` filter, so the collector stored the government-wide
 * top awards (UT-Battelle, Lockheed, Triad...) under every company with contracts; recipients were
 * also picked by name prefix ("ROGERS, WICKER, RYKMAN AND SPEDALE LLC" under Rogers Corporation).
 * A row is kept when `contractRowBelongs` (src/lib/alt/contracts.ts) accepts it: the event's
 * recipient is the company by whole name, or the collector recorded the source's child tie; a yearly
 * total is kept only when every recipient summed into it is the company.
 *
 *   bun scripts/alt-contracts-repair.ts [--tickers=AAPL,ROG] [--apply]
 *
 * Dry run by default: prints what would be deleted. `--apply` deletes those rows by uid.
 * Run it after the fixed collector has refreshed every company once (scripts/alt-slow.ts covers the
 * list in seven days), so subsidiary rows it re-stores with their tie are kept, not deleted.
 */
import { COVERAGE } from "@/lib/coverage";
import { ALT_NAMES, companyKeys, contractRowBelongs, type CompanyKeys } from "@/lib/alt/contracts";
import { REGISTRY_PATH, type AltRegistry } from "@/lib/alt/registry";
import { args, dbGate, log, sb } from "./lib/supa";

const apply = args.apply !== undefined;
const only = args.tickers ? new Set(args.tickers.toUpperCase().split(",")) : null;

async function jsonFile<T>(path: string): Promise<T | null> {
  const { data } = await sb.storage.from("datasets").download(path);
  return data ? (JSON.parse(await data.text()) as T) : null;
}

const registry = (await jsonFile<AltRegistry>(REGISTRY_PATH)) ?? {};
const universe = await jsonFile<{ companies: { ticker: string; name: string }[] }>("universe.json");
if (!universe?.companies?.length) throw new Error("datasets/universe.json is missing; company legal names are needed to judge rows");
const legal = new Map(universe.companies.map((c) => [c.ticker, c.name]));
const keys = new Map<string, CompanyKeys>();
for (const c of COVERAGE) keys.set(c.ticker, companyKeys([ALT_NAMES[c.ticker], c.shortName], [registry[c.ticker]?.legal, legal.get(c.ticker)]));

type Stored = { uid: string; ticker: string; kind: string; meta: Record<string, unknown> | null };
const rows: Stored[] = [];
for (let from = 0; ; from += 1000) {
  await dbGate("alt-contracts-repair");
  let q = sb.from("alt_data").select("uid, ticker, kind, meta").eq("dataset", "contracts").order("uid").range(from, from + 999);
  if (only) q = q.in("ticker", [...only]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  rows.push(...((data ?? []) as Stored[]));
  if (!data || data.length < 1000) break;
}

const drop: Stored[] = [];
const tally = new Map<string, { keep: number; drop: number }>();
for (const r of rows) {
  const k = keys.get(r.ticker);
  const ok = !!k && contractRowBelongs({ dataset: "contracts", kind: r.kind, meta: r.meta }, k);
  const key = `${r.kind} ${r.uid.split(":")[0]}`;
  const t = tally.get(key) ?? { keep: 0, drop: 0 };
  if (ok) t.keep++;
  else {
    t.drop++;
    drop.push(r);
  }
  tally.set(key, t);
}

log(`${rows.length} contract rows read${only ? ` for ${only.size} tickers` : ""}`);
for (const [key, t] of [...tally].sort()) log(`  ${key.padEnd(12)} keep ${String(t.keep).padStart(6)}  delete ${String(t.drop).padStart(6)}`);
const byTicker = new Map<string, number>();
for (const r of drop) byTicker.set(r.ticker, (byTicker.get(r.ticker) ?? 0) + 1);
log(`  rows to delete under ${byTicker.size} tickers; most: ${[...byTicker].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", ")}`);
for (const r of drop.slice(0, 10)) log(`  e.g. ${r.uid}  ${String(r.meta?.recipient ?? (r.meta?.recipients as string[] | undefined)?.join("; ") ?? "")}`);

if (!apply) {
  log("dry run: nothing deleted (add --apply to delete these rows)");
  process.exit(0);
}
let deleted = 0;
for (let i = 0; i < drop.length; i += 200) {
  await dbGate("alt-contracts-repair");
  const uids = drop.slice(i, i + 200).map((r) => r.uid);
  const { error } = await sb.from("alt_data").delete().eq("dataset", "contracts").in("uid", uids);
  if (error) throw new Error(error.message);
  deleted += uids.length;
}
log(`deleted ${deleted} rows`);
