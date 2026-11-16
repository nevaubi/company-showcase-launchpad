/**
 * Filing detail for every covered company: reads the latest 10-K and the latest 10-Q filed after it
 * (inline XBRL + label linkbase), builds the dimensional tables (`src/lib/xbrl/detail.ts`), stores them
 * as `detail/TICKER.json` in the datasets bucket and the concentration rows in `xbrl_concentration`.
 * Reruns skip filings already stored in the current format.
 *   bun scripts/xbrl-detail.ts [--tickers=QCOM,DAL] [--dry] [--force] [--workers=3]
 */
import { buildDetail, DETAIL_FORMAT, type FilingDetail, type StoredDetail } from "@/lib/xbrl/detail";
import { parseContexts, parseInlineFacts, parseLabels, parseUnits } from "@/lib/xbrl/inline";
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
  const idx = JSON.parse(await sec(archive(cik, accn, "index.json"))) as { directory: { item: { name: string }[] } };
  const lab = idx.directory.item.find((x) => x.name.endsWith("_lab.xml"));
  const [html, labXml] = await Promise.all([sec(archive(cik, accn, doc)), lab ? sec(archive(cik, accn, lab.name)).catch(() => "") : Promise.resolve("")]);
  return buildDetail({
    ticker,
    accn,
    form: r.form[i],
    filed: r.filingDate[i],
    reportDate: r.reportDate[i],
    doc,
    facts: parseInlineFacts(html, parseUnits(html)),
    contexts: parseContexts(html),
    labels: parseLabels(labXml),
  });
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

/** Customers/suppliers named after a covered company (first word match, longest name wins). */
function matcher(universe: { ticker: string; name: string }[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[.,'’]/g, "").replace(/\b(inc|corp|corporation|co|company|ltd|plc|holdings?|group|the|llc|lp|sa|nv|ag)\b/g, " ").replace(/\s+/g, " ").trim();
  const names = universe.map((u) => ({ t: u.ticker, n: norm(u.name) })).filter((x) => x.n.length >= 3).sort((a, b) => b.n.length - a.n.length);
  return (label: string, self: string) => {
    const l = norm(label);
    if (!l || /^customer\b|^customer [a-z]$|^(one|two|three|four|five) customers?|^largest|^top|^major|^distributor|^other/.test(l)) return null;
    const hit = names.find((x) => x.t !== self && (l === x.n || l.startsWith(`${x.n} `)));
    return hit?.t ?? null;
  };
}

async function main() {
  const { data: uni } = await sb.storage.from("datasets").download("universe.json");
  const universe = (JSON.parse(await uni!.text()) as { companies?: { ticker: string; cik: string; name: string }[] } | { ticker: string; cik: string; name: string }[]);
  const list = Array.isArray(universe) ? universe : (universe.companies ?? []);
  const want = args.tickers?.split(",").map((t) => t.toUpperCase());
  const todo = list.filter((c) => c.cik && (!want || want.includes(c.ticker)));
  const match = matcher(list);
  log(`${todo.length} companies`);
  let done = 0;
  let stats = { tables: 0, conc: 0, skipped: 0, failed: 0 };
  const queue = [...todo];
  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try {
        const sub = JSON.parse(await sec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)) as { filings: { recent: Recent } };
        const r = sub.filings.recent;
        const k = r.form.findIndex((f) => f === "10-K" || f === "10-KT");
        const q = r.form.findIndex((f, i) => f === "10-Q" && (k < 0 || i < k));
        if (k < 0 && q < 0) {
          stats.skipped++;
          continue;
        }
        const prev = args.force !== undefined ? null : await stored(c.ticker);
        const same = (d: FilingDetail | null | undefined, i: number) => !!d && i >= 0 && d.accn === r.accessionNumber[i] && d.format === DETAIL_FORMAT;
        if (prev && prev.format === DETAIL_FORMAT && same(prev.annual, k) && (q < 0 ? !prev.quarterly : same(prev.quarterly, q))) {
          stats.skipped++;
          continue;
        }
        const annual = k >= 0 ? (same(prev?.annual, k) ? prev!.annual : await filingDetail(c.ticker, c.cik, r, k)) : null;
        const quarterly = q >= 0 ? (same(prev?.quarterly, q) ? prev!.quarterly : await filingDetail(c.ticker, c.cik, r, q)) : null;
        const out: StoredDetail = { ticker: c.ticker, builtAt: new Date().toISOString(), format: DETAIL_FORMAT, annual, quarterly };
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
          log(`${c.ticker}: ${annual?.form ?? "-"} ${annual?.tables.length ?? 0} tables, segments ${annual?.segments?.segments.length ?? 0}×${annual?.segments?.rows.length ?? 0}, concentration ${annual?.concentration.length ?? 0} · ${quarterly?.form ?? "-"} ${quarterly?.tables.length ?? 0} tables · ${(JSON.stringify(out).length / 1e3).toFixed(0)} KB`);
          for (const t of (annual?.tables ?? []).slice(0, 12)) log(`   [${t.family}] ${t.title} — ${t.rows.length} rows${t.total ? " + total" : ""}`);
          for (const x of (annual?.concentration ?? []).slice(0, 6)) log(`   conc ${x.kind}/${x.benchmark} ${x.label} ${Object.values(x.values).map((v) => (v.v * 100).toFixed(0)).join("/")}%`);
          continue;
        }
        await dbGate("xbrl-detail");
        const up = await sb.storage.from("datasets").upload(`detail/${c.ticker}.json`, new Blob([JSON.stringify(out)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
        if (up.error) throw new Error(up.error.message);
        const accns = [annual?.accn, quarterly?.accn].filter(Boolean) as string[];
        await sb.from("xbrl_concentration").delete().eq("ticker", c.ticker).not("accn", "in", `(${accns.map((a) => `"${a}"`).join(",")})`);
        if (rows.length) {
          const { error } = await sb.from("xbrl_concentration").upsert(rows, { onConflict: "ticker,accn,kind,benchmark,member,period_end" });
          if (error) throw new Error(error.message);
        }
        done++;
        if (done % 25 === 0 || want) log(`${done} stored (${c.ticker}: ${out.annual?.tables.length ?? 0}+${out.quarterly?.tables.length ?? 0} tables, ${rows.length} concentration rows) · ${queue.length} left`);
      } catch (e) {
        stats.failed++;
        log(`${c.ticker} failed: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(args.workers ?? 3) }, worker));
  log(`DONE ${done} stored · ${stats.skipped} unchanged/no filings · ${stats.failed} failed · ${stats.tables} tables · ${stats.conc} concentration rows`);
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
