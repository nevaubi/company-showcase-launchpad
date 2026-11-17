import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { useUnitScale } from "@/hooks/use-preference";
import { fmtCell, fmtDate, scaleCaption } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  cagrOf,
  changeOf,
  coverageOf,
  detailPeriodLabel,
  detailUnit,
  type ConcentrationRow,
  type DetailRow,
  type DetailTable,
  type DetailValue,
  type FilingDetail,
  type SegmentMatrix,
} from "@/lib/xbrl/detail";
import { filingDetailQuery, namedByQuery } from "@/lib/xbrl/queries";
import { annualWithHistory, historySpan } from "@/lib/xbrl/history";
import { hasMoneyMap, MoneyMap } from "@/components/financials/money-map";

type Section = "map" | "revenue" | "segments" | "lending" | "capital" | "concentration" | "geography" | "costs" | "commitments" | "inventory" | "other";
const SECTION_LABEL: Record<Section, string> = {
  map: "Money map",
  revenue: "Revenue mix",
  segments: "Segment P&L",
  lending: "Loans & deposits",
  capital: "Regulatory capital",
  concentration: "Concentration",
  geography: "Geography",
  costs: "Costs",
  commitments: "Commitments",
  inventory: "Inventory & assets",
  other: "Other detail",
};
const SECTION_HINT: Record<Section, string> = {
  map: "Where revenue comes from, which segments earn it and where it goes, built only from values tagged in the filing",
  revenue: "Revenue split by segment, product, channel and timing, as tagged in the filing",
  segments: "Every line the filing reports per segment: revenue, significant expenses, profit",
  lending: "The loan book by portfolio, class, industry and region, its allowance, charge-offs, nonaccrual loans, and deposits by type",
  capital: "Capital, risk-weighted assets and capital ratios by approach and legal entity, with the requirements the filing states",
  concentration: "Customers, suppliers and regions the filing says make up a large share of revenue, purchases or receivables",
  geography: "Revenue and long-lived assets by country, region or state",
  costs: "Costs split by product or geography",
  commitments: "Purchase obligations, backlog and other commitments by year due",
  inventory: "Inventory components and property by asset type",
  other: "Other business breakdowns tagged in the filing",
};

const fmtShare = (x: number) => `${(x * 100).toFixed(x >= 0.995 || x < 0.1 ? 1 : 0)}%`;

/** The dimensional detail behind the statements, from the latest 10-K and 10-Q, every value clickable to its tag. */
export function FilingDetailView({ ticker }: { ticker: string }) {
  const q = useQuery(filingDetailQuery(ticker));
  const [which, setWhich] = useState<"annual" | "quarterly">("annual");
  const [section, setSection] = useState<Section | null>(null);
  const [span, setSpan] = useState<"history" | "filing">("history");
  const source = useSource();

  // The latest 10-K extended back through the stored earlier 10-Ks (each column from the newest filing that reports it).
  const merged = useMemo(() => (q.data?.annual && q.data.history?.length ? annualWithHistory(q.data) : null), [q.data]);
  const base: FilingDetail | null = q.data ? (which === "quarterly" ? q.data.quarterly : q.data.annual) ?? q.data.annual ?? q.data.quarterly : null;
  const isAnnual = !!base && base === q.data?.annual;
  const d: FilingDetail | null = isAnnual && merged && span === "history" ? merged : base;
  const years = merged ? historySpan(merged) : null;
  const sections = useMemo(() => {
    if (!d) return [] as Section[];
    const has = new Set<Section>(d.tables.map((t) => t.family as Section));
    if (d.segments) has.add("segments");
    if (d.concentration.length) has.add("concentration");
    if (base && hasMoneyMap(base)) has.add("map");
    return (["map", "revenue", "segments", "lending", "capital", "concentration", "geography", "costs", "commitments", "inventory", "other"] as Section[]).filter((s) => has.has(s));
  }, [d, base]);

  if (q.isLoading) return <Skeleton className="h-[480px]" />;
  if (q.isError) return <Empty text="Filing detail could not be loaded. Refresh to try again." />;
  if (!q.data || !d || !base) return <Empty text={`Filing detail for ${ticker} has not been read yet. It is built from the latest 10-K and 10-Q and refreshes as new filings arrive.`} />;

  const active: Section = section && sections.includes(section) ? section : (sections[0] ?? "revenue");
  const tables = d.tables.filter((t) => t.family === active);
  const filings = [q.data.annual, q.data.quarterly].filter(Boolean) as FilingDetail[];

  return (
    <div className="grid grid-cols-1 gap-3" data-section="Filing detail">
      <div className="flex flex-wrap items-center gap-2">
        {filings.length > 1 && (
          <Segmented
            label="Filing"
            value={isAnnual ? "annual" : "quarterly"}
            onChange={(v) => setWhich(v)}
            options={filings.map((f) => ({ v: f === q.data!.quarterly ? ("quarterly" as const) : ("annual" as const), l: `${f.form} · ${fmtDate(f.reportDate)}`, title: `Filed ${fmtDate(f.filed)}` }))}
          />
        )}
        {isAnnual && merged && years && (
          <Segmented
            label="Years"
            value={span}
            onChange={setSpan}
            options={[
              { v: "history" as const, l: years, title: `Earlier years from the ${q.data.history!.length} prior 10-K${q.data.history!.length > 1 ? "s" : ""}; each column comes from the newest filing that reports it` },
              { v: "filing" as const, l: "This 10-K only", title: "Only the years reported in the latest 10-K" },
            ]}
          />
        )}
        <span className="text-[11px] text-muted-foreground">
          {d.form} for the period ended {fmtDate(d.reportDate)}, filed {fmtDate(d.filed)}
          {d === merged ? ` · earlier years from ${q.data.history!.map((h) => `the FY${h.reportDate.slice(0, 4)} 10-K`).join(" and ")}` : ` · ${d.counts.dimensional.toLocaleString()} tagged breakdown values`}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto gap-1 text-[11px]"
          onClick={() => source.open({ ticker, label: `${d.form} filing`, unit: "usd", value: 0, doc: { accn: d.accn, doc: d.doc, form: d.form, filed: d.filed } })}
        >
          <FileText className="size-3.5" /> Open filing
        </Button>
      </div>
      {sections.length > 0 ? (
        <Segmented label="Detail section" value={active} onChange={setSection} options={sections.map((s) => ({ v: s, l: SECTION_LABEL[s], title: SECTION_HINT[s] }))} />
      ) : (
        <Empty text={`${ticker}'s ${d.form} tags no business breakdowns beyond the statements themselves.`} />
      )}
      <p className="text-[11px] text-muted-foreground">{SECTION_HINT[active]}. Click any number to see it highlighted in the filing.</p>
      {active === "map" ? (
        <MoneyMap d={base} ticker={ticker} />
      ) : active === "segments" && d.segments ? (
        <SegmentPnl m={d.segments} d={d} ticker={ticker} />
      ) : active === "concentration" ? (
        <Concentration rows={d.concentration} d={d} ticker={ticker} />
      ) : (
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {tables.map((t) => (
            <DetailCard key={t.id} t={t} d={d} ticker={ticker} />
          ))}
        </div>
      )}
      {active === "concentration" && <NamedBy ticker={ticker} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{text}</p>;
}

/** Click handler that opens one tagged value in the filing viewer. */
function useOpen(ticker: string, d: FilingDetail) {
  const source = useSource();
  return (label: string, periodKey: string, v: DetailValue, concept: string, unit: string) => {
    const p = d.periods[periodKey];
    source.open({
      ticker,
      label,
      periodLabel: detailPeriodLabel(p),
      unit: detailUnit(unit),
      value: v.v,
      // values carried in from an earlier 10-K open that filing
      src: { accn: v.accn ?? d.accn, doc: v.doc ?? d.doc, concept, start: p?.start, end: p?.end ?? d.reportDate, value: v.v },
      elementId: v.id,
    });
  };
}

function fmtValue(v: number, unit: string, scale: ReturnType<typeof useUnitScale>[0]) {
  const u = detailUnit(unit);
  if (u === "count") return Math.round(v).toLocaleString();
  return fmtCell(v, u, scale);
}
const unitCaption = (unit: string, scale: ReturnType<typeof useUnitScale>[0]) => {
  const u = detailUnit(unit);
  return u === "usd" ? scaleCaption(scale) : u === "pct" ? "percent" : u === "shares" ? "shares" : u === "usdPerShare" ? "dollars per share" : unit.replace(/^.*:/, "").toLowerCase();
};

function ValueCell({ v, onOpen, text, className }: { v: DetailValue | undefined; onOpen?: () => void; text: string; className?: string }) {
  if (!v) return <td className={cn("num border-b px-3 py-1 text-right text-muted-foreground/40", className)}>—</td>;
  return (
    <td className={cn("border-b p-0", className)}>
      <button type="button" onClick={onOpen} className="num block w-full px-3 py-1 text-right hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none" title="Show in filing">
        {text}
      </button>
    </td>
  );
}

/** Signed growth rate cell ("+12.4%"), muted dash when it can't be computed. */
function GrowthCell({ rate, title, className }: { rate: number | null; title?: string; className?: string }) {
  return (
    <td className={cn("num border-b px-3 py-1 text-right text-[12px]", rate == null ? "text-muted-foreground/40" : rate >= 0 ? "text-positive" : "text-negative", className)} title={title}>
      {rate == null ? "—" : `${rate >= 0 ? "+" : "−"}${Math.abs(rate * 100).toFixed(1)}%`}
    </td>
  );
}

function DetailCard({ t, d, ticker }: { t: DetailTable; d: FilingDetail; ticker: string }) {
  const [scale] = useUnitScale();
  // A table wider than the screen opens with the latest year next to the pinned labels, followed by its growth and share.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const label = el.querySelector<HTMLElement>("thead th");
    const last = el.querySelector<HTMLElement>("thead th[data-latest]");
    if (label && last) el.scrollLeft = last.offsetLeft - label.offsetWidth;
  }, [t.periods.length]);
  const open = useOpen(ticker, d);
  const latest = t.periods[t.periods.length - 1];
  const money = detailUnit(t.unit) === "usd";
  const cov = coverageOf(t);
  const sumLatest = t.rows.reduce((n, r) => n + Math.abs(r.values[latest]?.v ?? r.sub?.reduce((m, s) => m + Math.abs(s.values[latest]?.v ?? 0), 0) ?? 0), 0);
  const denom = Math.abs(t.total?.[latest]?.v ?? 0) || sumLatest;
  const showShare = money && !t.overlap && t.rows.length >= 2 && denom > 0 && !d.periods[latest]?.label;
  const hasChange = t.periods.filter((k) => !d.periods[k]?.label).length >= 2;
  // Compound growth only once the table spans more fiscal years than a single 10-K reports.
  const hasCagr = detailUnit(t.unit) !== "pct" && t.periods.filter((k) => (d.periods[k]?.months === 12 || d.periods[k]?.months === 0) && !d.periods[k].label).length >= 4;
  const extra = (hasChange ? 1 : 0) + (hasCagr ? 1 : 0) + (showShare ? 1 : 0);
  const rowFor = (r: DetailRow, depth: number, parent = "") => {
    const val = r.values[latest]?.v;
    const share = showShare && val !== undefined ? Math.abs(val) / denom : null;
    const ch = hasChange ? changeOf(t, r.values, d.periods) : null;
    const g = hasCagr ? cagrOf(t, r.values, d.periods) : null;
    // A parent with only nested values is a group heading.
    if (!depth && r.sub?.length && !Object.keys(r.values).length)
      return (
        <tr key={`${parent}/${r.member}`}>
          <th scope="row" colSpan={t.periods.length + 1 + extra} className="border-b px-3 pb-1 pt-2 text-left text-[12px] font-semibold" title={r.member}>
            {r.label}
          </th>
        </tr>
      );
    return (
      <tr key={`${parent}/${r.member}`} className="group">
        <th
          scope="row"
          className={cn("sticky left-0 z-10 min-w-40 max-w-72 border-b bg-card px-3 py-1 text-left font-normal group-hover:bg-secondary", depth || r.former ? "text-muted-foreground" : "", depth ? "pl-7" : "")}
          title={r.former ? `${r.label} — reported only in earlier filings (renamed, merged or no longer broken out)` : r.member}
        >
          <span className="line-clamp-2">{r.label}</span>
        </th>
        {t.periods.map((k) => (
          <ValueCell key={k} v={r.values[k]} text={r.values[k] ? fmtValue(r.values[k].v, t.unit, scale) : ""} onOpen={() => open(`${r.label} — ${t.conceptLabel || r.label}`, k, r.values[k], t.concept || r.member, t.unit)} />
        ))}
        {hasChange && <GrowthCell rate={ch} />}
        {hasCagr && <GrowthCell rate={g?.rate ?? null} title={g ? `${detailPeriodLabel(d.periods[g.from])} to ${detailPeriodLabel(d.periods[g.to])}, ${g.years} years compounded` : "Needs a positive value at least three years apart"} />}
        {showShare && (
          <td className="border-b px-3 py-1">
            {share != null && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                  <div className={cn("h-full rounded-full", depth ? "bg-muted-foreground/50" : "bg-foreground/70")} style={{ width: `${Math.min(100, share * 100)}%` }} />
                </div>
                <span className="num w-10 text-right text-[11px] text-muted-foreground">{fmtShare(share)}</span>
              </div>
            )}
          </td>
        )}
      </tr>
    );
  };
  return (
    <Panel
      className="min-w-0 rounded-lg border"
      title={t.title}
      subtitle={`${unitCaption(t.unit, scale)}${t.overlap ? " · lines as tagged; some include others" : cov != null && (cov < 0.97 || cov > 1.03) ? ` · listed items explain ${fmtShare(cov)} of the consolidated total` : cov != null ? " · items add up to the consolidated total" : ""}`}
      bodyClassName="p-0"
      collapse={520}
    >
      <div ref={scroller} className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b bg-card px-3 py-1.5 text-left text-[11px] font-normal text-muted-foreground">{t.axisLabel}</th>
              {t.periods.map((k) => (
                <th key={k} data-latest={k === latest ? "" : undefined} className="num whitespace-nowrap border-b px-3 py-1.5 text-right text-[11px] font-semibold">
                  {detailPeriodLabel(d.periods[k])}
                </th>
              ))}
              {hasChange && (
                <th className="whitespace-nowrap border-b px-3 py-1.5 text-right text-[11px] font-normal text-muted-foreground" title="Latest period against the one before it">
                  Change
                </th>
              )}
              {hasCagr && (
                <th className="whitespace-nowrap border-b px-3 py-1.5 text-right text-[11px] font-normal text-muted-foreground" title="Compound annual growth from the first to the latest year the row reports">
                  CAGR
                </th>
              )}
              {showShare && <th className="whitespace-nowrap border-b px-3 py-1.5 text-left text-[11px] font-normal text-muted-foreground">Share</th>}
            </tr>
          </thead>
          <tbody>
            {t.rows.flatMap((r) => [rowFor(r, 0), ...(r.sub ?? []).map((s) => rowFor(s, 1, r.member))])}
            {t.total && Object.keys(t.total).length > 0 && (
              <tr className="font-medium">
                <th scope="row" className="sticky left-0 z-10 border-t-2 border-t-foreground/70 bg-card px-3 py-1 text-left">Consolidated total</th>
                {t.periods.map((k) => (
                  <ValueCell key={k} className="border-t-2 border-t-foreground/70" v={t.total![k]} text={t.total![k] ? fmtValue(t.total![k].v, t.unit, scale) : ""} onOpen={() => open(`${t.conceptLabel} — total`, k, t.total![k], t.concept, t.unit)} />
                ))}
                {hasChange && <GrowthCell className="border-t-2 border-t-foreground/70" rate={changeOf(t, t.total, d.periods)} />}
                {hasCagr && (() => {
                  const g = cagrOf(t, t.total!, d.periods);
                  return <GrowthCell className="border-t-2 border-t-foreground/70" rate={g?.rate ?? null} title={g ? `${detailPeriodLabel(d.periods[g.from])} to ${detailPeriodLabel(d.periods[g.to])}, ${g.years} years compounded` : undefined} />;
                })()}
                {showShare && <td className="border-t-2 border-t-foreground/70" />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const KIND_HEAD: Record<SegmentMatrix["rows"][number]["kind"], string> = { revenue: "Revenue", cost: "Costs and expenses", profit: "Profit", other: "Other" };

function SegmentPnl({ m, d, ticker }: { m: SegmentMatrix; d: FilingDetail; ticker: string }) {
  const [scale] = useUnitScale();
  const open = useOpen(ticker, d);
  const source = useSource();
  const [pk, setPk] = useState(m.periods[m.periods.length - 1]);
  const period = m.periods.includes(pk) ? pk : m.periods[m.periods.length - 1];
  const revenue = m.rows.find((r) => r.kind === "revenue");
  const profits = m.rows.filter((r) => r.kind === "profit");
  const profit = profits.find((r) => /OperatingIncomeLoss$/.test(r.concept)) ?? profits.find((r) => /SegmentProfit|OperatingProfit|Ebitda/i.test(r.concept)) ?? profits[0];
  const totalRev = revenue ? m.segments.reduce((n, s) => n + Math.max(0, revenue.values[s.member]?.[period]?.v ?? 0), 0) : 0;
  const segs = m.segments.filter((s) => m.rows.some((r) => r.values[s.member]?.[period]));
  let lastKind = "";
  return (
    <Panel
      className="min-w-0 rounded-lg border"
      title="Segment P&L"
      subtitle={`${scaleCaption(scale)} · each column is one reportable segment as tagged in the filing`}
      bodyClassName="p-0"
      collapse={false}
      actions={m.periods.length > 1 ? <Segmented size="xs" label="Period" value={period} onChange={setPk} options={m.periods.map((k) => ({ v: k, l: detailPeriodLabel(d.periods[k]) }))} /> : undefined}
    >
      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-56 border-b bg-card px-3 py-1.5 text-left text-[11px] font-normal text-muted-foreground">Line</th>
              {segs.map((s) => {
                const share = revenue && totalRev > 0 ? (revenue.values[s.member]?.[period]?.v ?? 0) / totalRev : null;
                return (
                  <th key={s.member} className="min-w-28 border-b px-3 py-1.5 text-right align-bottom text-[11px] font-semibold" title={s.member}>
                    <span className="line-clamp-2">{s.label}</span>
                    {share != null && share > 0 && (
                      <span className="mt-1 flex items-center justify-end gap-1.5 font-normal text-muted-foreground">
                        <span className="h-1 w-10 overflow-hidden rounded-full bg-secondary">
                          <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, share * 100)}%` }} />
                        </span>
                        {fmtShare(share)}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => {
              const head = r.kind !== lastKind ? KIND_HEAD[r.kind] : null;
              lastKind = r.kind;
              return [
                head && (
                  <tr key={`h-${r.kind}`}>
                    <th colSpan={segs.length + 1} className="sticky left-0 border-b bg-secondary/40 px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {head}
                    </th>
                  </tr>
                ),
                <tr key={r.concept} className="group">
                  <th scope="row" className="sticky left-0 z-10 max-w-80 border-b bg-card px-3 py-1 text-left font-normal group-hover:bg-secondary" title={r.concept}>
                    <span className="line-clamp-2">{r.label}</span>
                  </th>
                  {segs.map((s) => {
                    const v = r.values[s.member]?.[period];
                    return <ValueCell key={s.member} v={v} text={v ? fmtCell(v.v, "usd", scale) : ""} onOpen={() => v && open(`${s.label} — ${r.label}`, period, v, r.concept, "USD")} />;
                  })}
                </tr>,
              ];
            })}
            {revenue && profit && (
              <tr className="font-medium">
                <th scope="row" className="sticky left-0 z-10 border-t-2 border-t-foreground/70 bg-card px-3 py-1 text-left" title={`${profit.label} ÷ ${revenue.label}`}>
                  Margin <span className="text-[11px] font-normal text-muted-foreground">· {profit.label.toLowerCase()} ÷ revenue</span>
                </th>
                {segs.map((s) => {
                  const rv = revenue.values[s.member]?.[period];
                  const pv = profit.values[s.member]?.[period];
                  if (!rv || !pv || !rv.v) return <td key={s.member} className="num border-t-2 border-t-foreground/70 px-3 py-1 text-right text-muted-foreground/40">—</td>;
                  const p = d.periods[period];
                  const part = (v: DetailValue, concept: string, label: string, sign: 1 | -1) => ({ accn: v.accn ?? d.accn, doc: v.doc ?? d.doc, concept, start: p?.start, end: p?.end ?? d.reportDate, value: v.v, label, sign });
                  return (
                    <td key={s.member} className="border-t-2 border-t-foreground/70 p-0">
                      <button
                        type="button"
                        className="num block w-full px-3 py-1 text-right hover:bg-secondary"
                        onClick={() =>
                          source.open({
                            ticker,
                            label: `${s.label} — ${profit.label} margin`,
                            periodLabel: detailPeriodLabel(p),
                            unit: "pct",
                            value: pv.v / rv.v,
                            derived: { formula: `${profit.label} ÷ ${revenue.label}`, parts: [part(pv, profit.concept, profit.label, 1), part(rv, revenue.concept, revenue.label, 1)] },
                          })
                        }
                      >
                        {fmtCell(pv.v / rv.v, "pct")}
                      </button>
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const CONC_HEAD: Record<ConcentrationRow["kind"], string> = { customer: "Customers", supplier: "Suppliers", geographic: "Regions", product: "Products", credit: "Credit exposure", other: "Other" };
const BENCH: Record<ConcentrationRow["benchmark"], string> = { revenue: "share of revenue", receivables: "share of receivables", purchases: "share of purchases", other: "share" };

function Concentration({ rows, d, ticker }: { rows: ConcentrationRow[]; d: FilingDetail; ticker: string }) {
  const open = useOpen(ticker, d);
  const groups = new Map<string, ConcentrationRow[]>();
  for (const r of rows) {
    const k = `${r.kind}|${r.benchmark}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  if (!rows.length) return <Empty text="This filing tags no customer, supplier or regional concentration." />;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {[...groups.entries()].map(([k, rs]) => {
        const keys = [...new Set(rs.flatMap((r) => Object.keys(r.values)))].sort((a, b) => (d.periods[a]?.end ?? "").localeCompare(d.periods[b]?.end ?? "")).slice(-7);
        const latest = keys[keys.length - 1];
        const head = `${CONC_HEAD[rs[0].kind]} · ${rs[0].benchmarkLabel && rs[0].benchmark === "other" ? rs[0].benchmarkLabel.toLowerCase() : BENCH[rs[0].benchmark]}`;
        return (
          <Panel key={k} className="min-w-0 rounded-lg border" title={head} subtitle={rs[0].kind === "customer" ? "Filings often keep customers anonymous (\u201cCustomer A\u201d); names appear only when the filing gives them" : undefined} bodyClassName="p-0" collapse={420}>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="border-b px-3 py-1.5 text-left text-[11px] font-normal text-muted-foreground">Item</th>
                    {keys.map((p) => (
                      <th key={p} className="num whitespace-nowrap border-b px-3 py-1.5 text-right text-[11px] font-semibold">
                        {detailPeriodLabel(d.periods[p])}
                      </th>
                    ))}
                    <th className="border-b px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.member} className="group">
                      <th scope="row" className="max-w-64 border-b px-3 py-1 text-left font-normal group-hover:bg-secondary/60" title={r.member}>
                        <span className="line-clamp-2">{r.label}</span>
                      </th>
                      {keys.map((p) => (
                        <ValueCell key={p} v={r.values[p]} text={r.values[p] ? fmtShare(r.values[p].v) : ""} onOpen={() => open(`${r.label} — ${head}`, p, r.values[p], "us-gaap:ConcentrationRiskPercentage1", "pure")} />
                      ))}
                      <td className="border-b px-3 py-1">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, (r.values[latest]?.v ?? 0) * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

/** Covered companies whose own filings name this company as a major customer or supplier. */
function NamedBy({ ticker }: { ticker: string }) {
  const q = useQuery(namedByQuery(ticker));
  const source = useSource();
  if (!q.data?.length) return null;
  return (
    <Panel className="min-w-0 rounded-lg border" title={`Named in other companies' filings`} subtitle={`Covered companies that report ${ticker} as a concentrated customer or supplier`} bodyClassName="p-0" collapse={360}>
      <ul className="divide-y text-[13px]">
        {q.data.map((r) => (
          <li key={`${r.ticker}-${r.kind}-${r.benchmark}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
            <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }} className="font-semibold hover:underline">
              {r.ticker}
            </Link>
            <span className="text-muted-foreground">
              reports {r.label} as a {r.kind} at {BENCH[r.benchmark as ConcentrationRow["benchmark"]] ?? "share"}
            </span>
            <button
              type="button"
              className="num ml-auto rounded px-1.5 py-0.5 font-semibold hover:bg-secondary"
              title="Show in filing"
              onClick={() =>
                source.open({ ticker: r.ticker, label: `${r.ticker}: ${r.label} as ${r.kind}`, periodLabel: fmtDate(r.period_end), unit: "pct", value: Number(r.pct), src: { accn: r.accn, concept: "us-gaap:ConcentrationRiskPercentage1", end: r.period_end, value: Number(r.pct) }, elementId: r.element_id ?? undefined })
              }
            >
              {fmtShare(Number(r.pct))}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {r.form} · {fmtDate(r.period_end)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
