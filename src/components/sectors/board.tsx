// Sector overview: the comparison board, the relative-performance panels of the sector ETFs and the
// compact macro context.
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Fragment, useMemo } from "react";
import { Segmented } from "@/components/app/segmented";
import { Sparkline } from "@/components/charts/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { BENCHMARKS, COVERAGE, MACRO_TILES } from "@/lib/coverage";
import { macroSummariesQuery, pricesQuery } from "@/lib/data";
import { changeText, fmtMacro } from "@/lib/macro";
import { fmtDate, ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { boardRows, relativeSeries, sortBoard, SPANS, WINDOWS, type BoardRow, type BoardSort, type Span } from "@/lib/sectors/board";
import type { MemberTape } from "@/lib/sectors/breadth";
import { mult, pct, tone, usd } from "@/lib/sectors/format";
import { qLabel, SECTOR_ETF, type Overview } from "@/lib/sectors/groups";
import { Section, ShareMeter, SortTh, heat, useWidth } from "./ui";

/** Where each window's shading saturates (return minus SPY's). */
const SCALE: Record<string, number> = { "1W": 0.03, "1M": 0.06, "3M": 0.12, YTD: 0.25, "1Y": 0.25 };

export function SectorBoard({
  ov,
  tape,
  tapeAsOf,
  level,
  sort,
  dir,
  onSort,
  onLevel,
}: {
  ov: Overview;
  tape: ReadonlyMap<string, MemberTape> | null;
  tapeAsOf: string | null;
  level: "sector" | "industry";
  sort: BoardSort;
  dir: "asc" | "desc";
  onSort: (k: string, d: "asc" | "desc") => void;
  onLevel: (l: "sector" | "industry") => void;
}) {
  const rows = useMemo(
    () => sortBoard(boardRows(ov, level, COVERAGE.map((c) => ({ ticker: c.ticker, sector: c.sector, group: c.group, industry: c.industry })), tape), sort, dir),
    [ov, level, tape, sort, dir],
  );
  const q = rows.find((r) => r.q)?.q;
  const th = { sort, dir, onSort };
  const ind = level === "industry";
  const stickyHead = "min-[1400px]:sticky min-[1400px]:top-[var(--sticky-top,3.5rem)] min-[1400px]:z-10 bg-card";
  return (
    <Section
      id="board"
      name="Sector board"
      title={ind ? "Industries compared" : "Sectors compared"}
      caption={`${rows.length} ${ind ? "industries" : "sectors"} · ${COVERAGE.length.toLocaleString("en-US")} covered companies · click a column to sort, a name to open it`}
      actions={
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
      }
    >
      <div className="max-[1399px]:overflow-x-auto max-[1399px]:scrollbar-thin">
        <table className={cn("w-full border-separate border-spacing-0 text-[13px]", ind ? "min-w-[1100px]" : "min-w-[1030px]")}>
          <colgroup>
            <col className={ind ? "w-[286px]" : "w-[200px]"} />
            <col className="w-[72px]" />
            {WINDOWS.map((w) => (
              <col key={w} className="w-[56px]" />
            ))}
            <col className={ind ? "w-[74px]" : "w-[80px]"} />
            <col className={ind ? "w-[74px]" : "w-[80px]"} />
            <col className="w-[62px]" />
            <col className="w-[62px]" />
            <col className="w-[62px]" />
            <col className="w-[56px]" />
            <col className="w-[84px]" />
          </colgroup>
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th className={cn(stickyHead, "h-6 border-b-0 px-3")} colSpan={2} />
              <th className={cn(stickyHead, "eyebrow h-6 border-l px-2 text-left font-normal")} colSpan={WINDOWS.length}>
                Return, cap-weighted
              </th>
              <th className={cn(stickyHead, "eyebrow h-6 border-l px-2 text-left font-normal")} colSpan={2}>
                Breadth
              </th>
              <th className={cn(stickyHead, "eyebrow h-6 border-l px-2 text-left font-normal")} colSpan={3}>
                Fundamentals{q ? ` · ${qLabel(q)}` : ""}
              </th>
              <th className={cn(stickyHead, "eyebrow h-6 border-l px-2 text-left font-normal")} colSpan={2}>
                Valuation
              </th>
            </tr>
            <tr className="[&>th]:border-b [&>th]:bg-card min-[1400px]:[&>th]:sticky min-[1400px]:[&>th]:top-[calc(var(--sticky-top,3.5rem)+1.5rem)] min-[1400px]:[&>th]:z-10">
              <SortTh k="name" label={ind ? "Industry" : "Sector"} align="left" first="asc" className="sticky left-0 z-[15] pl-3.5" {...th} />
              <SortTh k="mcap" label="Mkt cap" title="Market cap of the covered companies" {...th} />
              {WINDOWS.map((w, i) => (
                <SortTh key={w} k={`r${w}`} label={w} title={`Cap-weighted price return, ${w}`} className={cn(i === 0 && "border-l")} {...th} />
              ))}
              <SortTh k="a200" label="> 200d" title="Share of members above their 200-day average" className="border-l" {...th} />
              <SortTh k="nh" label="Near high" title="Share of members within 2% of their 52-week high" {...th} />
              <SortTh k="rev" label="Rev YoY" title="Revenue growth, latest calendar quarter vs a year earlier (Σ revenue ÷ Σ year-ago revenue − 1)" className="border-l" {...th} />
              <SortTh k="om" label="Op m." title="Operating margin, trailing twelve months (Σ operating income ÷ Σ revenue)" {...th} />
              <SortTh k="roic" label="ROIC" title="Return on invested capital, trailing twelve months" {...th} />
              <SortTh k="pe" label="P/E" title="Aggregate P/E: Σ market cap ÷ Σ trailing earnings" first="asc" className="border-l" {...th} />
              <SortTh k="pep" label="vs 10Y" title="Where today's aggregate P/E sits in its own 10-year quarterly range, 0 cheapest to 100 dearest" first="asc" {...th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <BoardTr key={r.slug} r={r} ind={ind} />
            ))}
          </tbody>
          <tfoot>
            <tr className="text-muted-foreground">
              <td className="sticky left-0 z-[5] h-7 bg-card px-3.5">S&amp;P 500 (SPY)</td>
              <td />
              {WINDOWS.map((w, i) => (
                <td key={w} className={cn("num px-2 text-right", i === 0 && "border-l")}>
                  {pct(ov.spy_returns?.[w], { sign: true })}
                </td>
              ))}
              <td className="border-l" colSpan={2} />
              <td className="border-l" colSpan={3} />
              <td className="border-l" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] leading-4 text-muted-foreground">
        Shading: the group's return minus SPY's over the same window, green ahead and red behind. Breadth from each member's daily closes
        {tapeAsOf ? ` as of ${fmtDate(tapeAsOf)}` : ""}. Fundamentals aggregate the members' filings (Σ numerator ÷ Σ denominator) for
        the latest calendar quarter; P/E vs 10Y places today's aggregate in its own 10-year range. Prices as of {fmtDate(ov.as_of)}.
      </p>
    </Section>
  );
}

function BoardTr({ r, ind }: { r: BoardRow; ind: boolean }) {
  // Industries carry their sector as a quiet suffix after the name and count.
  const to = r.kind === "sector" ? { to: "/app/sectors/$sector" as const, params: { sector: r.name } } : { to: "/app/sectors/g/$slug" as const, params: { slug: r.slug } };
  return (
    <tr className="group [&>td]:border-b [&>td]:transition-colors [&>td]:duration-150 hover:[&>td]:bg-secondary">
      <td className="sticky left-0 z-[5] h-7 max-w-0 bg-card px-3.5 max-[1399px]:min-w-[150px]">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <Link
            {...to}
            title={r.name}
            className="truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {r.name}
          </Link>
          <span className="num shrink-0 text-[11px] text-muted-foreground">{r.n}</span>
          {ind && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={r.sector}>
              · {r.sector}
            </span>
          )}
        </span>
      </td>
      <td className="num px-2 text-right">{usd(r.mcap)}</td>
      {WINDOWS.map((w, i) => (
        <td
          key={w}
          className={cn("num px-2 text-right", i === 0 && "border-l")}
          style={heat(r.excess[w], SCALE[w])}
          title={r.excess[w] != null ? `${w}: ${pct(r.ret[w], { sign: true })}, ${pct(r.excess[w], { sign: true })} vs SPY` : undefined}
        >
          {pct(r.ret[w], { sign: true })}
        </td>
      ))}
      <td className="border-l px-2 text-right">
        <ShareMeter value={r.above200} share={r.tape?.above200} />
      </td>
      <td className="px-2 text-right">
        <ShareMeter value={r.nearHigh} share={r.tape?.nearHigh} />
      </td>
      <td className={cn("num border-l px-2 text-right", tone(r.revGrowth))}>{pct(r.revGrowth, { sign: true })}</td>
      <td className="num px-2 text-right">{pct(r.om)}</td>
      <td className="num px-2 text-right">{pct(r.roic)}</td>
      <td className="num border-l px-2 text-right">{mult(r.pe)}</td>
      <td className="px-2 text-right">{r.pePct != null ? <PctBar p={r.pePct} /> : <span className="text-muted-foreground">–</span>}</td>
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

/* ---------- relative performance of the sector ETFs, small multiples on one scale ---------- */
/** One SPDR fund per sector (the benchmark list also carries SMH, an industry fund). */
const SECTOR_ETFS = BENCHMARKS.filter((b) => b.group === "sector" && b.sector && SECTOR_ETF[b.sector] === b.symbol);

export function RelativePanels({ span, onSpan }: { span: Span; onSpan: (s: Span) => void }) {
  const syms = ["SPY", ...SECTOR_ETFS.map((b) => b.symbol)];
  const qs = useQueries({ queries: syms.map((s) => pricesQuery(s, "2y", "1d")) });
  const stamp = qs.map((q) => q.dataUpdatedAt).join();
  const n = SPANS.find((s) => s.v === span)!.n;
  const panels = useMemo(() => {
    const spy = qs[0].data?.bars.map((b) => [b[0], b[5]] as const);
    if (!spy) return null;
    return SECTOR_ETFS.map((b, i) => {
      const bars = qs[i + 1].data?.bars.map((x) => [x[0], x[5]] as const);
      const s = bars ? relativeSeries(bars, spy, n) : [];
      return { b, s, last: s.at(-1)?.v ?? null, from: s[0]?.date, to: s.at(-1)?.date };
    })
      .filter((p) => p.s.length > 1)
      .sort((a, b) => (b.last ?? -9) - (a.last ?? -9));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, n]);
  const all = panels?.flatMap((p) => p.s.map((x) => x.v)) ?? [];
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const range = panels?.[0] ? `${fmtDate(panels[0].from!, { month: "short", day: "numeric", year: "numeric" })} to ${fmtDate(panels[0].to!, { month: "short", day: "numeric", year: "numeric" })}` : "";
  return (
    <Section
      id="relative"
      name="Relative performance"
      title="Sector ETFs against the S&P 500"
      caption={`Price of each SPDR sector ETF relative to SPY, rebased to 0 at the start · one scale for all panels · ${range}`}
      actions={<Segmented size="xs" label="Relative performance window" value={span} onChange={onSpan} options={SPANS.map((s) => ({ v: s.v, l: s.l }))} />}
    >
      {!panels ? (
        <Skeleton className="m-3.5 h-40" />
      ) : (
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

/* ---------- macro context: the official series tagged as sector drivers ---------- */
export function MacroContext() {
  const summaries = useQuery(macroSummariesQuery);
  const drivers = MACRO_TILES.filter((d) => d.sectors?.length)
    .map((d) => ({ d, r: summaries.data?.get(d.id) }))
    .sort((a, b) => (b.d.sectors!.length - a.d.sectors!.length) || a.d.title.localeCompare(b.d.title))
    .slice(0, 12);
  return (
    <Section
      id="macro"
      name="Macro context"
      title="Macro drivers"
      caption="Official series that lead sector revenue and costs, most widely relevant first · open one in Macro"
    >
      {!summaries.data ? (
        <Skeleton className="m-3.5 h-40" />
      ) : (
        <div className="max-lg:overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
                <th className="min-w-[210px] pl-3.5 text-left">Series</th>
                <th className="w-[90px] text-right">Latest</th>
                <th className="w-[150px] text-right">Change</th>
                <th className="relative w-[84px]">
                  <span className="sr-only">Trend</span>
                </th>
                <th className="text-left">Sectors it drives</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(({ d, r }) => (
                <tr key={d.id} className="[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 hover:[&>td]:bg-secondary/60">
                  <td className="max-w-0 pl-3.5">
                    <Link
                      to="/app/macro"
                      search={{ group: d.group === "curve" ? "rates" : d.group, series: d.id }}
                      className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`${d.title} · ${d.agency}`}
                    >
                      {d.title}
                    </Link>
                  </td>
                  <td className="num text-right font-medium">{r ? fmtMacro(d, r.latest) : "–"}</td>
                  <td className="num truncate text-right text-[12px] text-muted-foreground">
                    {r ? (
                      <>
                        {changeText(d, r).replace(/ vs .*/, "")} · {fmtDate(r.date, { month: "short", year: "2-digit" })}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>{r?.spark?.length ? <Sparkline values={r.spark.map((o) => o[1])} tone="ink" className="h-5 w-20" /> : null}</td>
                  <td className="max-w-0">
                    <span className="flex gap-1 overflow-hidden">
                      {d.sectors!.map((s, i) => (
                        <Fragment key={s}>
                          {i > 0 && <span className="text-muted-foreground">·</span>}
                          <Link
                            to="/app/sectors/$sector"
                            params={{ sector: s }}
                            className="shrink-0 rounded-sm text-[12px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {s}
                          </Link>
                        </Fragment>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
