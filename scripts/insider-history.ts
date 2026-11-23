// Backfill open-market insider purchases (Form 4, transaction code P, by officers and directors)
// from the SEC's quarterly Insider Transactions Data Sets into `insider_buys`. The scheduled `sec`
// job adds new purchases as Form 4s are parsed. Usage: bun scripts/insider-history.ts [--from=2016q1] [--to=2026q3]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { sb, args, log, dbGate } from "./lib/supa";
import { COVERAGE, tickerByCik } from "../src/lib/coverage";

const UA = "FiledUnder research admin@filedunder.ai";
const DIR = "/tmp/form345";
mkdirSync(DIR, { recursive: true });
// Issuer CIKs in SEC's data sets: current and former registrants of each covered company.
const byCik = tickerByCik(COVERAGE);
const bySym = new Map(COVERAGE.map((c) => [c.ticker.replace("-", "."), c.ticker]));

const MON: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const isoDate = (s: string) => {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : null;
};

function tsv(zip: string, file: string): Record<string, string>[] {
  const text = execFileSync("unzip", ["-p", zip, file], { maxBuffer: 1 << 30 }).toString("utf8");
  const lines = text.split("\n");
  const head = lines[0].split("\t").map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const p = lines[i].split("\t");
    const r: Record<string, string> = {};
    head.forEach((h, k) => (r[h] = (p[k] ?? "").trim()));
    out.push(r);
  }
  return out;
}

const quarters: string[] = [];
const [fy, fq] = String(args.from ?? "2016q1").split("q").map(Number);
const now = new Date();
const [ty, tq] = String(args.to ?? `${now.getUTCFullYear()}q${Math.floor(now.getUTCMonth() / 3) + 1}`).split("q").map(Number);
for (let y = fy, q = fq; y < ty || (y === ty && q <= tq); q === 4 ? (y++, (q = 1)) : q++) quarters.push(`${y}q${q}`);

let total = 0;
for (const qtr of quarters) {
  const zip = `${DIR}/${qtr}.zip`;
  if (!existsSync(zip)) {
    const res = await fetch(`https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${qtr}_form345.zip`, { headers: { "user-agent": UA } });
    if (!res.ok) { log(qtr, "not available", res.status); continue; }
    await Bun.write(zip, await res.arrayBuffer());
  }
  const subs = new Map<string, { ticker: string; filed: string; plan: boolean }>();
  for (const s of tsv(zip, "SUBMISSION.tsv")) {
    if (!/^4(\/A)?$/.test(s.DOCUMENT_TYPE)) continue;
    const ticker = byCik.get(String(Number(s.ISSUERCIK))) ?? bySym.get(s.ISSUERTRADINGSYMBOL?.toUpperCase());
    const filed = isoDate(s.FILING_DATE);
    if (!ticker || !filed) continue;
    subs.set(s.ACCESSION_NUMBER, { ticker, filed, plan: s.AFF10B5ONE === "1" });
  }
  const owners = new Map<string, { name: string; rel: string; title: string }>();
  for (const o of tsv(zip, "REPORTINGOWNER.tsv")) {
    if (!subs.has(o.ACCESSION_NUMBER) || owners.has(o.ACCESSION_NUMBER)) continue;
    owners.set(o.ACCESSION_NUMBER, { name: o.RPTOWNERNAME, rel: o.RPTOWNER_RELATIONSHIP, title: o.RPTOWNER_TITLE });
  }
  const agg = new Map<string, { shares: number; value: number; date: string | null }>();
  for (const t of tsv(zip, "NONDERIV_TRANS.tsv")) {
    if (t.TRANS_CODE !== "P" || t.TRANS_ACQUIRED_DISP_CD !== "A" || !subs.has(t.ACCESSION_NUMBER)) continue;
    const sh = Number(t.TRANS_SHARES), px = Number(t.TRANS_PRICEPERSHARE);
    if (!(sh > 0)) continue;
    const a = agg.get(t.ACCESSION_NUMBER) ?? { shares: 0, value: 0, date: null };
    a.shares += sh;
    a.value += px > 0 ? sh * px : 0;
    const d = isoDate(t.TRANS_DATE);
    if (d && (!a.date || d > a.date)) a.date = d;
    agg.set(t.ACCESSION_NUMBER, a);
  }
  const rows = [...agg.entries()].flatMap(([accn, a]) => {
    const s = subs.get(accn)!, o = owners.get(accn);
    if (!o) return [];
    const officer = /officer/i.test(o.rel), director = /director/i.test(o.rel);
    if (!officer && !director) return []; // 10% holders and funds are not insiders in this sense
    return [{ ticker: s.ticker, accn, owner: o.name.slice(0, 200), role: (o.title || o.rel || "").slice(0, 120) || null, is_officer: officer, is_director: director, trade_date: a.date, filed: s.filed, shares: a.shares, value: Math.round(a.value), plan_10b5: s.plan, source: "sec-form345" }];
  });
  for (let k = 0; k < rows.length; k += 1000) {
    await dbGate("insider-history");
    const { error } = await sb.from("insider_buys").upsert(rows.slice(k, k + 1000));
    if (error) throw new Error(error.message);
  }
  total += rows.length;
  log(qtr, "purchases", rows.length, "total", total);
}
log("done", total);
