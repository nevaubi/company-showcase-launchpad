// Insurers side by side: premiums earned and their growth, premiums written, the loss and benefit ratio,
// prior-year reserve development, acquisition costs, underwriting income and reserves — every figure from
// the latest 10-K's tags, every ratio opening both of its parts.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { Switch } from "@/components/ui/switch";
import { useSource } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import { isInsurerIndustry, type ExpVal, type ExposureIndex, type InsurerMetrics } from "@/lib/xbrl/exposure";
import { useSessionState } from "@/lib/use-session-state";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Stat } from "./region-exposures";
import { fy, median, ratioTarget, valTarget } from "./open";

type Metric = "earned" | "growth" | "written" | "loss" | "dev" | "acq" | "uw" | "res";
interface Row {
  ticker: string;
  name: string;
  industry: string;
  i: InsurerMetrics;
  m: Partial<Record<Metric, number>>;
}

function metrics(i: InsurerMetrics): Row["m"] {
  const E = i.earned.v;
  return {
    earned: E,
    growth: i.earnedPrior ? E / i.earnedPrior.v - 1 : undefined,
    written: i.written?.v,
    loss: i.losses ? i.losses.v / E : undefined,
    dev: i.priorYear ? i.priorYear.v / E : undefined,
    acq: i.acquisition ? i.acquisition.v / E : undefined,
    uw: i.underwriting?.v,
    res: i.reserves ? i.reserves.v / E : undefined,
  };
}

/**
 * Kind of insurer. SIC codes lump every carrier into "insurance", so the filing decides: premiums
 * written or prior-year reserve development are property & casualty disclosures.
 */
const kindOf = (r: { industry: string; i: InsurerMetrics }) =>
  /managed health/i.test(r.industry) ? "health" : r.i.written || r.i.priorYear ? "pc" : "life";
type Kind = "all" | "pc" | "life" | "health";
const KINDS: { v: Kind; l: string; title: string }[] = [
  { v: "all", l: "All", title: "Every insurer" },
  { v: "pc", l: "Property & casualty", title: "Insurers that report premiums written or prior-year reserve development" },
  { v: "life", l: "Life & other", title: "Life, annuity, title, mortgage and other insurers" },
  { v: "health", l: "Health plans", title: "Managed health care" },
];

export function InsurerBooks({ index }: { index: ExposureIndex }) {
  const uni = useUniverse();
  const { open } = useSource();
  const [kind, setKind] = useSessionState<Kind>("fu:exposures:ins-kind", "all");
  const [others, setOthers] = useSessionState("fu:exposures:ins-others", false);
  const [sort, setSort] = useState<{ c: Metric | "t"; d: 1 | -1 }>({ c: "earned", d: -1 });
  const byTk = useMemo(() => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])), [uni.data]);

  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const [ticker, c] of Object.entries(index.companies)) {
      if (!c.insurer) continue;
      const industry = byTk.get(ticker)?.industry ?? "";
      if (!others && !isInsurerIndustry(industry)) continue;
      out.push({ ticker, name: byTk.get(ticker)?.name ?? ticker, industry, i: c.insurer, m: metrics(c.insurer) });
    }
    return out;
  }, [index, byTk, others]);
  const kinds = useMemo(() => KINDS.filter((k) => k.v === "all" || all.some((r) => kindOf(r) === k.v)), [all]);
  const rows = useMemo(() => {
    const out = all.filter((r) => kind === "all" || kindOf(r) === kind);
    return out.sort((a, b) => {
      if (sort.c === "t") return a.ticker.localeCompare(b.ticker) * sort.d;
      const va = a.m[sort.c];
      const vb = b.m[sort.c];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.d;
    });
  }, [all, kind, sort]);
  const nOthers = useMemo(() => Object.entries(index.companies).filter(([t, c]) => c.insurer && !isInsurerIndustry(byTk.get(t)?.industry)).length, [index, byTk]);
  const med = useMemo(() => Object.fromEntries((["growth", "loss", "dev", "acq", "res"] as Metric[]).map((k) => [k, median(rows.map((r) => r.m[k]).filter((x): x is number => x != null))])) as Record<Metric, number | null>, [rows]);
  const totalEarned = rows.reduce((n, r) => n + r.i.earned.v, 0);
  const released = rows.filter((r) => (r.m.dev ?? 0) < 0).length;
  const strengthened = rows.filter((r) => (r.m.dev ?? 0) > 0).length;

  const Th = ({ c, children, title }: { c: Metric | "t"; children: React.ReactNode; title?: string }) => (
    <th aria-sort={sort.c === c ? (sort.d === 1 ? "ascending" : "descending") : "none"} className="sticky top-0 z-20 border-b bg-card px-2.5 py-2 text-right align-bottom">
      <button type="button" title={title} onClick={() => setSort((s) => ({ c, d: s.c === c ? (-s.d as 1 | -1) : c === "t" ? 1 : -1 }))} className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground hover:text-foreground">
        {children}
        {sort.c === c && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
  const none = <td className="border-b px-2.5 py-1.5 text-right text-muted-foreground group-hover:bg-secondary">—</td>;
  const usdCell = (r: Row, label: string, v: ExpVal | undefined, signed = false) =>
    !v ? (
      none
    ) : (
      <td className="border-b px-2.5 py-1.5 text-right group-hover:bg-secondary">
        <button type="button" className={cn("num whitespace-nowrap tabular-nums hover:underline", signed && v.v < 0 && "text-negative")} onClick={() => open(valTarget(r.ticker, label, fy(r.i.end), v))}>
          {fmtCompactUsd(v.v)}
        </button>
      </td>
    );
  const pctCell = (r: Row, k: Metric, num: ExpVal | undefined, den: ExpVal | undefined, label: string, formula: string, opts: { signed?: boolean; digits?: number; tone?: (v: number) => string | false } = {}) => {
    const v = r.m[k];
    if (v == null || !num || !den) return none;
    return (
      <td className="border-b px-2.5 py-1.5 text-right group-hover:bg-secondary">
        <button type="button" className={cn("num whitespace-nowrap tabular-nums hover:underline", opts.tone?.(v))} onClick={() => open(ratioTarget(r.ticker, label, fy(r.i.end), num, den, formula, v))}>
          {fmtPct(v, opts.digits ?? 1, opts.signed)}
        </button>
      </td>
    );
  };

  return (
    <div className="mt-4 min-w-0" data-section="Insurers">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {kinds.length > 2 && <Segmented label="Kind of insurer" value={kinds.some((k) => k.v === kind) ? kind : "all"} onChange={setKind} options={kinds} />}
        <p className="text-[11px] text-muted-foreground">Latest fiscal year, from each insurer's 10-K.</p>
        {nOthers > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={others} onCheckedChange={setOthers} aria-label="Include other companies with premium revenue" /> Other companies with premiums ({nOthers})
          </label>
        )}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Stat label="Insurers" value={String(rows.length)} />
        <Stat label="Premiums earned, combined" value={fmtCompactUsd(totalEarned)} hint={med.growth != null ? `median growth ${fmtPct(med.growth, 1, true)}` : undefined} />
        <Stat label="Median loss & benefit ratio" value={fmtPct(med.loss, 1)} hint="losses and benefits ÷ premiums earned" />
        <Stat label="Prior-year reserves" value={`${released} released · ${strengthened} added`} hint={med.dev != null ? `median ${fmtPct(med.dev, 1, true)} of premiums` : undefined} />
      </div>
      {!rows.length ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No insurer of this kind has been read yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r bg-card px-3 py-2 text-left">
                    <button type="button" onClick={() => setSort((s) => ({ c: "t", d: s.c === "t" ? (-s.d as 1 | -1) : 1 }))} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Insurer
                    </button>
                  </th>
                  <Th c="earned" title="Net premiums earned (a health plan's premium revenue)">Premiums earned</Th>
                  <Th c="growth" title="Premiums earned vs the prior fiscal year">Growth</Th>
                  <Th c="written" title="Net premiums written">Written</Th>
                  <Th c="loss" title="Losses and benefits incurred ÷ premiums earned">Loss & benefit ratio</Th>
                  <Th c="dev" title="Prior-year reserve development ÷ premiums earned; + = reserves added (adverse), − = released">Prior-year dev.</Th>
                  <Th c="acq" title="Amortization of deferred acquisition costs ÷ premiums earned">Acquisition</Th>
                  <Th c="uw" title="Underwriting income as tagged">Underwriting</Th>
                  <Th c="res" title="Loss and loss-expense reserves ÷ premiums earned">Reserves ÷ prem.</Th>
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r bg-secondary/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">Median of {rows.length}</td>
                  <td className="border-b bg-secondary/60" />
                  <td className="num border-b bg-secondary/60 px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.growth, 1, true)}</td>
                  <td className="border-b bg-secondary/60" />
                  <td className="num border-b bg-secondary/60 px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.loss, 1)}</td>
                  <td className="num border-b bg-secondary/60 px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.dev, 1, true)}</td>
                  <td className="num border-b bg-secondary/60 px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{fmtPct(med.acq, 1)}</td>
                  <td className="border-b bg-secondary/60" />
                  <td className="num border-b bg-secondary/60 px-2.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{med.res != null ? `${med.res.toFixed(2)}×` : "—"}</td>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const i = r.i;
                  const since = i.earnedPrior ? fmtDate(i.earnedPrior.end, { month: "short", year: "numeric" }) : "";
                  return (
                    <tr key={r.ticker} className="group">
                      <td className="sticky left-0 z-10 max-w-52 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
                        <span className="flex items-center gap-2" title={r.industry}>
                          <CompanyLogo ticker={r.ticker} className="size-5" />
                          <Link to="/app/companies/$ticker/financials" params={{ ticker: r.ticker }} search={{ basis: "detail" }} className="num font-medium hover:underline">
                            {r.ticker}
                          </Link>
                          <span className="hidden truncate text-xs text-muted-foreground sm:inline" title={`${r.name} · fiscal year ended ${fmtDate(i.end)}`}>
                            {r.name}
                          </span>
                        </span>
                      </td>
                      {usdCell(r, "Net premiums earned", i.earned)}
                      {pctCell(r, "growth", i.earned, i.earnedPrior, `Premium growth since FY ending ${since}`, "Premiums earned ÷ prior-year premiums earned − 1", { signed: true, tone: (v) => v < 0 && "text-negative" })}
                      {usdCell(r, "Net premiums written", i.written)}
                      {pctCell(r, "loss", i.losses, i.earned, "Loss & benefit ratio", "Losses and benefits incurred ÷ premiums earned", { tone: (v) => v > 1 && kindOf(r) !== "life" && "text-negative" })}
                      {pctCell(r, "dev", i.priorYear, i.earned, "Prior-year reserve development ÷ premiums", "Prior-year reserve development ÷ premiums earned", { signed: true, tone: (v) => v > 0 && "text-negative" })}
                      {pctCell(r, "acq", i.acquisition, i.earned, "Acquisition cost ratio", "Acquisition cost amortization ÷ premiums earned")}
                      {usdCell(r, "Underwriting income", i.underwriting, true)}
                      {i.reserves && r.m.res != null ? (
                        <td className="border-b px-2.5 py-1.5 text-right group-hover:bg-secondary">
                          <button type="button" className="num whitespace-nowrap tabular-nums hover:underline" title={`Reserves ${fmtCompactUsd(i.reserves.v)}`} onClick={() => open({ ...ratioTarget(r.ticker, "Reserves ÷ premiums earned", fy(i.end), i.reserves!, i.earned, "Loss and loss-expense reserves ÷ premiums earned", r.m.res!), unit: "ratio" })}>
                            {r.m.res.toFixed(2)}×
                          </button>
                        </td>
                      ) : (
                        none
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        From each insurer's latest 10-K: the consolidated tags first, else the total of its segment note or Schedule III. Prior-year development is how much the estimate for earlier years' claims changed this year: positive (red) means reserves were added. Life and annuity writers also pay benefits out of investment income and reserve build-up, so their ratio can pass 100% without an underwriting loss. A figure far out of proportion to premiums is left blank because it describes a different scope.
      </p>
    </div>
  );
}
