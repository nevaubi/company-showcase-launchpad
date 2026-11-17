/** Plain-text views of the cross-company exposure index for the research assistant (pure). */
import { isLenderIndustry, rankRegion, regionCounts, regionKey, regionName, REGION_NAMES, type BankMetrics, type ExpVal, type ExposureIndex } from "./exposure";

const usd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(0)}M` : a.toFixed(0);
  return `${v < 0 ? "-" : ""}$${s}`;
};
const pct = (v: number | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(d)}%`);
const cite = (t: string, v: ExpVal) => [...new Set(v.parts.map((p) => `filing:${t}:${p.accn}${p.doc ? `:${p.doc}` : ""}`))].join(", ");

/** Resolves "China", "greater china", "CN" or a key to one region key. */
export function resolveRegion(q: string): string | null {
  const s = q.trim();
  if (!s) return null;
  if (REGION_NAMES[s.toLowerCase()]) return s.toLowerCase();
  if (/^[A-Za-z]{2}$/.test(s)) return regionKey(`country:${s.toUpperCase()}`, s);
  return regionKey("x:x", s);
}

export function regionText(index: ExposureIndex, region: string, names: Map<string, string>, limit = 40): string {
  const key = resolveRegion(region);
  if (!key) return `Unknown region "${region}". Regions with data: ${regionCounts(index).slice(0, 30).map((c) => `${c.key} (${regionName(c.key)}, ${c.n})`).join(", ")}.`;
  const rows = rankRegion(index, key);
  if (!rows.length) return `No covered company breaks out ${regionName(key)} in its latest 10-K revenue tables.`;
  const lines = rows.slice(0, limit).map(({ ticker, r }) => {
    const prior = r.prior ? ` · ${r.prior.period} ${pct(r.prior.share, 1)} (${r.share - r.prior.share >= 0 ? "+" : ""}${((r.share - r.prior.share) * 100).toFixed(1)} pts)` : "";
    return `${ticker} ${names.get(ticker) ?? ""} · filed as "${r.label}" · ${r.period} ${usd(r.value.v)} = ${pct(r.share, 1)} of ${usd(r.total.v)} revenue${prior} · ${cite(ticker, r.value)}`;
  });
  return `Revenue from ${regionName(key)} by company (latest 10-K geography tables, highest share first; ${rows.length} companies break it out). Each company names its own regions, so check "filed as". Change is vs about three years earlier from the earlier 10-K.\n${lines.join("\n")}${rows.length > limit ? `\n… ${rows.length - limit} more` : ""}`;
}

const bankLine = (t: string, name: string, b: BankMetrics) => {
  const L = b.loans.v;
  const g = b.loansPrior ? ` (${pct(L / b.loansPrior.v - 1, 1)} vs ${b.loansPrior.end})` : "";
  const dep = b.deposits ? ` · deposits ${usd(b.deposits.v)}${b.depositsPrior ? ` (${pct(b.deposits.v / b.depositsPrior.v - 1, 1)})` : ""} · loans/deposits ${pct(L / b.deposits.v, 0)}` : "";
  return `${t} ${name} · year-end ${b.end} · loans ${usd(L)}${g}${dep} · net charge-offs ${b.nco ? `${usd(b.nco.v)} = ${pct(b.nco.v / L)}` : "n/a"} · allowance ${b.allowance ? pct(b.allowance.v / L) : "n/a"} · nonaccrual ${b.nonaccrual ? pct(b.nonaccrual.v / L) : "n/a"} of loans · ${cite(t, b.loans)}`;
};

export function lendersText(index: ExposureIndex, names: Map<string, string>, industries: Map<string, string>, opts: { sort?: "loans" | "nco" | "allowance" | "nonaccrual" | "growth"; limit?: number; others?: boolean } = {}): string {
  const by = opts.sort ?? "loans";
  const v = (b: BankMetrics) => (by === "loans" ? b.loans.v : by === "nco" ? (b.nco?.v ?? NaN) / b.loans.v : by === "allowance" ? (b.allowance?.v ?? NaN) / b.loans.v : by === "nonaccrual" ? (b.nonaccrual?.v ?? NaN) / b.loans.v : b.loansPrior ? b.loans.v / b.loansPrior.v - 1 : NaN);
  const rows = Object.entries(index.companies)
    .filter(([t, c]) => c.bank && (opts.others || isLenderIndustry(industries.get(t))))
    .map(([t, c]) => ({ t, b: c.bank!, x: v(c.bank!) }))
    .filter((r) => Number.isFinite(r.x))
    .sort((a, b) => b.x - a.x);
  if (!rows.length) return "No lender metrics stored yet.";
  const limit = opts.limit ?? 40;
  return `Lenders from their latest 10-K tags (sorted by ${by}, highest first; ${rows.length} lenders). Ratios use year-end loans; a ratio is n/a when its tags don't describe the same book.\n${rows.slice(0, limit).map((r) => bankLine(r.t, names.get(r.t) ?? "", r.b)).join("\n")}`;
}

export function companyExposureText(index: ExposureIndex, ticker: string, names: Map<string, string>): string {
  const c = index.companies[ticker];
  if (!c) return `${ticker} has no region breakdown or loan book in the exposure index (its 10-K may not tag revenue by geography).`;
  const out: string[] = [];
  if (c.exposure) {
    out.push(`${ticker} revenue by region (${c.exposure.table}, FY ending ${c.exposure.fyEnd}):`);
    for (const r of c.exposure.regions) {
      const peers = rankRegion(index, r.key);
      const rank = peers.findIndex((p) => p.ticker === ticker) + 1;
      out.push(`- "${r.label}" (${regionName(r.key)}): ${usd(r.value.v)} = ${pct(r.share, 1)}${r.prior ? `, ${r.prior.period} ${pct(r.prior.share, 1)}` : ""} · rank ${rank} of ${peers.length} companies breaking out ${regionName(r.key)} · ${cite(ticker, r.value)}`);
    }
  }
  if (c.bank) out.push(`Loan book: ${bankLine(ticker, names.get(ticker) ?? "", c.bank)}`);
  return out.join("\n");
}
