// Whole-market government files for every covered company.
//   bun scripts/gov-data.ts --ftd[=24]     SEC fails-to-deliver, the last N months (default 24)
//   bun scripts/gov-data.ts --medicare     CMS Medicare Part D + Part B drug spending (annual + latest quarters)
//   bun scripts/gov-data.ts --medicare-states[=5]  CMS Part D drug costs by prescriber state for every covered drug maker, the last N years
//                                          (add --if-new to do nothing unless CMS has published a newer year; the IR loop runs that weekly)
//   bun scripts/gov-data.ts --tri[=6]      EPA Toxics Release Inventory plants, releases and production index for every covered company, the last N years
//                                          (add --if-new to do nothing unless EPA has published a newer year; the IR loop runs that weekly)
//   bun scripts/gov-data.ts --sod[=6]      FDIC Summary of Deposits by state and metro for every covered bank, the last N years
//                                          (add --if-new to do nothing unless a newer June 30 survey is out; the IR loop runs that weekly)
// The scheduled `gov-data` job keeps the latest fails-to-deliver half-month current after the
// backfill; CMS publishes the drug files yearly with quarterly updates, so rerun --medicare then.
import { COVERAGE } from "@/lib/coverage";
import { ftdRows, ftdUrl, latestLikelyPeriod, parseFtd, periodCode, prevPeriod, unzipText } from "@/lib/alt/ftd";
import { CMS, displayBrand, drugYears, makerTicker, medicareRows, type CmsRecord, type Part } from "@/lib/alt/medicare";
import { GEO_DATASET, geoDistributions, geoRows, parseGeoCsv, partDOwners } from "@/lib/alt/medicare-geo";
import { normParent, parseTri, TRI_DATASET, triFileUrl, triMatcher, triRows } from "@/lib/alt/tri";
import { REGISTRY_PATH, type AltRegistryEntry } from "@/lib/alt/registry";
import { parseBuckets, SOD_API, sodFilter, sodRows, sodUrl, type SodEntity } from "@/lib/alt/sod";
import { staticRegistry } from "@/lib/alt/collect.server";
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

async function fdicJson(url: string): Promise<any> {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(45_000) }).catch(() => null);
    if (r?.ok) return r.json();
    await sleep(2000 * (t + 1));
  }
  throw new Error(`FDIC ${url} failed`);
}

if (args.sod !== undefined) {
  const years = Number(args.sod) || 6;
  const newest = Number((await fdicJson(`${SOD_API}?filters=CERT:3511&fields=YEAR&sort_by=YEAR&sort_order=DESC&limit=1`)).data?.[0]?.data?.YEAR);
  if (!newest) throw new Error("could not read the latest Summary of Deposits year");
  const { data: st } = await sb.from("job_state").select("cursor").eq("job", "gov-sod").maybeSingle();
  // Full runs (and weekly up-to-date checks) show on the admin freshness page as job "gov-sod".
  const record = args.dry === undefined && !args.tickers;
  const { data: run } = record ? await sb.from("job_runs").insert({ job: "gov-sod" }).select("id").single() : { data: null };
  if (args["if-new"] !== undefined && (st?.cursor ?? 0) >= newest) {
    log(`Summary of Deposits up to date (${newest})`);
    if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, items: 0, detail: { note: `up to date through June ${newest}` } }).eq("id", run.id);
  } else {
    const { data: regFile } = await sb.storage.from("datasets").download(REGISTRY_PATH);
    const reg = (regFile ? JSON.parse(await regFile.text()) : {}) as Record<string, AltRegistryEntry>;
    const banks = COVERAGE.map((c) => ({ ticker: c.ticker, cert: staticRegistry(c.ticker).fdic ?? reg[c.ticker]?.fdic })).filter((b): b is { ticker: string; cert: number } => !!b.cert);
    const only = args.tickers ? new Set(String(args.tickers).toUpperCase().split(",")) : null;
    const list = only ? banks.filter((b) => only.has(b.ticker)) : banks;
    const span = Array.from({ length: years }, (_, i) => newest - i);
    log(`Summary of Deposits ${span.at(-1)}–${newest} for ${list.length} banks`);
    const totals = new Map<number, Map<string, number>>();
    for (const y of span) totals.set(y, new Map(parseBuckets(await fdicJson(sodUrl(`YEAR:${y}`, "STALPBR")), "STALPBR").map((b) => [b.key, b.depositsK])));
    let rows = 0, done = 0;
    for (const b of list) {
      await dbGate();
      const inst = (await fdicJson(`https://api.fdic.gov/banks/institutions?filters=CERT:${b.cert}&fields=CERT,NAME,RSSDHCR,NAMEHCR`)).data?.[0]?.data;
      const e: SodEntity = { ticker: b.ticker, cert: b.cert, rssd: inst?.RSSDHCR ? String(inst.RSSDHCR) : null, name: inst?.NAMEHCR || inst?.NAME || b.ticker };
      const out = [];
      for (const y of span) {
        const states = parseBuckets(await fdicJson(sodUrl(sodFilter(e, y), "STALPBR")), "STALPBR");
        const metros = y === newest ? parseBuckets(await fdicJson(sodUrl(sodFilter(e, y), "MSANAMB", 500)), "MSANAMB") : [];
        out.push(...sodRows(e, y, states, totals.get(y)!, metros));
        await sleep(150);
      }
      if (args.dry === undefined) await upsert(out);
      rows += out.length;
      if (++done % 10 === 0 || only) log(`  ${done}/${list.length} ${b.ticker} (${e.name}) ${out.length} rows`);
    }
    if (args.dry === undefined && !only) await sb.from("job_state").upsert({ job: "gov-sod", cursor: newest, updated_at: new Date().toISOString() });
    if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, items: rows, detail: { banks: done, year: newest } }).eq("id", run.id);
    log(`Summary of Deposits done: ${rows} rows for ${done} banks`);
  }
}

if (args["medicare-states"] !== undefined) {
  const years = Number(args["medicare-states"]) || 5;
  const catalog = await (await fetch("https://data.cms.gov/data.json")).json();
  const files = geoDistributions(catalog);
  const newest = Math.max(...files.keys());
  if (!Number.isFinite(newest)) throw new Error("no CMS geography files in the catalog");
  const { data: st } = await sb.from("job_state").select("cursor").eq("job", "gov-medicare-states").maybeSingle();
  const record = args.dry === undefined && !args.tickers;
  const { data: run } = record ? await sb.from("job_runs").insert({ job: "gov-medicare-states" }).select("id").single() : { data: null };
  if (args["if-new"] !== undefined && (st?.cursor ?? 0) >= newest) {
    log(`Medicare drug costs by state up to date (${newest})`);
    if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, items: 0, detail: { note: `up to date through ${newest}` } }).eq("id", run.id);
  } else {
    const { data: regFile } = await sb.storage.from("datasets").download(REGISTRY_PATH);
    const reg = (regFile ? JSON.parse(await regFile.text()) : {}) as Record<string, AltRegistryEntry>;
    const coveredCos = COVERAGE.flatMap((c) => [c.shortName, reg[c.ticker]?.legal].filter(Boolean).map((name) => ({ ticker: c.ticker, name: name as string, sector: c.sector })));
    const memo = new Map<string, string | null>();
    const resolve = (m: string) => (memo.has(m) ? memo.get(m)! : (memo.set(m, makerTicker(m, coveredCos)), memo.get(m)!));
    const spending = await cmsAll(CMS.partD.annual);
    const owners = partDOwners(spending, resolve);
    const spendBy = new Map<number, Map<string, number>>();
    for (const r of drugYears("partD", "annual", spending, resolve)) {
      const m = spendBy.get(r.year) ?? spendBy.set(r.year, new Map()).get(r.year)!;
      m.set(r.ticker, (m.get(r.ticker) ?? 0) + r.spend);
    }
    const only = args.tickers ? new Set(String(args.tickers).toUpperCase().split(",")) : null;
    const span = [...files.keys()].filter((y) => y > newest - years && owners.has(y)).sort();
    log(`Medicare Part D by state ${span[0]}–${span.at(-1)} · owners known for ${span.map((y) => `${y}: ${owners.get(y)!.size}`).join(", ")} brands`);
    let rows = 0;
    const tickers = new Set<string>();
    for (const y of span) {
      const f = files.get(y)!;
      let text: string | null = null;
      for (let t = 0; t < 4 && !text; t++) {
        const r = await fetch(f.csv, { signal: AbortSignal.timeout(240_000) }).catch(() => null);
        if (r?.ok) text = await r.text();
        else await sleep(3000 * (t + 1));
      }
      if (!text) throw new Error(`CMS ${y} geography file failed`);
      const recs = parseGeoCsv(text);
      let out = geoRows(y, recs, owners.get(y)!, f.id, { spend: spendBy.get(y) });
      if (only) out = out.filter((r) => only.has(r.ticker));
      for (const r of out) tickers.add(r.ticker);
      if (args.dry === undefined) await upsert(out);
      rows += out.length;
      log(`  ${y}: ${recs.length} CMS rows → ${out.length} rows for ${new Set(out.map((r) => r.ticker)).size} companies`);
    }
    if (args.dry === undefined && !only) await sb.from("job_state").upsert({ job: "gov-medicare-states", cursor: newest, updated_at: new Date().toISOString() });
    if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, items: rows, detail: { companies: tickers.size, year: newest } }).eq("id", run.id);
    log(`Medicare by state done: ${rows} rows for ${tickers.size} companies (${GEO_DATASET})`);
  }
}

/** Hand-checked TRI parent names (normalized) whose company name doesn't carry over. */
const TRI_ALIASES: Record<string, string> = {
  "crh americas": "CRH",
  wabtec: "WAB",
};

if (args.tri !== undefined) {
  const years = Number(args.tri) || 6;
  let newest = 0;
  for (let y = new Date().getUTCFullYear(); y >= 2020 && !newest; y--) {
    const r = await fetch(triFileUrl(y), { headers: { Range: "bytes=0-2000" } }).catch(() => null);
    if (r?.ok && (await r.text()).includes("TRIFD")) newest = y;
  }
  if (!newest) throw new Error("no TRI basic data file found");
  const { data: st } = await sb.from("job_state").select("cursor").eq("job", "gov-tri").maybeSingle();
  const record = args.dry === undefined && !args.tickers;
  const { data: run } = record ? await sb.from("job_runs").insert({ job: "gov-tri" }).select("id").single() : { data: null };
  if (args["if-new"] !== undefined && (st?.cursor ?? 0) >= newest) {
    log(`TRI up to date (${newest})`);
    if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, items: 0, detail: { note: `up to date through ${newest}` } }).eq("id", run.id);
  } else {
    const { data: regFile } = await sb.storage.from("datasets").download(REGISTRY_PATH);
    const reg = (regFile ? JSON.parse(await regFile.text()) : {}) as Record<string, AltRegistryEntry>;
    const match = triMatcher(COVERAGE.map((c) => ({ ticker: c.ticker, shortName: c.shortName, legal: reg[c.ticker]?.legal, industry: c.industry })), TRI_ALIASES);
    const only = args.tickers ? new Set(String(args.tickers).toUpperCase().split(",")) : null;
    let rows = 0;
    const tickers = new Set<string>();
    for (let y = newest - years + 1; y <= newest; y++) {
      let text: string | null = null;
      for (let t = 0; t < 4 && !text; t++) {
        const r = await fetch(triFileUrl(y), { signal: AbortSignal.timeout(240_000) }).catch(() => null);
        if (r?.ok) text = await r.text();
        else await sleep(3000 * (t + 1));
      }
      if (!text) throw new Error(`TRI ${y} file failed`);
      const recs = parseTri(text);
      let out = triRows(y, recs, match);
      if (only) out = out.filter((r) => only.has(r.ticker));
      for (const r of out) tickers.add(r.ticker);
      if (args.dry === undefined) await upsert(out);
      rows += out.length;
      if (args.unmatched !== undefined && y === newest) {
        const fac = new Map<string, Set<string>>();
        for (const r of recs) if (r.parent && !match(r.parent)) (fac.get(r.parent) ?? fac.set(r.parent, new Set()).get(r.parent)!).add(r.trifd);
        log("largest unmatched parents:", [...fac].sort((a, b) => b[1].size - a[1].size).slice(0, 60).map(([p, f]) => `${p} (${normParent(p)}): ${f.size}`).join(" | "));
      }
      log(`  ${y}: ${recs.length} forms → ${out.length} rows for ${new Set(out.map((r) => r.ticker)).size} companies`);
    }
    if (args.dry === undefined && !only) await sb.from("job_state").upsert({ job: "gov-tri", cursor: newest, updated_at: new Date().toISOString() });
    if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, items: rows, detail: { companies: tickers.size, year: newest } }).eq("id", run.id);
    log(`TRI done: ${rows} rows for ${tickers.size} companies (${TRI_DATASET})`);
  }
}
