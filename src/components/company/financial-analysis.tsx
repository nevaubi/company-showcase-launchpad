// The Overview's financial analysis: headline levels, a rule-based read, and the tables of computed measures.
// Everything is arithmetic on the statements (src/lib/company/analysis.ts) and fixed rules over the result
// (src/lib/company/read.ts); no model writes any of it. Every number opens the filed figures behind it.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { analyze, figTarget, measureOf, medianTarget, vsPrior, type Fig, type FinancialAnalysis, type KeyFigure, type Measure, type MeasureGroup, type MeasureUnit } from "@/lib/company/analysis";
import { changeTone, fmtChange, fmtValue, fmtWithUnit, groupUnit, rowValues, unitLabel, usdScale } from "@/lib/company/analysis-format";
import { financialRead, fmtFig, READ_RULES, type ReadItem } from "@/lib/company/read";
import { newerFilings, type NewerFiling } from "@/lib/company/staleness";
import type { CompanyDataset } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FigButton } from "./fig-button";
import { Spark } from "./spark";

/* ------------------------------------------------------------------ what "latest" means, and what is not in it yet */

function spanSentence(a: FinancialAnalysis): string {
  const q = a.quarter;
  const fy = a.fiscalYear;
  if (a.basis === "ttm" && q) return `Latest is the trailing twelve months to ${q.label} (quarter ended ${fmtDate(q.end)}); fiscal years run to ${fy?.label ?? "the last filed year"}.`;
  if (fy) return `Latest is fiscal year ${fy.label} (ended ${fmtDate(fy.end)}): four consecutive quarters are not in the statements.`;
  return "The statements hold no income statement yet.";
}

function NotYetIncluded({ ticker, filings }: { ticker: string; filings: NewerFiling[] }) {
  const { open } = useSource();
  if (!filings.length) return null;
  return (
    <p data-section="Not in these figures yet" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-secondary/50 px-4 py-2 text-[13px]">
      <span className="font-medium">Not in these figures yet:</span>
      {filings.slice(0, 3).map((f) => (
        <Button
          key={f.accn}
          size="xs"
          variant="outline"
          className="h-6"
          onClick={() => open({ ticker, label: f.kind === "release" ? "Earnings release" : f.form, periodLabel: f.report ?? f.filed, unit: "usd", value: 0, doc: { accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, title: f.kind === "release" ? "Earnings release (8-K)" : `Form ${f.form}` } })}
        >
          {f.kind === "release" ? `results released ${fmtDate(f.filed)} (8-K)` : `${f.form} for the period to ${f.report ? fmtDate(f.report) : "a later date"}, filed ${fmtDate(f.filed)}`}
        </Button>
      ))}
      <span className={IR.caption}>The statements are rebuilt from SEC data on a schedule and will include it after the next rebuild.</span>
    </p>
  );
}

/* ------------------------------------------------------------------ key figures */

function KeyTile({ ticker, k }: { ticker: string; k: KeyFigure }) {
  const now = k.now!;
  const run = k.run.map((r) => ({ label: r.label, value: r.v, text: r.v == null ? undefined : fmtFig(r.v, k.unit) }));
  return (
    <div className="min-w-0 px-4 py-3">
      <p className={cn("truncate", IR.caption)} title={`${k.label}, ${now.period}`}>
        {k.label}
      </p>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <FigButton target={figTarget(ticker, k.label, now, k.unit)} className={cn("-ml-1", IR.stat)}>
          {fmtFig(now.v, k.unit)}
        </FigButton>
        <Spark points={run} width={72} height={24} name={`${k.label}, trailing twelve months at each quarter end`} className="mb-1 hidden sm:block" />
      </div>
      <p className={cn("mt-0.5 truncate", IR.caption)}>
        {k.prior ? (
          <>
            <FigButton target={figTarget(ticker, k.label, k.prior, k.unit)} className="-ml-1">
              {fmtFig(k.prior.v, k.unit)}
            </FigButton>{" "}
            a year earlier
          </>
        ) : (
          "no year-earlier figure"
        )}
      </p>
    </div>
  );
}

export interface PriceContext {
  /** last traded or last stored price, and the day it is from when known */
  price: number;
  asOf?: string | null;
  /** shares on the cover page of the latest report */
  shares: number | null;
  sharesTarget: SourceTarget | null;
}

/** Market value and earnings multiple at the last price: the only two figures here that are not from a filing alone. */
function PriceTiles({ ticker, a, ctx }: { ticker: string; a: FinancialAnalysis; ctx: PriceContext }) {
  const eps = measureOf(a, "eps");
  const cap = ctx.shares ? ctx.price * ctx.shares : null;
  const pe = eps?.now && eps.now.v > 0 ? ctx.price / eps.now.v : null;
  const at = `at ${fmtFig(ctx.price, "perShare")}${ctx.asOf ? `, ${fmtDate(ctx.asOf)}` : ""}`;
  return (
    <>
      <div className="min-w-0 px-4 py-3">
        <p className={cn("truncate", IR.caption)}>Market value</p>
        <p className={cn("mt-0.5", IR.stat)}>{cap != null ? fmtFig(cap, "usd") : DASH}</p>
        <p className={cn("mt-0.5 truncate", IR.caption)} title={`Shares on the cover of the latest report × the last price, ${at}`}>
          {ctx.shares && ctx.sharesTarget ? (
            <>
              <FigButton target={ctx.sharesTarget} className="-ml-1">
                {(ctx.shares / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M
              </FigButton>{" "}
              shares {at}
            </>
          ) : (
            "shares outstanding not on file"
          )}
        </p>
      </div>
      <div className="min-w-0 px-4 py-3">
        <p className={cn("truncate", IR.caption)}>Price to earnings</p>
        <p className={cn("mt-0.5", IR.stat)}>{pe != null ? `${fmtValue(pe, "x")}×` : DASH}</p>
        <p className={cn("mt-0.5 truncate", IR.caption)} title={eps?.note ?? `Last price ÷ diluted EPS over the trailing twelve months, ${at}`}>
          {eps?.now ? (
            <>
              on EPS{" "}
              <FigButton target={figTarget(ticker, "Diluted EPS", eps.now, "perShare")}>{fmtFig(eps.now.v, "perShare")}</FigButton>
              {eps.now.v <= 0 ? " (a loss)" : ""}
            </>
          ) : (
            "EPS over twelve months not available"
          )}
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the read */

function ReadSentence({ ticker, item }: { ticker: string; item: ReadItem }) {
  return (
    <li data-read-rule={item.id} className="flex gap-2 py-1.5 text-[13px] leading-5">
      <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", item.side === "strength" ? "bg-positive" : "bg-negative")} />
      <span className="min-w-0">
        {item.parts.map((p, i) =>
          p.fig ? (
            <FigButton key={i} target={figTarget(ticker, p.label ?? "Figure", p.fig, p.unit as MeasureUnit)} className={cn("-mx-0.5 font-medium", IR.derived)}>
              {p.text}
            </FigButton>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </span>
    </li>
  );
}

function ReadColumn({ ticker, title, items, empty }: { ticker: string; title: string; items: ReadItem[]; empty: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <h3 className={IR.group}>{title}</h3>
      {items.length ? (
        <ul className="mt-1 divide-y divide-border/60">
          {items.map((item) => (
            <ReadSentence key={item.id} ticker={ticker} item={item} />
          ))}
        </ul>
      ) : (
        <p className={cn("mt-1.5", IR.caption)}>{empty}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ measure tables */

function MeasureRow({ ticker, a, m, shared }: { ticker: string; a: FinancialAnalysis; m: Measure; shared: MeasureUnit | null }) {
  const scale = m.unit === "usd" ? usdScale(rowValues(m)) : "";
  const cell = (fig: Fig | null, what: string) =>
    fig ? (
      <FigButton target={figTarget(ticker, m.label, fig, m.unit)} title={`${m.label}, ${fig.period}: ${fmtWithUnit(fig.v, m.unit)}. Open the formula and filings.`} className="-mr-1">
        {fmtValue(fig.v, m.unit, scale)}
      </FigButton>
    ) : (
      <span className={IR.missing} title={m.note ? `Not shown: ${m.note}` : `No ${what} figure in the statements`}>
        {DASH}
      </span>
    );
  const change = vsPrior(m);
  const tone = changeTone(change, m.better, m.unit);
  const median = m.median ? medianTarget(ticker, m, (v) => fmtWithUnit(v, m.unit)) : null;
  // a row whose figure covers another period than the table's says which
  const period = m.now && m.now.period !== a.current ? m.now.period : null;
  const points = [...m.history.map((h) => ({ label: h.label, value: h.fig?.v ?? null, text: h.fig ? fmtWithUnit(h.fig.v, m.unit) : undefined })), ...(m.now && a.basis === "ttm" && m.history.length ? [{ label: m.now.period, value: m.now.v, text: fmtWithUnit(m.now.v, m.unit) }] : [])];
  return (
    <tr data-measure={m.key} className="border-t border-border/60 transition-colors duration-150 hover:bg-secondary/60 motion-reduce:transition-none">
      <th scope="row" className="py-1 pl-4 pr-2 text-left align-top font-normal">
        <span>{m.label}</span>
        {(!shared || period) && (
          <span className={cn("ml-1.5 whitespace-nowrap", IR.caption)}>
            {[!shared ? unitLabel(m.unit, scale) : null, period].filter(Boolean).join(" · ")}
          </span>
        )}
        {!m.now && m.note && <span className={cn("block", IR.caption)}>Not shown: {m.note}.</span>}
      </th>
      <td className={cn("py-1 pr-3 align-top font-medium", IR.num)}>{cell(m.now, "current")}</td>
      <td className={cn("py-1 pr-3 align-top", IR.num)}>{cell(m.prior, "year-earlier")}</td>
      <td className={cn("py-1 pr-3 align-top", IR.num, tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-muted-foreground")} title={change != null ? "Latest less the year-earlier figure, in the row's unit (points for percentages)" : undefined}>
        {change != null ? fmtChange(change, m.unit, scale) : DASH}
      </td>
      <td className={cn("hidden py-1 pr-3 align-top sm:table-cell", IR.num)}>
        {median && m.median ? (
          <FigButton target={median} title={`Median of ${m.median.n} fiscal years, ${m.median.from} to ${m.median.to}: ${fmtWithUnit(m.median.v, m.unit)}. Open each year.`} className="-mr-1">
            {fmtValue(m.median.v, m.unit, scale)}
          </FigButton>
        ) : (
          <span className={IR.missing} title="A median needs three fiscal years">
            {DASH}
          </span>
        )}
      </td>
      <td className="hidden py-1 pr-4 align-top sm:table-cell">
        <div className="flex h-5 items-center justify-end">
          <Spark points={points} name={`${m.label} by fiscal year`} />
        </div>
      </td>
    </tr>
  );
}

function DuPontRow({ ticker, a }: { ticker: string; a: FinancialAnalysis }) {
  const d = a.dupont;
  if (!d) return null;
  const part = (label: string, fig: Fig, unit: MeasureUnit) => (
    <FigButton target={figTarget(ticker, label, fig, unit)} className="font-medium">
      {fmtWithUnit(fig.v, unit)}
    </FigButton>
  );
  return (
    <tr data-measure="dupont" className="border-t border-border/60">
      <td colSpan={6} className={cn("px-4 py-1.5", IR.caption)}>
        <span className="text-foreground">Return on equity {part("Return on equity", d.roe, "pct")}</span> = net margin {part("Net margin", d.netMargin, "pct")} × asset turnover {part("Asset turnover", d.assetTurnover, "x")} × equity multiplier{" "}
        {part("Equity multiplier", d.leverage, "x")}
      </td>
    </tr>
  );
}

function MeasureTable({ ticker, a, g }: { ticker: string; a: FinancialAnalysis; g: MeasureGroup }) {
  const shared = groupUnit(g);
  const medianYears = Math.max(0, ...g.measures.map((m) => m.median?.n ?? 0));
  return (
    <table data-group={g.id} className={cn("mb-4 w-full table-fixed break-inside-avoid", IR.row)}>
      <colgroup>
        <col />
        <col className="w-[4.5rem]" />
        <col className="w-[4.5rem]" />
        <col className="w-[4.25rem]" />
        <col className="hidden w-[4.5rem] sm:table-column" />
        <col className="hidden w-20 sm:table-column" />
      </colgroup>
      <thead>
        <tr className={IR.caption}>
          <th scope="col" className="px-4 pb-1 pt-2 text-left font-normal">
            <span className={cn("text-foreground", IR.group)}>{g.title}</span>
            {shared && <span className="ml-1.5">{unitLabel(shared)}</span>}
          </th>
          <th scope="col" className="pb-1 pr-3 pt-2 text-right font-normal">
            Latest
          </th>
          <th scope="col" className="pb-1 pr-3 pt-2 text-right font-normal">
            Year earlier
          </th>
          <th scope="col" className="pb-1 pr-3 pt-2 text-right font-normal">
            Change
          </th>
          <th scope="col" className="hidden pb-1 pr-3 pt-2 text-right font-normal sm:table-cell" title="Median of the last five fiscal years that have a figure (at least three)">
            {medianYears > 0 && medianYears < 5 ? `${medianYears}-yr median` : "5-yr median"}
          </th>
          <th scope="col" className="hidden pb-1 pr-4 pt-2 text-right font-normal sm:table-cell">
            By fiscal year
          </th>
        </tr>
      </thead>
      <tbody>
        {g.measures.map((m) => (
          <MeasureRow key={m.key} ticker={ticker} a={a} m={m} shared={shared} />
        ))}
        {g.id === "returns" && <DuPontRow ticker={ticker} a={a} />}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ the section */

export function FinancialAnalysisSection({ ticker, data, price }: { ticker: string; data: CompanyDataset; price: PriceContext | null }) {
  const a = useMemo(() => analyze(data), [data]);
  const read = useMemo(() => financialRead(a), [a]);
  const newer = useMemo(() => newerFilings(data, a.quarter?.end ?? a.fiscalYear?.end ?? null), [data, a]);
  const prior = a.groups.flatMap((g) => g.measures).find((m) => m.prior && m.now && m.now.period === a.current)?.prior?.period;
  if (!a.current) {
    return (
      <IrPanel section="Financial analysis" title="Financial analysis" subtitle="Computed from the statements">
        <p className="px-4 py-3 text-[13px] text-muted-foreground">The statements for {ticker} hold no income statement yet, so there is nothing to compute.</p>
      </IrPanel>
    );
  }
  const tiles = a.keyFigures.length + (price ? 2 : 0);
  return (
    <>
      <IrPanel
        section="Key figures"
        title="Key figures"
        subtitle={`${a.basis === "ttm" ? `Trailing twelve months to ${a.quarter?.label}, quarter ended ${a.quarter ? fmtDate(a.quarter.end) : ""}` : `Fiscal year ${a.fiscalYear?.label}`}; balances at the period end · click a figure for its filings`}
        bodyClassName="p-0"
        actions={
          <Button size="xs" variant="ghost" asChild>
            <Link to="/app/companies/$ticker/financials" params={{ ticker }}>
              Statements
            </Link>
          </Button>
        }
      >
        <NotYetIncluded ticker={ticker} filings={newer} />
        <div className={cn("grid grid-cols-2 divide-x divide-y divide-border/60 sm:grid-cols-3", tiles >= 7 ? "xl:grid-cols-7" : tiles === 6 ? "xl:grid-cols-6" : "xl:grid-cols-5", "[&>*]:border-border/60 xl:divide-y-0")}>
          {a.keyFigures.map((k) => (
            <KeyTile key={k.key} ticker={ticker} k={k} />
          ))}
          {price && <PriceTiles ticker={ticker} a={a} ctx={price} />}
        </div>
      </IrPanel>

      <IrPanel
        section="Financial read"
        title="Financial read"
        subtitle={`As of ${read.span}. Each sentence comes from a fixed rule over the figures below and shows the numbers that triggered it; no model writes these.`}
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          <ReadColumn ticker={ticker} title="Strengths" items={read.strengths} empty="No strength rule is met by the current figures." />
          <ReadColumn ticker={ticker} title="Concerns" items={read.concerns} empty="No concern rule is met by the current figures." />
        </div>
        <p className={cn("border-t px-4 py-2", IR.caption)}>
          Rules, for example: revenue growth of {READ_RULES.growthStrong * 100}% or more ({READ_RULES.bank.growthStrong * 100}% for a bank), an operating margin a point above or a point and a half below a year earlier, free cash flow
          under {READ_RULES.conversionWeak * 100}% of net income, net debt over {READ_RULES.leverageHigh}× EBITDA, receivables or inventories growing {READ_RULES.workingCapitalGap * 100} points faster than revenue. At most {READ_RULES.perSide} per
          side, heaviest rule first. It is a reading aid, not advice.
        </p>
      </IrPanel>

      <IrPanel
        section="Financial analysis"
        title="Financial analysis"
        subtitle={`${spanSentence(a)}${prior ? ` Year earlier is ${prior.replace("TTM", "the twelve months")}.` : ""} Change is in the row's unit (points for percentages).`}
        bodyClassName="p-0"
      >
        <div className="gap-x-0 pt-1 xl:columns-2 xl:[column-rule:1px_solid_var(--border)]">
          {a.groups.map((g) => (
            <MeasureTable key={g.id} ticker={ticker} a={a} g={g} />
          ))}
        </div>
      </IrPanel>
    </>
  );
}
