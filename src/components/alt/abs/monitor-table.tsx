// The deal monitor: one row per deal of one family, figures of the deal's newest current monthly file.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { END_LABEL, FAMILY_LABEL } from "@/lib/abs/view/codes";
import { definitionOf, metricDefinition, type Definition } from "@/lib/abs/view/definitions";
import { count, day, fixed, monthYear, pct, pctSign, points, usdFull, usdK, usdM, asFiled } from "@/lib/abs/view/format";
import type { Figure } from "@/lib/abs/view/figures";
import {
  filterRows,
  isDefaultSort,
  nextSort,
  parseSort,
  sortRows,
  sortText,
  type MonitorModel,
  type MonitorRow,
  type SortKey,
} from "@/lib/abs/view/monitor";
import type { AbsFamily, Share } from "@/lib/abs/view/types";
import { STAGE_LABEL } from "@/lib/abs/view/stage";
import { Spark } from "./charts";
import { Help, Note, SortHead, Tag, Traced, type Trace } from "./ui";

type Col = {
  key: SortKey;
  head: string;
  def: Definition | null;
  className?: string;
  /** the trend sparkline: not sortable, drawn instead of a figure */
  trend?: boolean;
};

const def = (key: string, family: AbsFamily) => definitionOf(key, family);

function columns(family: AbsFamily): Col[] {
  const end = family === "cmbs" ? "sched_end_balance" : family === "auto_loan" ? "end_balance" : "end_securitization_value";
  if (family === "cmbs")
    return [
      { key: "period", head: "Period", def: null, className: "w-[104px]" },
      { key: "loans", head: "Loans", def: metricDefinition("loans"), className: "w-[60px]" },
      { key: "end", head: "Sched. end $M", def: metricDefinition("sched_end_balance"), className: "w-[84px]" },
      { key: "due30", head: "30+ days %", def: def("status_due30", family), className: "w-[68px]" },
      { key: "nonperforming", head: "Matured, non-perf. %", def: def("status_matured_nonperforming", family), className: "w-[84px]" },
      { key: "late", head: "Grace, under 30 %", def: def("status_late", family), className: "w-[76px]" },
      { key: "change", head: "30+ change pp", def: def("status_due30_change", family), className: "w-[68px]" },
      { key: "due30", head: "30+ trend", def: def("status_due30", family), className: "w-[100px]", trend: true },
      { key: "rate", head: "Rate, as filed", def: metricDefinition("wa_period_rate"), className: "w-[76px]" },
      { key: "periods", head: "Periods", def: def("months", family), className: "w-[60px]" },
    ];
  return [
    { key: "period", head: "Period", def: null, className: "w-[104px]" },
    { key: "records", head: "Records in the file", def: metricDefinition("records"), className: "w-[76px]" },
    { key: "end", head: family === "auto_lease" ? "End secur. value $M" : "End balance $M", def: metricDefinition(end), className: "w-[84px]" },
    { key: "due30", head: "30+ days %", def: def("due30", family), className: "w-[64px]" },
    { key: "due60", head: "60+ days %", def: def("due60", family), className: "w-[64px]" },
    { key: "change", head: "60+ change pp", def: def("due60_change", family), className: "w-[68px]" },
    { key: "due60", head: "60+ trend", def: def("due60", family), className: "w-[100px]", trend: true },
    { key: "charge_offs", head: "Charge-offs $K", def: metricDefinition("charge_offs"), className: "w-[80px]" },
    { key: "score", head: "Credit score", def: metricDefinition("wa_credit_score"), className: "w-[60px]" },
    { key: "periods", head: "Periods", def: def("months", family), className: "w-[60px]" },
  ];
}

function figureTrace(r: MonitorRow, label: string, f: Figure | null, shown: string, metric: string, d: Definition | null): Trace | null {
  const l = r.latest;
  if (!l || !f) return null;
  return {
    label,
    shown,
    stored: f.text ?? "not stated in the file",
    accession: l.accession,
    cik: l.cik,
    form: l.form,
    filed: l.filed,
    period: l.recordsEnd,
    metric,
    n: f.n,
    missing: f.missing,
    definition: d,
  };
}

function shareTrace(r: MonitorRow, label: string, s: Share | null, d: Definition | null, family: AbsFamily): Trace | null {
  const l = r.latest;
  if (!l || !s) return null;
  return {
    label,
    shown: pctSign(s.value),
    accession: l.accession,
    cik: l.cik,
    form: l.form,
    filed: l.filed,
    period: l.recordsEnd,
    parts: [
      { label: "Numerator", value: `${usdFull(s.numerator)} in ${s.buckets.length ? s.buckets.join(", ") : "no bucket the file holds"}` },
      { label: "Denominator", value: `${usdFull(s.denominator)}, ${END_LABEL[family].toLowerCase()} of the file` },
    ],
    definition: d,
  };
}

const cell = "h-7 px-2 py-0.5 text-right align-middle";

function Row({ r, cols, onOpen }: { r: MonitorRow; cols: Col[]; onOpen: (id: string) => void }) {
  const l = r.latest!;
  const family = r.family;
  const out: ReactNode[] = [];
  const group = (k: string) => l.groups?.find((g) => g.key === k) ?? null;
  for (const [i, c] of cols.entries()) {
    let body: ReactNode = "–";
    switch (c.key) {
      case "period":
        body = (
          <span className="inline-flex items-center justify-end gap-1">
            {l.mixedPeriods && <Tag title="The file's records state more than one period end; the latest is shown.">mixed</Tag>}
            <span className="num whitespace-nowrap">{day(l.recordsEnd)}</span>
          </span>
        );
        break;
      case "records":
        body = <Traced trace={figureTrace(r, "Records in the file", l.records, count(l.records?.value), "records", c.def)}>{count(l.records?.value)}</Traced>;
        break;
      case "loans":
        body = <Traced trace={figureTrace(r, "Loans", l.loans, count(l.loans?.value), "loans", c.def)}>{count(l.loans?.value)}</Traced>;
        break;
      case "end":
        body = (
          <Traced trace={figureTrace(r, c.def?.label ?? "End amount", l.end, usdFull(l.end?.value), family === "cmbs" ? "sched_end_balance" : family === "auto_loan" ? "end_balance" : "end_securitization_value", c.def)}>
            {usdM(l.end?.value)}
          </Traced>
        );
        break;
      case "due30":
        if (c.trend) break;
        body =
          family === "cmbs" ? (
            <Traced trace={shareTrace(r, "30 days or more", group("due30"), c.def, family)}>{pct(group("due30")?.value)}</Traced>
          ) : (
            <Traced trace={shareTrace(r, "30 or more days past due", l.due30, c.def, family)}>{pct(l.due30?.value)}</Traced>
          );
        break;
      case "due60":
        if (c.trend) break;
        body = <Traced trace={shareTrace(r, "60 or more days past due", l.due60, c.def, family)}>{pct(l.due60?.value)}</Traced>;
        break;
      case "nonperforming":
        body = <Traced trace={shareTrace(r, "Matured, non-performing", group("matured_nonperforming"), c.def, family)}>{pct(group("matured_nonperforming")?.value)}</Traced>;
        break;
      case "late":
        body = <Traced trace={shareTrace(r, "Grace or under 30 days", group("late"), c.def, family)}>{pct(group("late")?.value)}</Traced>;
        break;
      case "change":
        body = r.change ? (
          <span
            className={cn(
              "num",
              !/[1-9]/.test(points(r.change.value)) ? "text-muted-foreground" : r.change.value > 0 ? "text-negative" : "text-positive",
            )}
            title={`${day(r.change.from)} to ${day(r.change.to)}${r.change.days != null && r.change.days > 45 ? `, ${r.change.days} days apart: a period between them is not stored` : ""}`}
          >
            {points(r.change.value)}
          </span>
        ) : (
          "–"
        );
        break;
      case "charge_offs":
        body = <Traced trace={figureTrace(r, "Charge-offs of the period", l.chargeOffs, usdFull(l.chargeOffs?.value), "charge_offs", c.def)}>{usdK(l.chargeOffs?.value)}</Traced>;
        break;
      case "score":
        body = <Traced trace={figureTrace(r, "Weighted credit score", l.score, fixed(l.score?.value, 1), "wa_credit_score", c.def)}>{fixed(l.score?.value, 0)}</Traced>;
        break;
      case "rate":
        body = <Traced trace={figureTrace(r, "Weighted period rate, as filed", l.rate, asFiled(l.rate?.text), "wa_period_rate", c.def)}>{asFiled(l.rate?.text)}</Traced>;
        break;
      case "periods":
        body = (
          <span className="num" title={r.periods !== r.distinctPeriods ? `${r.periods} filings state ${r.distinctPeriods} distinct periods` : undefined}>
            {count(r.periods)}
          </span>
        );
        break;
      default:
        break;
    }
    if (c.trend)
      body = (
        <Spark
          values={r.trend.map((t) => t.share)}
          labels={r.trend.map((t) => monthYear(t.recordsEnd))}
          format={(v) => `${pct(v)}%`}
        />
      );
    out.push(
      <td key={`${c.key}${i}`} className={cn(cell, c.trend && "text-center")}>
        {body}
      </td>,
    );
  }
  return (
    <tr className="border-b border-border/60 transition-colors duration-150 hover:bg-secondary/40">
      <th scope="row" className="sticky left-0 z-[1] h-7 max-w-[340px] bg-panel px-2 py-0.5 text-left align-middle font-normal">
        <span className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            data-agent-click
            onClick={() => onOpen(r.dealId)}
            title={`${r.name}${r.cik != null ? `, CIK ${r.cik}` : ""}`}
            className="min-w-0 truncate rounded-sm text-left text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {r.name}
          </button>
          {r.review && <Tag tone="warn" title="An amendment of this deal shares its cover period with no other filing: see its filings list.">check</Tag>}
        </span>
      </th>
      {out}
    </tr>
  );
}

export function MonitorTable({
  model,
  sort: sortTextValue,
  q,
  onSort,
  onOpen,
}: {
  model: MonitorModel;
  sort: string | undefined;
  q: string | undefined;
  onSort: (text: string, isDefault: boolean) => void;
  onOpen: (dealId: string) => void;
}) {
  const family = model.family;
  const sort = parseSort(family, sortTextValue);
  const rows = sortRows(filterRows(model.rows, q), sort);
  const cols = columns(family);
  const click = (key: SortKey) => {
    const s = nextSort(sort, key);
    onSort(sortText(s), isDefaultSort(family, s));
  };
  if (!model.rows.length)
    return (
      <Note className="px-3.5 py-6 text-center text-[12px]">
        No {FAMILY_LABEL[family].toLowerCase()} deal has a monthly report stored yet.
      </Note>
    );
  return (
    <div className="max-xl:overflow-x-auto">
      <table className="w-full min-w-[930px] table-fixed border-collapse text-[13px] xl:min-w-[1080px]">
        <thead className="xl:sticky xl:top-[var(--sticky-top,3.5rem)] xl:z-[2]">
          <tr className="border-b bg-panel">
            <SortHead active={sort.key === "name"} dir={sort.dir} onClick={() => click("name")} align="left" className="sticky left-0 z-[3] w-[190px] bg-panel sm:w-[260px] lg:w-[340px]">
              Deal, issuer as filed
            </SortHead>
            {cols.map((c, i) =>
              c.trend ? (
                <th key={`${c.key}${i}`} scope="col" className={cn("h-8 px-2 text-center align-bottom text-[11px] font-normal text-muted-foreground", c.className)}>
                  <Help def={c.def}>{c.head}</Help>
                </th>
              ) : (
                <SortHead key={`${c.key}${i}`} active={sort.key === c.key} dir={sort.dir} onClick={() => click(c.key)} className={c.className}>
                  <Help def={c.def}>{c.head}</Help>
                </SortHead>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.dealId} r={r} cols={cols} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
      {!rows.length && <Note className="px-3.5 py-4 text-center">No deal of this family matches that name or CIK.</Note>}
    </div>
  );
}

/** Deals whose only current filings describe a pool at cut-off: shown apart, in no figure above. */
export function OfferingOnly({ model, onOpen }: { model: MonitorModel; onOpen: (dealId: string) => void }) {
  if (!model.offeringOnly.length) return null;
  const family = model.family;
  return (
    <div className="grid gap-2">
      <Note>
        {STAGE_LABEL} only: these deals have no monthly report stored yet. Their figures describe the pool at its cut-off date and stay
        out of the monitor.
      </Note>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th scope="col" className="h-8 px-2 text-left font-normal">Deal, issuer as filed</th>
            <th scope="col" className="px-2 text-right font-normal">Filed</th>
            <th scope="col" className="px-2 text-right font-normal">Cut-off the file states</th>
            <th scope="col" className="px-2 text-right font-normal">{family === "cmbs" ? "Loans" : "Records in the file"}</th>
            <th scope="col" className="px-2 text-right font-normal">{END_LABEL[family]} $M</th>
          </tr>
        </thead>
        <tbody>
          {model.offeringOnly.map((r) => (
            <tr key={r.dealId} className="border-b border-border/60">
              <th scope="row" className="h-7 px-2 text-left font-normal">
                <button type="button" data-agent-click onClick={() => onOpen(r.dealId)} className="rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {r.name}
                </button>
              </th>
              <td className="num px-2 text-right">{day(r.offering?.filed)}</td>
              <td className="num px-2 text-right">{day(r.offering?.recordsAfterFiling ? r.offering.recordsEnd : r.offering?.coverEnd)}</td>
              <td className="num px-2 text-right">{count(r.offering?.count?.value)}</td>
              <td className="num px-2 text-right">{usdM(r.offering?.end?.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

