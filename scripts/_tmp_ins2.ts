// Build insurer details in memory (no writes) and print the insurance tables + segment matrix kinds.
import { buildDetail } from "@/lib/xbrl/detail";
import { parseContexts, parseInlineFacts, parseLabels, parseUnits } from "@/lib/xbrl/inline";
const UA = "FiledUnder Research research@filedunder.ai";
const get = async (u: string) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); };
const tk = JSON.parse(await get("https://www.sec.gov/files/company_tickers.json")) as Record<string, { cik_str: number; ticker: string }>;
const cikOf = Object.fromEntries(Object.values(tk).map((x) => [x.ticker, String(x.cik_str).padStart(10, "0")]));
for (const t of (process.argv[2] ?? "TRV,ALL,CB").split(",")) {
  const cik = cikOf[t];
  const sub = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik}.json`));
  const r = sub.filings.recent;
  const i = r.form.findIndex((f: string) => f === "10-K");
  const accn = r.accessionNumber[i], doc = r.primaryDocument[i];
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/`;
  const idx = JSON.parse(await get(base + "index.json"));
  const lab = idx.directory.item.find((x: any) => x.name.endsWith("_lab.xml"));
  const html = await get(base + doc);
  const labels = lab ? parseLabels(await get(base + lab.name)) : new Map();
  const d = buildDetail({ ticker: t, accn, form: "10-K", filed: r.filingDate[i], reportDate: r.reportDate[i], doc, facts: parseInlineFacts(html, parseUnits(html)), contexts: parseContexts(html), labels });
  console.log(`\n=== ${t} ${accn}`);
  for (const x of d.tables.filter((x) => x.family === "insurance")) {
    const k = x.periods.at(-1)!;
    console.log(`  [${x.title}] ${x.rows.length} rows; ${x.rows.slice(0, 4).map((r) => `${r.label}=${((r.values[k]?.v ?? r.sub?.reduce((n, s) => n + (s.values[k]?.v ?? 0), 0) ?? 0) / 1e6).toFixed(0)}M${r.sub ? `(+${r.sub.length})` : ""}`).join("; ")}${x.total ? ` | total ${(x.total[k]?.v / 1e6).toFixed(0)}M` : ""}`);
  }
  if (d.segments) console.log("  SEG rows:", d.segments.rows.map((r) => `${r.kind}:${r.label}`).join(" | "), "\n  segs:", d.segments.segments.map((s) => s.label).join(", "));
  console.log("  consolidated:", Object.keys(d.consolidated ?? {}).filter((c) => /Premium|Claims|Benefit|Underwriting|PriorYear|Acquisition/.test(c)).join(", "));
}
