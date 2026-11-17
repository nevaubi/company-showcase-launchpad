// Whole-market government files for every covered company.
//   bun scripts/gov-data.ts --ftd[=24]     SEC fails-to-deliver, the last N months (default 24)
//   bun scripts/gov-data.ts --medicare     CMS Medicare Part D + Part B drug spending (annual + latest quarters)
// The scheduled `gov-data` job keeps the latest fails-to-deliver half-month current after the
// backfill; CMS publishes the drug files yearly with quarterly updates, so rerun --medicare then.
import { COVERAGE } from "@/lib/coverage";
import { ftdRows, ftdUrl, latestLikelyPeriod, parseFtd, periodCode, prevPeriod, unzipText } from "@/lib/alt/ftd";
import { CMS, displayBrand, drugYears, makerTicker, medicareRows, type CmsRecord, type Part } from "@/lib/alt/medicare";
import { REGISTRY_PATH, type AltRegistryEntry } from "@/lib/alt/registry";
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

async function cmsAll(id: string): Promise<CmsRecord[]> {
  const out: CmsRecord[] = [];
  for (let off = 0; ; off += 5000) {
    let page: CmsRecord[] | null = null;
    for (let t = 0; t < 4 && !page; t++) {
      const r = await fetch(`https://data.cms.gov/data-api/v1/dataset/${id}/data?size=5000&offset=${off}`).catch(() => null);
      if (r?.ok) page = (await r.json()) as CmsRecord[];
      else await sleep(2000 * (t + 1));
    }
    if (!page) throw new Error(`CMS ${id} offset ${off} failed`);
    out.push(...page);
    if (page.length < 5000) return out;
  }
}

/**
 * Part B files name no manufacturer: find each drug's FDA labelers and keep it only when they all
 * belong to one covered company. Keyed by the merged display name (CMS spells a drug differently
 * across files: "Keytruda" vs "KEYTRUDA"); generics (brand = generic name) are skipped.
 */
async function partBOwners(drugs: Map<string, string>, resolve: (m: string) => string | null) {
  const path = "alt/drug-owners.json";
  const { data } = await sb.storage.from("datasets").download(path);
  const old = (data ? JSON.parse(await data.text()) : {}) as Record<string, { ticker: string; maker: string } | null>;
  const cache: typeof old = {};
  let looked = 0;
  for (const [key, generic] of drugs) {
    if (key in old) { cache[key] = old[key]; continue; }
    if (!key || key === generic) { cache[key] = null; continue; }
    let j: any = null;
    for (let t = 0; t < 3 && j == null; t++) {
      const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=brand_name:${encodeURIComponent(`"${key}"`)}&limit=50`).catch(() => null);
      if (r?.status === 404) j = { results: [] };
      else if (r?.ok) j = await r.json();
      else await sleep(3000 * (t + 1));
    }
    const labelers = [...new Set(((j?.results ?? []) as { labeler_name?: string }[]).map((x) => x.labeler_name ?? "").filter(Boolean))];
    const tickers = new Set(labelers.map(resolve));
    const owner = tickers.size === 1 && !tickers.has(null) ? [...tickers][0]! : null;
    cache[key] = owner ? { ticker: owner, maker: labelers[0] } : null;
    if (++looked % 100 === 0) log("  Part B owner lookups", looked);
    await sleep(250);
  }
  await sb.storage.from("datasets").upload(path, JSON.stringify(cache), { upsert: true, contentType: "application/json" });
  log("Part B owners", Object.values(cache).filter(Boolean).length, "of", Object.keys(cache).length, "drugs;", looked, "looked up");
  return cache;
}

if (args.medicare !== undefined) {
  const { data: regFile } = await sb.storage.from("datasets").download(REGISTRY_PATH);
  const reg = (regFile ? JSON.parse(await regFile.text()) : {}) as Record<string, AltRegistryEntry>;
  const covered = COVERAGE.flatMap((c) => {
    const names = [c.shortName, reg[c.ticker]?.legal].filter(Boolean) as string[];
    return names.map((name) => ({ ticker: c.ticker, name, sector: c.sector }));
  });
  const memo = new Map<string, string | null>();
  const resolve = (m: string) => (memo.has(m) ? memo.get(m)! : (memo.set(m, makerTicker(m, covered)), memo.get(m)!));
  const readings = [];
  for (const part of ["partD", "partB"] as Part[]) {
    const annual = await cmsAll(CMS[part].annual);
    const quarterly = await cmsAll(CMS[part].quarterly);
    log(part, annual.length, "annual rows,", quarterly.length, "quarterly rows");
    let owner: ((b: string) => { ticker: string; maker: string } | null) | undefined;
    if (part === "partB") {
      const big = new Map<string, string>();
      for (const r of [...annual, ...quarterly]) {
        const spend = Math.max(...Object.entries(r).filter(([k]) => k.startsWith("Tot_Spndng")).map(([, v]) => Number(v) || 0));
        if (spend >= 10e6 && r.Brnd_Name) big.set(displayBrand(r.Brnd_Name).toLowerCase(), displayBrand(r.Gnrc_Name ?? "").toLowerCase());
      }
      const owners = await partBOwners(big, resolve);
      owner = (b) => owners[displayBrand(b).toLowerCase()] ?? null;
    }
    readings.push(...drugYears(part, "annual", annual, resolve, owner), ...drugYears(part, "quarterly", quarterly, resolve, owner));
  }
  const unmatched = [...memo.entries()].filter(([, t]) => !t).length;
  const rows = medicareRows(readings);
  log("medicare:", rows.length, "rows for", new Set(rows.map((r) => r.ticker)).size, "companies;", unmatched, "maker names left unmatched");
  for (const [m, t] of memo) if (t) log("  maker", JSON.stringify(m), "→", t);
  if (args.dry === undefined) await upsert(rows);
  log(args.dry !== undefined ? "medicare dry run (nothing written)" : "medicare done");
}
