/**
 * Removes stored alt-data rows that are not the company's own (round 2 audit F1 and its follow-up).
 * Every check is the one the app's read screen applies (src/lib/alt/screen.ts), so after this runs
 * the database functions that count raw rows (alt_event_buckets, alt_source_stats) agree with pages.
 *
 *   contracts  `spending_by_award` ignored `recipient_id`, so the government-wide top awards were
 *              stored under every company; recipients were also picked by name prefix. Kept when
 *              `contractRowBelongs` (contracts.ts) accepts the row.
 *   fda        openFDA's recalling-firm search is a phrase match (independent Coca-Cola bottlers under
 *              KO, "Boston Scientific Target" under TGT). Kept when `firmRowBelongs` (firms.ts) accepts
 *              the stored firm (sponsor for approvals).
 *   trials     lead-sponsor prefix match (Merck KGaA under MRK). Same check on the stored sponsor.
 *   recalls    NHTSA `manufacturer like '%ITT%'` (LITTELFUSE, Pitts Enterprises under ITT). Rows
 *              written before the manufacturer was stored are looked up by campaign number at NHTSA.
 *   consumer   CPSC title word match ("Caterpillar Pull Toys" under CAT). Rows written before the
 *              firms were stored are looked up by recall number at CPSC and judged by `cpscRole`.
 *   bank       FDIC CET1 ratios of 0 (field not reported before 2015).
 *
 *   bun scripts/alt-contracts-repair.ts [--sets=contracts,fda,trials,recalls,consumer,bank] [--tickers=AAPL,ROG] [--apply]
 *
 * Dry run by default: prints what would be deleted per set and ticker. `--apply` deletes those rows by
 * uid. Run the contracts set after the fixed collector has refreshed every company once
 * (scripts/alt-slow.ts covers the list in seven days), so subsidiary rows it re-stores with their tie
 * are kept; the other sets can run any time.
 */
import { COVERAGE } from "@/lib/coverage";
import { ALT_NAMES, companyKeys, contractRowBelongs, type CompanyKeys } from "@/lib/alt/contracts";
import { cpscRole, firmCheck, firmRowBelongs, type CpscRecord } from "@/lib/alt/firms";
import { isBankPlaceholder } from "@/lib/alt/bank";
import { REGISTRY_PATH, type AltRegistry } from "@/lib/alt/registry";
import { args, dbGate, log, sb, sleep } from "./lib/supa";

const SETS = ["contracts", "fda", "trials", "recalls", "consumer", "bank"] as const;
type Set_ = (typeof SETS)[number];
const apply = args.apply !== undefined;
const only = args.tickers ? new Set(args.tickers.toUpperCase().split(",")) : null;
const sets = (args.sets ? args.sets.split(",") : [...SETS]).filter((s): s is Set_ => (SETS as readonly string[]).includes(s));
const UA = "FiledUnder Research research@filedunder.ai";

async function jsonFile<T>(path: string): Promise<T | null> {
  const { data } = await sb.storage.from("datasets").download(path);
  return data ? (JSON.parse(await data.text()) as T) : null;
}

const registry = (await jsonFile<AltRegistry>(REGISTRY_PATH)) ?? {};
const universe = await jsonFile<{ companies: { ticker: string; name: string }[] }>("universe.json");
if (!universe?.companies?.length) throw new Error("datasets/universe.json is missing; company legal names are needed to judge rows");
const legal = new Map(universe.companies.map((c) => [c.ticker, c.name]));
const keys = new Map<string, CompanyKeys>();
const shortName = new Map<string, string>();
for (const c of COVERAGE) {
  keys.set(c.ticker, companyKeys([ALT_NAMES[c.ticker], c.shortName], [registry[c.ticker]?.legal, legal.get(c.ticker)]));
  shortName.set(c.ticker, ALT_NAMES[c.ticker] ?? c.shortName);
}

type Stored = { uid: string; ticker: string; dataset: string; kind: string; title: string | null; value: number | null; meta: Record<string, unknown> | null };

async function readSet(dataset: Set_): Promise<Stored[]> {
  const rows: Stored[] = [];
  for (let from = 0; ; from += 1000) {
    await dbGate("alt-contracts-repair");
    let q = sb.from("alt_data").select("uid, ticker, dataset, kind, title, value, meta").eq("dataset", dataset).order("uid").range(from, from + 999);
    if (only) q = q.in("ticker", [...only]);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Stored[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function getJson(url: string): Promise<unknown> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url.slice(0, 120)}`);
    } catch (e) {
      if (i === 3) throw e;
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`no answer from ${url.slice(0, 120)}`);
}

/** NHTSA manufacturer per campaign number, 100 campaigns a request. */
async function nhtsaMakers(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((x) => `'${x.replace(/'/g, "")}'`).join(",");
    const j = (await getJson(`https://data.transportation.gov/resource/6axg-epim.json?$select=nhtsa_id,manufacturer&$where=${encodeURIComponent(`nhtsa_id in(${list})`)}&$limit=1000`)) as { nhtsa_id: string; manufacturer: string }[];
    for (const r of j) out.set(r.nhtsa_id, r.manufacturer);
    await sleep(300);
  }
  return out;
}

/** CPSC recall record by recall number. */
async function cpscRecord(no: string): Promise<CpscRecord | null> {
  const j = (await getJson(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=${encodeURIComponent(no)}`)) as CpscRecord[];
  await sleep(250);
  return j?.[0] ?? null;
}

const drop: Stored[] = [];
const unknown: Stored[] = [];
for (const set of sets) {
  const rows = await readSet(set);
  let judged = rows;
  const verdict = new Map<string, boolean>();
  if (set === "recalls") {
    const legacy = rows.filter((r) => !r.meta || !("manufacturer" in r.meta));
    const makers = await nhtsaMakers([...new Set(legacy.map((r) => r.uid.split(":")[2]))]);
    for (const r of legacy) {
      const m = makers.get(r.uid.split(":")[2]);
      if (m === undefined) unknown.push(r);
      else verdict.set(r.uid, !!keys.get(r.ticker) && firmCheck(r.ticker, keys.get(r.ticker)!)(m));
    }
  }
  if (set === "consumer") {
    judged = rows.filter((r) => !r.meta || !("firms" in r.meta));
    for (const r of judged) {
      const rec = await cpscRecord(r.uid.split(":")[2]);
      const k = keys.get(r.ticker);
      if (!rec) unknown.push(r);
      else verdict.set(r.uid, !!k && cpscRole(rec, firmCheck(r.ticker, k), shortName.get(r.ticker) ?? r.ticker) !== null);
    }
  }
  const tally = new Map<string, number>();
  let kept = 0;
  for (const r of judged) {
    const k = keys.get(r.ticker);
    const ok =
      verdict.get(r.uid) ??
      (set === "bank" ? !isBankPlaceholder(r) : set === "contracts" ? !!k && contractRowBelongs(r, k) : set === "consumer" ? true : !!k && firmRowBelongs(r, r.ticker, k));
    if (ok) kept++;
    else {
      drop.push(r);
      tally.set(r.ticker, (tally.get(r.ticker) ?? 0) + 1);
    }
  }
  const n = [...tally.values()].reduce((a, b) => a + b, 0);
  log(`${set.padEnd(9)} ${String(rows.length).padStart(6)} rows read, ${String(judged.length).padStart(6)} judged: keep ${kept}, delete ${n} under ${tally.size} tickers`);
  if (tally.size) log(`          most: ${[...tally].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, c]) => `${t} ${c}`).join(", ")}`);
  for (const r of drop.filter((x) => x.dataset === set).slice(0, 6)) log(`          e.g. ${r.uid}  ${String(r.meta?.firm ?? r.meta?.sponsor ?? r.meta?.recipient ?? r.title ?? "").slice(0, 90)}`);
}
if (unknown.length) log(`${unknown.length} rows could not be looked up at the source and are left alone (rerun later): ${unknown.slice(0, 8).map((r) => r.uid).join(", ")}`);

if (!apply) {
  log(`dry run: nothing deleted (add --apply to delete these ${drop.length} rows)`);
  process.exit(0);
}
let deleted = 0;
for (const set of sets) {
  const uids = drop.filter((r) => r.dataset === set).map((r) => r.uid);
  for (let i = 0; i < uids.length; i += 200) {
    await dbGate("alt-contracts-repair");
    const { error } = await sb.from("alt_data").delete().eq("dataset", set).in("uid", uids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    deleted += Math.min(200, uids.length - i);
  }
}
log(`deleted ${deleted} rows`);
