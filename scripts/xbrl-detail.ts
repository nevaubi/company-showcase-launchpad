/**
 * Filing detail for every covered company: reads the latest 10-K and the latest 10-Q filed after it
 * (inline XBRL + label linkbase), builds the dimensional tables (`src/lib/xbrl/detail.ts`), stores them
 * as `detail/TICKER.json` in the datasets bucket and the concentration rows in `xbrl_concentration`.
 * It also reads the 10-Ks about two and four years back (`history`), so the annual tables extend to
 * ~7 fiscal years (merged purely in `src/lib/xbrl/history.ts`). Reruns skip filings already stored in
 * the current format.
 *   bun scripts/xbrl-detail.ts [--tickers=QCOM,DAL] [--dry] [--force] [--workers=3]
 */
import { buildDetail, DETAIL_FORMAT, type FilingDetail, type StoredDetail } from "@/lib/xbrl/detail";
import { parseContexts, parseInlineFacts, parseLabels, parseUnits } from "@/lib/xbrl/inline";
import { companyMatcher } from "@/lib/xbrl/counterparty";
import { indexEntry, type ExposureIndex } from "@/lib/xbrl/exposure";
import { args, dbGate, log, sb, sleep } from "./lib/supa";

const UA = "FiledUnder Research research@filedunder.ai";
let last = 0;
let chain = Promise.resolve();
/** SEC allows 10 requests a second; stay under it across workers. */
const slot = () => (chain = chain.then(async () => {
  const wait = Math.max(0, last + 180 - Date.now());
  if (wait) await sleep(wait);
  last = Date.now();
}));

async function sec(url: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    await slot();
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(120_000) }).catch(() => null);
    if (r?.ok) return await r.text();
    if (r && r.status === 404) throw new Error(`404 ${url}`);
    await sleep(2000 * (i + 1) * (r?.status === 429 ? 5 : 1));
  }
  throw new Error(`SEC unavailable: ${url}`);
}

interface Recent {
  accessionNumber: string[];
  form: string[];
  filingDate: string[];
  reportDate: string[];
  primaryDocument: string[];
  isInlineXBRL: number[];
}
const archive = (cik: string, accn: string, file: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${file}`;

async function filingDetail(ticker: string, cik: string, r: Recent, i: number): Promise<FilingDetail | null> {
  const accn = r.accessionNumber[i];
  const doc = r.primaryDocument[i];
  if (!r.isInlineXBRL[i]) return null;
  const idx = JSON.parse(await sec(archive(cik, accn, "index.json"))) as { directory: { item: { name: string; size?: string | number }[] } };
  const lab = idx.directory.item.find((x) => x.name.endsWith("_lab.xml"));
  const [html, labXml] = await Promise.all([sec(archive(cik, accn, doc)), lab ? sec(archive(cik, accn, lab.name)).catch(() => "") : Promise.resolve("")]);
  let facts = parseInlineFacts(html, parseUnits(html));
  let all = html;
  // Some filers (Wells Fargo, U.S. Bancorp) put the financial statements in an annual-report exhibit of the
  // inline XBRL document set; read the largest other inline document when the primary one carries few tags.
  if (facts.length < 400) {
    const others = idx.directory.item
      .filter((x) => /\.htm$/i.test(x.name) && x.name !== doc && !/^R\d+\.htm$/i.test(x.name))
      .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))
      .slice(0, 2);
    for (const o of others) {
      const extra = await sec(archive(cik, accn, o.name)).catch(() => "");
      if (!/<ix:nonFraction/i.test(extra)) continue;
      all += extra;
      const units = parseUnits(all);
      const more = parseInlineFacts(extra, units).map((f) => ({ ...f, doc: o.name }));
      if (more.length > facts.length) {
        facts = [...parseInlineFacts(html, units), ...more];
        break;
      }
    }
  }
  return buildDetail({
    ticker,
    accn,
    form: r.form[i],
    filed: r.filingDate[i],
    reportDate: r.reportDate[i],
    doc,
    facts,
    contexts: parseContexts(all),
    labels: parseLabels(labXml),
  });
}

const isAnnual = (f: string) => f === "10-K" || f === "10-KT";

/**
 * The 10-Ks about two and four years before the latest one (each 10-K reports three fiscal years, so
 * these extend the latest filing's three to about seven). Large filers' `recent` list can stop short
 * of them; then the older submissions pages are read too.
 */
async function olderAnnuals(sub: Submissions): Promise<{ r: Recent; i: number }[]> {
  const pages: Recent[] = [sub.filings.recent];
  const all = () => pages.flatMap((r) => r.form.map((f, i) => ({ r, i, f })).filter((x) => isAnnual(x.f)));
  for (const f of sub.filings.files ?? []) {
    if (all().length >= 5) break;
    pages.push(JSON.parse(await sec(`https://data.sec.gov/submissions/${f.name}`)) as Recent);
  }
  const ks = all();
  return [ks[2], ks[4]].filter(Boolean).map(({ r, i }) => ({ r, i }));
}

interface Submissions {
  filings: { recent: Recent; files?: { name: string }[] };
}

async function stored(ticker: string): Promise<StoredDetail | null> {
  const { data } = await sb.storage.from("datasets").download(`detail/${ticker}.json`);
  if (!data) return null;
  try {
    return JSON.parse(await data.text()) as StoredDetail;
  } catch {
    return null;
  }
}

async function main() {
  const { data: uni } = await sb.storage.from("datasets").download("universe.json");
  const universe = (JSON.parse(await uni!.text()) as { companies?: { ticker: string; cik: string; name: string }[] } | { ticker: string; cik: string; name: string }[]);
  const list = Array.isArray(universe) ? universe : (universe.companies ?? []);
  const want = args.tickers?.split(",").map((t) => t.toUpperCase());
  const todo = list.filter((c) => c.cik && (!want || want.includes(c.ticker)));
  const match = companyMatcher(list);
  log(`${todo.length} companies`);
  // Full runs show on the admin freshness page (job "xbrl-detail").
  const record = !want && args.dry === undefined;
  const { data: run } = record ? await sb.from("job_runs").insert({ job: "xbrl-detail" }).select("id").single() : { data: null };
  let done = 0;
  let stats = { tables: 0, conc: 0, skipped: 0, failed: 0, history: 0 };
  // Cross-company index (region exposure, bank metrics) for the Exposures page, refreshed as companies are read.
  const index: ExposureIndex = (await (async () => {
    const { data } = await sb.storage.from("datasets").download("detail-index.json");
    try {
      return data ? (JSON.parse(await data.text()) as ExposureIndex) : null;
    } catch {
      return null;
    }
  })()) ?? { builtAt: "", companies: {} };
  const note = (ticker: string, d: StoredDetail | null) => {
    const e = d ? indexEntry(d) : {};
    if (e.exposure || e.bank) index.companies[ticker] = e;
    else delete index.companies[ticker];
  };
  let lastSave = Date.now();
  const saveIndex = async () => {
    if (args.dry !== undefined) return;
    index.builtAt = new Date().toISOString();
    const up = await sb.storage.from("datasets").upload("detail-index.json", new Blob([JSON.stringify(index)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (up.error) log(`index upload failed: ${up.error.message}`);
    lastSave = Date.now();
  };
  const queue = [...todo];
  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try {
        const sub = JSON.parse(await sec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)) as Submissions;
        const r = sub.filings.recent;
        const k = r.form.findIndex(isAnnual);
        const q = r.form.findIndex((f, i) => f === "10-Q" && (k < 0 || i < k));
        if (k < 0 && q < 0) {
          stats.skipped++;
          note(c.ticker, null);
          continue;
        }
        const prev = args.force !== undefined ? null : await stored(c.ticker);
        const same = (d: FilingDetail | null | undefined, i: number) => !!d && i >= 0 && d.accn === r.accessionNumber[i] && d.format === DETAIL_FORMAT;
        // `historyChecked` marks a file whose earlier 10-Ks were already looked up (some have none in inline XBRL).
        const hasHistory = !!prev && prev.historyChecked === r.accessionNumber[k];
        if (prev && prev.format === DETAIL_FORMAT && same(prev.annual, k) && (q < 0 ? !prev.quarterly : same(prev.quarterly, q)) && (k < 0 || hasHistory)) {
          stats.skipped++;
          note(c.ticker, prev);
          continue;
        }
        const annual = k >= 0 ? (same(prev?.annual, k) ? prev!.annual : await filingDetail(c.ticker, c.cik, r, k)) : null;
        const quarterly = q >= 0 ? (same(prev?.quarterly, q) ? prev!.quarterly : await filingDetail(c.ticker, c.cik, r, q)) : null;
        const history: FilingDetail[] = [];
        if (annual && k >= 0) {
          for (const o of await olderAnnuals(sub)) {
            const reuse = prev?.history?.find((h) => h.accn === o.r.accessionNumber[o.i] && h.format === DETAIL_FORMAT);
            const h = reuse ?? (await filingDetail(c.ticker, c.cik, o.r, o.i).catch((e) => (log(`${c.ticker} history ${o.r.accessionNumber[o.i]}: ${(e as Error).message}`), null)));
            if (h && h.reportDate < annual.reportDate) history.push(h);
          }
          stats.history += history.length;
        }
        const out: StoredDetail = { ticker: c.ticker, builtAt: new Date().toISOString(), format: DETAIL_FORMAT, annual, quarterly, ...(history.length ? { history } : {}), ...(annual ? { historyChecked: annual.accn } : {}) };
        const rows = [annual, quarterly].flatMap((d) =>
          !d
            ? []
            : d.concentration.flatMap((row) =>
                Object.entries(row.values).map(([pk, v]) => ({
                  ticker: c.ticker,
                  accn: d.accn,
                  form: d.form,
                  filed: d.filed,
                  period_start: d.periods[pk]?.start ?? null,
                  period_end: d.periods[pk]?.end ?? d.reportDate,
                  kind: row.kind,
                  benchmark: row.benchmark,
                  benchmark_label: row.benchmarkLabel,
                  member: row.member,
                  label: row.label,
                  pct: v.v,
                  element_id: v.id ?? null,
                  counterparty: row.kind === "customer" || row.kind === "supplier" ? match(row.label, c.ticker) : null,
                })),
              ),
        );
        stats.tables += (annual?.tables.length ?? 0) + (quarterly?.tables.length ?? 0);
        stats.conc += rows.length;
        if (args.dry !== undefined) {
          log(`${c.ticker}: earlier 10-Ks ${history.map((h) => h.reportDate).join(", ") || "none"} · ${annual?.form ?? "-"} ${annual?.tables.length ?? 0} tables, segments ${annual?.segments?.segments.length ?? 0}×${annual?.segments?.rows.length ?? 0}, concentration ${annual?.concentration.length ?? 0} · ${quarterly?.form ?? "-"} ${quarterly?.tables.length ?? 0} tables · ${(JSON.stringify(out).length / 1e3).toFixed(0)} KB`);
          for (const t of (annual?.tables ?? []).slice(0, 12)) log(`   [${t.family}] ${t.title} — ${t.rows.length} rows${t.total ? " + total" : ""}`);
          for (const x of (annual?.concentration ?? []).slice(0, 6)) log(`   conc ${x.kind}/${x.benchmark} ${x.label} ${Object.values(x.values).map((v) => (v.v * 100).toFixed(0)).join("/")}%`);
          continue;
        }
        await dbGate("xbrl-detail");
        const up = await sb.storage.from("datasets").upload(`detail/${c.ticker}.json`, new Blob([JSON.stringify(out)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
        if (up.error) throw new Error(up.error.message);
        const accns = [annual?.accn, quarterly?.accn].filter(Boolean) as string[];
        await sb.from("xbrl_concentration").delete().eq("ticker", c.ticker).not("accn", "in", `(${accns.map((a) => `"${a}"`).join(",")})`);
        // Two filing types can fold into one kind/benchmark; keep the first of each key.
        const keyed = new Map(rows.map((x) => [`${x.accn}|${x.kind}|${x.benchmark}|${x.member}|${x.period_end}`, x]).reverse());
        if (keyed.size) {
          const { error } = await sb.from("xbrl_concentration").upsert([...keyed.values()], { onConflict: "ticker,accn,kind,benchmark,member,period_end" });
          if (error) throw new Error(error.message);
        }
        done++;
        note(c.ticker, out);
        if (Date.now() - lastSave > 5 * 60_000) await saveIndex();
        if (done % 25 === 0 || want) log(`${done} stored (${c.ticker}: ${out.annual?.tables.length ?? 0}+${out.quarterly?.tables.length ?? 0} tables, ${rows.length} concentration rows, ${history.length} earlier 10-Ks) · ${queue.length} left`);
      } catch (e) {
        stats.failed++;
        log(`${c.ticker} failed: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(args.workers ?? 3) }, worker));
  await saveIndex();
  if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: stats.failed < Math.max(25, todo.length * 0.05), items: done, detail: { ...stats, companies: todo.length } }).eq("id", run.id);
  log(`DONE ${done} stored · ${stats.skipped} unchanged/no filings · ${stats.failed} failed · ${stats.tables} tables · ${stats.conc} concentration rows · ${stats.history} earlier 10-Ks`);
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
