import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { coverageOf } from "@/lib/coverage";
import { Segmented } from "@/components/app/segmented";
import { Switch } from "@/components/ui/switch";
import { useSource } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import { isLenderIndustry, type BankMetrics, type ExpVal, type ExposureIndex } from "@/lib/xbrl/exposure";
import { useSessionState } from "@/lib/use-session-state";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Stat } from "./region-exposures";
import { fy, median, ratioTarget, valTarget } from "./open";

type Size = "all" | "large" | "mid" | "small";
type Metric = "loans" | "loanG" | "deposits" | "depG" | "ltd" | "nco" | "acl" | "npl";
interface Row {
  ticker: string;
  name: string;
  b: BankMetrics;
  m: Partial<Record<Metric, number>>;
}

const SIZES: { v: Size; l: string; title: string }[] = [
  { v: "all", l: "All" },
  { v: "large", l: "$100B+", title: "Loans of $100 billion or more" },
  { v: "mid", l: "$10–100B", title: "Loans between $10 and $100 billion" },
  { v: "small", l: "Under $10B", title: "Loans under $10 billion" },
].map((x) => ({ title: x.l, ...x }) as { v: Size; l: string; title: string });

/** Credit metrics where a higher reading is worse; the top fifth of the lenders shown is marked. */
const WORSE_HIGH: Metric[] = ["nco", "acl", "npl"];

function metrics(b: BankMetrics): Row["m"] {
  const L = b.loans.v;
  return {
    loans: L,
    loanG: b.loansPrior ? L / b.loansPrior.v - 1 : undefined,
    deposits: b.deposits?.v,
    depG: b.deposits && b.depositsPrior ? b.deposits.v / b.depositsPrior.v - 1 : undefined,
    ltd: b.deposits ? L / b.deposits.v : undefined,
    nco: b.nco ? b.nco.v / L : undefined,
    acl: b.allowance ? b.allowance.v / L : undefined,
    npl: b.nonaccrual ? b.nonaccrual.v / L : undefined,
  };
}

export function BankBooks({ index }: { index: ExposureIndex }) {
  const uni = useUniverse();
  const { open } = useSource();
  const [size, setSize] = useSessionState<Size>("fu:exposures:size", "all");
  const [sort, setSort] = useState<{ c: Metric | "t"; d: 1 | -1 }>({ c: "loans", d: -1 });
  const [others, setOthers] = useSessionState("fu:exposures:others", false);
  const byTk = useMemo(() => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])), [uni.data]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const [ticker, c] of Object.entries(index.companies)) {
      if (!c.bank) continue;
      if (!others && !isLenderIndustry(byTk.get(ticker)?.industry)) continue;
      const L = c.bank.loans.v;
      if (size === "large" ? L < 1e11 : size === "mid" ? L < 1e10 || L >= 1e11 : size === "small" ? L >= 1e10 : false) continue;
      out.push({ ticker, name: byTk.get(ticker)?.name ?? ticker, b: c.bank, m: metrics(c.bank) });
    }
    return out.sort((a, b) => {
      if (sort.c === "t") return a.ticker.localeCompare(b.ticker) * sort.d;
      const va = a.m[sort.c];
      const vb = b.m[sort.c];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.d;
    });
  }, [index, byTk, size, sort, others]);
  const nOthers = useMemo(() => Object.entries(index.companies).filter(([t, c]) => c.bank && !isLenderIndustry(byTk.get(t)?.industry)).length, [index, byTk]);

  const med = useMemo(() => Object.fromEntries((["loanG", "depG", "ltd", "nco", "acl", "npl"] as Metric[]).map((k) => [k, median(rows.map((r) => r.m[k]).filter((x): x is number => x != null))])) as Record<Metric, number | null>, [rows]);
  const cut = useMemo(() => {
    const q: Partial<Record<Metric, number>> = {};
    for (const k of WORSE_HIGH) {
      const s = rows.map((r) => r.m[k]).filter((x): x is number => x != null).sort((a, b) => a - b);
      if (s.length >= 5) q[k] = s[Math.floor(s.length * 0.8)];
    }
    return q;
  }, [rows]);
  const totalLoans = rows.reduce((n, r) => n + r.b.loans.v, 0);
  const totalDeposits = rows.reduce((n, r) => n + (r.b.deposits?.v ?? 0), 0);

  const Th = ({ c, children, title, className }: { c: Metric | "t"; children: React.ReactNode; title?: string; className?: string }) => (
    <th aria-sort={sort.c === c ? (sort.d === 1 ? "ascending" : "descending") : "none"} className={cn("sticky top-0 z-20 border-b bg-card px-3 py-2 text-right align-bottom", className)}>
      <button type="button" title={title} onClick={() => setSort((s) => ({ c, d: s.c === c ? (-s.d as 1 | -1) : c === "t" ? 1 : -1 }))} className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground hover:text-foreground">
        {children}
        {sort.c === c && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  const pctCell = (r: Row, k: Metric, num: ExpVal | undefined, den: ExpVal | undefined, label: string, formula: string, period: string, signed = false) => {
    const v = r.m[k];
    if (v == null || !num || !den) return <td className="border-b px-3 py-1 text-right text-muted-foreground group-hover:bg-secondary">–</td>;
    const bad = WORSE_HIGH.includes(k) && cut[k] != null && v >= cut[k]!;
    return (
      <td className="border-b px-3 py-1 text-right group-hover:bg-secondary">
        <button type="button" className={cn("num whitespace-nowrap tabular-nums hover:underline", bad && "text-negative", signed && v < 0 && "text-negative")} onClick={() => open(ratioTarget(r.ticker, label, period, num, den, formula, v))}>
          {fmtPct(v, k === "ltd" ? 0 : signed ? 1 : 2, signed)}
        </button>
      </td>
    );
  };

  return (
    <div className="mt-4 min-w-0" data-section="Banks and lenders">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Lender size" value={size} onChange={setSize} options={SIZES} />
        <p className="text-[11px] text-muted-foreground">By loans at the latest fiscal year-end.</p>
        {nOthers > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch checked={others} onCheckedChange={setOthers} aria-label="Include other companies with loan books" /> Other companies with loan books ({nOthers})
          </label>
        )}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4">
        <Stat label="Lenders" value={String(rows.length)} />
        <Stat label="Loans, combined" value={fmtCompactUsd(totalLoans)} hint={`deposits ${fmtCompactUsd(totalDeposits)}`} />
        <Stat label="Median net charge-off rate" value={fmtPct(med.nco, 2)} />
        <Stat label="Median allowance ÷ loans" value={fmtPct(med.acl, 2)} hint={med.npl != null ? `nonaccrual ${fmtPct(med.npl, 2)} of loans` : undefined} />
      </div>
      {!rows.length ? (
        <p className="rounded-md border bg-card p-6 text-sm text-muted-foreground">No lender of this size yet.</p>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-paper">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[880px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r bg-card px-3 py-2 text-left">
                    <button type="button" onClick={() => setSort((s) => ({ c: "t", d: s.c === "t" ? (-s.d as 1 | -1) : 1 }))} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Lender
                    </button>
                  </th>
                  <Th c="loans">Loans</Th>
                  <Th c="loanG" title="Loans vs the prior fiscal year-end">Loan growth</Th>
                  <Th c="deposits">Deposits</Th>
                  <Th c="depG" title="Deposits vs the prior fiscal year-end">Dep. growth</Th>
                  <Th c="ltd" title="Loans ÷ deposits">Loans ÷ dep.</Th>
                  <Th c="nco" title="Net charge-offs over the fiscal year ÷ year-end loans">Charge-offs</Th>
                  <Th c="acl" title="Allowance for loan losses ÷ loans">Allowance</Th>
                  <Th c="npl" title="Nonaccrual loans ÷ loans">Nonaccrual</Th>
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r bg-secondary/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">Median of {rows.length}</td>
                  <td className="border-b bg-secondary/60" />
                  <td className="num border-b bg-secondary/60 px-3 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.loanG, 1, true)}</td>
                  <td className="border-b bg-secondary/60" />
                  <td className="num border-b bg-secondary/60 px-3 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.depG, 1, true)}</td>
                  <td className="num border-b bg-secondary/60 px-3 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.ltd, 0)}</td>
                  <td className="num border-b bg-secondary/60 px-3 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.nco, 2)}</td>
                  <td className="num border-b bg-secondary/60 px-3 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.acl, 2)}</td>
                  <td className="num border-b bg-secondary/60 px-3 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.npl, 2)}</td>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.b;
                  const p = fy(b.end);
                  const prev = (x?: { end: string }) => (x ? fmtDate(x.end, { month: "short", year: "numeric" }) : "");
                  return (
                    <tr key={r.ticker} className="group">
                      <td className="sticky left-0 z-10 max-w-52 border-b border-r bg-card px-3 py-1 group-hover:bg-secondary">
                        <span className="flex items-center gap-2" title={byTk.get(r.ticker)?.industry}>
                          <CompanyLogo ticker={r.ticker} className="size-5" />
                          <Link to="/app/companies/$ticker/financials" params={{ ticker: r.ticker }} search={{ basis: "detail" }} className="num font-medium hover:underline">
                            {r.ticker}
                          </Link>
                          <span className="hidden truncate text-[13px] text-muted-foreground sm:inline" title={`${r.name} · year-end ${fmtDate(b.end)}`}>
                            {coverageOf(r.ticker)?.shortName ?? r.name}
                          </span>
                        </span>
                      </td>
                      <td className="border-b px-3 py-1 text-right group-hover:bg-secondary">
                        <button type="button" className="num whitespace-nowrap tabular-nums hover:underline" onClick={() => open(valTarget(r.ticker, "Loans", p, b.loans))}>
                          {fmtCompactUsd(b.loans.v)}
                        </button>
                      </td>
                      {pctCell(r, "loanG", b.loans, b.loansPrior, `Loan growth since ${prev(b.loansPrior)}`, "Loans ÷ prior year-end loans − 1", p, true)}
                      <td className="border-b px-3 py-1 text-right group-hover:bg-secondary">
                        {b.deposits ? (
                          <button type="button" className="num whitespace-nowrap tabular-nums hover:underline" onClick={() => open(valTarget(r.ticker, "Total deposits", p, b.deposits!))}>
                            {fmtCompactUsd(b.deposits.v)}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                      {pctCell(r, "depG", b.deposits, b.depositsPrior, `Deposit growth since ${prev(b.depositsPrior)}`, "Deposits ÷ prior year-end deposits − 1", p, true)}
                      {pctCell(r, "ltd", b.loans, b.deposits, "Loans ÷ deposits", "Loans ÷ total deposits", p)}
                      {pctCell(r, "nco", b.nco, b.loans, "Net charge-off rate", "Net charge-offs ÷ year-end loans", p)}
                      {pctCell(r, "acl", b.allowance, b.loans, "Allowance ÷ loans", "Allowance for loan losses ÷ loans", p)}
                      {pctCell(r, "npl", b.nonaccrual, b.loans, "Nonaccrual ÷ loans", "Nonaccrual loans ÷ loans", p)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        From each lender's latest 10-K: the consolidated tags first, else the loan note's total, else its portfolio segments added up. A ratio is left blank when its two figures don't describe the same book. Red marks the top fifth of the lenders shown on a credit-loss measure.
      </p>
    </div>
  );
}
