// "Results & promises" sections: latest quarter scorecard, quarterly history, next report.
// Figures come from src/lib/earnings/quarters.ts; every value opens its filing or formula.
import { ExternalLink } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import type { Scorecard } from "@/lib/earnings/workflow";
import { pointsChange, priorIndex, yearAgoIndex, type Figure, type PendingRelease, type ProfitLine, type QuarterRecord, type ReactionSummary, type ReactionWindow } from "@/lib/earnings/quarters";
import type { PeriodEstimate } from "@/lib/estimates/core";
import type { EarningsRelease } from "@/lib/financials/types";
import type { Reaction } from "@/lib/markets/core";
import { REPORT_EXPIRY_LAG, type EarningsPricing } from "@/lib/options/core";
import type { NextEarnings } from "@/lib/company/catalysts";
import { fmtCompactUsd, fmtDate, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DerivedQ4Note, fmtFig, MachineWritten, signedPct, signedPts, SourceNum, Stat, toneText, type FigUnit } from "./figures";
import { Quiet, Section } from "./layout";
import { HistoryCharts } from "./history-charts";
import { latestFigures, readFromOf, type LatestFigures } from "./results-view";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Period } from "@/lib/financials/types";

/** The Financials tab's mark for a column read at view time: "10-K · new", with the filing in a tooltip. */
export function ReadMark({ period, className }: { period: Period; className?: string }) {
  const read = readFromOf(period);
  if (!read) return null;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("num text-[10px] font-normal uppercase tracking-wide text-foreground/80 underline decoration-dotted underline-offset-2", className)}>
          {read.form} · new
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 text-xs">
        Read at view time from the {read.form} filed {fmtDate(read.filed)}. The scheduled rebuild has not added this quarter yet.
        {read.form.startsWith("10-K") && " A 10-K states the full year, so the quarter is derived: the year less the first nine months."}
      </TooltipContent>
    </Tooltip>
  );
}

const releaseUrl = (cik: string | undefined, r: EarningsRelease) =>
  cik ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accn.replace(/-/g, "")}/${r.doc}` : null;

/** Opens an earnings release in the source panel. */
function ReleaseLink({ ticker, r, children, className }: { ticker: string; r: EarningsRelease; children?: React.ReactNode; className?: string }) {
  const { open } = useSource();
  return (
    <button
      type="button"
      onClick={() => open({ ticker, label: r.title, unit: "", value: 0, doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.filed, title: r.title } })}
      className={cn("inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      {children ?? `8-K, ${fmtDate(r.filed)}`}
    </button>
  );
}

// ───────────────────────── Latest quarter

interface ScoreRow {
  key: string;
  label: string;
  unit: FigUnit;
  get: (r: QuarterRecord) => Figure | null;
  /** Margins compare in percentage points. */
  ratio?: boolean;
  growthKey?: "revenue" | "profit" | "netIncome" | "eps" | "fcf";
}

export function scoreRows(pl: ProfitLine): ScoreRow[] {
  return [
    { key: "revenue", label: "Revenue", unit: "usd", get: (r) => r.revenue, growthKey: "revenue" },
    { key: "grossMargin", label: "Gross margin", unit: "pct", get: (r) => r.grossMargin, ratio: true },
    { key: "profit", label: pl.label, unit: "usd", get: (r) => r.profit, growthKey: "profit" },
    { key: "profitMargin", label: pl.marginLabel, unit: "pct", get: (r) => r.profitMargin, ratio: true },
    { key: "netIncome", label: "Net income", unit: "usd", get: (r) => r.netIncome, growthKey: "netIncome" },
    { key: "eps", label: "Diluted EPS", unit: "usdPerShare", get: (r) => r.eps, growthKey: "eps" },
    { key: "fcf", label: "Free cash flow", unit: "usd", get: (r) => r.fcf, growthKey: "fcf" },
  ];
}

function Change({ ticker, row, cur, base, label, period }: { ticker: string; row: ScoreRow; cur: QuarterRecord; base: QuarterRecord | null; label: string; period: string }) {
  if (!base) return <span className="num text-muted-foreground">–</span>;
  if (row.ratio) {
    const pc = pointsChange(row.get(cur), row.get(base), row.label, label === "qoq" ? "the prior quarter" : "a year earlier");
    return <SourceNum ticker={ticker} f={pc} label={`${row.label} change`} period={period} unit="pct" text={signedPts(pc?.v)} className={toneText(pc?.v)} />;
  }
  const g = row.growthKey ? (label === "qoq" ? cur.qoq[row.growthKey] : cur.yoy[row.growthKey]) : null;
  return <SourceNum ticker={ticker} f={g ?? null} label={`${row.label} change`} period={period} unit="pct" text={signedPct(g?.v)} className={toneText(g?.v)} />;
}

export function LatestQuarter({
  ticker,
  cik,
  records,
  profit,
  pending,
  readNote,
  score,
  companyName,
}: {
  ticker: string;
  cik?: string;
  /** All quarters, oldest first */
  records: QuarterRecord[];
  profit: ProfitLine;
  pending: PendingRelease | null;
  /** What the view-time read of a newer 10-Q/10-K did (resultsReadNote), or null when the statements are current */
  readNote?: string | null;
  score: Scorecard | null;
  companyName: string;
}) {
  const idx = (() => {
    for (let i = records.length - 1; i >= 0; i--) if (records[i].revenue || records[i].profit || records[i].netIncome) return i;
    return -1;
  })();
  if (idx < 0)
    return (
      <Section id="latest" name="Latest quarter" title="Latest quarter">
        <Quiet>No quarterly statements for this company yet.</Quiet>
      </Section>
    );
  const periods = records.map((r) => r.period);
  const cur = records[idx];
  const pi = priorIndex(periods, idx);
  const yi = yearAgoIndex(periods, idx);
  const prior = pi >= 0 ? records[pi] : null;
  const year = yi >= 0 ? records[yi] : null;
  const rows = scoreRows(profit).filter((r) => r.get(cur));
  const p = cur.period;
  const src = cur.revenue?.cell?.src ?? cur.netIncome?.cell?.src ?? cur.eps?.cell?.src;
  const filedFrom = src ? `${src.accn}` : null;
  const figs = latestFigures(cur, pending);

  return (
    <Section
      id="latest"
      name="Latest quarter"
      title={`Latest quarter · ${p.label}`}
      caption={
        <>
          Quarter ended {fmtDate(p.end)}
          {cur.release && (
            <>
              {" · reported "}
              <ReleaseLink ticker={ticker} r={cur.release} />
            </>
          )}
          {filedFrom && <> · figures from the filed statements, click any value for its source</>}
        </>
      }
    >
      {pending && <PendingNote ticker={ticker} cik={cik} pending={pending} score={score} companyName={companyName} readNote={readNote} figs={figs} />}
      {!pending && readNote && (
        <p data-section="Read at view time" className="border-b bg-secondary/40 px-4 py-2.5 text-[13px] text-muted-foreground">
          {readNote}
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="relative min-w-0 overflow-x-auto lg:border-r">
          <table className="w-full min-w-[560px] text-[13px]">
            <caption className="sr-only">
              {p.label} results against the prior quarter and the same quarter a year earlier
            </caption>
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="py-1.5 pl-4 pr-2 text-left font-normal">
                  <span className="eyebrow">USD</span>
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium text-foreground">
                  {p.label}
                  <ReadMark period={p} className="ml-1.5" />
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  {prior ? prior.period.label : "Prior quarter"}
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  vs prior
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  {year ? year.period.label : "Year earlier"}
                </th>
                <th scope="col" className="py-1.5 pl-2 pr-4 text-right font-normal">
                  vs year earlier
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn("h-7 border-b border-border/60 last:border-0", r.ratio && "text-muted-foreground")}>
                  <th scope="row" className={cn("py-1 pl-4 pr-2 text-left font-normal", r.ratio && "pl-7")}>
                    {r.label}
                  </th>
                  <td className="px-2 py-1 text-right font-medium text-foreground">
                    <SourceNum ticker={ticker} f={r.get(cur)} label={r.label} period={p.label} unit={r.unit} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    {prior ? <SourceNum ticker={ticker} f={r.get(prior)} label={r.label} period={prior.period.label} unit={r.unit} /> : <span className="text-muted-foreground">–</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Change ticker={ticker} row={r} cur={cur} base={prior} label="qoq" period={`${p.label} vs ${prior?.period.label ?? "prior quarter"}`} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    {year ? <SourceNum ticker={ticker} f={r.get(year)} label={r.label} period={year.period.label} unit={r.unit} /> : <span className="text-muted-foreground">–</span>}
                  </td>
                  <td className="py-1 pl-2 pr-4 text-right">
                    <Change ticker={ticker} row={r} cur={cur} base={year} label="yoy" period={`${p.label} vs ${year?.period.label ?? "a year earlier"}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <DerivedQ4Note derived={[cur, prior, year].some((r) => r?.eps?.q4 === "derived")} withheld={[cur, prior, year].some((r) => r?.q4EpsWithheld)} className="border-t px-4 py-2" />
        </div>
        <div className="grid min-w-0 grid-cols-2 content-start divide-x border-t lg:grid-cols-1 lg:divide-x-0 lg:divide-y lg:border-t-0 lg:border-b-0">
          <Stat
            className="bg-transparent"
            label={`EPS vs the Street, ${p.label}`}
            value={
              cur.surprise?.actual != null && cur.surprise.estimate != null ? (
                <span className="num">
                  {fmtPrice(cur.surprise.actual)} <span className="text-[13px] font-normal text-muted-foreground">vs {fmtPrice(cur.surprise.estimate)}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">–</span>
              )
            }
            hint={
              cur.surprise?.surprisePct != null ? (
                <>
                  <span className={cn("num", toneText(cur.surprise.surprisePct))}>{signedPct(cur.surprise.surprisePct)}</span> surprise on the provider's basis. That EPS is often adjusted, so it can differ from filed diluted EPS
                </>
              ) : (
                "No consensus on record for this quarter"
              )
            }
          />
          <ReactionStat ticker={ticker} quarter={p.label} reaction={cur.reaction} release={cur.release} window={cur.window} />
        </div>
      </div>
    </Section>
  );
}

/** Longest straddle (snapshot to expiry, days) set beside the typical reaction: two weeks around the report. */
const MAX_SPAN = 14;

/** "Adjusted close $271.40 on 29 Oct → $262.24 on 31 Oct": the two prices behind a reaction (earnings-M4). */
export function windowText(w: ReactionWindow | null | undefined): string | null {
  if (!w) return null;
  const d = (x: string) => fmtDate(x, { month: "short", day: "numeric", year: "numeric" });
  return `Adjusted close $${w.from.close.toFixed(2)} on ${d(w.from.date)} to $${w.to.close.toFixed(2)} on ${d(w.to.date)}`;
}

function ReactionStat({
  ticker,
  quarter,
  reaction,
  release,
  window: w,
}: {
  ticker: string;
  quarter: string;
  reaction: Reaction | null;
  release: EarningsRelease | null;
  window: ReactionWindow | null;
}) {
  return (
    <Stat
      className="bg-transparent"
      label={`Stock reaction, 2 days, ${quarter}`}
      value={reaction ? <span className={cn("num", toneText(reaction.move))}>{signedPct(reaction.move)}</span> : <span className="text-muted-foreground">–</span>}
      hint={
        reaction ? (
          <>
            {reactionParts(reaction).map((part, i) => (
              <span key={part.key}>
                {i > 0 && " · "}
                <span className={cn("num", toneText(part.v))}>{signedPct(part.v)}</span> {part.text}
              </span>
            ))}
            {release && (
              <>
                {reactionParts(reaction).length > 0 && " · "}
                <ReleaseLink ticker={ticker} r={release}>
                  release
                </ReleaseLink>
              </>
            )}
            {w && <span className="mt-0.5 block">{windowText(w)}</span>}
          </>
        ) : release ? (
          "Not enough price history around the release"
        ) : (
          "No earnings release matched to this quarter"
        )
      }
    />
  );
}

/** The parts of a reaction's sub-line that have a value: a missing figure drops its phrase rather than printing a mark inside the sentence (p5-shots L12). */
function reactionParts(r: Reaction): { key: string; v: number; text: string }[] {
  const out: { key: string; v: number; text: string }[] = [];
  if (r.excess != null) out.push({ key: "excess", v: r.excess, text: "vs S&P 500" });
  if (r.drift20 != null) out.push({ key: "drift", v: r.drift20, text: "over the next 20 sessions" });
  return out;
}

/** The company has reported a newer quarter than the statements hold: say so precisely, with what is known from the release. */
function PendingNote({
  ticker,
  cik,
  pending,
  score,
  companyName,
  readNote,
  figs,
}: {
  ticker: string;
  cik?: string;
  pending: PendingRelease;
  score: Scorecard | null;
  companyName: string;
  readNote?: string | null;
  figs: LatestFigures;
}) {
  const q = figs.release?.label;
  const r = pending.release;
  const url = releaseUrl(cik, r);
  const sc = score && score.accession === r.accn ? score : null;
  const metric = (id: string) => sc?.metrics.find((m) => m.id === id && m.value != null && !m.unconfirmed) ?? null;
  const rev = metric("revenue");
  const eps = metric("eps_gaap") ?? metric("eps_adjusted");
  return (
    <div data-section="Newest release" className="border-b bg-secondary/40 px-4 py-2.5">
      <p className="text-[13px]">
        <span className="font-medium">
          {sc?.quarter_end
            ? `${companyName} reported the quarter ended ${fmtDate(sc.quarter_end)} on ${fmtDate(r.filed)}.`
            : pending.count > 1
              ? `${companyName} has filed ${pending.count} earnings releases since ${pending.throughLabel}, the latest on ${fmtDate(r.filed)}.`
              : `${companyName} filed an earnings release on ${fmtDate(r.filed)}, after ${pending.throughLabel}.`}
        </span>{" "}
        <span className="text-muted-foreground">
          {sc?.quarter_end ? "Its statements are not in these tables yet; they" : "These tables"} run through the quarter ended {fmtDate(pending.throughEnd)}.{" "}
          {readNote && <>{readNote} </>}
        </span>
        <ReleaseLink ticker={ticker} r={r} className="text-[13px]">
          Open the release
        </ReleaseLink>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            SEC.gov <ExternalLink className="size-3" />
          </a>
        )}
      </p>
      <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
        {rev && (
          <div>
            <dt className="inline">Revenue in the release </dt>
            <dd className="num inline font-medium text-foreground" title={rev.quote ?? undefined}>
              {rev.printed ?? fmtCompactUsd(rev.value)}
            </dd>
          </div>
        )}
        {eps && (
          <div>
            <dt className="inline">{eps.label} in the release </dt>
            <dd className="num inline font-medium text-foreground" title={eps.quote ?? undefined}>
              {eps.printed ?? fmtFig(eps.value, "usdPerShare")}
            </dd>
          </div>
        )}
        {pending.surprise?.actual != null && pending.surprise.estimate != null && (
          <div>
            <dt className="inline">EPS vs the Street, {q} </dt>
            <dd className="num inline text-foreground">
              {fmtPrice(pending.surprise.actual)} vs {fmtPrice(pending.surprise.estimate)},{" "}
              <span className={toneText(pending.surprise.surprisePct)}>{signedPct(pending.surprise.surprisePct)}</span>
            </dd>
          </div>
        )}
        {pending.reaction && (
          <div>
            <dt className="inline">Stock reaction, 2 days, {q} </dt>
            <dd className="num inline text-foreground">
              <span className={toneText(pending.reaction.move)}>{signedPct(pending.reaction.move)}</span>
              {pending.reaction.excess != null && (
                <>
                  , <span className={toneText(pending.reaction.excess)}>{signedPct(pending.reaction.excess)}</span> vs S&amp;P 500
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
      {figs.why && <p className="mt-1 text-[11px] text-muted-foreground">{figs.why}</p>}
    </div>
  );
}

// ───────────────────────── History

export function History({ ticker, quarters, profit }: { ticker: string; quarters: QuarterRecord[]; profit: ProfitLine }) {
  if (quarters.length < 2) return null;
  const hasFcf = quarters.some((q) => q.fcf);
  const hasSurprise = quarters.some((q) => q.surprise);
  const hasReaction = quarters.some((q) => q.reaction);
  const n = quarters.length;
  return (
    <Section
      id="history"
      name="Quarterly history"
      title="Quarterly history"
      caption={`Last ${n} quarters, newest first. Growth is against the same quarter a year earlier. Reaction: close before the release to the close the day after; drift: the 20 sessions after that.`}
    >
      <HistoryCharts quarters={[...quarters].reverse()} profit={profit} />
      <div className="relative min-w-0 overflow-x-auto border-t">
        <table className="w-full min-w-[880px] bg-card text-[13px]">
          <caption className="sr-only">Quarterly results, growth, margins, consensus surprise and stock reaction</caption>
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" rowSpan={2} className="sticky left-0 z-[1] border-b bg-card py-1.5 pl-4 pr-2 text-left align-bottom font-normal">
                Quarter
              </th>
              <th scope="colgroup" colSpan={hasFcf ? 7 : 6} className="border-b px-2 pt-1.5 text-left font-normal">
                <span className="eyebrow">Results · USD</span>
              </th>
              {hasSurprise && (
                <th scope="colgroup" className="border-b border-l px-2 pt-1.5 text-left font-normal">
                  <span className="eyebrow">Street</span>
                </th>
              )}
              {hasReaction && (
                <th scope="colgroup" colSpan={3} className="border-b border-l px-2 pt-1.5 text-left font-normal">
                  <span className="eyebrow">Stock reaction</span>
                </th>
              )}
            </tr>
            <tr className="border-b">
              <Th>Revenue</Th>
              <Th>y/y</Th>
              <Th>{profit.key === "operatingIncome" ? "Op. margin" : "Pre-tax margin"}</Th>
              <Th>Net income</Th>
              <Th>EPS</Th>
              <Th>EPS y/y</Th>
              {hasFcf && <Th>FCF</Th>}
              {hasSurprise && <Th className="border-l">EPS surprise</Th>}
              {hasReaction && (
                <>
                  <Th className="border-l">2-day</Th>
                  <Th>vs S&amp;P</Th>
                  <Th className="pr-4">20-day drift</Th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {quarters.map((q, i) => {
              const pl = q.period.label;
              return (
                <tr key={q.period.key} className={cn("h-7 border-b border-border/60 last:border-0", i === 0 && "font-medium")}>
                  <th scope="row" className="sticky left-0 z-[1] bg-card py-1 pl-4 pr-2 text-left font-normal whitespace-nowrap">
                    <span className={cn("num", i === 0 && "font-medium")}>{pl}</span>{" "}
                    <ReadMark period={q.period} className="mr-1" />
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">{fmtDate(q.period.end, { month: "short", year: "numeric" })}</span>
                  </th>
                  <Td>
                    <SourceNum ticker={ticker} f={q.revenue} label="Revenue" period={pl} unit="usd" />
                  </Td>
                  <Td>
                    <SourceNum ticker={ticker} f={q.yoy.revenue} label="Revenue growth" period={pl} unit="pct" text={signedPct(q.yoy.revenue?.v)} className={toneText(q.yoy.revenue?.v)} />
                  </Td>
                  <Td>
                    <SourceNum ticker={ticker} f={q.profitMargin} label={profit.marginLabel} period={pl} unit="pct" />
                  </Td>
                  <Td>
                    <SourceNum ticker={ticker} f={q.netIncome} label="Net income" period={pl} unit="usd" />
                  </Td>
                  <Td>
                    <SourceNum ticker={ticker} f={q.eps} label="Diluted EPS" period={pl} unit="usdPerShare" />
                  </Td>
                  <Td>
                    <SourceNum ticker={ticker} f={q.yoy.eps} label="EPS growth" period={pl} unit="pct" text={signedPct(q.yoy.eps?.v)} className={toneText(q.yoy.eps?.v)} />
                  </Td>
                  {hasFcf && (
                    <Td>
                      <SourceNum ticker={ticker} f={q.fcf} label="Free cash flow" period={pl} unit="usd" />
                    </Td>
                  )}
                  {hasSurprise && (
                    <Td className="border-l" title={q.surprise ? `EPS ${q.surprise.actual} vs consensus ${q.surprise.estimate?.toFixed(2)} (estimates provider)` : undefined}>
                      <span className={cn("num", toneText(q.surprise?.surprisePct))}>{signedPct(q.surprise?.surprisePct)}</span>
                    </Td>
                  )}
                  {hasReaction && (
                    <>
                      <Td className="border-l" title={q.reaction ? `Release ${fmtDate(q.reaction.date)}${q.window ? `. ${windowText(q.window)}` : ""}` : undefined}>
                        <span className={cn("num", toneText(q.reaction?.move))}>{signedPct(q.reaction?.move)}</span>
                      </Td>
                      <Td>
                        <span className={cn("num", toneText(q.reaction?.excess))}>{signedPct(q.reaction?.excess)}</span>
                      </Td>
                      <Td className="pr-4">
                        <span className={cn("num", toneText(q.reaction?.drift20))}>{signedPct(q.reaction?.drift20)}</span>
                      </Td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DerivedQ4Note derived={quarters.some((q) => q.eps?.q4 === "derived")} withheld={quarters.some((q) => q.q4EpsWithheld)} className="border-t px-4 py-2" />
    </Section>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-2 py-1.5 text-right font-normal whitespace-nowrap", className)}>
      {children}
    </th>
  );
}
function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td title={title} className={cn("px-2 py-1 text-right whitespace-nowrap", className)}>
      {children}
    </td>
  );
}

// ───────────────────────── Next report

export function NextReport({
  next,
  consensus,
  pricing,
  pricedAsOf,
  pricedFrom = "the close",
  typical,
  guidance,
  listenFor,
}: {
  next: NextEarnings | null;
  consensus: PeriodEstimate | null;
  pricing: EarningsPricing | null;
  pricedAsOf: string | null;
  /** where and when the option quotes were taken, e.g. "the Yahoo Finance close" */
  pricedFrom?: string;
  typical: ReactionSummary | null;
  guidance: { quote: string; summary: string; callQuarter: string | null; callDate: string; url: string }[];
  listenFor: string[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const daysTo = next ? Math.round((Date.parse(next.date) - Date.parse(today)) / 86_400_000) : null;
  // The options figure sits beside the typical reaction only when it prices mainly the report: an expiry
  // within REPORT_EXPIRY_LAG days after it, quoted no more than MAX_SPAN days before that expiry (earnings-M1).
  const span = pricing && pricedAsOf ? Math.round((Date.parse(pricing.point.e) - Date.parse(pricedAsOf)) / 86_400_000) : null;
  const pricingNear = !!pricing && pricing.lag <= REPORT_EXPIRY_LAG && span != null && span <= MAX_SPAN;
  return (
    <Section
      id="next"
      name="Next report"
      title="Next report"
      caption={next ? `Date from ${next.basis}` : "No date known yet"}
    >
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-4">
        <Stat
          label={next?.estimated ? "Expected date (estimate)" : "Date"}
          value={next ? fmtDate(next.date) : <span className="text-muted-foreground">–</span>}
          hint={daysTo != null ? (daysTo >= 0 ? `in ${daysTo} days` : `${-daysTo} days ago`) : undefined}
        />
        <Stat
          label={consensus?.endDate ? `Street EPS · quarter to ${fmtDate(consensus.endDate, { month: "short", year: "numeric" })}` : "Street EPS"}
          value={consensus?.eps.avg != null ? <span className="num">{fmtPrice(consensus.eps.avg)}</span> : <span className="text-muted-foreground">–</span>}
          hint={
            consensus ? (
              <>
                {consensus.eps.analysts != null && `${consensus.eps.analysts} analysts`}
                {consensus.eps.yearAgo != null && ` · year ago ${fmtPrice(consensus.eps.yearAgo)}`}
                {consensus.revenue.avg != null && ` · revenue ${fmtCompactUsd(consensus.revenue.avg)}`}
              </>
            ) : (
              "No analyst estimates for this company"
            )
          }
        />
        <Stat
          label="Move priced by options"
          value={
            pricingNear ? (
              <span className="num">±{(pricing!.point.m * 100).toFixed(1)}%</span>
            ) : (
              <span className="text-muted-foreground">–</span>
            )
          }
          hint={
            // An expiry weeks after the report also prices ordinary movement, so it is not set beside
            // the typical reaction (earnings-M1); the options panel below still shows it.
            pricingNear
              ? `At-the-money straddle to ${fmtDate(pricing!.point.e)}, the ${span} days from ${pricedFrom} of ${fmtDate(pricedAsOf!, { month: "short", day: "numeric" })}${
                  pricing!.lag > 0 ? `, ${pricing!.lag} ${pricing!.lag === 1 ? "day" : "days"} after the report` : ""
                }`
              : pricing && pricing.lag > REPORT_EXPIRY_LAG
                ? `No expiry close to the report yet: the nearest, ${fmtDate(pricing.point.e)}, is ${pricing.lag} days after it`
                : pricing && span != null
                  ? `Options price ±${(pricing.point.m * 100).toFixed(1)}% to ${fmtDate(pricing.point.e)}, but that spans ${span} days of ordinary trading, not mainly the report`
                : "No listed expiry covers the report yet, or no options snapshot"
          }
        />
        <Stat
          label={typical ? `Typical reaction · last ${typical.n} reports` : "Typical reaction"}
          value={typical ? <span className="num">±{(typical.medianAbs * 100).toFixed(1)}%</span> : <span className="text-muted-foreground">–</span>}
          hint={
            typical ? (
              <>
                median 2-day move · up {Math.round(typical.upRate * 100)}% of the time
                {typical.medianDrift20 != null && (
                  <>
                    {" · "}median drift <span className={cn("num", toneText(typical.medianDrift20))}>{signedPct(typical.medianDrift20)}</span>
                  </>
                )}
              </>
            ) : (
              "Needs three past releases with prices"
            )
          }
        />
      </div>
      {guidance.length > 0 && (
        <div className="border-t px-4 py-3">
          <h3 className="eyebrow mb-1">Guidance on the {guidance[0].callQuarter ?? fmtDate(guidance[0].callDate)} call</h3>
          <p className="mb-2">
            <MachineWritten by="Quotes checked word for word against the transcript; the line under each is a model's summary." href={guidance[0].url} sourceLabel="Transcript" />
          </p>
          <ul className="grid gap-2">
            {guidance.map((g, i) => (
              <li key={i} className="grid gap-0.5 text-[13px]">
                <a href={g.url} target="_blank" rel="noopener noreferrer" className="border-l-2 border-border pl-2 italic hover:text-foreground">
                  “{g.quote}” <ExternalLink className="inline size-3 not-italic" />
                </a>
                <span className="pl-2 text-[11px] text-muted-foreground">{g.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {listenFor.length > 0 && (
        <div className="border-t px-4 py-3">
          <h3 className="eyebrow mb-1">Suggested questions</h3>
          <p className="mb-2">
            <MachineWritten by="Suggested by a language model from the release and past calls." />
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-[13px]">
            {listenFor.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}
