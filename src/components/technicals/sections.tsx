import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TickerMark } from "@/components/app/ticker";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, ordinal } from "@/lib/format";
import { optionsHistoryQuery } from "@/lib/options/data";
import type { Technicals } from "@/lib/technicals/analysis";
import { METRICS, peersQuery, rowsOf, type CrossFile, type CrossRow } from "@/lib/technicals/cross";
import { impliedMove, MEAN_ABS_NORMAL, weekdaysBetween, type LevelRow } from "@/lib/technicals/measures";
import { fmtUsd } from "@/lib/technicals/read";
import { cn } from "@/lib/utils";
import { f2, Note, pc, PercentileBar, pp, signTone, T as S, TableWrap, TechPanel } from "./ui";

const Loading = () => <Skeleton className="m-3 h-40" />;
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : ordinal(Math.min(99, Math.max(1, Math.round(v * 100)))));

/** A two-column table of named figures, each with the basis it rests on. */
function Facts({ rows }: { rows: [label: ReactNode, value: ReactNode, basis?: ReactNode][] }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map(([l, v, b], i) => (
          <tr key={i} className={S.row}>
            <td className={cn(S.td, "text-muted-foreground sm:whitespace-nowrap")}>{l}</td>
            <td className={cn(S.num, "font-medium")}>{v}</td>
            <td className={cn(S.td, "hidden text-[11px] text-muted-foreground sm:table-cell")}>{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const SubTitle = ({ children, caption }: { children: ReactNode; caption?: ReactNode }) => (
  <div className="flex flex-wrap items-baseline gap-x-2 border-b px-3 pb-1.5 pt-3">
    <h3 className={S.group}>{children}</h3>
    {caption && <span className={S.caption}>{caption}</span>}
  </div>
);
/** Two tables side by side on wide screens, stacked on narrow ones, divided by a hairline. */
const Split = ({ children, wideLeft, single, className }: { children: ReactNode; wideLeft?: boolean; single?: boolean; className?: string }) => (
  <div
    className={cn(
      "grid grid-cols-1 divide-y [&>*]:min-w-0",
      !single && "xl:divide-x xl:divide-y-0",
      single ? "" : wideLeft ? "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "xl:grid-cols-2",
      className,
    )}
  >
    {children}
  </div>
);

/* ---------- levels and risk ---------- */
/** Shorter names for the ladder; the full description is the row's tooltip. */
const LEVEL_LABEL: Record<string, string> = {
  "VWAP from the last earnings release": "VWAP since earnings",
  "VWAP from the 52-week low": "VWAP since the 52-week low",
};
/** One line of basis for a level: the band its swing points span, or the anchor. */
const levelBasis = (l: LevelRow) =>
  l.band
    ? `${l.touches} swing points, ${f2(l.band[0])} to ${f2(l.band[1])}`
    : l.detail.replace("Volume-weighted average price since", "Since").replace("; filled at this price", "");
export function LevelsPanel({ T, loading }: { T: Technicals | null; loading: boolean }) {
  const M = T?.measures;
  return (
    <TechPanel section="Levels and risk" id="levels" tour="tech-levels" title="Levels and risk" subtitle={M ? `Close ${f2(M.close)} on ${fmtDate(M.asOf)}` : undefined}>
      {!M ? (
        loading ? (
          <Loading />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>No levels without a price history.</p>
        )
      ) : (
        <>
          <Split>
            <div>
              <SubTitle caption="high to low; distance from the close in percent and in average true ranges (ATR)">Price ladder</SubTitle>
              <TableWrap min={440}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className={S.th}>Level</th>
                      <th className={S.thNum}>Price</th>
                      <th className={S.thNum}>vs close</th>
                      <th className={S.thNum}>ATRs</th>
                      <th className={cn(S.th, "hidden md:table-cell")}>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const out: ReactNode[] = [];
                      let placed = false;
                      const closeRow = (
                        <tr key="close" className="border-b bg-highlight-soft/60">
                          <td className={cn(S.td, "font-semibold")}>Close</td>
                          <td className={cn(S.num, "font-semibold")}>{f2(M.close)}</td>
                          <td className={S.num} />
                          <td className={S.num} />
                          <td className={cn(S.td, "hidden text-[11px] text-muted-foreground md:table-cell")}>{fmtDate(M.asOf)}</td>
                        </tr>
                      );
                      M.levels.forEach((l, i) => {
                        if (!placed && l.price <= M.close) {
                          out.push(closeRow);
                          placed = true;
                        }
                        out.push(
                          <tr key={i} className={S.row} title={l.detail}>
                            <td className={cn(S.td, "whitespace-nowrap")}>{LEVEL_LABEL[l.label] ?? l.label}</td>
                            <td className={S.num}>{f2(l.price)}</td>
                            <td className={S.num}>{pp(l.distance)}</td>
                            <td className={S.num}>{l.atrs == null ? "–" : f2(l.atrs, 1)}</td>
                            <td className={cn(S.td, "hidden max-w-[13rem] truncate whitespace-nowrap text-[11px] text-muted-foreground md:table-cell")}>{levelBasis(l)}</td>
                          </tr>,
                        );
                      });
                      if (!placed) out.push(closeRow);
                      return out;
                    })()}
                  </tbody>
                </table>
              </TableWrap>
            </div>
            <div>
              <SubTitle caption="arithmetic on its own range, not advice">Risk context</SubTitle>
              <Facts
                rows={[
                  ["ATR (14)", f2(M.risk.atr), `${pc(M.volatility.atrPct, 1)} of the close`],
                  [`Stop ${M.risk.stopAtrs} ATR below the close`, f2(M.risk.stopLevel), `${pp(M.risk.stopPct != null ? -M.risk.stopPct : null)} from the close`],
                  [`Size for a ${pc(M.risk.riskFraction)} account risk`, pc(M.risk.positionPct, 1), `${pc(M.risk.riskFraction)} ÷ ${pc(M.risk.stopPct, 1)} to the stop`],
                  ["Fall exceeded 1 day in 20", pp(M.risk.var95 != null ? -M.risk.var95 : null), "5th percentile of daily returns"],
                  ["Largest one-day fall", pp(M.risk.worstDay), M.risk.worstDate ? fmtDate(M.risk.worstDate) : ""],
                  ["Drawdown now", pp(M.drawdown.current), M.drawdown.sessionsUnder ? `${M.drawdown.sessionsUnder} sessions below the ${fmtDate(M.drawdown.peakDate, { month: "short", day: "numeric" })} high` : "at a new high"],
                  ["Largest drawdown", pp(M.drawdown.max), `${fmtDate(M.drawdown.maxPeak)} to ${fmtDate(M.drawdown.maxTrough)}`],
                  ["High regained", M.drawdown.maxRecovered ? fmtDate(M.drawdown.maxRecovered) : "not yet", "after the largest drawdown"],
                  [
                    "Longest spell below a high",
                    `${M.drawdown.longestUnder.toLocaleString("en-US")} sessions`,
                    `${fmtDate(M.drawdown.longestFrom)} to ${M.drawdown.longestTo ? fmtDate(M.drawdown.longestTo) : "now"}`,
                  ],
                  ...(M.liquidity.hasVolume
                    ? ([
                        ["Median daily dollar volume", fmtUsd(M.liquidity.dollarVol20), "last 20 sessions"],
                        [
                          "Price impact (Amihud)",
                          M.liquidity.amihud != null ? `${(M.liquidity.amihud * 1e4).toFixed(M.liquidity.amihud * 1e4 >= 1 ? 1 : 3)} bp` : "–",
                          "average move per $1 million traded",
                        ],
                      ] as [ReactNode, ReactNode, ReactNode][])
                    : []),
                ]}
              />
            </div>
          </Split>
          <Note>
            Support and resistance: swing highs and lows of the last two years (504 sessions), chained into one level when each is within the larger of 1% of price and 0.75 ATR of the next; the
            six nearest levels with at least two swing points are listed. VWAP is the volume-weighted average price since the anchor. The stop and position size are arithmetic on the average
            true range, and a gap can pass through a stop. Price impact: the average of |daily return| ÷ dollar volume over the last 60 sessions (Amihud). Drawdowns use the total-return index over the {M.bars.toLocaleString("en-US")} sessions since {fmtDate(M.first)}.
          </Note>
        </>
      )}
    </TechPanel>
  );
}

/* ---------- volatility and expected move ---------- */
export function VolatilityPanel({ symbol, T, loading, covered }: { symbol: string; T: Technicals | null; loading: boolean; covered: boolean }) {
  const opt = useQuery({ ...optionsHistoryQuery(symbol), enabled: covered });
  const M = T?.measures;
  const iv = opt.data?.find((r) => r.iv30 != null);
  // the latest snapshot that carries a term structure (expiry by expiry)
  const snap = opt.data?.find((r) => r.term.length > 0);
  // one expiry per horizon: the first at or after 1, 7, 14, 30, 60, 90 and 180 calendar days
  const priced = (snap?.term ?? []).filter((t) => t.d > 0 && t.m > 0);
  const term = [...new Set([1, 7, 14, 30, 60, 90, 180].map((d) => priced.find((t) => t.d >= d)).filter((t): t is NonNullable<typeof t> => !!t))];
  const rv = M?.volatility.rv21;
  return (
    <TechPanel
      section="Volatility"
      id="volatility"
      tour="tech-volatility"
      title="Volatility and expected move"
      subtitle={
        M?.volatility.rv21 != null
          ? `21-day realised volatility ${pc(M.volatility.rv21, 1)} a year, ${pct(M.volatility.rank3y ?? M.volatility.rankAll)} percentile of its ${M.volatility.rank3y != null ? "last three years" : "history"}`
          : undefined
      }
    >
      {!M ? (
        loading ? (
          <Loading />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>No volatility figures without a price history.</p>
        )
      ) : (
        <>
          <Split>
            <div>
              <SubTitle caption="one standard deviation: about two outcomes in three fall inside if volatility holds">Expected move</SubTitle>
              <TableWrap min={400}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className={S.th}>Horizon</th>
                      <th className={S.thNum}>From realised volatility</th>
                      <th className={S.thNum}>Price range</th>
                      <th className={S.thNum}>From option prices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {M.volatility.expected.map((e) => (
                      <tr key={e.sessions} className={S.row}>
                        <td className={S.td}>{e.sessions === 5 ? "1 week (5 sessions)" : "1 month (21 sessions)"}</td>
                        <td className={cn(S.num, "font-medium")}>±{pc(e.pct, 1)}</td>
                        <td className={S.num}>
                          {f2(e.low)} to {f2(e.high)}
                        </td>
                        <td className={S.num}>{iv?.iv30 != null ? `±${pc(impliedMove(iv.iv30, e.sessions), 1)}` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className={cn("px-3 py-2", S.caption)}>
                Realised: {pc(M.volatility.rv21, 1)} a year over the last 21 sessions, scaled by the square root of time.{" "}
                {iv?.iv30 != null
                  ? `Options: 30-day implied volatility ${pc(iv.iv30, 1)} from the Cboe snapshot of ${fmtDate(iv.date)}, scaled the same way.`
                  : covered
                    ? "No option snapshot is stored for this stock."
                    : "Option snapshots are kept for covered companies only."}
              </p>
            </div>
            <div>
              <SubTitle caption={`annualised; percentile among every window of that length since ${fmtDate(M.first)}`}>Realised volatility by window</SubTitle>
              <TableWrap min={400}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className={S.th}>Window</th>
                      <th className={S.thNum}>Now</th>
                      <th className={S.thNum}>Percentile</th>
                      <th className={cn(S.th, "hidden sm:table-cell")} />
                      <th className={S.thNum}>Median</th>
                      <th className={S.thNum}>10th to 90th</th>
                    </tr>
                  </thead>
                  <tbody>
                    {M.volatility.cone.map((z) => (
                      <tr key={z.n} className={S.row}>
                        <td className={S.td}>{z.n} sessions</td>
                        <td className={cn(S.num, "font-medium")}>{pc(z.current, 1)}</td>
                        <td className={S.num}>{pct(z.pct)}</td>
                        <td className={cn(S.td, "hidden w-20 sm:table-cell")}>
                          <PercentileBar value={z.pct} />
                        </td>
                        <td className={S.num}>{pc(z.p50, 1)}</td>
                        <td className={S.num}>
                          {pc(z.p10, 0)} to {pc(z.p90, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {M.volatility.rank3y != null && (
                <p className={cn("px-3 py-2", S.caption)}>
                  Against the last three years only, the 21-session figure is at the {pct(M.volatility.rank3y)} percentile.
                </p>
              )}
            </div>
          </Split>
          <Split className="border-t">
            <div>
              <SubTitle caption={`variance ratios over the last ${M.walk.window.toLocaleString("en-US")} daily returns`}>Trend or reversal</SubTitle>
              <TableWrap min={400}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className={S.th}>Horizon</th>
                      <th className={S.thNum} title="Variance of q-day returns ÷ (q × variance of 1-day returns): 1 for a random walk">
                        Variance ratio
                      </th>
                      <th className={S.thNum} title="Lo-MacKinlay statistic, valid when volatility changes over time">
                        z
                      </th>
                      <th className={S.thNum}>p</th>
                      <th className={S.th}>Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {M.walk.rows.map((r) => (
                      <tr key={r.q} className={S.row}>
                        <td className={S.td}>{r.q} days</td>
                        <td className={cn(S.num, "font-medium")}>{f2(r.vr)}</td>
                        <td className={S.num}>{f2(r.z)}</td>
                        <td className={S.num}>{f2(r.p, 3)}</td>
                        <td className={cn(S.td, "whitespace-nowrap text-[11px] text-muted-foreground")}>{r.p < 0.05 ? (r.vr > 1 ? "moves continued" : "moves reversed") : "as a random walk"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className={cn("px-3 py-2", S.caption)}>
                {M.walk.reading === "random"
                  ? `Taken together the four horizons are not distinguishable from a random walk (joint p ${f2(M.walk.pJoint, 2)}): neither following moves nor fading them has had the odds on its side at these horizons.`
                  : M.walk.reading === "continue"
                    ? `Moves have tended to continue (joint p ${f2(M.walk.pJoint, 3)}): a ratio above 1 means returns add up faster than a random walk's would.`
                    : `Moves have tended to reverse (joint p ${f2(M.walk.pJoint, 3)}): a ratio below 1 means part of each move was given back.`}
              </p>
            </div>
            <div>
              <SubTitle caption={snap ? `straddle price ÷ share price, Cboe snapshot of ${fmtDate(snap.date)}` : undefined}>Priced by options</SubTitle>
              {term.length > 0 && snap ? (
                <>
                  <TableWrap min={400}>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className={S.th}>Expiry</th>
                          <th className={S.thNum} title="Weekdays from the snapshot to the expiry">
                            Sessions
                          </th>
                          <th className={S.thNum} title="At-the-money straddle ÷ share price: the average size of the move the market prices by expiry">
                            Priced move
                          </th>
                          <th className={S.thNum} title="The same average move if the 21-day realised volatility held: 0.8 × volatility × √(sessions ÷ 252)">
                            At realised pace
                          </th>
                          <th className={S.thNum} title="Priced move ÷ move at the realised pace">
                            Ratio
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {term.map((t) => {
                          const n = weekdaysBetween(snap.date, t.e);
                          const real = rv != null && n > 0 ? MEAN_ABS_NORMAL * impliedMove(rv, n) : null;
                          return (
                            <tr key={t.e} className={S.row}>
                              <td className={cn(S.td, "num whitespace-nowrap")}>{fmtDate(t.e)}</td>
                              <td className={S.num}>{n || "–"}</td>
                              <td className={cn(S.num, "font-medium")}>±{pc(t.m, 1)}</td>
                              <td className={S.num}>{real != null ? `±${pc(real, 1)}` : "–"}</td>
                              <td className={S.num}>{real ? `${f2(t.m / real)}×` : "–"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                  <p className={cn("px-3 py-2", S.caption)}>
                    A straddle prices the average size of the move by expiry, about 0.8 of one standard deviation, so both columns are average moves and smaller than the one-standard-deviation
                    figures above. A ratio above 1: options price more movement than the last 21 sessions delivered. Sessions count weekdays; holidays are not removed.
                  </p>
                </>
              ) : (
                <p className={cn("px-3 py-3", S.caption)}>
                  {!covered
                    ? "Option snapshots are kept for covered companies only."
                    : opt.isPending
                      ? "Loading the option snapshot."
                      : iv
                        ? "The stored snapshots carry no expiry-by-expiry prices for this stock yet."
                        : "No option snapshot is stored for this stock."}
                </p>
              )}
            </div>
          </Split>
        </>
      )}
    </TechPanel>
  );
}

/* ---------- relative strength and cross-section ---------- */
const RANK_ROWS = ["mom12_1", "r63", "r252", "rs_sector252", "from_hi", "vol60", "beta", "sharpe1y"];
/** Lower is ranked first for these, as in the pipeline's sector ranks. */
const LOW_FIRST = new Set(["vol60", "beta"]);
/** Rank within the sector when the pipeline does not publish one for the measure: computed the same way. */
function sectorRank(stocks: CrossRow[], me: CrossRow, k: string): [number, number] | null {
  const v = me[k];
  if (typeof v !== "number" || !me.sector) return null;
  const peers = stocks.filter((r) => r.sector === me.sector && typeof r[k] === "number");
  if (peers.length < 2) return null;
  const better = peers.filter((r) => (LOW_FIRST.has(k) ? (r[k] as number) < v : (r[k] as number) > v)).length;
  return [better + 1, peers.length];
}
export function RelativePanel({
  symbol,
  T,
  loading,
  cross,
  covered,
  onPick,
}: {
  symbol: string;
  T: Technicals | null;
  loading: boolean;
  cross: CrossFile | null;
  covered: boolean;
  onPick: (s: string) => void;
}) {
  const peers = useQuery({ ...peersQuery(symbol), enabled: !!cross });
  const M = T?.measures;
  const rows = cross ? rowsOf(cross) : [];
  const me = rows.find((r) => r.sym === symbol);
  const ranks = cross?.ranks[symbol];
  const peerNames = (peers.data?.matrix.names ?? []).filter((n) => n !== symbol).slice(0, 8);
  const peerCorr = new Map((peers.data?.matrix.names ?? []).map((n, j) => [n, peers.data!.matrix.c[0]?.[j] ?? null]));
  const num = (r: (typeof rows)[number] | undefined, k: string) => (typeof r?.[k] === "number" ? (r[k] as number) : null);
  const stocks = rows.filter((r) => r.kind === "stock");
  const KEYS = ["r63", "r252", "mom12_1", "rs_sector252", "vol60", "beta"];
  const hasBench = !!M?.momentum.vs.length;
  return (
    <TechPanel section="Relative strength" id="relative" tour="tech-relative" title="Relative strength" subtitle={me ? "Total returns against the market and the sector, and where it ranks among covered companies" : "Total returns against the market and, for a covered company, its sector"}>
      {!M ? (
        loading ? (
          <Loading />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>No comparison without a price history.</p>
        )
      ) : (
        <>
          <Split single={!hasBench}>
            <div>
              <SubTitle caption={hasBench ? "total return; against a benchmark, (1 + own) ÷ (1 + benchmark) − 1" : "total return"}>Returns</SubTitle>
              <TableWrap min={340}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className={S.th}>Window</th>
                    <th className={S.thNum}>Return</th>
                    {M.momentum.vs.map((b) => (
                      <th key={b.sym} className={S.thNum}>
                        vs {b.sym}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["1 month", M.momentum.r21, "rs21"],
                      ["3 months", M.momentum.r63, "rs63"],
                      ["6 months", M.momentum.r126, "rs126"],
                      ["12 months", M.momentum.r252, "rs252"],
                      ["12-1 month", M.momentum.mom12_1, "rsMom"],
                      ["6-1 month", M.momentum.mom6_1, "rsMom6"],
                    ] as const
                  ).map(([l, v, k]) => (
                    <tr key={l} className={S.row} title={l.includes("-1") ? `From ${l.startsWith("12") ? 252 : 126} to 21 sessions ago: the latest month is left out` : undefined}>
                      <td className={S.td}>{l}</td>
                      <td className={cn(S.num, "font-medium", signTone(v))}>{pp(v)}</td>
                      {M.momentum.vs.map((b) => (
                        <td key={b.sym} className={cn(S.num, signTone(b[k]))}>
                          {pp(b[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableWrap>
            </div>
            {hasBench && (
            <div>
              <SubTitle caption="daily total returns, last 252 sessions">Sensitivity</SubTitle>
                <TableWrap min={440}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className={S.th}>Against</th>
                      <th className={S.thNum} title="Slope of its daily return on the benchmark's, with the standard error">
                        Beta
                      </th>
                      <th className={S.thNum}>Correlation</th>
                      <th className={S.thNum} title="Share of its daily variance the benchmark explains">
                        R²
                      </th>
                      <th className={S.thNum} title="Annualised volatility of the part the benchmark does not explain">
                        Own volatility
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {M.momentum.vs.map((b) => (
                      <tr key={b.sym} className={S.row}>
                        <td className={S.td}>
                          {b.sym} <span className="text-[11px] text-muted-foreground">{b.kind === "market" ? "market" : "sector"}</span>
                        </td>
                        <td className={cn(S.num, "font-medium")}>
                          {f2(b.beta)}
                          <span className="font-normal text-muted-foreground"> ± {f2(b.seBeta)}</span>
                        </td>
                        <td className={S.num}>{f2(b.corr)}</td>
                        <td className={S.num}>{f2(b.r2)}</td>
                        <td className={S.num}>{pc(b.idioVol, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </TableWrap>
            </div>
            )}
          </Split>
          {me && (
            <Split>
              <div className="border-t">
                <SubTitle caption={`${stocks.length.toLocaleString("en-US")} covered companies, as of ${fmtDate(cross!.as_of)}`}>Where it ranks</SubTitle>
                <TableWrap min={340}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className={S.th}>Measure</th>
                      <th className={S.thNum}>Value</th>
                      <th className={S.thNum} title={`Rank among covered companies in ${me.sector}`}>
                        In sector
                      </th>
                      <th className={S.thNum} title="Share of the other covered companies with a lower value">
                        All covered
                      </th>
                      <th className={cn(S.th, "hidden sm:table-cell")} />
                    </tr>
                  </thead>
                  <tbody>
                    {RANK_ROWS.filter((k) => num(me, k) != null && METRICS[k]).map((k) => {
                      const v = num(me, k)!;
                      const rk = ranks?.[k] ?? sectorRank(stocks, me, k);
                      const others = stocks.filter((r) => r.sym !== symbol && num(r, k) != null);
                      const p = others.length ? others.filter((r) => num(r, k)! < v).length / others.length : null;
                      return (
                        <tr key={k} className={S.row} title={METRICS[k].def}>
                          <td className={S.td}>{METRICS[k].label}</td>
                          <td className={cn(S.num, "font-medium", METRICS[k].signed ? signTone(v) : "")}>{METRICS[k].fmt(v)}</td>
                          <td className={S.num}>{rk ? `${rk[0]} of ${rk[1]}` : "–"}</td>
                          <td className={S.num}>{pct(p)}</td>
                          <td className={cn(S.td, "hidden w-20 sm:table-cell")}>
                            <PercentileBar value={p} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </TableWrap>
                <p className={cn("px-3 py-2", S.caption)}>
                  In sector: rank 1 is the highest return, momentum, relative strength and Sharpe ratio, and the lowest volatility and beta. All covered: the percentile of the value itself,
                  the share of the other covered companies below it.
                </p>
              </div>
              <div className="border-t">
                <SubTitle caption={peers.data ? `sector names whose daily returns move most with ${symbol}` : undefined}>Closest peers</SubTitle>
                {peerNames.length ? (
                  <TableWrap min={520}>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className={S.th}>Company</th>
                          <th className={S.thNum} title="Correlation of daily total returns over the last year">
                            Correlation
                          </th>
                          {KEYS.slice(0, 4).map((k) => (
                            <th key={k} className={S.thNum} title={METRICS[k].def}>
                              {METRICS[k].label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[symbol, ...peerNames].map((n) => {
                          const r = rows.find((x) => x.sym === n);
                          return (
                            <tr key={n} className={cn(S.row, n === symbol && "bg-highlight-soft/60")}>
                              <td className={S.td}>
                                {n === symbol ? (
                                  <TickerMark ticker={n} name link={false} />
                                ) : (
                                  <button type="button" data-agent-click onClick={() => onPick(n)} title={`Open ${n} in Technicals`} className={cn(S.cellButton, "text-left")}>
                                    <TickerMark ticker={n} name link={false} />
                                  </button>
                                )}
                              </td>
                              <td className={S.num}>{n === symbol ? "–" : f2(peerCorr.get(n) ?? null)}</td>
                              {KEYS.slice(0, 4).map((k) => (
                                <td key={k} className={cn(S.num, METRICS[k].signed ? signTone(num(r, k)) : "")}>
                                  {METRICS[k].fmt(num(r, k))}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                ) : (
                  <p className={cn("px-3 py-3", S.caption)}>{peers.isPending ? "Loading peer correlations." : "Peer correlations are not published for this company yet."}</p>
                )}
              </div>
            </Split>
          )}
          <Note>
            {hasBench
              ? "Beta and correlation come from a regression of its daily total returns on the benchmark's; own volatility is what is left after the benchmark's part is removed. "
              : `${symbol} is the market benchmark on this page, so there is nothing to measure it against. `}
            {me
              ? "Ranks and peers come from the nightly cross-section of covered companies."
              : !covered
                ? "Sector ranks and peers are computed for covered companies only."
                : cross
                  ? `${symbol} is not in the cross-section of covered companies yet.`
                  : "The cross-section of covered companies is not available right now, so ranks and peers are left out."}
          </Note>
        </>
      )}
    </TechPanel>
  );
}

/* ---------- events: earnings reactions and the signal log ---------- */
function Reactions({ symbol, T, R }: { symbol: string; T: Technicals; R: NonNullable<Technicals["reactions"]> }) {
  const { open } = useSource();
  return (
    <div>
      <SubTitle caption={`${R.stats.n} releases since ${fmtDate(T.first)}`}>Earnings reactions</SubTitle>
      <TableWrap min={460}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className={S.th}>Release</th>
              <th className={S.thNum} title="Close before the release to the close of the session after it">
                Move
              </th>
              <th className={S.thNum} title="The same window minus SPY">
                vs SPY
              </th>
              <th className={S.thNum} title="Size of the move in units of its normal two-day volatility: the daily volatility of the 60 sessions before × √2">
                σ
              </th>
              <th className={S.thNum} title="Return over the 20 sessions after the reaction window">
                Next 20 days
              </th>
            </tr>
          </thead>
          <tbody>
            {R.rows.slice(0, 12).map((r) => (
              <tr key={r.accn} className={S.row}>
                <td className={S.td}>
                  <button
                    type="button"
                    data-agent-click
                    title="Open the release"
                    onClick={() => open({ ticker: symbol, label: "Earnings release", periodLabel: fmtDate(r.date), unit: "pct", value: r.move, doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.date, title: `8-K filed ${r.date}` } })}
                    className={cn(S.cellButton, "num text-left underline decoration-muted-foreground/50")}
                  >
                    {fmtDate(r.date)}
                  </button>
                </td>
                <td className={cn(S.num, "font-medium", signTone(r.move))}>{pp(r.move)}</td>
                <td className={cn(S.num, signTone(r.excess))}>{pp(r.excess)}</td>
                <td className={S.num}>{f2(r.sigma, 1)}</td>
                <td className={cn(S.num, signTone(r.drift20))}>{pp(r.drift20)}</td>
              </tr>
            ))}
            <tr className="border-t bg-secondary/40">
              <td className={cn(S.td, "font-semibold")}>All {R.stats.n}</td>
              <td className={cn(S.num, "font-semibold")} title="Average size of the move, either direction">
                ±{pc(R.stats.avgAbsMove, 1)}
              </td>
              <td className={cn(S.num, "font-semibold")}>{pp(R.stats.avgExcess)}</td>
              <td className={cn(S.num, "font-semibold")}>{f2(R.stats.avgSigma, 1)}</td>
              <td className={cn(S.num, "font-semibold")}>{pp(R.stats.avgDrift20)}</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>
      <p className={cn("px-3 py-2", S.caption)}>
        Up after {pc(R.stats.upRate)} of releases; the following 20 days continued the reaction's direction {pc(R.stats.continuation)} of the time. The bottom row averages every release: the size of
        the move, then the signed averages.{R.rows.length > 12 ? ` The latest 12 of ${R.rows.length} are listed.` : ""}
      </p>
    </div>
  );
}

function ChartEvents({ T, count }: { T: Technicals; count: number }) {
  const log = T.events.slice(0, count);
  return (
    <div>
      <SubTitle caption={`latest ${log.length} of ${T.events.length.toLocaleString("en-US")} since ${fmtDate(T.first)}`}>Chart events</SubTitle>
      <TableWrap min={420}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className={S.th}>Day</th>
              <th className={S.th}>Event</th>
              <th className={S.thNum}>+5 days</th>
              <th className={S.thNum}>+20 days</th>
              <th className={S.thNum}>+60 days</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={`${e.type}-${e.i}`} className={S.row}>
                <td className={cn(S.td, "num whitespace-nowrap")}>{fmtDate(e.date)}</td>
                <td className={S.td}>{e.name}</td>
                {[5, 20, 60].map((h) => (
                  <td key={h} className={cn(S.num, signTone(e.fwd[h]))}>
                    {e.fwd[h] == null ? <span className="text-muted-foreground">open</span> : pp(e.fwd[h])}
                  </td>
                ))}
              </tr>
            ))}
            {!log.length && (
              <tr>
                <td colSpan={5} className={cn("px-3 py-3", S.caption)}>
                  No chart event has fired in this history.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrap>
      <p className={cn("px-3 py-2", S.caption)}>
        Total return over the sessions after each event. One event says little: whether a type of event has been followed by anything unusual is tested in Evidence, over every occurrence and
        against the base rate. Open: the window has not ended yet.
      </p>
    </div>
  );
}

export function EventsPanel({ symbol, T, loading }: { symbol: string; T: Technicals | null; loading: boolean }) {
  const R = T?.reactions ?? null;
  return (
    <TechPanel
      section="Events"
      id="events"
      tour="tech-events"
      title="Events"
      subtitle={R ? "How the price moved around earnings releases, and the latest chart events with what followed" : "The latest chart events with what followed"}
    >
      {!T ? (
        loading ? (
          <Loading />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>No events without a price history.</p>
        )
      ) : R ? (
        <Split>
          <Reactions symbol={symbol} T={T} R={R} />
          <ChartEvents T={T} count={14} />
        </Split>
      ) : (
        <ChartEvents T={T} count={16} />
      )}
    </TechPanel>
  );
}
