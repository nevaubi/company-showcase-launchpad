// Sector overview: the comparison board with its three column sets, the sector funds against the S&P 500
// (relative performance, and correlation with volatility and beta) and the compact macro context.
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, type ReactNode } from "react";
import { Segmented } from "@/components/app/segmented";
import { Sparkline } from "@/components/charts/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { BENCHMARKS, COVERAGE, MACRO_TILES } from "@/lib/coverage";
import { macroSummariesQuery, pricesQuery } from "@/lib/data";
import type { MacroSummary } from "@/lib/macro";
import { changeText, fmtMacro } from "@/lib/macro";
import { fmtDate, ordinal } from "@/lib/format";
import { marketsQuery } from "@/lib/markets/query";
import { cn } from "@/lib/utils";
import {
  BOARD_DROP,
  BOARD_SETS,
  fitBoard,
  boardRows,
  relativeSeries,
  sharedQuarter,
  signalShare,
  sortBoard,
  SPANS,
  WINDOWS,
  withoutTapeRow,
  type BoardRow,
  type BoardSet,
  type BoardSort,
  type Cell,
  type Span,
} from "@/lib/sectors/board";
import { tapeAsOf, type MemberTape, type TapeFile } from "@/lib/sectors/breadth";
import { pickDrivers } from "@/lib/sectors/drivers";
import { fundRisk } from "@/lib/sectors/etf";
import { mult, pct, ratio, tone, usd } from "@/lib/sectors/format";
import { qLabel, SECTOR_ETF, type Overview } from "@/lib/sectors/groups";
import { baseMembers } from "@/lib/sectors/members";
import { marketIndex } from "@/lib/sectors/risk";
import { QuietLine, Section, ShareMeter, SortTh, STICKY_HEAD, STICKY_HEAD_2, heat, useFits, useWidth } from "./ui";

/** Where each window's shading saturates (return minus SPY's). */
const SCALE: Record<string, number> = { "1W": 0.03, "1M": 0.06, "3M": 0.12, YTD: 0.25, "1Y": 0.25 };

const SET_LABEL: Record<BoardSet, string> = { overview: "Overview", fundamentals: "Fundamentals", risk: "Risk and signals" };

interface ColSpec {
  k: BoardSort;
  label: string;
  title: string;
  /** Column width in px. */
  w: number;
  first?: "asc" | "desc";
  /** Starts a column group: draws the rule on its left. */
  group?: string;
  cell: (r: BoardRow, ctx: Ctx) => ReactNode;
  /** Per-cell tooltip and shading. */
  cellTitle?: (r: BoardRow) => string | undefined;
  style?: (r: BoardRow) => React.CSSProperties | undefined;
  className?: (r: BoardRow) => string;
}
interface Ctx {
  pending: boolean;
  marketPending: boolean;
}

const basis = (c: Cell, what: string) => (c.q ? `${what}: ${qLabel(c.q)} · ${c.n ?? 0} ${c.n === 1 ? "company" : "companies"}` : undefined);
const fund = (k: keyof BoardRow["f"], label: string, title: string, w: number, fmt: (v: number | null) => string, extra: Partial<ColSpec> = {}): ColSpec => ({
  k: (extra.k ?? k) as BoardSort,
  label,
  title,
  w,
  cell: (r) => fmt(r.f[k].v),
  cellTitle: (r) => basis(r.f[k], label),
  ...extra,
});
const dash = <span className="text-muted-foreground">–</span>;
const wait = <Skeleton className="ml-auto h-3 w-8" />;

const RETURN_COLS: ColSpec[] = WINDOWS.map((w, i) => ({
  k: `r${w}` as BoardSort,
  label: w,
  title: `Cap-weighted price return of the members, ${w}`,
  w: 56,
  group: i === 0 ? "Return, cap-weighted" : undefined,
  cell: (r) => pct(r.ret[w], { sign: true }),
  cellTitle: (r) => (r.excess[w] != null ? `${w}: ${pct(r.ret[w], { sign: true })}, ${pct(r.excess[w], { sign: true })} vs SPY` : undefined),
  style: (r) => heat(r.excess[w], SCALE[w]),
}));
const valTitle = (r: BoardRow, what: string) => (r.valQuarter ? `${what}: ${qLabel(r.valQuarter)} quarter-end market caps (no current multiple in the file)` : `${what}: today's market caps · ${r.valN ?? 0} companies`);
const PE: ColSpec = {
  k: "pe",
  label: "P/E",
  title: "Aggregate P/E on today's market caps: Σ market cap ÷ Σ trailing earnings",
  w: 56,
  first: "asc",
  cell: (r) => mult(r.pe),
  cellTitle: (r) => (r.pe != null ? valTitle(r, "P/E") : undefined),
};

const COLS: Record<BoardSet, ColSpec[]> = {
  overview: [
    { k: "mcap", label: "Mkt cap", title: "Market cap of the covered companies", w: 72, cell: (r) => usd(r.mcap) },
    ...RETURN_COLS,
    {
      k: "a200",
      label: "> 200d",
      title: "Share of members above their 200-day average",
      w: 80,
      group: "Breadth",
      cell: (r, c) => (c.pending ? wait : <ShareMeter value={r.above200} share={r.tape?.above200} noRow={r.tape?.noRow} />),
    },
    {
      k: "nh",
      label: "Near high",
      title: "Share of members within 2% of their 52-week high",
      w: 80,
      cell: (r, c) => (c.pending ? wait : <ShareMeter value={r.nearHigh} share={r.tape?.nearHigh} noRow={r.tape?.noRow} />),
    },
    fund("rev_growth", "Rev YoY", "Revenue growth, latest calendar quarter vs a year earlier (Σ revenue ÷ Σ year-ago revenue − 1)", 62, (v) => pct(v, { sign: true }), {
      k: "rev",
      group: "Fundamentals",
      className: (r) => tone(r.f.rev_growth.v),
    }),
    fund("om", "Op m.", "Operating margin, trailing twelve months (Σ operating income ÷ Σ revenue)", 62, (v) => pct(v)),
    fund("roic", "ROIC", "Return on invested capital, trailing twelve months (Σ NOPAT ÷ Σ invested capital)", 62, (v) => pct(v)),
    { ...PE, group: "Valuation, today" },
    {
      k: "pep",
      label: "vs 10Y",
      title: "Where today's aggregate P/E sits in its own 10-year quarterly range, 0 cheapest to 100 dearest",
      w: 84,
      first: "asc",
      cell: (r) => (r.pePct != null ? <PctBar p={r.pePct} /> : dash),
    },
  ],
  fundamentals: [
    fund("rev_ttm", "Revenue", "Revenue of the members, trailing twelve months, summed", 78, (v) => usd(v), { k: "revttm", group: "Size, TTM" }),
    fund("rev_growth", "Rev YoY", "Revenue growth, latest calendar quarter vs a year earlier (Σ revenue ÷ Σ year-ago revenue − 1)", 66, (v) => pct(v, { sign: true }), {
      k: "rev",
      group: "Growth, YoY",
      className: (r) => tone(r.f.rev_growth.v),
    }),
    fund("ni_growth", "Earnings", "Net income growth, latest calendar quarter vs a year earlier (Σ net income ÷ Σ year-ago net income − 1)", 70, (v) => pct(v, { sign: true }), {
      k: "ni",
      className: (r) => tone(r.f.ni_growth.v),
    }),
    fund("gm", "Gross", "Gross margin, trailing twelve months (Σ gross profit ÷ Σ revenue)", 62, (v) => pct(v), { group: "Margins, TTM" }),
    fund("om", "Operating", "Operating margin, trailing twelve months (Σ operating income ÷ Σ revenue)", 72, (v) => pct(v)),
    fund("nm", "Net", "Net margin, trailing twelve months (Σ net income ÷ Σ revenue)", 58, (v) => pct(v)),
    fund("fcfm", "FCF", "Free cash flow margin, trailing twelve months (Σ operating cash flow less capex ÷ Σ revenue)", 58, (v) => pct(v)),
    fund("roic", "ROIC", "Return on invested capital, trailing twelve months (Σ NOPAT ÷ Σ invested capital)", 62, (v) => pct(v), { group: "Capital" }),
    fund("nd_ebitda", "ND/EBITDA", "Net debt to EBITDA (Σ debt less cash ÷ Σ EBITDA, companies with positive EBITDA)", 84, (v) => mult(v), { k: "nde", first: "asc" }),
    { ...PE, group: "Valuation, today" },
    {
      k: "ps",
      label: "P/S",
      title: "Aggregate price to sales on today's market caps: Σ market cap ÷ Σ trailing revenue",
      w: 56,
      first: "asc",
      cell: (r) => mult(r.ps),
      cellTitle: (r) => (r.ps != null ? valTitle(r, "P/S") : undefined),
    },
    {
      k: "fcfy",
      label: "FCF yld",
      title: "Free cash flow yield: Σ free cash flow ÷ Σ market cap (1 ÷ aggregate P/FCF)",
      w: 66,
      cell: (r) => pct(r.fcfYield),
      cellTitle: (r) => (r.fcfYield != null ? valTitle(r, "FCF yield") : undefined),
    },
  ],
  risk: [
    { k: "mcap", label: "Mkt cap", title: "Market cap of the covered companies", w: 76, cell: (r) => usd(r.mcap) },
    { ...RETURN_COLS[2], w: 64, group: "Return" },
    {
      k: "vol",
      label: "Volatility",
      title: "Median of the members' 60-day volatility (standard deviation of daily returns), annualised",
      w: 88,
      group: "Risk",
      cell: (r, c) => (c.pending ? wait : pct(r.vol)),
      cellTitle: (r) => (r.tape ? `${r.tape.volKnown} of ${r.n} members` : undefined),
    },
    { k: "disp", label: "1M spread", title: "Standard deviation of the members' 21-day returns: how far apart they moved", w: 88, cell: (r) => pct(r.disp) },
    { k: "top5", label: "Top 5", title: "Share of the group's market cap in its five largest members", w: 70, cell: (r) => pct(r.top5, { digits: 0 }) },
    {
      k: "em",
      label: "Earn. move",
      title: "Mean of the members' average absolute move from the close before an earnings release to the close of the day after",
      w: 96,
      group: "Earnings",
      cell: (r, c) => (c.marketPending ? wait : pct(r.earnings?.v)),
      cellTitle: (r) => (r.earnings ? `${r.earnings.n} of ${r.n} members have a measured release` : undefined),
    },
    {
      k: "sig",
      label: "With signal",
      title: "Share of the members in the markets file with a chart pattern triggered in the last ten sessions",
      w: 96,
      group: "Chart signals, last 10 sessions",
      cell: (r, c) => (c.marketPending ? wait : <ShareMeter value={signalShare(r)} />),
      cellTitle: (r) => (r.signals && r.covered ? `${r.signals.total} signals in ${r.signals.companies} of the ${r.covered} members the file covers (${r.n} members)` : undefined),
    },
    {
      k: "bull",
      label: "Bullish",
      title: "Live signals with a bullish reading (breakouts, golden crosses, oversold, double bottoms, gaps up)",
      w: 70,
      cell: (r, c) => (c.marketPending ? wait : r.signals && r.covered ? r.signals.bullish : dash),
      cellTitle: (r) => kinds(r, "bullish"),
    },
    {
      k: "bear",
      label: "Bearish",
      title: "Live signals with a bearish reading (breakdowns, death crosses, overbought, double tops, gaps down)",
      w: 70,
      cell: (r, c) => (c.marketPending ? wait : r.signals && r.covered ? r.signals.bearish : dash),
      cellTitle: (r) => kinds(r, "bearish"),
    },
  ],
};
const kinds = (r: BoardRow, bias: "bullish" | "bearish") =>
  r.signals
    ?.kinds.filter((k) => k.bias === bias)
    .map((k) => `${k.label} ${k.n}`)
    .join(" · ") || undefined;

/** Name column: 180 px on a phone (the rest scrolls beside it; "Communication Services" fits), the full width from about 540 px up. */
const NAME_W = { sector: 212, industry: 310 };

export function SectorBoard({
  ov,
  tape,
  tapeFile,
  tapePending,
  level,
  set,
  sort,
  dir,
  onSort,
  onLevel,
  onSet,
}: {
  ov: Overview;
  /** Member tape by ticker; null when it did not load (then every row shows the pipeline's breadth). */
  tape: ReadonlyMap<string, MemberTape> | null;
  tapeFile: TapeFile | null;
  tapePending: boolean;
  level: "sector" | "industry";
  set: BoardSet;
  sort: BoardSort;
  dir: "asc" | "desc";
  onSort: (k: string, d: "asc" | "desc") => void;
  onLevel: (l: "sector" | "industry") => void;
  onSet: (s: BoardSet) => void;
}) {
  const market = useQuery({ ...marketsQuery, select: marketIndex, enabled: set === "risk" });
  const members = useMemo(() => baseMembers(ov, COVERAGE), [ov]);
  const all = useMemo(() => boardRows(ov, level, members.list, tape, market.data), [ov, level, members, tape, market.data]);
  const rows = useMemo(() => sortBoard(all, sort, dir), [all, sort, dir]);
  const ind = level === "industry";
  const [wrap, avail] = useWidth<HTMLDivElement>();
  // The name column as the table's min-width draws it: clamp(180px, 100vw - 228px, NAME_W).
  const nameW = typeof window === "undefined" ? NAME_W[level] : Math.min(NAME_W[level], Math.max(180, window.innerWidth - 228));
  const cols = useMemo(() => {
    // Each column carries the group it sits in, so a dropped or moved column never takes a group label away.
    let g = "";
    const tagged = COLS[set].map((c) => ({ ...c, grp: (g = c.group ?? g) }));
    const fit = fitBoard(tagged, BOARD_DROP[set], sort, avail, nameW);
    return fit.map((c, i) => ({ ...c, group: i === 0 || fit[i - 1].grp !== c.grp ? c.grp || (i === 0 ? undefined : " ") : undefined }));
  }, [set, sort, avail, nameW]);
  const hidden = COLS[set].filter((c) => !cols.some((x) => x.k === c.k)).map((c) => c.label);
  const rest = cols.reduce((s, c) => s + c.w, 0);
  const fits = avail >= rest + nameW;
  const q = sharedQuarter(all);
  const th = { sort, dir, onSort };
  const ctx: Ctx = { pending: tapePending, marketPending: set === "risk" && market.isPending };
  const head = cn("bg-card", fits && "sticky top-[var(--sticky-top,3.5rem)] z-10");
  // Column groups for the quiet head row: the leading ungrouped columns sit under the name.
  const groups: { label: string; span: number }[] = [];
  for (const c of cols) {
    if (c.group || !groups.length) groups.push({ label: c.group ?? "", span: 1 });
    else groups[groups.length - 1].span++;
  }
  const noRow = withoutTapeRow(all);
  const covered = all.reduce((s, r) => s + (r.covered ?? 0), 0);
  const total = all.reduce((s, r) => s + r.n, 0);
  return (
    <Section
      id="board"
      name="Sector board"
      title={ind ? "Industries compared" : "Sectors compared"}
      caption={`${rows.length} ${ind ? "industries" : "sectors"} · ${members.list.length.toLocaleString("en-US")} covered companies · click a column to sort, a name to open it${ind ? " · the code after each industry is its sector's fund" : ""}${
        hidden.length ? ` · ${hidden.join(", ")} on a wider window` : ""
      }`}
      actions={
        <>
          <Segmented size="xs" label="Columns" value={set} onChange={onSet} options={(Object.keys(BOARD_SETS) as BoardSet[]).map((s) => ({ v: s, l: SET_LABEL[s] }))} />
          <Segmented
            size="xs"
            label="Level"
            value={level}
            onChange={onLevel}
            options={[
              { v: "sector", l: "Sectors" },
              { v: "industry", l: "Industries" },
            ]}
          />
        </>
      }
    >
      <div ref={wrap} className={cn(!fits && "overflow-x-auto scrollbar-thin")}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: `calc(${rest}px + clamp(180px, 100vw - 228px, ${NAME_W[level]}px))` }}>
          <colgroup>
            <col />
            {cols.map((c) => (
              <col key={c.k} style={{ width: c.w }} />
            ))}
          </colgroup>
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th className={cn(head, "sticky left-0 z-[15] h-6 px-3")} />
              {groups.map((g, i) =>
                i === 0 && !g.label ? (
                  <th key={i} className={cn(head, "h-6")} colSpan={g.span} />
                ) : (
                  <th key={i} className={cn(head, "eyebrow h-6 overflow-hidden border-l px-2 text-left font-normal whitespace-nowrap")} colSpan={g.span}>
                    {g.label}
                    {g.label === "Fundamentals" || set === "fundamentals" ? (i === (set === "fundamentals" ? 0 : -1) || g.label === "Fundamentals" ? ` · ${q ? qLabel(q) : "latest quarter"}` : "") : ""}
                  </th>
                ),
              )}
            </tr>
            <tr className={cn("[&>th]:border-b [&>th]:bg-card", fits && STICKY_HEAD_2)}>
              <SortTh k="name" label={ind ? "Industry" : "Sector"} align="left" first="asc" className="sticky left-0 !z-[15] pl-3.5" {...th} />
              {cols.map((c) => (
                <SortTh key={c.k} k={c.k} label={c.label} title={c.title} first={c.first} className={cn(c.group && "border-l")} {...th} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <BoardTr key={r.slug} r={r} ind={ind} cols={cols} ctx={ctx} />
            ))}
          </tbody>
          {set !== "fundamentals" && (
            <tfoot>
              <tr className="text-muted-foreground">
                <td className="sticky left-0 z-[5] h-7 bg-card px-3.5 whitespace-nowrap">S&amp;P 500 (SPY)</td>
                {cols.map((c) => (
                  <td key={c.k} className={cn("num px-2 text-right", c.group && "border-l")}>
                    {c.k.startsWith("r") && c.k !== "rev" && c.k !== "revttm" && c.k !== "roic" ? pct(ov.spy_returns?.[c.k.slice(1)], { sign: true }) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] leading-4 text-muted-foreground">
        {set === "overview" && (
          <>
            Shading: the group's return minus SPY's over the same window, green ahead and red behind.{" "}
            {tapePending ? (
              "Breadth is loading."
            ) : tape && tapeFile ? (
              <>
                Breadth from each member's daily closes {tapeAsOf(tapeFile, (d) => fmtDate(d))}
                {noRow ? `; ${noRow.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} companies have no breadth row and count in no share` : ""}.
              </>
            ) : (
              `The daily member tape did not load: breadth is the pipeline's share above the 200-day average on ${fmtDate(ov.as_of)}, and the near-high share is not available.`
            )}{" "}
            Fundamentals aggregate the members' filings (Σ numerator ÷ Σ denominator) for {q ? qLabel(q) : "each group's latest quarter (in each cell's tooltip)"}, the
            newest quarter at least half as many companies have reported as the one before. P/E is on today's market caps; vs 10Y places it in its own 10-year range.
            Prices as of {fmtDate(ov.as_of)}.
          </>
        )}
        {set === "fundamentals" && (
          <>
            Every figure is Σ numerator ÷ Σ denominator over the members reporting both, for {q ? qLabel(q) : "each group's latest quarter"}; a cell's tooltip gives its
            quarter and company count. Revenue is the members' trailing twelve months summed. Valuation is on today's market caps over trailing figures (
            {ov.groups.find((g) => g.kind === level)?.val_now ? "the companies with a recent report" : "quarter-end caps where the file has no current multiple"}); FCF
            yield is 1 ÷ aggregate P/FCF. Banks report no gross margin, so Financials shows none. Prices as of {fmtDate(ov.as_of)}.
          </>
        )}
        {set === "risk" && (
          <>
            Volatility: median of the members' 60-day volatility, annualised{tape && tapeFile ? ` (${tapeAsOf(tapeFile, (d) => fmtDate(d))})` : tapePending ? "" : " (the member tape did not load)"}.
            1M spread: standard deviation of the members' 21-day returns. Earnings move: close before a release to the close of the day after, averaged per company, then
            across the members.{" "}
            {market.data
              ? `Earnings moves and chart signals come from the markets file built ${fmtDate(market.data.asOf)}, which covers ${covered.toLocaleString("en-US")} of these ${total.toLocaleString("en-US")} companies${covered < total / 2 ? " (the small bundled copy, not the full nightly file)" : ""}.`
              : market.isError
                ? "The markets file did not load, so earnings moves and chart signals are not shown."
                : "Loading the markets file for earnings moves and chart signals."}
          </>
        )}
      </p>
    </Section>
  );
}

function BoardTr({ r, ind, cols, ctx }: { r: BoardRow; ind: boolean; cols: ColSpec[]; ctx: Ctx }) {
  const to = r.kind === "sector" ? { to: "/app/sectors/$sector" as const, params: { sector: r.name } } : { to: "/app/sectors/g/$slug" as const, params: { slug: r.slug } };
  const code = SECTOR_ETF[r.sector];
  return (
    <tr className="group [&>td]:border-b [&>td]:transition-colors [&>td]:duration-150 hover:[&>td]:bg-secondary">
      <td className="sticky left-0 z-[5] h-7 overflow-hidden bg-card pl-3.5 pr-2">
        {/* One line of 28 px: what does not fit whole wraps below it and is cut off, so a name is never half shown beside a suffix. */}
        <span className="flex h-7 flex-wrap items-baseline gap-x-1.5 overflow-hidden leading-7">
          <Link
            {...to}
            title={ind ? `${r.name} · ${r.sector}` : r.name}
            className="max-w-full truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {r.name}
          </Link>
          <span className="num text-[11px] text-muted-foreground" title={`${r.n} members`}>
            {r.n}
          </span>
          {ind && (
            <span className="text-[11px] whitespace-nowrap text-muted-foreground" title={r.sector}>
              · <span className="num min-[1600px]:hidden">{code ?? r.sector}</span>
              <span className="max-[1599px]:hidden">{r.sector}</span>
            </span>
          )}
        </span>
      </td>
      {cols.map((c) => (
        <td key={c.k} className={cn("num px-2 text-right", c.group && "border-l", c.className?.(r))} style={c.style?.(r)} title={c.cellTitle?.(r)}>
          {c.cell(r, ctx)}
        </td>
      ))}
    </tr>
  );
}

function PctBar({ p }: { p: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${ordinal(Math.round(p * 100))} percentile of its 10-year range`}>
      <span className="relative h-1 w-10 rounded-full bg-secondary" aria-hidden>
        <span className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${p * 100}%` }} />
      </span>
      <span className="num w-6 text-right">{Math.round(p * 100)}</span>
    </span>
  );
}

/* ---------- the sector funds: prices shared by the relative panels and the correlation panel ---------- */
/** One SPDR fund per sector (the benchmark list also carries SMH, an industry fund). */
const SECTOR_ETFS = BENCHMARKS.filter((b) => b.group === "sector" && b.sector && SECTOR_ETF[b.sector] === b.symbol);
const FUNDS = ["SPY", ...SECTOR_ETFS.map((b) => b.symbol)];

function useFundCloses() {
  const qs = useQueries({ queries: FUNDS.map((s) => pricesQuery(s, "2y", "1d")) });
  const stamp = qs.map((q) => `${q.dataUpdatedAt}${q.status}`).join();
  return useMemo(() => {
    const closes = new Map<string, (readonly [string, number])[]>();
    qs.forEach((q, i) => {
      if (q.data?.bars.length) closes.set(FUNDS[i], q.data.bars.map((b) => [b[0], b[5]] as const));
    });
    return {
      closes,
      /** Funds whose prices failed to load (not those still loading). */
      failed: FUNDS.filter((_, i) => qs[i].isError || (qs[i].isSuccess && !qs[i].data?.bars.length)),
      loading: qs.some((q) => q.isPending),
      retry: () => qs.forEach((q) => (q.isError ? void q.refetch() : undefined)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
}

const notShown = (failed: string[]) => {
  const f = failed.filter((s) => s !== "SPY");
  return f.length ? ` · not shown: ${f.join(", ")} (prices did not load)` : "";
};
const RetryLine = ({ what, retry }: { what: string; retry: () => void }) => (
  <QuietLine>
    {what}{" "}
    <button type="button" onClick={retry} className="rounded-sm text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      Try again
    </button>
  </QuietLine>
);

export function RelativePanels({ span, onSpan }: { span: Span; onSpan: (s: Span) => void }) {
  const f = useFundCloses();
  const n = SPANS.find((s) => s.v === span)!.n;
  const spy = f.closes.get("SPY");
  const panels = useMemo(() => {
    if (!spy) return null;
    return SECTOR_ETFS.map((b) => {
      const bars = f.closes.get(b.symbol);
      const s = bars ? relativeSeries(bars, spy, n) : [];
      return { b, s, last: s.at(-1)?.v ?? null, from: s[0]?.date, to: s.at(-1)?.date };
    })
      .filter((p) => p.s.length > 1)
      .sort((a, b) => (b.last ?? -9) - (a.last ?? -9));
  }, [f, spy, n]);
  const all = panels?.flatMap((p) => p.s.map((x) => x.v)) ?? [];
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const range = panels?.[0] ? ` · ${fmtDate(panels[0].from!)} to ${fmtDate(panels[0].to!)}` : "";
  return (
    <Section
      id="relative"
      name="Relative performance"
      title="Sector funds against the S&P 500"
      caption={`Total return (dividend-adjusted close) of each SPDR sector fund relative to SPY, rebased to 0 at the start · one scale for all panels${range}${notShown(f.failed)}`}
      actions={<Segmented size="xs" label="Relative performance window" value={span} onChange={onSpan} options={SPANS.map((s) => ({ v: s.v, l: s.l }))} />}
    >
      {panels?.length ? (
        <ul className="grid grid-cols-2 gap-x-2 px-1.5 py-1.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {panels.map((p) => (
            <li key={p.b.symbol} className="min-w-0">
              <Link
                to="/app/sectors/$sector"
                params={{ sector: p.b.sector! }}
                className="block rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-medium">{p.b.name}</span>
                  <span className={cn("num shrink-0 text-[13px] font-medium", tone(p.last))}>{pct(p.last, { sign: true })}</span>
                </span>
                <span className="num block text-[11px] text-muted-foreground">{p.b.symbol} vs SPY</span>
                <Mini s={p.s} lo={lo} hi={hi} label={`${p.b.name} relative to SPY`} />
              </Link>
            </li>
          ))}
        </ul>
      ) : f.loading ? (
        <Skeleton className="m-3.5 h-40" />
      ) : (
        <RetryLine what={spy ? "No sector fund's prices loaded, so there is nothing to compare with SPY right now." : "SPY prices did not load, so the funds cannot be compared right now."} retry={f.retry} />
      )}
    </Section>
  );
}

function Mini({ s, lo, hi, label }: { s: { date: string; v: number }[]; lo: number; hi: number; label: string }) {
  const [ref, W] = useWidth<HTMLSpanElement>();
  const H = 52;
  const pad = (hi - lo) * 0.06 || 0.01;
  const x = (i: number) => (i / Math.max(1, s.length - 1)) * (W - 2) + 1;
  const y = (v: number) => 2 + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - 4);
  const last = s.at(-1)!.v;
  return (
    <span ref={ref} className="mt-1 block h-[52px]">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={`${label}: ${pct(last, { sign: true })}`}>
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--rule)" />
          <path
            d={s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
            fill="none"
            stroke={last >= 0 ? "var(--positive)" : "var(--negative)"}
            strokeWidth={1.4}
          />
          <circle cx={x(s.length - 1)} cy={y(last)} r={2} fill={last >= 0 ? "var(--positive)" : "var(--negative)"} />
        </svg>
      )}
    </span>
  );
}

/* ---------- correlation of the sector funds, with each fund's volatility and beta ---------- */
/** Background of a correlation cell: one hue, deeper as the two funds move more together; red for a negative value. */
function corrBg(v: number | null) {
  if (v == null) return undefined;
  const a = Math.min(1, Math.abs(v)) ** 2 * 42;
  return { background: `color-mix(in oklab, var(${v >= 0 ? "--chart-1" : "--negative"}) ${a.toFixed(0)}%, transparent)` };
}

export function FundCorrelation() {
  const f = useFundCloses();
  const risk = useMemo(() => {
    const series = FUNDS.filter((s) => f.closes.has(s)).map((s) => ({ symbol: s, closes: f.closes.get(s)! }));
    return series.length > 1 && f.closes.has("SPY") ? fundRisk(series, "SPY", 252) : null;
  }, [f]);
  const name = (s: string) => (s === "SPY" ? "S&P 500" : (SECTOR_ETFS.find((b) => b.symbol === s)?.sector ?? s));
  const [wrap, fits] = useFits<HTMLDivElement>(150 + 13 * 28);
  return (
    <Section
      id="correlation"
      name="Fund correlation"
      title="How the sector funds move together"
      caption={
        risk?.sessions
          ? `Daily total returns over ${risk.sessions} sessions to ${fmtDate(risk.to)} · correlation × 100, deeper is tighter · volatility annualised, beta to SPY${notShown(f.failed)}`
          : "Correlation of daily returns, with each fund's volatility and beta to SPY"
      }
    >
      {risk?.sessions ? (
        <div ref={wrap} className={cn(!fits && "overflow-x-auto scrollbar-thin")}>
          <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]" style={{ minWidth: 150 + risk.symbols.length * 28 }}>
            <colgroup>
              <col style={{ width: 58 }} />
              <col style={{ width: 48 }} />
              <col style={{ width: 44 }} />
              {risk.symbols.map((s) => (
                <col key={s} />
              ))}
            </colgroup>
            <thead className="text-[11px] text-muted-foreground">
              <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:font-medium">
                <th className="sticky left-0 z-[2] bg-card pl-3.5 text-left">Fund</th>
                <th className="px-1 text-right" title="Standard deviation of daily returns × √252">
                  Vol
                </th>
                <th className="px-1 text-right" title="Slope of the fund's daily returns on SPY's">
                  Beta
                </th>
                {risk.symbols.map((s, j) => (
                  <th key={s} className={cn("num px-0 text-center font-normal", j === 0 && "border-l")} title={name(s)}>
                    {s.replace(/^XL/, "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {risk.symbols.map((s, i) => (
                <tr key={s} className="[&>td]:h-7 [&>td]:border-b last:[&>td]:border-b-0">
                  <td className="sticky left-0 z-[1] bg-card pl-3.5">
                    {s === "SPY" ? (
                      <span className="num font-medium" title={name(s)}>
                        SPY
                      </span>
                    ) : (
                      <Link
                        to="/app/sectors/$sector"
                        params={{ sector: name(s) }}
                        title={name(s)}
                        className="num inline-flex h-7 items-center rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {s}
                      </Link>
                    )}
                  </td>
                  <td className="num px-1 text-right">{pct(risk.vol[i], { digits: 0 })}</td>
                  <td className="num px-1 text-right">{ratio(risk.beta[i])}</td>
                  {risk.symbols.map((t, j) => (
                    <td
                      key={t}
                      className={cn("num px-0 text-center text-[11px]", j === 0 && "border-l")}
                      style={i === j ? undefined : corrBg(risk.corr[i][j])}
                      title={i === j ? undefined : `${name(s)} and ${name(t)}: ${ratio(risk.corr[i][j])}`}
                    >
                      {i === j ? <span className="text-muted-foreground/50">·</span> : risk.corr[i][j] == null ? "–" : Math.round(risk.corr[i][j]! * 100)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : f.loading ? (
        <Skeleton className="m-3.5 h-64" />
      ) : (
        <RetryLine what="Too few fund prices loaded to measure how the sectors move together." retry={f.retry} />
      )}
      {risk?.sessions ? (
        <p className="border-t px-3.5 py-2 text-[11px] leading-4 text-muted-foreground">
          Column heads drop the XL of each ticker (K is XLK). All figures use the sessions every fund has, {fmtDate(risk.from)} to {fmtDate(risk.to)}.
        </p>
      ) : null}
    </Section>
  );
}

/* ---------- macro context: a short selection of the official series tagged as sector drivers ---------- */
const SECTOR_ORDER = SECTOR_ETFS.map((b) => b.sector!);

export function MacroContext() {
  const summaries = useQuery(macroSummariesQuery);
  const tagged = MACRO_TILES.filter((d) => d.sectors?.length).length;
  const drivers = useMemo(() => pickDrivers(MACRO_TILES, SECTOR_ORDER, 12), []);
  return (
    <Section
      id="macro"
      name="Macro context"
      title="Macro drivers"
      caption={`${drivers.length} of the ${tagged} official series tagged to sectors, chosen so every sector has at least one · each sector page lists all of its own · open one in Macro`}
    >
      {summaries.isError ? (
        <QuietLine>The macro series did not load right now.</QuietLine>
      ) : !summaries.data ? (
        <Skeleton className="m-3.5 h-40" />
      ) : (
        <div className="max-lg:overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[88px]" />
              <col className="w-[150px]" />
              <col className="w-[96px]" />
              <col />
            </colgroup>
            <thead className="text-[11px] text-muted-foreground">
              <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
                <th className="pl-3.5 text-left">Series</th>
                <th className="text-right">Latest</th>
                <th className="text-right">Change</th>
                <th className="relative">
                  <span className="sr-only">Trend</span>
                </th>
                <th className="text-left">Sectors it drives</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <DriverRow key={d.id} d={d} r={summaries.data.get(d.id)} sectors />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

type Tile = (typeof MACRO_TILES)[number];
type Summary = MacroSummary | undefined;

/** One macro series as a table row: title (opens Macro), latest value, change with its date, trend, and optionally the sectors it is tagged to. */
export function DriverRow({ d, r, sectors }: { d: Tile; r: Summary; sectors?: boolean }) {
  return (
    <tr className="[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 last:[&>td]:border-b-0 hover:[&>td]:bg-secondary/60">
      <td className="truncate pl-3.5">
        <Link
          to="/app/macro"
          search={{ group: d.group === "curve" ? "rates" : d.group, series: d.id }}
          className="inline-flex h-7 max-w-full items-center rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`${d.title} · ${d.agency}`}
        >
          <span className="truncate">{d.title}</span>
        </Link>
      </td>
      <td className="num text-right font-medium whitespace-nowrap">{r ? fmtMacro(d, r.latest) : "–"}</td>
      <td className="num truncate text-right text-[12px] text-muted-foreground">
        {r ? (
          <>
            {changeText(d, r).replace(/ vs .*/, "")} · {fmtDate(r.date, { month: "short", year: "2-digit" })}
          </>
        ) : (
          "–"
        )}
      </td>
      <td className={sectors ? undefined : "max-sm:hidden"}>{r?.spark?.length ? <Sparkline values={r.spark.map((o) => o[1])} tone="ink" className="h-5 w-20" /> : null}</td>
      {sectors && (
        <td className="truncate">
          {d.sectors!.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <span className="px-1 text-muted-foreground">·</span>}
              <Link
                to="/app/sectors/$sector"
                params={{ sector: s }}
                className="inline-flex h-7 items-center rounded-sm text-[12px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {s}
              </Link>
            </Fragment>
          ))}
        </td>
      )}
    </tr>
  );
}
