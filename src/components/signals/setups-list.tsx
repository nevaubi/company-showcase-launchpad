// Today's setups as one dense table. Signals are grouped under their rule, and the rule's evidence
// ("why this is here") is stated once per group instead of on every row. A row opens in place for
// the signal's detail, risk plan and actions, so nothing navigates away.
import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronRight, Plus } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { TickerMark } from "@/components/app/ticker";
import { Button } from "@/components/ui/button";
import { impliedMoveBy } from "@/lib/options/core";
import { optionsLatestQuery } from "@/lib/options/data";
import { LISTED, type EvidenceBook } from "@/lib/signals/evidence";
import { evidenceLine, liveLine } from "@/lib/signals/explain";
import { dayLong, dayShort, holdLabel, num, pct, price, tidyDetail, usdCompact } from "@/lib/signals/format";
import { MAX_ATR_SHARE, type RankedSetup } from "@/lib/signals/rank";
import { STRATEGY } from "@/lib/signals/strategies";
import { cn } from "@/lib/utils";
import { CAPTION, Fact, GradeTag, NUM, SideTag, TD, TH } from "./parts";

const COLS = 8;

export function SetupsList({
  rows,
  book,
  sparks,
  totals,
  onTrack,
  tracking,
}: {
  rows: readonly RankedSetup[];
  book: EvidenceBook;
  /** Signals each rule has after the filters, before the limits, so a group can say "5 of 129". */
  totals?: Map<string, number>;
  /** Sixty closes per ticker; rows show a dash until they arrive. */
  sparks: Map<string, number[]> | undefined;
  onTrack: (r: RankedSetup) => void;
  tracking: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, RankedSetup[]>();
    for (const r of rows) m.set(r.key, [...(m.get(r.key) ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="@container -mx-3.5 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse sm:min-w-[820px]">
        <thead>
          <tr className="border-b">
            <th className={cn(TH, "w-7 pl-3.5 pr-0")} aria-label="Open" />
            <th scope="col" className={TH}>Stock</th>
            <th scope="col" className={TH}>Signal</th>
            <th scope="col" className={cn(TH, "hidden text-right sm:table-cell")}>Fired</th>
            <th scope="col" className={cn(TH, "text-right")} title="Last close on the signal's session">Price</th>
            <th scope="col" className={cn(TH, "text-right")} title="2 times the 14-day average daily range from the price (2.5 times for momentum, event and supply-chain rules)">Stop</th>
            <th scope="col" className={cn(TH, "text-right")} title="1.5 times the distance to the stop (2 times for momentum, event and supply-chain rules)">Target</th>
            <th scope="col" className={cn(TH, "pr-3.5")}>60 days</th>
          </tr>
        </thead>
        {groups.map(([key, list]) => {
          const e = book.byKey.get(key);
          if (!e) return null;
          const listed = LISTED.includes(e.grade);
          return (
            <tbody key={key} data-rule={key}>
              <tr className="border-b bg-muted/40">
                <td colSpan={COLS} className="p-0">
                  <div className="sticky left-0 w-[100cqw] px-3.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5">
                      <span className="font-semibold">{STRATEGY[e.strategy]?.label ?? e.strategy}</span>
                      <SideTag side={e.side} />
                      <span className="text-muted-foreground">{holdLabel(e.horizon)}</span>
                      <GradeTag grade={e.grade} />
                      {listed && (
                        <span className="num" title="The rule's average after costs since 2022, shrunk toward zero for luck and adjusted for today's market">
                          Expected edge {pct(e.edge)} a trade
                        </span>
                      )}
                      {totals && (totals.get(key) ?? 0) > list.length && (
                        <span className="num text-[11px] text-muted-foreground" title="Signals of this rule on the page, out of those that pass the filters">
                          {list.length} of {totals.get(key)} shown
                        </span>
                      )}
                    </div>
                    <p className={cn(CAPTION, "mt-0.5 max-w-[68rem]")}>
                      {evidenceLine(e, book.discovery)} {liveLine(e.live)}
                    </p>
                  </div>
                </td>
              </tr>
              {list.map((r) => {
                const isOpen = open === r.id;
                const spark = sparks?.get(r.ticker);
                return (
                  <Fragment key={r.id}>
                    <tr
                      data-agent-click
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.id)}
                      className={cn("cursor-pointer border-b transition-colors duration-150 hover:bg-highlight-soft/40", isOpen && "bg-highlight-soft/30")}
                    >
                      <td className={cn(TD, "w-7 pl-3.5 pr-0")}>
                        <button
                          type="button"
                          aria-label={`${isOpen ? "Close" : "Open"} ${r.ticker} detail`}
                          aria-expanded={isOpen}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setOpen(isOpen ? null : r.id);
                          }}
                          className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", isOpen && "rotate-90")} aria-hidden />
                        </button>
                      </td>
                      <td className={cn(TD, "max-w-[15rem]")}>
                        <TickerMark ticker={r.ticker} className="align-top sm:hidden" />
                        <TickerMark ticker={r.ticker} name={r.name} className="hidden align-top sm:inline-flex" />
                      </td>
                      <td className={cn(TD, "max-w-[9rem] truncate sm:max-w-[22rem]")} title={tidyDetail(r.detail)}>
                        {r.detail ? tidyDetail(r.detail) : <span className="text-muted-foreground">–</span>}
                      </td>
                      <td className={cn(TD, NUM, "hidden text-muted-foreground sm:table-cell")}>{dayShort(r.firedAt)}</td>
                      <td className={cn(TD, NUM)}>{price(r.price)}</td>
                      <td className={cn(TD, NUM)}>{r.barsOk ? price(r.stop) : <span className="text-muted-foreground">–</span>}</td>
                      <td className={cn(TD, NUM)}>{r.barsOk ? price(r.target) : <span className="text-muted-foreground">–</span>}</td>
                      <td className={cn(TD, "pr-3.5")}>
                        {spark && r.barsOk ? <Sparkline values={spark} tone="ink" fill={false} strokeWidth={1.25} className="block h-5 w-20" /> : <span className="text-muted-foreground">–</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-highlight-soft/20">
                        <td colSpan={COLS} className="p-0">
                          <div className="sticky left-0 w-[100cqw] px-3.5 py-3">
                            <SetupDetail r={r} peers={list.length} onTrack={onTrack} tracking={tracking} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/** The signal itself, its risk plan with distances, what options price in, and the actions. */
function SetupDetail({ r, peers, onTrack, tracking }: { r: RankedSetup; peers: number; onTrack: (r: RankedSetup) => void; tracking: boolean }) {
  const opts = useQuery(optionsLatestQuery([r.ticker]));
  const o = opts.data?.get(r.ticker);
  const priced = o ? impliedMoveBy(o.term, Math.ceil((r.horizon * 7) / 5)) : null;
  // Signed distances from the price: a short's stop sits above it and its target below.
  const toStop = r.stop / r.price - 1;
  const toTarget = r.target / r.price - 1;
  const wide = r.family === "momentum" || r.family === "events" || r.family === "links";
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-5">
        {r.detail ? `${tidyDetail(r.detail)}. ` : ""}
        <span className="text-muted-foreground">
          Fired on the close of {dayLong(r.firedAt)}
          {r.liveCaught ? ", caught that night" : ", found on a later scan (not counted in the live record)"}. Enter at the next open, exit at the close {holdLabel(r.horizon)} later, or at the stop or target.
        </span>
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-8">
        <Fact label="Price">{price(r.price)}</Fact>
        <Fact label="Stop">{r.barsOk ? `${price(r.stop)} (${pct(toStop, 1)})` : "–"}</Fact>
        <Fact label="Target">{r.barsOk ? `${price(r.target)} (${pct(toTarget, 1)})` : "–"}</Fact>
        <Fact label="Average daily range">{r.barsOk ? `${price(r.atr)} (${pct(r.atr / r.price, 1, false)})` : "–"}</Fact>
        <Fact label="Traded a day">{usdCompact(r.dollarVolume)}</Fact>
        <Fact label="Cost, round trip">{r.cost == null ? "–" : `${num(r.cost * 1e4, 0)} bp`}</Fact>
        <Fact label="Strength in this rule">{peers > 1 ? `top ${Math.max(1, Math.round((1 - r.strengthPct) * 100))}%` : "only signal"}</Fact>
        <Fact label="Options price in">{priced ? `±${pct(priced.m, 1, false)} by ${dayShort(priced.e)}` : "–"}</Fact>
      </div>
      <p className={CAPTION}>
        {r.barsOk
          ? `The stop is ${wide ? "2.5" : "2"} average daily ranges from the price and the target ${wide ? "2" : "1.5"} times that distance. `
          : `No stop or target: the stored prices for this stock look wrong (an average daily range above ${Math.round(MAX_ATR_SHARE * 100)}% of the price). `}
        {priced && r.barsOk ? `The target is ${num(Math.abs(toTarget) / priced.m, 1)} times the move options price in by ${dayShort(priced.e)}. ` : ""}
        Strength orders signals inside a rule only: on the live record so far it shows no link to the outcome.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => onTrack(r)} disabled={tracking || !r.barsOk}>
          <Plus aria-hidden /> Paper trade
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link to="/app/autopilots" search={{ variant: r.key }}>
            <Bot aria-hidden /> Automate this rule
          </Link>
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }}>
            Open {r.ticker}
          </Link>
        </Button>
      </div>
    </div>
  );
}
