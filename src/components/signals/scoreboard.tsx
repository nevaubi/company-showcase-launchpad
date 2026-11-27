// Every rule the engine tries, backtest against live, sortable. A row opens in place for the rule,
// its record over time, the eight checks, market regimes and the live comparison.
import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, Check, ChevronRight, X } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { Button } from "@/components/ui/button";
import { adjustedT, REGIMES } from "@/lib/signals/backtest";
import { EVIDENCE, LISTED, type EvidenceBook, type Grade, type VariantEvidence } from "@/lib/signals/evidence";
import { evidenceLine, liveLine } from "@/lib/signals/explain";
import { count, holdLabel, monthLabel, num, pct, pctTone, VERDICT_LABEL, ruleNameOf } from "@/lib/signals/format";
import { gateChecks, type PairSetup, type SetupsFile, type VariantMeta } from "@/lib/signals/setups";
import { FAMILY_LABEL, STRATEGY, type Family } from "@/lib/signals/strategies";
import { cn } from "@/lib/utils";
import { CurveChart } from "./curve-chart";
import { CAPTION, GradeTag, NUM, SideTag, SortTh, TD, TH, type SortState } from "./parts";

type SortKey = "rule" | "n" | "avg" | "months" | "t" | "q" | "liveN" | "liveAvg" | "liveHit" | "status";
const GRADE_RANK: Record<Grade, number> = { proven: 0, candidate: 1, watch: 2, probation: 3, unproven: 4 };
const FAMILIES: ("all" | Family)[] = ["all", "reversal", "momentum", "events", "links", "multi", "pairs"];
const COLS = 12;

interface Row {
  v: VariantMeta;
  e: VariantEvidence;
}

const label = (r: Row) => STRATEGY[r.v.strategy]?.label ?? r.v.strategy;
/** Sort value per column; missing values always sink to the bottom. */
function valueOf(r: Row, k: SortKey): number | string | null {
  const b = r.e.blocks, l = r.e.live;
  switch (k) {
    case "rule": return label(r);
    case "n": return r.v.outSample.n;
    case "avg": return b?.mean ?? null;
    case "months": return b ? b.positive / b.months : null;
    case "t": return b?.t ?? null;
    case "q": return b ? r.e.q : null;
    case "liveN": return l.n || null;
    case "liveAvg": return l.n ? l.avgNet : null;
    case "liveHit": return l.n ? l.hit : null;
    case "status": return -GRADE_RANK[r.e.grade] * 100 + (b?.t ?? -50);
  }
}

export function Scoreboard({ data, book, sameLive }: { data: SetupsFile; book: EvidenceBook; sameLive?: Map<string, string[]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [family, setFamily] = useState<"all" | Family>("all");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "t", dir: -1 });
  const rows = useMemo(() => {
    const list: Row[] = data.variants.flatMap((v) => {
      const e = book.byKey.get(v.key);
      return e && (family === "all" || v.family === family) ? [{ v, e }] : [];
    });
    return list.sort((a, b) => {
      const x = valueOf(a, sort.key), y = valueOf(b, sort.key);
      if (x == null || y == null) return x == null && y == null ? (a.v.key < b.v.key ? -1 : 1) : x == null ? 1 : -1;
      const c = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
      return c * sort.dir || (a.v.key < b.v.key ? -1 : 1);
    });
  }, [data.variants, book, family, sort]);
  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir > 0 ? -1 : 1 } : { key: k, dir: k === "rule" || k === "q" ? 1 : -1 }));
  const head = { sort, onSort };

  return (
    <div>
      <Segmented<"all" | Family> label="Scoreboard family" size="xs" value={family} onChange={setFamily} options={FAMILIES.map((f) => ({ v: f, l: f === "all" ? "All" : FAMILY_LABEL[f] }))} />
      <div className="@container -mx-3.5 mt-3 overflow-x-auto">
        <table className="w-full border-collapse sm:min-w-[980px]">
          <thead>
            <tr className="hidden sm:table-row">
              <th colSpan={3} />
              <th colSpan={5} scope="colgroup" className="eyebrow border-b px-2 pb-1 text-left">Backtest since {data.oosStart.slice(0, 4)}, after costs</th>
              <th colSpan={3} scope="colgroup" className="eyebrow border-b border-l px-2 pb-1 text-left">Live, finished trades</th>
              <th />
            </tr>
            <tr className="border-b">
              <th className={cn(TH, "w-7 pl-3.5 pr-0")} aria-label="Open" />
              <SortTh k="rule" align="left" {...head}>Rule</SortTh>
              <th scope="col" className={cn(TH, "hidden sm:table-cell")}>Side, hold</th>
              <SortTh k="n" className="hidden sm:table-cell" title="Trades since 2022, stocks under $5M a day left out" {...head}>Trades</SortTh>
              <SortTh k="avg" className="hidden sm:table-cell" title="Average net return per trade against the sector fund, each month counted once" {...head}>Avg net</SortTh>
              <SortTh k="months" className="hidden sm:table-cell" title="Months with a positive average, out of months with trades" {...head}>Months up</SortTh>
              <SortTh k="t" title="The average divided by its error, with months as the unit and the error widened for holds that run across months" {...head}>t</SortTh>
              <SortTh k="q" title="Share of rules listed down to this one that would be expected to be luck. A rule is watched at 10% or less." {...head}>Luck rate</SortTh>
              <SortTh k="liveN" className="hidden sm:table-cell border-l" title="Signals caught on the day they fired whose holding period has finished" {...head}>Trades</SortTh>
              <SortTh k="liveAvg" className="hidden sm:table-cell" title="Average net return per finished live trade" {...head}>Avg net</SortTh>
              <SortTh k="liveHit" className="hidden sm:table-cell" title="Share of finished live trades that made money" {...head}>Up</SortTh>
              <SortTh k="status" align="left" className="pr-3.5" {...head}>Status</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const { v, e } = r;
              const b = e.blocks, l = e.live;
              const isOpen = open === v.key;
              return (
                <Fragment key={v.key}>
                  <tr data-agent-click aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.key)} className={cn("cursor-pointer border-b transition-colors duration-150 hover:bg-highlight-soft/40", isOpen && "bg-highlight-soft/30")}>
                    <td className={cn(TD, "w-7 pl-3.5 pr-0")}>
                      <button
                        type="button"
                        aria-label={`${isOpen ? "Close" : "Open"} ${label(r)} detail`}
                        aria-expanded={isOpen}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setOpen(isOpen ? null : v.key);
                        }}
                        className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", isOpen && "rotate-90")} aria-hidden />
                      </button>
                    </td>
                    <td className={cn(TD, "py-1 leading-4 sm:whitespace-nowrap sm:py-0 sm:leading-5")}>
                      {label(r)}
                      <span className="block whitespace-nowrap text-[11px] text-muted-foreground sm:hidden">
                        {v.side > 0 ? "Long" : "Short"}, {holdLabel(v.horizon)}
                      </span>
                      {l.n > 0 && sameLive?.get(v.key) && (
                        <span className="block whitespace-normal text-[11px] leading-4 text-muted-foreground">
                          Same live trades as {sameLive.get(v.key)!.map(ruleNameOf).join(" and ")}
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, "hidden whitespace-nowrap sm:table-cell")}>
                      <SideTag side={v.side} /> <span className="text-muted-foreground">{holdLabel(v.horizon)}</span>
                    </td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell")}>{count(v.outSample.n)}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell", pctTone(b?.mean))}>{pct(b?.mean)}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell")}>{b ? `${b.positive}/${b.months}` : "–"}</td>
                    <td className={cn(TD, NUM)}>{num(b?.t, 2)}</td>
                    <td className={cn(TD, NUM, b && e.q <= EVIDENCE.watchFdr ? "" : "text-muted-foreground")}>{b ? pct(e.q, 0, false) : "–"}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell border-l")} title={sameLive?.get(v.key) ? `Same trades as ${sameLive.get(v.key)!.join(" and ")}` : undefined}>{l.n ? count(l.n) : "–"}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell", l.n ? pctTone(l.avgNet) : "")}>{l.n ? pct(l.avgNet) : "–"}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell")}>{l.n ? pct(l.hit, 0, false) : "–"}</td>
                    <td className={cn(TD, "min-w-[8rem] max-w-[11rem] whitespace-normal py-1 pr-3.5 leading-4 sm:max-w-[15rem] sm:truncate sm:whitespace-nowrap sm:py-0 sm:leading-5")} title={e.reason || undefined}>
                      {e.grade === "unproven" ? <span className="text-muted-foreground">{e.reason}</span> : <GradeTag grade={e.grade} />}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-highlight-soft/20">
                      <td colSpan={COLS} className="p-0">
                        <div className="sticky left-0 w-[100cqw] px-3.5 py-3">
                          <VariantDetail v={v} e={e} data={data} book={book} same={sameLive?.get(v.key)} />
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
    </div>
  );
}

const H = "mb-1 text-[13px] font-semibold leading-5";

function VariantDetail({ v, e, data, book, same }: Row & { data: SetupsFile; book: EvidenceBook; same?: string[] }) {
  const s = STRATEGY[v.strategy];
  const b = e.blocks;
  const o = v.outSample;
  const year0 = data.oosStart.slice(0, 4);
  const tStored = adjustedT(o);
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-3">
        <div>
          <p className="text-[13px] leading-5">{s?.rule}.</p>
          <p className={cn(CAPTION, "mt-0.5")}>
            Research: {s?.source}.{s?.data ? ` Data: ${s.data}${s.dataFrom ? ` (from ${s.dataFrom})` : ""}.` : ""}
          </p>
          {(v.strategy === "insider" || v.strategy === "earnRunup") && <p className={cn(CAPTION, "mt-1")}>
            SEC records provide filing dates. The model uses a filing at the first trading-session close after that date.
          </p>}
          {v.strategy === "shortFlow" && <p className={cn(CAPTION, "mt-1")}>
            From Nov 16, 2026, each file enters the model at the first session close after its recorded collection date. Earlier files assume availability at the next session close.
          </p>}
        </div>
        <p className="text-[13px] leading-5">
          {evidenceLine(e, book.discovery)} <span className="text-muted-foreground">{liveLine(e.live, same?.map(ruleNameOf))}</span>
        </p>
        <div>
          <div className={H}>Record over time</div>
          <p className={cn(CAPTION, "mb-1")}>Running sum of the monthly average net return per trade. Worst fall from a peak {pct(v.maxDrawdown, 1)}.</p>
          <CurveChart curve={v.curve} from={data.oosStart.slice(0, 7)} label={`${s?.label ?? v.strategy}: running sum of the monthly average net return per trade`} />
        </div>
        {v.years.length > 0 && (
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <tbody>
                <tr>
                  <th scope="row" className={cn(CAPTION, "pr-3 text-left font-normal")}>Year</th>
                  {v.years.map((y) => (
                    <td key={y.year} className={cn(CAPTION, NUM, "px-2")}>{y.year}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={cn(CAPTION, "pr-3 text-left font-normal")}>Avg net a trade</th>
                  {v.years.map((y) => (
                    <td key={y.year} className={cn("num px-2 text-right text-[13px] leading-5", pctTone(y.avgNet))}>{pct(y.avgNet)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={cn(CAPTION, "pr-3 text-left font-normal")}>Trades</th>
                  {v.years.map((y) => (
                    <td key={y.year} className={cn(CAPTION, NUM, "px-2")}>{count(y.n)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {v.family === "pairs" ? (
          <Pairs pairs={data.pairs} grade={e.grade} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {!LISTED.includes(e.grade) && <span className={CAPTION}>Not listed. Paper only, if you want to follow it anyway:</span>}
            <Button asChild size="xs" variant={LISTED.includes(e.grade) ? "outline" : "ghost"} className={LISTED.includes(e.grade) ? undefined : "text-muted-foreground"}>
              <Link to="/app/autopilots" search={{ variant: v.key }}>
                <Bot aria-hidden /> Paper-trade this rule automatically
              </Link>
            </Button>
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <div className={H}>Month by month since {year0}</div>
          {b ? (
            <KV
              rows={[
                ["Months with trades", `${b.months}, ${b.positive} up`],
                ["Average net a trade", pct(b.mean)],
                ["Spread from month to month", pct(b.sd, 2, false)],
                ["Error of the average", pct(b.se, 2, false)],
                ["t (average over its error)", num(b.t)],
                ["Independent months it is worth", num(b.nEff, 0)],
                ["Luck rate among all rules", pct(e.q, 0, false)],
                ["Share of the average kept", pct(e.kept, 0, false)],
              ]}
            />
          ) : (
            <p className={CAPTION}>{e.reason}.</p>
          )}
        </div>
        <div>
          <div className={H}>As stored by the nightly test</div>
          <KV
            rows={[
              ["Trades, signal days", `${count(o.n)}, ${count(o.days)}`],
              ["Average net, every trade equal", pct(o.avgNet)],
              ["Win rate", pct(o.hit, 0, false)],
              ["t, signal days as independent", num(tStored)],
              ["Deflated Sharpe", num(v.dsr)],
            ]}
          />
          <p className={cn(CAPTION, "mt-1")}>Holds that overlap make neighbouring signal days move together, so this t overstates the evidence. The monthly t above is the one used.</p>
        </div>
        <div>
          <div className={H}>The eight checks of the strict gate</div>
          <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {gateChecks(v, data.gate).map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-[13px] leading-5">
                {c.ok ? <Check className="size-3.5 shrink-0 text-positive" aria-label="Passed" /> : <X className="size-3.5 shrink-0 text-negative" aria-label="Failed" />}
                <span className={cn("min-w-0 truncate", !c.ok && "text-muted-foreground")} title={c.label}>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className={H}>By market regime, all years</div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th scope="col" className={cn(CAPTION, "py-0.5 text-left font-normal")}>Regime</th>
                <th scope="col" className={cn(CAPTION, "py-0.5 text-right font-normal")}>Trades</th>
                <th scope="col" className={cn(CAPTION, "py-0.5 text-right font-normal")}>Avg net</th>
                <th scope="col" className={cn(CAPTION, "py-0.5 text-right font-normal")} title="How much of the regime's difference from the rule's average is believed after shrinkage">Believed</th>
              </tr>
            </thead>
            <tbody>
              {REGIMES.map((r) => {
                const cell = v.regimes[r];
                const fit = e.regimes.find((f) => f.regime === r);
                return (
                  <tr key={r} className="border-b last:border-b-0">
                    <td className={cn("py-0.5 text-[13px] leading-5", r === data.regime && "font-medium")}>
                      {r}
                      {r === data.regime ? <span className="font-normal text-muted-foreground"> · today</span> : null}
                    </td>
                    <td className={cn("py-0.5 text-[13px] leading-5", NUM)}>{count(cell?.n ?? 0)}</td>
                    <td className={cn("py-0.5 text-[13px] leading-5", NUM)}>{pct(cell?.avgNet)}</td>
                    <td className={cn("py-0.5 text-[13px] leading-5", NUM, "text-muted-foreground")}>{fit ? pct(fit.kept, 0, false) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {book.regimePrior.value === 0 && <p className={cn(CAPTION, "mt-1")}>Across all rules the regime averages differ by no more than luck, so they do not move the expected edge.</p>}
        </div>
        <div>
          <div className={H}>Before {year0}</div>
          <p className="text-[13px] leading-5">
            {v.inSample.n ? (
              <span className="num">
                {count(v.inSample.n)} trades, {pct(v.inSample.avgNet)} a trade, t {num(v.inSample.t)}
              </span>
            ) : (
              <span className="text-muted-foreground">No trades before {year0}{s?.dataFrom ? ` (the data starts in ${s.dataFrom})` : ""}.</span>
            )}
          </p>
        </div>
        <div>
          <div className={H}>Live against the backtest</div>
          <p className="text-[13px] leading-5">{liveLine(e.live, same?.map(ruleNameOf))}</p>
          {e.live.n > 0 && e.live.band != null && (
            <p className={cn(CAPTION, "mt-0.5")}>
              {VERDICT_LABEL[e.live.verdict]}. Over a record this short the average can sit {pct(e.live.band, 1, false)} either side of the expected {pct(e.edge)} by luck
              {e.live.since ? `; counted since ${monthLabel(e.live.since.slice(0, 7))}` : ""}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <dl>
      {rows.map(([k, val]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-b py-0.5 text-[13px] leading-5 last:border-b-0">
          <dt className="min-w-0 truncate text-muted-foreground" title={k}>{k}</dt>
          <dd className="num shrink-0 text-right">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Same-sector pairs stretched beyond two standard deviations on the last session. */
function Pairs({ pairs, grade }: { pairs: PairSetup[]; grade: Grade }) {
  if (!pairs.length) return <p className={CAPTION}>No pair is stretched beyond 2 standard deviations on the last session.</p>;
  return (
    <div>
      <div className={H}>Pairs stretched apart on the last session</div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th scope="col" className={cn(TH, "pl-0")}>Cheap leg</th>
            <th scope="col" className={TH}>Rich leg</th>
            <th scope="col" className={cn(TH, "text-right")} title="Spread in standard deviations from its average">Stretch</th>
            <th scope="col" className={cn(TH, "text-right")} title="Trading days for half of a stretch to close, on past behaviour">Half-life</th>
            <th scope="col" className={TH}>Spread, 120 days</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => {
            const cheap = p.side > 0 ? p.a : p.b, rich = p.side > 0 ? p.b : p.a;
            return (
              <tr key={`${p.a}:${p.b}`} className="border-b last:border-b-0">
                <td className={cn(TD, "pl-0")}><TickerMark ticker={cheap} className="align-top" /></td>
                <td className={TD}><TickerMark ticker={rich} className="align-top" /></td>
                <td className={cn(TD, NUM)}>{num(Math.abs(p.z), 2)} sd</td>
                <td className={cn(TD, NUM)}>{num(p.halfLife, 0)} days</td>
                <td className={TD}><Sparkline values={p.zs} tone="ink" fill={false} strokeWidth={1.25} className="block h-5 w-24" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={cn(CAPTION, "mt-1")}>{LISTED.includes(grade) ? "The pairs rule is listed; go long the cheap leg and short the rich one." : "Context only: the pairs rule is not listed, so these are not setups."}</p>
    </div>
  );
}
