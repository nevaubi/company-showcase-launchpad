/**
 * Removes stored alt-data rows that are not the company's own (round 2 audit F1 and its follow-ups),
 * in two parts with separate switches so nothing a refresh cannot restore is deleted. The rules are
 * pure in src/lib/alt/repair.ts and use the same checks as the app's read screen (screen.ts).
 *
 *   --part=copies     Rows wrong under every company; can run at once:
 *                     contract award rows the old collector copied from the government-wide list
 *                     onto every company (`usa:` awards without a tie stored under 25+ companies),
 *                     except a copy whose recipient is that company by name or hand-checked alias;
 *                     FDA firms, trial sponsors, NHTSA campaigns and CPSC recalls hand-checked as
 *                     another business (KNOWN_OTHER); FDIC CET1 zero placeholders.
 *   --part=refreshed  Other contract rows the screen hides, per company, only when the fixed
 *                     collector has refreshed that company (a `contracts_refresh` record of the current
 *                     rule written at or after --since, default the rule's date), and only rows that
 *                     refresh did not reproduce: legacy rows (no `as_of`) whose recipient is neither the
 *                     company by name or alias nor a recipient the source lists in the company's family.
 *                     Companies without such a record are listed and left alone.
 *
 *   bun scripts/alt-contracts-repair.ts --part=copies|refreshed [--since=2026-11-21] [--tickers=AMZN,ROG] [--apply]
 *
 * Dry run by default: prints what each part would delete per dataset and ticker. `--apply` deletes
 * those rows by uid. Firm rows the rule refuses that are not hand-checked as another business are
 * hidden by the screen and never deleted here.
 */
import { COVERAGE } from "@/lib/coverage";
import { ALT_NAMES, REFRESH_DATASET, sharedCores, tickerKeys, type CompanyKeys } from "@/lib/alt/contracts";
import { planRepair, type RepairRow } from "@/lib/alt/repair";
import { REGISTRY_PATH, type AltRegistry } from "@/lib/alt/registry";
import { args, dbGate, log, sb } from "./lib/supa";

/** The fixed contracts collector (rule 2) was written on this day; no refresh record can be older. */
const RULE_DATE = "2026-11-20";
const part = args.part;
if (part !== "copies" && part !== "refreshed") throw new Error("--part=copies or --part=refreshed is required");
const since = args.since ?? RULE_DATE;
if (!/^\d{4}-\d{2}-\d{2}/.test(since) || since < RULE_DATE) throw new Error(`--since must be a date on or after ${RULE_DATE}`);
const apply = args.apply !== undefined;
const only = args.tickers ? new Set(args.tickers.toUpperCase().split(",")) : null;
const SETS = part === "copies" ? ["contracts", "fda", "trials", "recalls", "consumer", "bank"] : ["contracts"];

async function jsonFile<T>(path: string): Promise<T | null> {
  const { data } = await sb.storage.from("datasets").download(path);
  return data ? (JSON.parse(await data.text()) as T) : null;
}

const registry = (await jsonFile<AltRegistry>(REGISTRY_PATH)) ?? {};
const universe = await jsonFile<{ companies: { ticker: string; name: string }[] }>("universe.json");
if (!universe?.companies?.length) throw new Error("datasets/universe.json is missing; company legal names are needed to judge rows");
const legal = new Map(universe.companies.map((c) => [c.ticker, c.name]));
const shared = sharedCores(COVERAGE.map((c) => ({ cik: c.cik, names: [ALT_NAMES[c.ticker], c.shortName, registry[c.ticker]?.legal, legal.get(c.ticker)] })));
const keys = new Map<string, CompanyKeys>();
for (const c of COVERAGE) keys.set(c.ticker, tickerKeys(c.ticker, c.shortName, [registry[c.ticker]?.legal, legal.get(c.ticker)], shared));

async function readSet(dataset: string, cols = "uid, ticker, dataset, kind, title, value, meta"): Promise<RepairRow[]> {
  const rows: RepairRow[] = [];
  for (let from = 0; ; from += 1000) {
    await dbGate("alt-contracts-repair");
    // every contracts row is read: copy counts are across companies
    let q = sb.from("alt_data").select(cols).eq("dataset", dataset).order("uid").range(from, from + 999);
    if (only && dataset !== "contracts") q = q.in("ticker", [...only]);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as RepairRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const rows: RepairRow[] = [];
for (const s of SETS) rows.push(...(await readSet(s)));
const records = await readSet(REFRESH_DATASET);
const plan = planRepair(rows, records, (t) => keys.get(t) ?? null, since);
const drop = (part === "copies" ? plan.copies : plan.refreshed).filter((r) => !only || only.has(r.ticker));

for (const s of SETS) {
  const d = drop.filter((r) => r.dataset === s);
  const tally = new Map<string, number>();
  for (const r of d) tally.set(r.ticker, (tally.get(r.ticker) ?? 0) + 1);
  log(`${s.padEnd(9)} ${String(rows.filter((r) => r.dataset === s).length).padStart(6)} rows read: delete ${d.length} under ${tally.size} tickers`);
  if (tally.size) log(`          most: ${[...tally].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, c]) => `${t} ${c}`).join(", ")}`);
  for (const r of d.slice(0, 5)) log(`          e.g. ${r.uid}  ${String(r.meta?.firm ?? r.meta?.sponsor ?? r.meta?.recipient ?? r.title ?? "").slice(0, 90)}`);
}
const waiting = [...plan.waiting].filter(([t]) => !only || only.has(t));
if (part === "refreshed") log(`refreshed companies (record at or after ${since}): ${new Set(records.map((r) => r.ticker)).size}; waiting for a refresh, left alone: ${waiting.length} companies, ${waiting.reduce((a, [, n]) => a + n, 0)} rows${waiting.length ? ` (${waiting.slice(0, 15).map(([t, n]) => `${t} ${n}`).join(", ")}${waiting.length > 15 ? ", ..." : ""})` : ""}`);

if (!apply) {
  log(`dry run (${part}): nothing deleted (add --apply to delete these ${drop.length} rows)`);
  process.exit(0);
}
let deleted = 0;
for (const s of SETS) {
  const uids = drop.filter((r) => r.dataset === s).map((r) => r.uid);
  for (let i = 0; i < uids.length; i += 200) {
    await dbGate("alt-contracts-repair");
    const { error } = await sb.from("alt_data").delete().eq("dataset", s).in("uid", uids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    deleted += Math.min(200, uids.length - i);
  }
}
log(`deleted ${deleted} rows (${part})`);
