// Trade ideas as one dense table: stock, side, the reasons behind the idea, what those rules made
// against the S&P 500, and the risk plan. A row opens in place for each signal's detail, its filed
// sources (click to open the filing) and the rule's history.
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { TickerMark } from "@/components/app/ticker";
import { Button } from "@/components/ui/button";
import { useSource } from "@/components/source/source-context";
import { SIGNAL_META, type BacktestStats } from "@/lib/signals/core";
import { count, nameOf, pct, price } from "@/lib/signals/format";
import { READING_LABEL, ruleRecord, type RankedIdea } from "@/lib/signals/ideas";
import { cn } from "@/lib/utils";
import { CAPTION, Fact, NUM, SideTag, TD, TH } from "./parts";

const COLS = 8;

/** "All companies: +0.8% against the S&P 500 over three months, beat it 48% of 598 times." */
function historyLine(who: string, s: BacktestStats): string {
  if (!s.n || s.avgExcess == null) return `${who}: no history.`;
  return `${who}: ${pct(s.avgExcess, 1)} against the S&P 500 over three months, beat it ${pct(s.hitRate, 0, false)} of ${count(s.n)} times.`;
}

export function IdeasTable({ rows, priceOf, onTrack, busy }: { rows: readonly RankedIdea[]; priceOf: (ticker: string) => number | undefined; onTrack: (i: RankedIdea) => void; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="@container -mx-3.5 overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse sm:min-w-[860px]">
        <thead>
          <tr className="border-b">
            <th className={cn(TH, "w-7 pl-3.5 pr-0")} aria-label="Open" />
            <th scope="col" className={TH}>Stock</th>
            <th scope="col" className={TH}>Side</th>
            <th scope="col" className={TH}>Reasons</th>
            <th scope="col" className={cn(TH, "text-right")} title="Average three-month return against the S&P 500 of the rules behind the idea, over all their past firings. A dash means none of its rules has made money.">Rules made</th>
            <th scope="col" className={cn(TH, "text-right")} title="Latest price, or the scan price when no quote is available">Price</th>
            <th scope="col" className={cn(TH, "text-right")} title="2 times the 14-day average daily range from the scan price">Stop</th>
            <th scope="col" className={cn(TH, "pr-3.5 text-right")} title="Twice the distance to the stop">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((idea) => {
            const isOpen = open === idea.ticker;
            const aligned = idea.signals.filter((s) => SIGNAL_META[s.kind].dir === idea.direction);
            const reasons = aligned.map((s) => SIGNAL_META[s.kind].label).join(" + ");
            const live = priceOf(idea.ticker);
            return (
              <Fragment key={idea.ticker}>
                <tr data-agent-click aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : idea.ticker)} className={cn("cursor-pointer border-b transition-colors duration-150 hover:bg-highlight-soft/40", isOpen && "bg-highlight-soft/30")}>
                  <td className={cn(TD, "w-7 pl-3.5 pr-0")}>
                    <button
                      type="button"
                      aria-label={`${isOpen ? "Close" : "Open"} ${idea.ticker} detail`}
                      aria-expanded={isOpen}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setOpen(isOpen ? null : idea.ticker);
                      }}
                      className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", isOpen && "rotate-90")} aria-hidden />
                    </button>
                  </td>
                  <td className={cn(TD, "max-w-[15rem]")}>
                    <TickerMark ticker={idea.ticker} className="align-top sm:hidden" />
                    <TickerMark ticker={idea.ticker} name={nameOf(idea.ticker)} className="hidden align-top sm:inline-flex" />
                  </td>
                  <td className={TD}>
                    <SideTag side={idea.direction === "long" ? 1 : -1} />
                  </td>
                  <td className={cn(TD, "max-w-[11rem] truncate sm:max-w-[24rem]")} title={reasons}>
                    {reasons}
                    {idea.opposing > 0 && <span className="text-muted-foreground"> · {idea.opposing} against</span>}
                  </td>
                  <td className={cn(TD, NUM, idea.expected == null ? "text-muted-foreground" : "")}>{pct(idea.expected, 1)}</td>
                  <td className={cn(TD, NUM)}>{price(live ?? idea.price)}</td>
                  <td className={cn(TD, NUM)}>{price(idea.plan.stop)}</td>
                  <td className={cn(TD, NUM, "pr-3.5")}>{price(idea.plan.target)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b bg-highlight-soft/20">
                    <td colSpan={COLS} className="p-0">
                      <div className="sticky left-0 w-[100cqw] px-3.5 py-3">
                        <IdeaDetail idea={idea} live={live} onTrack={() => onTrack(idea)} busy={busy} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IdeaDetail({ idea, live, onTrack, busy }: { idea: RankedIdea; live?: number; onTrack: () => void; busy: boolean }) {
  const { open } = useSource();
  // Signed distances from the scan price: a short's stop sits above it and its target below.
  const toStop = idea.plan.stop / idea.plan.entry - 1;
  const toTarget = idea.plan.target / idea.plan.entry - 1;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-2">
        {idea.signals.map((s) => {
          const meta = SIGNAL_META[s.kind];
          const rec = ruleRecord(s.kind, s.stats);
          const against = meta.dir !== idea.direction;
          return (
            <div key={s.kind} className="min-w-0">
              <div className="text-[13px] font-semibold leading-5">
                {meta.label}
                {against && <span className="font-normal text-muted-foreground"> · points the other way</span>}
              </div>
              <p className="text-[13px] leading-5">{s.detail}</p>
              <p className={cn(CAPTION, "mt-0.5")}>
                {historyLine("All companies", s.stats)} {READING_LABEL[rec.reading]}.
              </p>
              <p className={CAPTION}>
                {historyLine(`${idea.ticker} alone`, s.own)}
                {s.own.n > 0 && s.own.n < 30 ? " Too few to read." : ""}
              </p>
              {s.evidence.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.evidence.map((e, k) => (
                    <button
                      key={k}
                      type="button"
                      title="Open the filing this figure comes from"
                      className="inline-flex min-h-7 items-center gap-1 rounded border bg-card px-1.5 text-[11px] leading-4 transition-colors duration-150 hover:bg-highlight-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => open({ ticker: idea.ticker, label: e.label, periodLabel: e.periodLabel, unit: e.unit, value: e.value, src: e.src, derived: e.derived, doc: e.doc })}
                    >
                      <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      {e.label}
                      {e.periodLabel ? ` · ${e.periodLabel}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
        <Fact label="Scan price">{price(idea.plan.entry)}</Fact>
        <Fact label="Latest price">{price(live)}</Fact>
        <Fact label="Stop">{`${price(idea.plan.stop)} (${pct(toStop, 1)})`}</Fact>
        <Fact label="Target">{`${price(idea.plan.target)} (${pct(toTarget, 1)})`}</Fact>
        <Fact label="Average daily range">{price(idea.plan.atr)}</Fact>
        <Fact label="Hold">about 3 months</Fact>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="outline" onClick={onTrack} disabled={busy}>
          <Plus aria-hidden /> Paper trade
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link to="/app/companies/$ticker" params={{ ticker: idea.ticker }}>
            Open {idea.ticker}
          </Link>
        </Button>
      </div>
    </div>
  );
}
