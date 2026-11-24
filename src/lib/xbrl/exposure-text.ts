/** Plain-text views of the cross-company exposure index for the research assistant (pure). */
import { isInsurerIndustry, isLenderIndustry, rankRegion, regionCounts, regionKey, regionName, REGION_NAMES, type BankMetrics, type ExpVal, type ExposureIndex, type InsurerMetrics } from "./exposure";

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

const insLine = (t: string, name: string, i: InsurerMetrics) => {
  const E = i.earned.v;
  const g = i.earnedPrior ? ` (${pct(E / i.earnedPrior.v - 1, 1)} vs FY ending ${i.earnedPrior.end})` : "";
  const parts = [
    `${t} ${name} · FY ending ${i.end} · premiums earned ${usd(E)}${g}`,
    i.written ? `written ${usd(i.written.v)}` : null,
    `loss & benefit ratio ${i.losses ? pct(i.losses.v / E, 1) : "n/a"}`,
    i.priorYear ? `prior-year reserve development ${usd(i.priorYear.v)} = ${pct(i.priorYear.v / E, 1)} of premiums (${i.priorYear.v > 0 ? "adverse: reserves added" : "favorable: reserves released"})` : null,
    i.acquisition ? `acquisition costs ${pct(i.acquisition.v / E, 1)} of premiums` : null,
    i.underwriting ? `underwriting income ${usd(i.underwriting.v)}` : null,
    i.reserves ? `loss reserves ${usd(i.reserves.v)} = ${(i.reserves.v / E).toFixed(2)}× premiums` : null,
    cite(t, i.earned),
  ];
  return parts.filter(Boolean).join(" · ");
};

export type InsurerSort = "premiums" | "growth" | "loss_ratio" | "reserve_development";
export function insurersText(index: ExposureIndex, names: Map<string, string>, industries: Map<string, string>, opts: { sort?: InsurerSort; limit?: number; others?: boolean } = {}): string {
  const by = opts.sort ?? "premiums";
  const v = (i: InsurerMetrics) =>
    by === "premiums" ? i.earned.v : by === "growth" ? (i.earnedPrior ? i.earned.v / i.earnedPrior.v - 1 : NaN) : by === "loss_ratio" ? (i.losses?.v ?? NaN) / i.earned.v : (i.priorYear?.v ?? NaN) / i.earned.v;
  const rows = Object.entries(index.companies)
    .filter(([t, c]) => c.insurer && (opts.others || isInsurerIndustry(industries.get(t))))
    .map(([t, c]) => ({ t, i: c.insurer!, x: v(c.insurer!) }))
    .filter((r) => Number.isFinite(r.x))
    .sort((a, b) => b.x - a.x);
  if (!rows.length) return "No insurer metrics stored yet.";
  const limit = opts.limit ?? 40;
  return `Insurers from their latest 10-K tags (sorted by ${by.replace("_", " ")}, highest first; ${rows.length} insurers). Ratios divide by net premiums earned (a health plan's premium revenue); prior-year development > 0 means reserves for earlier years were raised. Life and annuity writers (no premiums written or reserve development tagged) also pay benefits from investment income, so their ratio can pass 100% without an underwriting loss. n/a = not tagged or a different scope.\n${rows.slice(0, limit).map((r) => insLine(r.t, names.get(r.t) ?? "", r.i)).join("\n")}`;
}

export function companyExposureText(index: ExposureIndex, ticker: string, names: Map<string, string>): string {
  const c = index.companies[ticker];
  if (!c) return `${ticker} has no region breakdown, loan book or insurance figures in the exposure index (its 10-K may not tag them).`;
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
  if (c.insurer) out.push(`Insurance: ${insLine(ticker, names.get(ticker) ?? "", c.insurer)}`);
  return out.join("\n");
}

interface DepositRow {
  ticker: string;
  date: string | null;
  title: string;
  value: number | null;
  meta: Record<string, any>;
  source_url: string | null;
}

/** Covered banks' deposits in one state (FDIC Summary of Deposits), largest first, with share of the state and 1-year change. */
export function stateDepositsText(rows: DepositRow[], latest: string, state: string, names: Map<string, string>, limit = 40): string {
  const st = state.trim().toUpperCase();
  const now = rows.filter((r) => r.date === latest && r.meta?.state === st).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!now.length) return `No covered bank reports branch deposits in ${st} in the June ${latest.slice(0, 4)} FDIC survey. Use a two-letter state code.`;
  const prev = new Map(rows.filter((r) => r.date !== latest && r.meta?.state === st).map((r) => [r.ticker, r.value ?? 0]));
  const total = now[0].meta.state_total as number | undefined;
  const sum = now.reduce((n, r) => n + (r.value ?? 0), 0);
  const lines = now.slice(0, limit).map((r) => {
    const p = prev.get(r.ticker);
    const yr = !p ? "n/a" : p < (r.value ?? 0) * 0.05 ? `new to the state (was ${usd(p)})` : pct((r.value ?? 0) / p - 1, 1);
    return `${r.ticker} ${names.get(r.ticker) ?? ""} · ${usd(r.value ?? 0)} in ${r.meta.branches} branches · ${pct(r.meta.market_share, 1)} of the state's deposits · ${pct(r.meta.share, 1)} of the bank's · 1-yr ${yr} · ${r.source_url}`;
  });
  return `Deposits in ${st} held by covered banks, FDIC Summary of Deposits June 30 ${latest.slice(0, 4)} (all insured deposits in the state: ${total ? usd(total) : "n/a"}; covered banks together ${total ? pct(sum / total, 1) : "n/a"}). Branch deposits are booked where the account is kept, so online banks concentrate in their home state.\n${lines.join("\n")}`;
}

/** One bank's largest states and metros (latest survey). */
export function bankStatesText(rows: DepositRow[], ticker: string): string | null {
  const mine = rows.filter((r) => r.ticker === ticker);
  const latest = mine.map((r) => r.date ?? "").sort().at(-1);
  if (!latest) return null;
  const total = mine.find((r) => r.date === latest && !r.meta?.state);
  const states = mine.filter((r) => r.date === latest && r.meta?.state).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const metros = ((total?.meta?.metros ?? []) as { name: string; value: number; share: number }[]).slice(0, 6);
  return `Branch deposits June ${latest.slice(0, 4)} (FDIC): ${total ? usd(total.value ?? 0) : "n/a"} in ${states.length} states: ${states.slice(0, 8).map((r) => `${r.meta.state} ${pct(r.meta.share, 1)} of the bank (${pct(r.meta.market_share, 1)} of the state)`).join(", ")}${metros.length ? `; largest metros: ${metros.map((m) => `${m.name} ${pct(m.share, 0)}`).join(", ")}` : ""} · ${total?.source_url ?? ""}`;
}
