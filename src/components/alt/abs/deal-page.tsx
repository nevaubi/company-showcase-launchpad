// One deal, opened in place from the monitor: what the trust is (as filed), its newest monthly figures,
// their history, the newest file's breakdowns or loans, every stored filing, and the definitions.
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { SectionNav } from "@/components/sectors/ui";
import { Panel } from "@/components/app/page-header";
import { BLANK, DUE_30_PLUS, END_LABEL, END_METRIC, FAMILY_LABEL, NEW_USED, STATUS_GROUPS, ZERO_BALANCE } from "@/lib/abs/view/codes";
import { foreclosureShare, topItems, type AutoPoint, type CmbsPoint, type DealModel } from "@/lib/abs/view/deal";
import { DEFINITION_KEYS, definitionOf, metricDefinition, UNIT_LABEL, type Definition } from "@/lib/abs/view/definitions";
import type { Figure } from "@/lib/abs/view/figures";
import { asFiled, asWritten, count, day, fixed, pct, pctSign, usdCompact, usdFull, usdK, usdM } from "@/lib/abs/view/format";
import { STAGE_LABEL, STAGE_LIMIT, STAGE_RULE } from "@/lib/abs/view/stage";
import type { AbsFamily, Share } from "@/lib/abs/view/types";
import { DUE_RAMP, Legend, MeterList, PeriodColumns, PeriodLines } from "./charts";
import { FilingsTable } from "./filings-table";
import { LoansTable } from "./loans-table";
import { Help, Note, SecLink, Tag, Traced, edgarFilerUrl, type Trace } from "./ui";

const SECTION = "scroll-mt-[calc(var(--sticky-top,3.5rem)+2.75rem)]";

const loansText = (n: number | null | undefined) => (n == null ? "–" : `${count(n)} ${n === 1 ? "loan" : "loans"}`);

/* ---------- tiles ---------- */

function Tile({ label, def, value, sub, trace }: { label: string; def: Definition | null; value: string; sub?: ReactNode; trace: Trace | null }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2 shadow-paper">
      <p className="text-[11px] text-muted-foreground">
        <Help def={def}>{label}</Help>
      </p>
      <Traced trace={trace} className="mt-0.5 block text-left text-lg font-semibold leading-tight">
        {value}
      </Traced>
      {sub && <p className="num mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

type Point = { accession: string; cik: number; filed: string; recordsEnd: string | null };

const fileOf = (m: DealModel, accession: string) => {
  const f = m.filings.find((x) => x.accession === accession);
  return f ? { name: f.fileName ?? "asset file", bytes: f.bytes, sha256: f.sha256 } : null;
};

function storedTrace(m: DealModel, p: Point, label: string, f: Figure | null, shown: string, metric: string, d: Definition | null): Trace | null {
  if (!f) return null;
  return {
    label,
    shown,
    stored: f.text ?? "not stated in the file",
    accession: p.accession,
    cik: p.cik,
    filed: p.filed,
    period: p.recordsEnd,
    metric,
    n: f.n,
    missing: f.missing,
    file: fileOf(m, p.accession),
    definition: d,
  };
}

function shareTrace(m: DealModel, p: Point, label: string, s: Share | null, d: Definition | null, family: AbsFamily, what = END_LABEL[family].toLowerCase()): Trace | null {
  if (!s) return null;
  return {
    label,
    shown: pctSign(s.value),
    accession: p.accession,
    cik: p.cik,
    filed: p.filed,
    period: p.recordsEnd,
    parts: [
      { label: "Numerator", value: `${usdFull(s.numerator)}${s.buckets.length ? ` in ${s.buckets.join(", ")}` : ""}` },
      { label: "Denominator", value: `${usdFull(s.denominator)}, ${what}` },
    ],
    file: fileOf(m, p.accession),
    definition: d,
  };
}

/* ---------- sections ---------- */

function Section({ id, name, title, subtitle, children, actions }: { id: string; name: string; title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div id={id} data-section={name} className={SECTION}>
      <Panel title={title} subtitle={subtitle} actions={actions} collapse={false}>
        {children}
      </Panel>
    </div>
  );
}

const periodFoot = (p: Point) => (
  <span className="num">
    {p.accession} · filed {p.filed}
  </span>
);

function AutoNewest({ m, family }: { m: DealModel; family: "auto_loan" | "auto_lease" }) {
  const p = m.auto[m.auto.length - 1] ?? m.offeringAuto[m.offeringAuto.length - 1];
  if (!p) return <Note>No figures are stored for this deal's current filings.</Note>;
  const endKey = END_METRIC[family];
  const offering = !m.auto.length;
  const d = (k: string) => definitionOf(k, family);
  const tiles: ReactNode[] = [
    <Tile key="end" label={END_LABEL[family]} def={metricDefinition(endKey)} value={usdCompact(p.end?.value)} sub={`${count(p.records?.value)} records in the file`} trace={storedTrace(m, p, END_LABEL[family], p.end, usdFull(p.end?.value), endKey, metricDefinition(endKey))} />,
    <Tile key="due30" label="30 or more days past due" def={d("due30")} value={pctSign(p.due30.value)} sub={`${usdCompact(p.due30.numerator)} of the ${END_LABEL[family].toLowerCase()}`} trace={shareTrace(m, p, "30 or more days past due", p.due30, d("due30"), family)} />,
    <Tile key="due60" label="60 or more days past due" def={d("due60")} value={pctSign(p.due60.value)} sub={`${usdCompact(p.due60.numerator)} of the ${END_LABEL[family].toLowerCase()}`} trace={shareTrace(m, p, "60 or more days past due", p.due60, d("due60"), family)} />,
    <Tile key="co" label="Charge-offs of the period" def={metricDefinition("charge_offs")} value={usdCompact(p.chargeOffs?.value)} sub={p.chargeOffs ? `${count(p.chargeOffs.n)} records state an amount` : undefined} trace={storedTrace(m, p, "Charge-offs of the period", p.chargeOffs, usdFull(p.chargeOffs?.value), "charge_offs", metricDefinition("charge_offs"))} />,
  ];
  if (family === "auto_loan")
    tiles.push(<Tile key="rec" label="Recoveries of the period" def={metricDefinition("recoveries")} value={usdCompact(p.recoveries?.value)} sub={p.recoveries ? `${count(p.recoveries.n)} records state an amount` : undefined} trace={storedTrace(m, p, "Recoveries of the period", p.recoveries, usdFull(p.recoveries?.value), "recoveries", metricDefinition("recoveries"))} />);
  else
    tiles.push(<Tile key="res" label="Base residual, active leases" def={metricDefinition("base_residual_active")} value={usdCompact(p.baseResidual?.value)} sub={p.baseResidual ? `${count(p.baseResidual.n)} leases` : undefined} trace={storedTrace(m, p, "Base residual, active leases", p.baseResidual, usdFull(p.baseResidual?.value), "base_residual_active", metricDefinition("base_residual_active"))} />);
  tiles.push(
    <Tile key="score" label="Weighted credit score" def={metricDefinition("wa_credit_score")} value={fixed(p.score?.value, 0)} sub={p.score ? `${count(p.score.n)} records, ${count(p.score.missing)} left out` : undefined} trace={storedTrace(m, p, "Weighted credit score", p.score, fixed(p.score?.value, 4), "wa_credit_score", metricDefinition("wa_credit_score"))} />,
    <Tile key="term" label="Weighted remaining term" def={metricDefinition("wa_remaining_term")} value={p.remainingTerm?.value == null ? "–" : `${fixed(p.remainingTerm.value, 1)} mo`} sub={p.originalTerm?.value != null ? `original ${fixed(p.originalTerm.value, 1)} mo` : undefined} trace={storedTrace(m, p, "Weighted remaining term", p.remainingTerm, `${fixed(p.remainingTerm?.value, 4)} months`, "wa_remaining_term", metricDefinition("wa_remaining_term"))} />,
    <Tile key="pti" label="Payment to income, median as written" def={metricDefinition("payment_to_income")} value={asWritten(p.pti.p50?.text)} sub={`p25 ${asWritten(p.pti.p25?.text)} · p75 ${asWritten(p.pti.p75?.text)}`} trace={storedTrace(m, p, "Payment to income, median as written by the filer", p.pti.p50 ?? null, asWritten(p.pti.p50?.text), "payment_to_income", metricDefinition("payment_to_income"))} />,
  );
  return (
    <div className="grid gap-2">
      {offering && <OfferingBanner />}
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">{tiles}</div>
      <Note>
        Figures of the file filed {day(p.filed)} ({p.accession}), whose records state the period ending {day(p.recordsEnd)}. Payment to
        income is shown as the filer writes it (some write 8.73, others 0.0873) and is never averaged; {p.ptiOverOne?.value != null ? `${count(p.ptiOverOne.value)} records write a value above 1.` : ""}
      </Note>
    </div>
  );
}

function OfferingBanner() {
  return (
    <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px]">
      Only a {STAGE_LABEL.toLowerCase()} is stored for this deal. Its figures describe the pool at its cut-off date, not a month of
      performance.
    </p>
  );
}

function AutoHistory({ m, family }: { m: DealModel; family: "auto_loan" | "auto_lease" }) {
  const pts = m.auto;
  if (pts.length < 2)
    return <Note>{pts.length ? "One reporting period is stored for this deal: there is no history to draw yet." : "No monthly report is stored for this deal yet."}</Note>;
  const x = (p: AutoPoint) => p.recordsEnd ?? p.filed;
  const end = [{ id: "end", label: END_LABEL[family], color: "var(--chart-1)", points: pts.map((p) => ({ x: x(p), y: p.end?.value ?? null, foot: periodFoot(p) })) }];
  const dueKeys = DUE_30_PLUS.map((b, i) => ({ id: b, label: b, color: DUE_RAMP[i] }));
  const due = pts.map((p) => ({
    x: x(p),
    values: Object.fromEntries(DUE_30_PLUS.map((b) => [b, p.end?.value ? (p.split[b]?.value ?? 0) / p.end.value : null])),
    foot: periodFoot(p),
  }));
  const flowKeys = [
    { id: "co", label: "Charge-offs", color: "var(--chart-4)" },
    ...(family === "auto_loan" ? [{ id: "rec", label: "Recoveries", color: "var(--chart-1)" }] : []),
  ];
  const flows = pts.map((p) => ({ x: x(p), values: { co: p.chargeOffs?.value ?? null, rec: p.recoveries?.value ?? null }, foot: periodFoot(p) }));
  const score = [{ id: "score", label: "Weighted credit score", color: "var(--chart-1)", points: pts.map((p) => ({ x: x(p), y: p.score?.value ?? null, foot: periodFoot(p) })) }];
  const term = [{ id: "term", label: "Weighted remaining term", color: "var(--chart-1)", points: pts.map((p) => ({ x: x(p), y: p.remainingTerm?.value ?? null, foot: periodFoot(p) })) }];
  return (
    <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-2">
      <Chart title={`${END_LABEL[family]}, $M`}>
        <PeriodLines series={end} yFormat={(v) => usdM(v)} zero label={`${END_LABEL[family]} by reporting period`} />
      </Chart>
      <Chart title={`30 or more days past due, % of the ${END_LABEL[family].toLowerCase()}`} legend={<Legend items={dueKeys} shape="rect" />}>
        <PeriodColumns data={due} keys={dueKeys} mode="stack" yFormat={(v) => pct(v, 1)} label="Share of the end amount by days past due, by reporting period" />
      </Chart>
      <Chart title="Charge-offs and recoveries of each period, $K" legend={flowKeys.length > 1 ? <Legend items={flowKeys} shape="rect" /> : undefined}>
        <PeriodColumns data={flows} keys={flowKeys} mode="group" yFormat={(v) => usdK(v)} label="Charge-offs and recoveries by reporting period" />
      </Chart>
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
        <Chart title="Weighted credit score">
          <PeriodLines series={score} yFormat={(v) => fixed(v, 0)} height={160} label="Weighted credit score by reporting period" />
        </Chart>
        <Chart title="Weighted remaining term, months">
          <PeriodLines series={term} yFormat={(v) => fixed(v, 0)} height={160} label="Weighted remaining term by reporting period" />
        </Chart>
      </div>
      <Note className="@5xl:col-span-2">
        Each point is one current monthly file, at the period its records state; files of an offering-stage pool and superseded filings
        are left out. Amounts are those of each reporting period as filed, not annualized; a period that is not stored leaves its month
        out.
      </Note>
    </div>
  );
}

function Chart({ title, legend, children }: { title: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{title}</span>
        {legend}
      </figcaption>
      {children}
    </figure>
  );
}

const sharePct = (s: number | null) => (s == null ? "–" : `${pct(s, 1)}%`);

function AutoBreakdowns({ m, family }: { m: DealModel; family: "auto_loan" | "auto_lease" }) {
  const b = m.breakdowns;
  if (!b.state) return <Note>No breakdowns are stored for this deal's newest file.</Note>;
  const items = (dim: string, keep?: number) => {
    const list = keep ? topItems(b[dim], keep).items : b[dim].items;
    return list.map((i) => ({
      key: i.bucket || "other",
      label: i.label,
      value: i.amount,
      share: i.share,
      detail: `${i.label}: ${usdFull(i.amount)}, ${count(i.records)} records`,
    }));
  };
  const zbc = b.zero_balance_code;
  const records = zbc ? zbc.items.reduce((s, i) => s + (i.records ?? 0), 0) : 0;
  const zbcItems = (zbc?.items ?? [])
    .map((i) => ({
      key: i.bucket,
      label: i.bucket === BLANK ? "Still reported, no code" : (ZERO_BALANCE[family][i.bucket] ?? `Code ${i.bucket}`),
      value: i.records,
      share: records ? (i.records ?? 0) / records : null,
      detail: `${count(i.records)} records`,
    }))
    .sort((a, c) => (c.value ?? 0) - (a.value ?? 0));
  const p = m.auto[m.auto.length - 1] ?? m.offeringAuto[m.offeringAuto.length - 1];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
        <Chart title={`State, % of the ${END_LABEL[family].toLowerCase()}`}>
          <MeterList items={items("state", 12)} format={sharePct} label="Share of the end amount by state" />
        </Chart>
        <Chart title="Credit score band">
          <MeterList items={items("score_band")} format={sharePct} label="Share of the end amount by credit score band" />
        </Chart>
        <Chart title="Make, as filed">
          <MeterList items={items("make", 12)} format={sharePct} label="Share of the end amount by make" />
        </Chart>
        <div className="grid content-start gap-5">
          <Chart title="New or used">
            <MeterList
              items={(b.new_used?.items ?? []).map((i) => ({ key: i.bucket, label: i.bucket === BLANK ? "Not stated" : (NEW_USED[i.bucket] ?? `Code ${i.bucket}`), value: i.amount, share: i.share, detail: `${count(i.records)} records` }))}
              format={sharePct}
              label="Share of the end amount, new or used"
            />
          </Chart>
          <Chart title="Why records left the pool, % of records">
            <MeterList items={zbcItems} format={sharePct} color="var(--chart-5)" label="Records by zero-balance code" />
          </Chart>
        </div>
      </div>
      <Note>
        Breakdowns of the file whose records state {day(m.shown?.recordsEnd)} ({m.shown?.accession}). Shares are of the{" "}
        {END_LABEL[family].toLowerCase()} of the whole file, so paid-off records count in no state; the zero-balance list counts records.
        Makes are grouped by their trimmed upper-case text as filed: spelling variants of one make are not merged. Payment to income as
        written: p25 {asWritten(p?.pti.p25?.text)}, p50 {asWritten(p?.pti.p50?.text)}, p75 {asWritten(p?.pti.p75?.text)}, p99{" "}
        {asWritten(p?.pti.p99?.text)}, max {asWritten(p?.pti.max?.text)}.
      </Note>
    </div>
  );
}

function CmbsNewest({ m }: { m: DealModel }) {
  const p = m.cmbs[m.cmbs.length - 1] ?? m.offeringCmbs[m.offeringCmbs.length - 1];
  if (!p) return <Note>No figures are stored for this deal's current filings.</Note>;
  const g = Object.fromEntries(p.groups.map((x) => [x.key, x]));
  const d = (k: string) => definitionOf(k, "cmbs");
  const fc = m.loanTable && m.shown?.accession === p.accession ? foreclosureShare(m.loanTable, p.accession) : null;
  const tiles = [
    <Tile key="end" label="Scheduled end balance" def={metricDefinition("sched_end_balance")} value={usdCompact(p.end?.value)} sub={`${count(p.loans?.value)} loans, ${count(p.records?.value)} records in the file`} trace={storedTrace(m, p, "Scheduled end balance", p.end, usdFull(p.end?.value), "sched_end_balance", metricDefinition("sched_end_balance"))} />,
    <Tile key="30" label="30 days or more" def={d("status_due30")} value={pctSign(g.due30?.value)} sub={loansText(g.due30?.loans)} trace={shareTrace(m, p, "30 days or more", g.due30 ?? null, d("status_due30"), "cmbs")} />,
    <Tile key="np" label="Matured, non-performing" def={d("status_matured_nonperforming")} value={pctSign(g.matured_nonperforming?.value)} sub={loansText(g.matured_nonperforming?.loans)} trace={shareTrace(m, p, "Matured, non-performing", g.matured_nonperforming ?? null, d("status_matured_nonperforming"), "cmbs")} />,
    <Tile key="fc" label="In foreclosure or bank-owned" def={d("foreclosure")} value={fc ? pctSign(fc.value) : "–"} sub={fc ? `${loansText(fc.loans)}, from the loan records` : undefined} trace={fc ? shareTrace(m, p, "In foreclosure or bank-owned", fc, d("foreclosure"), "cmbs", "scheduled end balance of every loan of the file") : null} />,
    <Tile key="rate" label="Weighted period rate, as filed" def={metricDefinition("wa_period_rate")} value={asFiled(p.rate?.text)} sub={UNIT_LABEL.as_filed.split(":")[0]} trace={storedTrace(m, p, "Weighted period rate, as filed", p.rate, asFiled(p.rate?.text, 10), "wa_period_rate", metricDefinition("wa_period_rate"))} />,
  ];
  const mix = p.groups.map((x) => ({ key: x.key, label: x.label, value: x.numerator, share: x.value, detail: `${x.label}: ${usdFull(x.numerator)}, ${count(x.loans)} loans` }));
  return (
    <div className="grid gap-3">
      {!m.cmbs.length && <OfferingBanner />}
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-5">{tiles}</div>
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Chart title="Payment status, % of the scheduled end balance">
          <MeterList items={mix} format={sharePct} label="Share of the scheduled end balance by payment status group" />
        </Chart>
        <Note className="self-end">
          Groups as the payment status codes define them: {STATUS_GROUPS.map((x) => `${x.label.toLowerCase()} (${x.codes.map((c) => (c === BLANK ? "blank" : c)).join(", ")})`).join("; ")}.
          The list has no foreclosure value, so that share is read from each loan's workout strategy and its properties' status. Figures
          of the file filed {day(p.filed)} ({p.accession}), records of the period ending {day(p.recordsEnd)}.
        </Note>
      </div>
    </div>
  );
}

function CmbsHistory({ m }: { m: DealModel }) {
  const pts = m.cmbs;
  if (pts.length < 2)
    return <Note>{pts.length ? "One reporting period is stored for this deal: there is no history to draw yet." : "No monthly report is stored for this deal yet."}</Note>;
  const x = (p: CmbsPoint) => p.recordsEnd ?? p.filed;
  const g = (p: CmbsPoint, k: string) => p.groups.find((q) => q.key === k)?.value ?? null;
  const balance = [{ id: "end", label: "Scheduled end balance", color: "var(--chart-1)", points: pts.map((p) => ({ x: x(p), y: p.end?.value ?? null, foot: periodFoot(p) })) }];
  const shares = [
    { id: "due30", label: "30 days or more", color: "var(--chart-4)", points: pts.map((p) => ({ x: x(p), y: g(p, "due30"), foot: periodFoot(p) })) },
    { id: "np", label: "Matured, non-performing", color: "var(--chart-1)", points: pts.map((p) => ({ x: x(p), y: g(p, "matured_nonperforming"), foot: periodFoot(p) })) },
  ];
  return (
    <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-2">
      <Chart title="Scheduled end balance, $M">
        <PeriodLines series={balance} yFormat={(v) => usdM(v)} zero label="Scheduled end balance by reporting period" />
      </Chart>
      <Chart title="Share of the scheduled end balance, %" legend={<Legend items={shares} />}>
        <PeriodLines series={shares} yFormat={(v) => pct(v, 1)} zero label="Shares 30 days or more and matured non-performing by reporting period" />
      </Chart>
      <Note className="@5xl:col-span-2">
        Each point is one current monthly file, at the period its records state; offering-stage and superseded filings are left out.
      </Note>
    </div>
  );
}

function Definitions({ family }: { family: AbsFamily }) {
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 @3xl:grid-cols-2">
        {DEFINITION_KEYS[family].map((k) => {
          const d = definitionOf(k, family);
          if (!d) return null;
          return (
            <div key={k} className="min-w-0">
              <dt className="text-[12px] font-medium">
                {d.label} <span className="font-normal text-muted-foreground">· {d.unit} · {d.kind === "derived" ? "derived by this page" : "stored figure"}</span>
              </dt>
              <dd className="text-[11.5px] leading-relaxed text-muted-foreground">{d.what}</dd>
            </div>
          );
        })}
      </dl>
      <Note>
        {STAGE_RULE} {STAGE_LIMIT}
      </Note>
    </div>
  );
}

/* ---------- the page ---------- */

export function DealPage({ model, onBack }: { model: DealModel; onBack: () => void }) {
  const family = model.family === "other" ? null : model.family;
  const sections =
    family === "cmbs"
      ? [
          { id: "deal-newest", label: "Newest period" },
          { id: "deal-history", label: "History" },
          { id: "deal-loans", label: "Loans" },
          { id: "deal-filings", label: "Filings" },
          { id: "deal-definitions", label: "Definitions" },
        ]
      : [
          { id: "deal-newest", label: "Newest period" },
          { id: "deal-history", label: "History" },
          { id: "deal-breakdowns", label: "Breakdowns" },
          { id: "deal-filings", label: "Filings" },
          { id: "deal-definitions", label: "Definitions" },
        ];
  const cikLink = (cik: number | null) =>
    cik == null ? <span className="text-muted-foreground">not stated</span> : <SecLink href={edgarFilerUrl(cik)} className="num">{cik}</SecLink>;
  return (
    <div className="@container grid grid-cols-1 content-start gap-4">
      <div data-section="Deal" className="grid gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All {family ? FAMILY_LABEL[family].toLowerCase() : "deals"}
        </button>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[18px] font-semibold leading-tight">{model.name}</h2>
          {family && <Tag>{FAMILY_LABEL[family]}</Tag>}
          {model.review.length > 0 && <Tag tone="warn">amendment to check</Tag>}
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span>Issuing entity CIK {cikLink(model.cik)}</span>
          <span>Depositor CIK {cikLink(model.depositorCik)}</span>
          <span>Sponsor CIK {cikLink(model.sponsorCik)}</span>
          {model.fileNumber && <span>SEC file number <span className="num">{model.fileNumber}</span></span>}
          <span>
            {count(model.filings.length)} filings stored, {count(family === "cmbs" ? model.cmbs.length : model.auto.length)} monthly periods
          </span>
        </p>
        <Note>
          Names and CIKs as the filings state them. A pool is not attributed to any company here: a sponsor or depositor named in a
          filing is not evidence that a listed company holds the risk.
          {model.depositorKeyed ? " This deal's filings name only their depositor, so it is keyed by the depositor's CIK and the SEC file number." : ""}
        </Note>
      </div>
      {family ? (
        <>
          <SectionNav sections={sections} />
          <Section id="deal-newest" name="Newest period" title="Newest period" subtitle="The newest current monthly file of the deal">
            {family === "cmbs" ? <CmbsNewest m={model} /> : <AutoNewest m={model} family={family} />}
          </Section>
          <Section id="deal-history" name="History" title="History" subtitle="Current monthly files, oldest first">
            {family === "cmbs" ? <CmbsHistory m={model} /> : <AutoHistory m={model} family={family} />}
          </Section>
          {family === "cmbs" ? (
            <Section id="deal-loans" name="Loans" title="Loans" subtitle={model.shown ? `Records of the file filed ${day(model.filings.find((f) => f.accession === model.shown!.accession)?.filed)}, period ending ${day(model.shown.recordsEnd)}` : undefined}>
              {model.loanTable && model.loanTable.loans.length ? <LoansTable table={model.loanTable} /> : <Note>No loan records are stored for this deal's newest file.</Note>}
            </Section>
          ) : (
            <Section id="deal-breakdowns" name="Breakdowns" title="Breakdowns of the newest file">
              <AutoBreakdowns m={model} family={family} />
            </Section>
          )}
          <Section id="deal-filings" name="Filings" title="Filings" subtitle="Every stored ABS-EE and ABS-EE/A of the deal, newest first">
            <FilingsTable model={model} />
          </Section>
          <Section id="deal-definitions" name="Definitions" title="Definitions">
            <Definitions family={family} />
          </Section>
        </>
      ) : (
        <Note>This deal's asset files are of a class this page does not read.</Note>
      )}
    </div>
  );
}

