// Today's setups as one dense table. Signals are grouped under their rule, and the rule's evidence
// ("why this is here") is stated once per group instead of on every row. A row opens in place for
// the signal's detail, risk plan and actions, so nothing navigates away.
import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, ChevronRight, Plus } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { TickerMark } from "@/components/app/ticker";
import { Button } from "@/components/ui/button";
import { impliedMoveBy } from "@/lib/options/core";
import { setupQuoteQuery } from "@/lib/options/data";
import { sourceName } from "@/lib/options/source";
import { LISTED, type EvidenceBook } from "@/lib/signals/evidence";
import { evidenceLine, liveLine } from "@/lib/signals/explain";
import { dayLong, dayShort, holdLabel, num, pct, price, tidyDetail, usdCompact, ruleNameOf } from "@/lib/signals/format";
import { MAX_ATR_SHARE, priceGap, type RankedSetup } from "@/lib/signals/rank";
import { STRATEGY } from "@/lib/signals/strategies";
import { cn } from "@/lib/utils";
import { CAPTION, Fact, GradeTag, NUM, SideTag, TD, TH } from "./parts";

export function SetupsList({
  rows,
  book,
  sparks,
  bars,
  sameLive,
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
  /** Market bar closes by `ticker|date`, to check each stored price against. */
  bars?: Map<string, number>;
  /** Rules whose live trades are the same trades as other rules'. */
  sameLive?: Map<string, string[]>;
  onTrack: (r: RankedSetup) => void;
  tracking: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, RankedSetup[]>();
    for (const r of rows) m.set(r.key, [...(m.get(r.key) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  // A stop and a target belong to listed rules only; a table of unlisted rules has no such columns.
  const plan = rows.some((r) => LISTED.includes(r.grade));
  const COLS = plan ? 8 : 6;

  return (
    <div className="@container -mx-3.5 overflow-x-auto">
      <table className={cn("w-full border-collapse", plan ? "min-w-[520px] sm:min-w-[820px]" : "min-w-0 sm:min-w-[680px]")}>
        <thead>
          <tr className="border-b">
            <th className={cn(TH, "w-7 pl-3.5 pr-0")} aria-label="Open" />
            <th scope="col" className={TH}>Stock</th>
            <th scope="col" className={TH}>Signal</th>
            <th scope="col" className={cn(TH, "hidden text-right sm:table-cell")}>Fired</th>
            <th scope="col" className={cn(TH, "text-right")} title="Last close on the signal's session">Price</th>
            {plan && (
              <>
                <th scope="col" className={cn(TH, "text-right")} title="2 times the 14-day average daily range from the price (2.5 times for momentum, event and supply-chain rules)">Stop</th>
                <th scope="col" className={cn(TH, "text-right")} title="1.5 times the distance to the stop (2 times for momentum, event and supply-chain rules)">Target</th>
              </>
            )}
            <th scope="col" className={cn(TH, "hidden pr-3.5 sm:table-cell")}>60 days</th>
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
                      {listed && <GradeTag grade={e.grade} />}
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
                      {evidenceLine(e, book.discovery)} {liveLine(e.live, sameLive?.get(key)?.map(ruleNameOf))}
                    </p>
                  </div>
                </td>
              </tr>
              {list.map((r) => {
                const isOpen = open === r.id;
                const spark = sparks?.get(r.ticker);
                const bar = bars?.get(`${r.ticker}|${r.priceOn}`);
                const gap = priceGap(r.price, bar);
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
                      <td className={cn(TD, "min-w-[8rem] whitespace-normal py-1 leading-4 sm:max-w-[22rem] sm:truncate sm:whitespace-nowrap sm:leading-5")} title={tidyDetail(r.detail)}>
                        {r.detail ? tidyDetail(r.detail) : <span className="text-muted-foreground">–</span>}
                      </td>
                      <td className={cn(TD, NUM, "hidden text-muted-foreground sm:table-cell")}>{dayShort(r.firedAt)}</td>
                      <td className={cn(TD, NUM, !plan && "pr-3.5 sm:pr-2")}>
                        <span className="inline-flex items-center justify-end gap-1">
                          {gap != null && bar != null && (
                            <span role="img" className="text-warning" title={priceGapText(r, bar, gap)} aria-label={priceGapText(r, bar, gap)}>
                              <AlertTriangle className="size-3" aria-hidden />
                            </span>
                          )}
                          {price(r.price)}
                        </span>
                      </td>
                      {plan && (
                        <>
                          <td className={cn(TD, NUM)}>{r.barsOk && listed ? price(r.stop) : <span className="text-muted-foreground">–</span>}</td>
                          <td className={cn(TD, NUM)}>{r.barsOk && listed ? price(r.target) : <span className="text-muted-foreground">–</span>}</td>
                        </>
                      )}
                      <td className={cn(TD, "hidden pr-3.5 sm:table-cell")}>
                        {spark && r.barsOk ? <Sparkline values={spark} tone="ink" fill={false} strokeWidth={1.25} className="block h-5 w-20" /> : <span className="text-muted-foreground">–</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-highlight-soft/20">
                        <td colSpan={COLS} className="p-0">
                          <div className="sticky left-0 w-[100cqw] px-3.5 py-3">
                            <SetupDetail r={r} listed={listed} bar={bar ?? null} gap={gap} peers={list.length} onTrack={onTrack} tracking={tracking} />
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

const priceGapText = (r: RankedSetup, bar: number, gap: number) =>
  `Stored price ${price(r.price)} differs from the market bar close of ${dayShort(r.priceOn)}, ${price(bar)}, by ${pct(gap, 1)}. The nightly price series may hold a mid-session snapshot.`;

/** The signal itself, what options price in, and the actions; the risk plan in full only for a listed rule. */
function SetupDetail({ r, listed, bar, gap, peers, onTrack, tracking }: { r: RankedSetup; listed: boolean; bar: number | null; gap: number | null; peers: number; onTrack: (r: RankedSetup) => void; tracking: boolean }) {
  const opts = useQuery(setupQuoteQuery(r.ticker, r.firedAt));
  const o = opts.data;
  const priced = o ? impliedMoveBy(o.term, Math.ceil((r.horizon * 7) / 5)) : null;
  // Signed distances from the price: a short's stop sits above it and its target below.
  const toStop = r.stop / r.price - 1;
  const toTarget = r.target / r.price - 1;
  const wide = r.family === "momentum" || r.family === "events" || r.family === "links";
  const planFacts = (
    <>
      <Fact label="Stop">{r.barsOk ? `${price(r.stop)} (${pct(toStop, 1)})` : "–"}</Fact>
      <Fact label="Target">{r.barsOk ? `${price(r.target)} (${pct(toTarget, 1)})` : "–"}</Fact>
    </>
  );
  const planNote = r.barsOk
    ? `The stop is ${wide ? "2.5" : "2"} average daily ranges from the price and the target ${wide ? "2" : "1.5"} times that distance. `
    : `No stop or target: the stored prices for this stock look wrong (an average daily range above ${Math.round(MAX_ATR_SHARE * 100)}% of the price). `;
  return (
    <div className="space-y-2.5">
      {!listed && (
        <p className="text-[13px] font-medium leading-5">
          This rule is not listed: its record cannot be told apart from luck. The signal is shown to watch, not to act on.
        </p>
      )}
      <p className="text-[13px] leading-5">
        {r.detail ? `${tidyDetail(r.detail)}. ` : ""}
        <span className="text-muted-foreground">
          Fired on the close of {dayLong(r.firedAt)}
          {r.liveCaught ? ", caught that night" : ", found on a later scan (not counted in the live record)"}. The rule enters at the next open and exits at the close {holdLabel(r.horizon)} later.
        </span>
      </p>
      {gap != null && bar != null && <p className="text-[13px] leading-5 text-warning">{priceGapText(r, bar, gap)}</p>}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-8">
        <Fact label="Price">{price(r.price)}</Fact>
        {listed && planFacts}
        <Fact label="Average daily range">{r.barsOk ? `${price(r.atr)} (${pct(r.atr / r.price, 1, false)})` : "–"}</Fact>
        <Fact label="Traded a day">{usdCompact(r.dollarVolume)}</Fact>
        <Fact label="Cost, round trip">{r.cost == null ? "–" : `${num(r.cost * 1e4, 0)} bp`}</Fact>
        <Fact label="Strength in this rule">{peers > 1 ? `top ${Math.max(1, Math.round((1 - r.strengthPct) * 100))}%` : "only signal"}</Fact>
        <Fact label="Straddle at signal close">{priced ? `±${pct(priced.m, 1, false)} by ${dayShort(priced.e)}` : "–"}</Fact>
      </div>
      <p className={CAPTION}>
        {listed ? planNote : ""}
        {o ? `${sourceName(o)} snapshot ${dayShort(o.date)} at ${price(o.price)}. ${o.skew != null ? `25Δ put–call skew ${num(100 * o.skew, 1)} vol pts. ` : ""}${o.putCall != null ? `Put/call open interest ${num(o.putCall, 2)}×. ` : ""}` : opts.isError ? "Options lookup unavailable. " : !opts.isPending ? `No stored option quote for ${dayShort(r.firedAt)}. ` : ""}
        {listed && priced && priced.m > 0 && o && r.priceOn === o.date && Math.abs(o.price / r.price - 1) <= 0.02 && r.barsOk ? `The target is ${num(Math.abs(toTarget) / priced.m, 1)} times the move options price in by ${dayShort(priced.e)}. ` : ""}
        Strength orders signals inside a rule only: on the live record so far it shows no link to the outcome.
      </p>
      {listed ? (
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
      ) : (
        <div className="space-y-1.5 border-t pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="xs" variant="outline">
              <Link to="/app/companies/$ticker" params={{ ticker: r.ticker }}>
                Open {r.ticker}
              </Link>
            </Button>
          </div>
          <p className={CAPTION}>If you paper-trade it anyway (paper only, no money):</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-8">{planFacts}</div>
          <p className={CAPTION}>{planNote}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onTrack(r)} disabled={tracking || !r.barsOk}>
              <Plus aria-hidden /> Paper trade
            </Button>
            <Button asChild size="xs" variant="ghost" className="text-muted-foreground">
              <Link to="/app/autopilots" search={{ variant: r.key }}>
                <Bot aria-hidden /> Automate this rule
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
