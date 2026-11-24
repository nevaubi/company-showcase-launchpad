// One sector or industry: breadcrumb, summary strip, section nav, peers, performance and valuation,
// quarterly aggregates with risk and signals and the weekly note, the distribution on a chosen metric,
// constituents, macro, KPIs, insiders, filings and segment exposure. Used by /app/sectors/$sector and
// /app/sectors/g/$slug. One member list and one breadth rule for the whole page (src/lib/sectors/members.ts,
// group.ts `joinRows`), so the strip, the peers row and the company table cannot disagree.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { MultiLine } from "@/components/charts/multi-line";
import { Skeleton } from "@/components/ui/skeleton";
import { COVERAGE, MACRO_TILES } from "@/lib/coverage";
import { macroSummariesQuery } from "@/lib/data";
import { fmtDate, ordinal } from "@/lib/format";
import { marketsQuery } from "@/lib/markets/query";
import { cn } from "@/lib/utils";
import { boardRows, type BoardRow } from "@/lib/sectors/board";
import { groupTape, tapeAsOf } from "@/lib/sectors/breadth";
import { driversOf } from "@/lib/sectors/drivers";
import { byUnit, count, mult, pct, pts, ratio, tone, usd } from "@/lib/sectors/format";
import { COL_SETS, COLS, DIST, joinRows, sortRows, summary, tableSort, tapeOn, type ColSet, type GroupSearch, type Row, type Summary } from "@/lib/sectors/group";
import { BREAKDOWN_METRICS, fmtMetric, groupQuery, loadFailure, overviewQuery, qLabel, tapeQuery, type GroupFile, type ValRange } from "@/lib/sectors/groups";
import { baseMembers, membersOf, pageMembers, type Member } from "@/lib/sectors/members";
import { groupRisk, marketIndex, type MarketIndex, type Signal } from "@/lib/sectors/risk";
import { distribution, ends, ranks, type DistPoint, type Distribution as Dist } from "@/lib/sectors/stats";
import { DriverRow } from "./board";
import { AggregateTrends, BreakdownSheet, SectorNotes, useHasNotes } from "./sector-views";
import { Breadcrumb, groupLink, heat, QuietLine, Section, SectionNav, ShareMeter, SortTh, STICKY_HEAD_NAV, Tile, useFits, useWidth, type Crumb } from "./ui";

/** A markets file smaller than this is the bundled copy (about a hundred companies), not the nightly one (about 1,800). */
const FULL_MARKETS = 1000;

export function GroupView({
  slug,
  search,
  setSearch,
}: {
  slug: string;
  search: GroupSearch;
  setSearch: (patch: Partial<GroupSearch>) => void;
}) {
  const g = useQuery(groupQuery(slug));
  const ov = useQuery(overviewQuery);
  const tape = useQuery(tapeQuery);
  const market = useQuery({ ...marketsQuery, select: marketIndex });
  const d = g.data;
  const hasNote = useHasNotes(d?.sector_slug);
  const metric = search.m && d?.agg[search.m] ? search.m : "rev_growth";
  // The breakdown sheet opens from a quarter in the address (a note's link) or a click; closing clears the quarter.
  const [sheetQ, setSheetQ] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  if (!seeded && d && search.q && BREAKDOWN_METRICS.has(metric) && d.quarters.includes(search.q)) {
    setSeeded(true);
    setSheetQ(search.q);
  }
  const pick = (m: string, q?: string) => {
    setSearch({ m: m === "rev_growth" ? undefined : m, q });
    if (q && BREAKDOWN_METRICS.has(m)) setSheetQ(q);
  };
  const idx = tape.data?.idx ?? null;
  const members = useMemo(
    () => pageMembers(baseMembers(ov.data, COVERAGE).list, d ? { kind: d.kind, name: d.name, sector: d.sector, constituents: d.constituents } : null),
    [ov.data, d],
  );
  const rows = useMemo(() => (d ? joinRows(d.constituents, { tape: idx, market: market.data }) : []), [d, idx, market.data]);

  if (g.isError) {
    const why = loadFailure(g.error);
    const title = why === "missing" ? "Group not found" : why === "signin" ? "Sign in to see this group" : "This group is not available right now";
    return (
      <div className="grid grid-cols-1 gap-4">
        <Breadcrumb items={[{ label: "Sectors", to: "/app/sectors" }, { label: why === "missing" ? "Not found" : "Not available" }]} />
        <PageHeader title={title} />
        <Section name={why === "missing" ? "Not found" : "Not available"} title={why === "missing" ? "No file for this group" : "The file did not load"}>
          <QuietLine>
            {why === "missing" ? (
              <>There is no sector or industry file for “{slug}” yet. </>
            ) : why === "signin" ? (
              <>The sector files load for signed-in users only. </>
            ) : (
              <>
                The data service did not answer.{" "}
                <button type="button" onClick={() => void g.refetch()} className="rounded-sm text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Try again
                </button>{" "}
                or{" "}
              </>
            )}
            <Link to="/app/sectors" className="text-link hover:underline">
              {why === "service" ? "go back to sectors" : "Back to sectors"}
            </Link>
          </QuietLine>
        </Section>
      </div>
    );
  }
  if (!d)
    return (
      <div className="grid grid-cols-1 gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
      </div>
    );

  const sectorCrumb = groupLink("sector", d.sector, d.sector_slug);
  const crumbs: Crumb[] = [{ label: "Sectors", to: "/app/sectors" }, ...(d.kind === "industry" ? [sectorCrumb, { label: d.name }] : [{ label: d.name }])];
  const own = d.constituents.map((c) => c.tk);
  const t = tapeOn(idx) ? groupTape(own, idx) : null;
  const ovRow = ov.data?.groups.find((x) => x.slug === d.slug);
  const sum = summary(d, rows, t, ovRow?.breadth?.b200 ?? null);
  const ref = sum.ref;
  const nav = [
    { id: "summary", label: "Summary" },
    { id: "peers", label: d.kind === "sector" ? "Industries" : "Peer industries" },
    { id: "performance", label: "Performance" },
    { id: "trends", label: "Fundamentals" },
    { id: "risk", label: "Risk and signals" },
    { id: "distribution", label: "Distribution" },
    { id: "constituents", label: "Companies" },
    { id: "drivers", label: "Macro" },
    ...(d.insiders || d.filings?.length ? [{ id: "activity", label: "Insiders and filings" }] : []),
    ...(d.segments?.inside?.length ? [{ id: "segments", label: "Exposure" }] : []),
  ];
  const breadthLine = tape.data?.file && t ? `; breadth ${tapeAsOf(tape.data.file, (x) => fmtDate(x))}` : "";
  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <Breadcrumb items={crumbs} />
        <PageHeader
          className="mb-0"
          eyebrow={d.kind === "sector" ? `Sector${d.etf ? ` · ${d.etf}` : ""}` : `Industry · ${d.sector}`}
          title={d.name}
          description={`${d.constituents.length} covered companies, classified by SIC code with documented overrides. Fundamentals are Σ numerator ÷ Σ denominator over the companies reporting both, for ${
            ref ? `${qLabel(ref.q)} (${ref.n} companies)` : "the latest quarter"
          }: the newest quarter at least half as many companies have reported as the one before${
            ref?.early ? `; ${qLabel(ref.early.q)} has ${ref.early.n} so far` : ""
          }. Built ${fmtDate(d.generated.slice(0, 10))}${breadthLine}.`}
        />
      </div>
      <SummaryStrip d={d} s={sum} onPick={pick} />
      <SectionNav sections={nav} />
      <Peers d={d} ov={ov.data ?? null} list={members} tape={idx} loading={ov.isLoading} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Performance d={d} win={search.pw ?? "1y"} onWin={(v) => setSearch({ pw: v === "1y" ? undefined : v })} />
        <Valuation d={d} onPick={pick} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <AggregateTrends g={d} metric={metric} q={search.q} span={search.span ?? "5y"} onSpan={(v) => setSearch({ span: v === "5y" ? undefined : v })} onPick={pick} />
        <div className="grid min-w-0 grid-cols-1 content-start gap-5">
          <RiskSignals d={d} rows={rows} tape={idx} tapePending={tape.isPending} market={market.data ?? null} marketError={market.isError} />
          {hasNote !== false && (
            <SectorNotes only={d.sector_slug} onlyName={d.kind === "industry" ? d.sector : undefined} />
          )}
        </div>
      </div>
      <Distribution rows={rows} dm={search.dm ?? "rev_growth"} onDm={(v) => setSearch({ dm: v === "rev_growth" ? undefined : v })} name={d.name} />
      <Constituents d={d} rows={rows} search={search} setSearch={setSearch} />
      <div id="drivers" className="grid scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] grid-cols-1 gap-5 xl:grid-cols-2">
        <Macro d={d} />
        <Drivers sector={d.sector} />
        {!!d.kpis?.length && (
          <div className="xl:col-span-2">
            <Kpis d={d} />
          </div>
        )}
      </div>
      {!!(d.insiders || d.filings?.length) && (
        <div id="activity" className="grid scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] grid-cols-1 gap-5 xl:grid-cols-2">
          <Insiders d={d} />
          <Filings d={d} />
        </div>
      )}
      <Segments d={d} />
      <BreakdownSheet
        g={d}
        metric={metric}
        q={sheetQ}
        onClose={() => {
          setSheetQ(null);
          if (search.q) setSearch({ q: undefined });
        }}
      />
    </div>
  );
}

/* ---------- summary strip ---------- */
const cos = (n: number | null | undefined) => `${count(n)} ${n === 1 ? "company" : "cos"}`;

function SummaryStrip({ d, s, onPick }: { d: GroupFile; s: Summary; onPick: (m: string, q?: string) => void }) {
  const omD = s.om.v != null && s.omYearAgo != null ? s.om.v - s.omYearAgo : null;
  const early = s.ref?.early ? ` ${qLabel(s.ref.early.q)} is left out: ${s.ref.early.n} companies have reported it so far.` : "";
  const b = s.breadth;
  const share = b.above200;
  const thin = share?.thin && share.known > 0;
  return (
    <section
      id="summary"
      data-section="Summary"
      aria-label="Summary"
      className="grid scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] grid-cols-2 border-y bg-card/40 sm:grid-cols-4 xl:grid-cols-8 [&>*]:border-b [&>*]:border-r xl:[&>*]:border-b-0 [&>*:nth-child(8)]:border-r-0"
    >
      <Tile label="Companies" value={count(s.n)} sub={s.top5 != null ? `top 5 hold ${pct(s.top5, { digits: 0 })}` : undefined} basis="by market cap" />
      <Tile label="Market cap" value={usd(s.mcap)} sub={d.kind === "sector" && d.etf ? `benchmark ${d.etf}` : "covered companies"} basis="latest close" />
      <Tile
        label="Revenue growth"
        value={pct(s.rev.v, { sign: true })}
        sub={`median ${pct(s.rev.med, { sign: true })}`}
        basis={s.rev.q ? `${qLabel(s.rev.q)} · ${cos(s.rev.n)}` : undefined}
        title={`Σ revenue ÷ Σ year-ago revenue − 1 for ${s.rev.q ? qLabel(s.rev.q) : "the latest quarter"}.${early} Open the companies behind it`}
        onClick={() => onPick("rev_growth", s.rev.q ?? undefined)}
      />
      <Tile
        label="Operating margin"
        value={pct(s.om.v)}
        sub={omD != null ? <span className={tone(omD)}>{pts(omD)} YoY</span> : `median ${pct(s.om.med)}`}
        basis={s.om.q ? `${qLabel(s.om.q)} TTM · ${cos(s.om.n)}` : undefined}
        title={`Σ operating income ÷ Σ revenue, trailing twelve months to ${s.om.q ? qLabel(s.om.q) : "the latest quarter"}; company median ${pct(s.om.med)}.${early} Open the companies behind it`}
        onClick={() => onPick("om", s.om.q ?? undefined)}
      />
      <Tile
        label="P/E"
        value={mult(s.pe.v)}
        sub={s.pe.pct != null ? `${ordinal(Math.round(s.pe.pct * 100))} pct of 10Y` : s.pe.q ? "quarter-end caps" : undefined}
        basis={s.pe.v != null ? (s.pe.q ? `${qLabel(s.pe.q)} · ${cos(s.pe.n)}` : `today · ${cos(s.pe.n)}`) : undefined}
        title={
          s.pe.q
            ? `Σ quarter-end market cap ÷ Σ trailing earnings, ${qLabel(s.pe.q)} (no current multiple in the file). Open the companies behind it`
            : "Σ market cap today ÷ Σ trailing earnings. Open the latest quarter's companies behind it"
        }
        onClick={() => onPick("pe", s.pe.q ?? s.ref?.q ?? d.quarters.at(-1))}
      />
      <Tile
        label="Return 3M"
        value={pct(s.ret3m, { sign: true })}
        sub={s.ret3m != null && s.spy3m != null ? `${pct(s.ret3m - s.spy3m, { sign: true })} vs SPY` : undefined}
        subTone={s.ret3m != null && s.spy3m != null ? tone(s.ret3m - s.spy3m) : undefined}
        basis="cap-weighted, price"
      />
      <Tile
        label="Return 1Y"
        value={pct(s.ret1y, { sign: true })}
        sub={s.ret1y != null && s.spy1y != null ? `${pct(s.ret1y - s.spy1y, { sign: true })} vs SPY` : undefined}
        subTone={s.ret1y != null && s.spy1y != null ? tone(s.ret1y - s.spy1y) : undefined}
        basis="cap-weighted, price"
      />
      <Tile
        label="Above 200-day"
        value={thin ? `${share!.hits} of ${share!.known}` : pct(b.share, { digits: 0 })}
        sub={b.nearHigh?.known ? `${b.nearHigh.hits} near 52w high` : b.from === "pipeline" ? "pipeline's share" : undefined}
        basis={
          b.from === "tape" && share
            ? `${share.known} of ${s.n} with a reading${b.noRow ? ` · ${b.noRow} no row` : ""}`
            : b.from === "pipeline"
              ? "daily tape not loaded"
              : undefined
        }
        title={
          b.from === "tape"
            ? "Members above their 200-day average, from each member's daily closes; the same count as the group's row among its peers"
            : "The pipeline's share above the 200-day average (the daily member tape did not load)"
        }
      />
    </section>
  );
}

/* ---------- peers: industries of the sector, or the sector's other industries ---------- */
function Peers({
  d,
  ov,
  list,
  tape,
  loading,
}: {
  d: GroupFile;
  ov: import("@/lib/sectors/groups").Overview | null;
  list: readonly Member[];
  tape: ReadonlyMap<string, import("@/lib/sectors/breadth").MemberTape> | null;
  loading: boolean;
}) {
  const rows = useMemo(() => {
    if (!ov) return [];
    const inds = boardRows(ov, "industry", list, tape).filter((r) => r.sector === d.sector);
    const sec = boardRows(ov, "sector", list, tape).find((r) => r.name === d.sector);
    return [...(sec ? [sec] : []), ...inds.sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))];
  }, [ov, tape, list, d.sector]);
  const spy = ov?.spy_returns ?? {};
  return (
    <Section
      id="peers"
      name="Peer industries"
      title={d.kind === "sector" ? `Industries in ${d.name}` : `${d.sector}: this industry and its peers`}
      caption="The sector first, then its industries by market cap · return shading is the return minus SPY's · fundamentals for each group's latest quarter (in each cell's tooltip)"
    >
      {loading ? (
        <Skeleton className="m-3.5 h-32" />
      ) : !rows.length ? (
        <QuietLine>The sector overview file is not available, so peers cannot be compared right now.</QuietLine>
      ) : (
        <div className="max-[1399px]:overflow-x-auto max-[1399px]:scrollbar-thin">
          <table className="w-full min-w-[700px] border-separate border-spacing-0 text-[13px] sm:min-w-[820px]">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
                <th className="sticky left-0 z-[2] w-[148px] min-w-[148px] bg-card pl-3.5 text-left sm:w-auto sm:min-w-[200px]">Group</th>
                <th className="w-[76px] text-right">Mkt cap</th>
                <th className="w-[64px] text-right">3M</th>
                <th className="w-[64px] text-right">1Y</th>
                <th className="w-[86px] text-right" title="Share of members above their 200-day average">
                  &gt; 200d
                </th>
                <th className="w-[72px] text-right">Rev YoY</th>
                <th className="w-[64px] text-right">Op m.</th>
                <th className="w-[60px] text-right" title="Aggregate P/E on today's market caps">
                  P/E
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PeerTr key={r.slug} r={r} here={r.slug === d.slug} spy={spy} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function PeerTr({ r, here, spy }: { r: BoardRow; here: boolean; spy: Record<string, number> }) {
  const l = groupLink(r.kind, r.name, r.slug);
  const ex = (w: "3M" | "1Y") => (r.ret[w] != null && spy[w] != null ? r.ret[w]! - spy[w] : null);
  const basis = (c: BoardRow["f"]["rev_growth"]) => (c.q ? `${qLabel(c.q)} · ${c.n ?? 0} companies` : undefined);
  return (
    <tr
      aria-current={here ? "page" : undefined}
      className={cn("[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 hover:[&>td]:bg-secondary/60", here && "[&>td]:bg-secondary", r.kind === "sector" && "font-medium")}
    >
      <td className={cn("sticky left-0 z-[1] max-w-0 bg-card pl-3.5", here && "shadow-[inset_2px_0_0_var(--ink)]")}>
        <span className="flex min-w-0 items-baseline gap-1.5">
          {here ? (
            <span className="truncate" title={r.name}>
              {r.name}
            </span>
          ) : (
            <Link to={l.to!} params={l.params as never} title={r.name} className="truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {r.name}
            </Link>
          )}
          <span className="num shrink-0 text-[11px] font-normal text-muted-foreground" title={`${r.n} members`}>
            {r.n}
            {r.kind === "sector" && <span className="max-sm:hidden"> · whole sector</span>}
          </span>
        </span>
      </td>
      <td className="num text-right">{usd(r.mcap)}</td>
      <td className="num text-right" style={heat(ex("3M"), 0.12)}>
        {pct(r.ret["3M"], { sign: true })}
      </td>
      <td className="num text-right" style={heat(ex("1Y"), 0.25)}>
        {pct(r.ret["1Y"], { sign: true })}
      </td>
      <td className="text-right">
        <ShareMeter value={r.above200} share={r.tape?.above200} noRow={r.tape?.noRow} />
      </td>
      <td className={cn("num text-right", tone(r.f.rev_growth.v))} title={basis(r.f.rev_growth)}>
        {pct(r.f.rev_growth.v, { sign: true })}
      </td>
      <td className="num text-right" title={basis(r.f.om)}>
        {pct(r.f.om.v)}
      </td>
      <td className="num text-right" title={r.valQuarter ? `${qLabel(r.valQuarter)} quarter-end caps` : r.valN ? `today · ${r.valN} companies` : undefined}>
        {mult(r.pe)}
      </td>
    </tr>
  );
}

/* ---------- risk and live chart signals ---------- */
const BIAS_TONE: Record<Signal["bias"], string> = { bullish: "text-positive", bearish: "text-negative", neutral: "text-muted-foreground" };

function RiskSignals({
  d,
  rows,
  tape,
  tapePending,
  market,
  marketError,
}: {
  d: GroupFile;
  rows: Row[];
  tape: ReadonlyMap<string, import("@/lib/sectors/breadth").MemberTape> | null;
  tapePending: boolean;
  market: MarketIndex | null;
  marketError: boolean;
}) {
  const tks = useMemo(() => d.constituents.map((c) => c.tk), [d]);
  const beta = useMemo(() => new Map(d.constituents.map((c) => [c.tk, c.beta ?? null])), [d]);
  const risk = useMemo(() => groupRisk(tks, { beta, tape, market }), [tks, beta, tape, market]);
  const withSig = useMemo(
    () =>
      rows
        .filter((r) => r.signals.length)
        .sort((a, b) => Math.min(...a.signals.map((s) => s.ago ?? 99)) - Math.min(...b.signals.map((s) => s.ago ?? 99)) || (b.mcap ?? 0) - (a.mcap ?? 0)),
    [rows],
  );
  const shown = withSig.slice(0, 8);
  const N = risk.members;
  const bundled = market && market.size < FULL_MARKETS;
  const sig = risk.signals;
  return (
    <Section
      id="risk"
      name="Risk and signals"
      title="Risk and chart signals"
      caption={
        market
          ? `Markets file built ${fmtDate(market.asOf)}: ${risk.covered} of ${N} members${bundled ? " (the small bundled copy, not the nightly file)" : ""} · each figure says how many members it rests on`
          : marketError
            ? "The markets file did not load: earnings moves and chart signals are not shown"
            : "Loading the markets file"
      }
    >
      <div className="grid grid-cols-2 border-b sm:grid-cols-4 [&>*]:border-r [&>*:last-child]:border-r-0 max-sm:[&>*:nth-child(2)]:border-r-0 max-sm:[&>*:nth-child(-n+2)]:border-b">
        <Tile label="Beta, median" value={ratio(risk.beta.v)} sub="daily returns vs SPY, 1Y" basis={`${risk.beta.n} of ${N} members`} />
        <Tile
          label="Volatility, median"
          value={tapePending ? <Skeleton className="mt-1 h-4 w-12" /> : pct(risk.vol.v)}
          sub="60 sessions, annualised"
          basis={tape ? `${risk.vol.n} of ${N} members` : tapePending ? undefined : "daily tape not loaded"}
        />
        <Tile label="Earnings move" value={market ? pct(risk.earnings.v) : "–"} sub="mean absolute, day after" basis={market ? `${risk.earnings.n} of ${N} members` : undefined} />
        <Tile
          label="With a signal"
          value={market ? (risk.covered ? `${sig.companies} of ${risk.covered}` : "–") : "–"}
          sub={market ? <span>
              <span className="text-positive">{sig.bullish} bullish</span> · <span className="text-negative">{sig.bearish} bearish</span>
            </span> : undefined}
          basis="last 10 sessions"
          title={sig.kinds.map((k) => `${k.label} ${k.n}`).join(" · ") || undefined}
        />
      </div>
      {market && shown.length > 0 ? (
        <>
          <p className="eyebrow px-3.5 pb-1 pt-2">Live chart signals, most recent first</p>
          <ul>
            {shown.map((r) => (
              <li key={r.tk} className="flex h-7 items-center gap-2 px-3.5 text-[13px]">
                <TickerMark ticker={r.tk} size="xs" className="w-[76px] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12px]" title={r.signals.map((s) => `${s.label}: ${s.rule} (${fmtDate(s.date)})`).join("\n")}>
                  {r.signals.map((s, i) => (
                    <span key={`${s.kind}-${s.date}`}>
                      {i > 0 && <span className="text-muted-foreground"> · </span>}
                      <span className={BIAS_TONE[s.bias]}>{s.label}</span>
                    </span>
                  ))}
                </span>
                <span className="num shrink-0 text-[11px] text-muted-foreground">
                  {(() => {
                    const ago = Math.min(...r.signals.map((s) => s.ago ?? 99));
                    return ago === 0 ? "today" : ago === 99 ? "" : `${ago}d ago`;
                  })()}
                </span>
              </li>
            ))}
          </ul>
          {withSig.length > shown.length && (
            <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
              {withSig.length - shown.length} more {withSig.length - shown.length === 1 ? "company has" : "companies have"} a live signal: the Companies table's risk columns list every one.
            </p>
          )}
        </>
      ) : market ? (
        <QuietLine>No chart pattern triggered in the last ten sessions among the {risk.covered} members the markets file covers.</QuietLine>
      ) : null}
    </Section>
  );
}

/* ---------- performance and valuation ---------- */
const RET = ["1W", "1M", "3M", "6M", "YTD", "1Y"];

function Performance({ d, win, onWin }: { d: GroupFile; win: "6m" | "1y" | "2y"; onWin: (v: "6m" | "1y" | "2y") => void }) {
  const p = d.perf;
  const series = useMemo(() => {
    if (!p) return [];
    const n = win === "2y" ? p.dates.length : win === "6m" ? 126 : 252;
    const from = Math.max(0, p.dates.length - n);
    const reb = (arr: (number | null)[]) => {
      const base = arr.slice(from).find((v): v is number => v != null);
      return p.dates.slice(from).map((x, i) => ({ x, y: base && arr[from + i] != null ? (arr[from + i]! / base - 1) * 100 : null }));
    };
    return [
      { key: "cw", label: "Cap wt", color: "var(--chart-1)", points: reb(p.cw) },
      { key: "ew", label: "Equal wt", color: "var(--chart-3)", points: reb(p.ew) },
      { key: "spy", label: "SPY", color: "var(--muted-foreground)", points: reb(p.spy) },
    ];
  }, [p, win]);
  const R = d.returns;
  const lines = (
    [
      ["cw", "Cap-weighted"],
      ["ew", "Equal-weighted"],
      ["etf", d.etf ?? "ETF"],
      ["spy", "SPY"],
    ] as const
  ).filter(([k]) => R?.[k]);
  return (
    <Section
      id="performance"
      name="Performance"
      title="Performance"
      caption="The group's companies cap-weighted (Cap wt) and equal-weighted (Equal wt) against SPY · price return"
      actions={
        <Segmented
          size="xs"
          label="Performance window"
          value={win}
          onChange={onWin}
          options={[
            { v: "6m", l: "6M" },
            { v: "1y", l: "1Y" },
            { v: "2y", l: "2Y" },
          ]}
        />
      }
    >
      {p ? (
        <div className="px-3.5 py-2">
          <MultiLine
            series={series}
            label={`${d.name} performance`}
            format={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`}
            baseline={0}
            xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
            height={220}
          />
        </div>
      ) : (
        <QuietLine>No daily index for this group yet.</QuietLine>
      )}
      {lines.length > 0 && (
        <div className="max-sm:overflow-x-auto border-t">
          <table className="w-full min-w-[460px] text-[13px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground [&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
                <th className="pl-3.5 text-left">Return</th>
                {RET.map((k) => (
                  <th key={k} className="text-right">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map(([k, l]) => (
                <tr key={k} className={cn("[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 last:[&>td]:border-b-0", k === "spy" && "text-muted-foreground")}>
                  <td className="whitespace-nowrap pl-3.5">{l}</td>
                  {RET.map((w) => (
                    <td key={w} className={cn("num text-right", k !== "spy" && tone(R![k]![w]))}>
                      {pct(R![k]![w], { sign: true })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function RangeRow({ label, r, now, onClick }: { label: string; r: ValRange | null | undefined; now: number | null | undefined; onClick?: () => void }) {
  if (!r) return null;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - r.min) / (r.max - r.min || 1)) * 100));
  return (
    <button
      type="button"
      onClick={onClick}
      data-agent-click
      className="block w-full px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="num">
          <span className="font-medium">{mult(now)}</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground">{r.pct != null ? `${ordinal(Math.round(r.pct * 100))} percentile` : "–"}</span>
        </span>
      </span>
      <span className="relative mt-2 block h-1.5 rounded-full bg-secondary">
        <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-muted-foreground" style={{ left: `${pos(r.med)}%` }} />
        {now != null && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${pos(now)}%` }} />}
      </span>
      <span className="num mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>
          {mult(r.min)} {r.min_q ? qLabel(r.min_q) : ""}
        </span>
        <span>median {mult(r.med)}</span>
        <span>
          {mult(r.max)} {r.max_q ? qLabel(r.max_q) : ""}
        </span>
      </span>
    </button>
  );
}

function Valuation({ d, onPick }: { d: GroupFile; onPick: (m: string, q?: string) => void }) {
  const vn = d.val_now as Record<string, number | null> | undefined;
  const lq = d.quarters[d.quarters.length - 1];
  const any = d.val_range?.pe || d.val_range?.ps || d.val_range?.pfcf;
  return (
    <Section
      id="valuation"
      name="Valuation"
      title="Valuation against its own history"
      caption={`Today's aggregate multiple (${vn?.n ?? "–"} companies) within its 10-year quarterly range · click a row for the latest quarter's companies (quarter-end market caps)`}
    >
      {any ? (
        <div className="divide-y">
          <RangeRow label="P/E" r={d.val_range?.pe} now={vn?.pe} onClick={() => onPick("pe", lq)} />
          <RangeRow label="P/Sales" r={d.val_range?.ps} now={vn?.ps} onClick={() => onPick("ps", lq)} />
          <RangeRow label="P/FCF" r={d.val_range?.pfcf} now={vn?.pfcf} onClick={() => onPick("pfcf", lq)} />
        </div>
      ) : (
        <QuietLine>Not enough quarters of earnings to place today's multiples in a range.</QuietLine>
      )}
      <p className="border-t px-3.5 py-2 text-[11px] leading-4 text-muted-foreground">
        Company medians today: P/E {mult(vn?.pe_med)}, P/S {mult(vn?.ps_med)}, P/FCF {mult(vn?.pfcf_med)}. Aggregates above 150× (earnings near zero)
        are left out.
      </p>
    </Section>
  );
}

/* ---------- distribution on one metric ---------- */
function Distribution({ rows, dm, onDm, name }: { rows: Row[]; dm: string; onDm: (v: string) => void; name: string }) {
  const m = DIST.find((x) => x.k === dm) ?? DIST[0];
  const dist = useMemo(() => distribution(rows, m.get), [rows, m]);
  const rk = useMemo(() => ranks(rows.map(m.get)), [rows, m]);
  const rankOf = new Map(rows.map((r, i) => [r.tk, rk[i]]));
  const e = useMemo(() => ends(dist.points, (r) => r.tk), [dist]);
  const fmt = (v: number | null | undefined) => byUnit(v, m.unit);
  const list = (title: string, items: DistPoint<Row>[], tied = 0) => (
    <div className="min-w-0">
      <p className="eyebrow px-3.5 pb-1 pt-2">{title}</p>
      <ol>
        {items.map((p) => (
          <li key={p.item.tk} className="flex h-7 items-center gap-2 px-3.5 text-[13px]">
            <span className="num w-7 shrink-0 text-right text-[11px] text-muted-foreground">#{rankOf.get(p.item.tk)}</span>
            <TickerMark ticker={p.item.tk} name className="min-w-0 flex-1" />
            <span className={cn("num shrink-0", m.unit === "ret" && tone(p.v))}>{fmt(p.v)}</span>
          </li>
        ))}
      </ol>
      {tied > 0 && (
        <p className="px-3.5 pb-2 text-[11px] text-muted-foreground">
          {tied} more {tied === 1 ? "ties" : "tie"} with the last one shown
        </p>
      )}
    </div>
  );
  return (
    <Section
      id="distribution"
      name="Distribution"
      title="Where each company sits"
      caption={
        dist.n
          ? `${m.l} across ${dist.n} of ${rows.length} companies · median ${fmt(dist.median)}, middle half ${fmt(dist.q1)} to ${fmt(dist.q3)} · ranks count from the highest`
          : `No company in ${name} reports ${m.l.toLowerCase()}`
      }
      actions={<Segmented size="xs" label="Distribution metric" value={m.k} onChange={onDm} options={DIST.map((x) => ({ v: x.k, l: x.s }))} />}
    >
      {dist.n ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Strip dist={dist} fmt={fmt} />
          {e.all ? (
            <div className="border-t lg:col-span-2 lg:border-l lg:border-t-0">{list(`All ${e.all.length} ranked, highest first`, e.all)}</div>
          ) : (
            <>
              <div className="border-t lg:border-l lg:border-t-0">{list("Highest", e.top, e.topTied)}</div>
              <div className="border-t lg:border-l lg:border-t-0">{list("Lowest", e.bottom, e.bottomTied)}</div>
            </>
          )}
        </div>
      ) : (
        <QuietLine>Choose another metric.</QuietLine>
      )}
    </Section>
  );
}

/**
 * Dots placed in value order; each takes the offset from the middle line (0, then one dot up, one down,
 * two up, ...) nearest the middle at which it overlaps no dot already placed.
 */
function swarm(xs: readonly number[], r: number, maxOff: number): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length).fill(0);
  const placed: { x: number; y: number }[] = [];
  const d2 = (2 * r) ** 2;
  for (const { x, i } of order) {
    const near = placed.filter((p) => Math.abs(p.x - x) < 2 * r);
    let y = 0;
    for (let k = 0; ; k++) {
      const cand = k === 0 ? 0 : Math.ceil(k / 2) * 2 * r * (k % 2 ? -1 : 1);
      if (Math.abs(cand) > maxOff) {
        y = Math.max(-maxOff, Math.min(maxOff, cand));
        break;
      }
      if (!near.some((p) => (p.x - x) ** 2 + (p.y - cand) ** 2 < d2 - 0.01)) {
        y = cand;
        break;
      }
    }
    placed.push({ x, y });
    out[i] = y;
  }
  return out;
}

function Strip({ dist, fmt }: { dist: Dist<Row>; fmt: (v: number | null | undefined) => string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 124;
  const m = { l: 10, r: 10, t: 16, b: 24 };
  const x = (v: number) => m.l + ((Math.max(dist.lo, Math.min(dist.hi, v)) - dist.lo) / (dist.hi - dist.lo || 1)) * (W - m.l - m.r);
  const mid = m.t + (H - m.t - m.b) / 2;
  const placed = useMemo(() => {
    const xs = dist.points.map((p) => x(p.v));
    const ys = swarm(xs, 3, (H - m.t - m.b) / 2 - 3);
    return dist.points.map((p, i) => ({ p, px: xs[i], py: mid + ys[i] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dist, W]);
  const zero = dist.lo < 0 && dist.hi > 0 ? x(0) : null;
  return (
    <div ref={ref} className="min-w-0 px-3.5 py-2">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Median ${fmt(dist.median)}, middle half ${fmt(dist.q1)} to ${fmt(dist.q3)}`} className="overflow-visible">
          {dist.q1 != null && dist.q3 != null && (
            <rect x={x(dist.q1)} y={m.t} width={Math.max(1, x(dist.q3) - x(dist.q1))} height={H - m.t - m.b} fill="var(--secondary)" rx={3} />
          )}
          {zero != null && <line x1={zero} x2={zero} y1={m.t} y2={H - m.b} stroke="var(--rule)" />}
          {placed.map(({ p, px, py }) => (
            <circle key={p.item.tk} cx={px} cy={py} r={2.6} fill={p.clipped ? "var(--card)" : "var(--chart-1)"} stroke="var(--chart-1)" strokeWidth={1} opacity={0.85}>
              <title>{`${p.item.tk} ${p.item.name}: ${fmt(p.v)}${p.clipped ? " (beyond the plotted range)" : ""}`}</title>
            </circle>
          ))}
          {dist.median != null && (
            <>
              <line x1={x(dist.median)} x2={x(dist.median)} y1={m.t - 4} y2={H - m.b + 2} stroke="var(--foreground)" strokeWidth={1.5} />
              <text x={x(dist.median)} y={m.t - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--foreground)">
                median {fmt(dist.median)}
              </text>
            </>
          )}
          <text x={m.l} y={H - 8} fontSize={10} fill="var(--muted-foreground)">
            {fmt(dist.lo)}
            {dist.points.some((p) => p.clipped && p.v < dist.lo) ? " and below" : ""}
          </text>
          <text x={W - m.r} y={H - 8} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
            {fmt(dist.hi)}
            {dist.points.some((p) => p.clipped && p.v > dist.hi) ? " and above" : ""}
          </text>
        </svg>
      )}
      <p className="text-[11px] text-muted-foreground">Shaded band: middle half of the companies. Hollow dots lie beyond the range shown. Hover a dot for the company.</p>
    </div>
  );
}

/* ---------- constituents ---------- */
const SET_LABEL: Record<ColSet, string> = { fundamentals: "Fundamentals", risk: "Risk and signals" };
const COL_BY = new Map(COLS.map((c) => [c.k, c]));
/** Columns drawn by the table itself rather than from `COLS`. */
const SPECIAL: Record<string, { l: string; t: string }> = {
  a200: { l: "> 200d", t: "Above its 200-day average (daily member tape)" },
  nh: { l: "Near high", t: "Within 2% of its 52-week high (daily member tape)" },
  sig: { l: "Signals", t: "Chart patterns triggered in the last ten sessions (markets file)" },
};
/** Column groups: a rule on the left of the first column of each. */
const GROUP_START = new Set(["ret_1m", "rev_growth", "pe", "beta", "em"]);

function Flag({ v, yes, no }: { v: boolean | null; yes: string; no: string }) {
  if (v == null) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[12px]" title={v ? yes : no}>
      <span className={cn("size-1.5 rounded-full", v ? "bg-positive" : "bg-negative")} aria-hidden />
      {v ? "Yes" : "No"}
    </span>
  );
}

function Constituents({ d, rows, search, setSearch }: { d: GroupFile; rows: Row[]; search: GroupSearch; setSearch: (p: Partial<GroupSearch>) => void }) {
  const set: ColSet = search.cols ?? "fundamentals";
  const { sort, dir } = tableSort(set, search.sort, search.dir);
  const isSector = d.kind === "sector";
  const inds = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.industry, (m.get(r.industry) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const ind = isSector && search.ind && inds.some(([n]) => n === search.ind) ? search.ind : null;
  const shown = useMemo(() => sortRows(ind ? rows.filter((r) => r.industry === ind) : rows, sort, dir), [rows, ind, sort, dir]);
  const th = { sort, dir, onSort: (k: string, d2: "asc" | "desc") => setSearch({ sort: k === "mcap" && d2 === "desc" ? undefined : k, dir: k === "mcap" && d2 === "desc" ? undefined : d2 }) };
  const qs = new Set(rows.map((r) => r.q).filter(Boolean));
  // A whole sector adds the industry column; the weight column gives way so the table fits the page.
  const wide = isSector && !ind;
  const keys = (COL_SETS[set] as readonly string[]).filter((k) => !(wide && k === "w"));
  const minW = 210 + (wide ? 186 : 0) + keys.reduce((s, k) => s + (k === "sig" ? 220 : k === "nh" || k === "em" || k === "vol" ? 84 : 68), 0);
  const [wrap, fits] = useFits<HTMLDivElement>(minW);
  const noSignalFile = set === "risk" && !rows.some((r) => r.inMarket);
  return (
    <Section
      id="constituents"
      name="Constituents"
      title="Companies"
      caption={`${shown.length}${ind ? ` of ${rows.length}` : ""} companies · ${
        set === "fundamentals"
          ? `fundamentals for each company's latest quarter${qs.size === 1 ? ` (${qLabel([...qs][0]!)})` : ""}, prices from the latest close`
          : `beta to SPY over a year, 60-session volatility annualised, average earnings move and chart signals${noSignalFile ? " (the markets file did not load)" : ""}`
      } · click a column to sort`}
      actions={
        <Segmented
          size="xs"
          label="Company columns"
          value={set}
          onChange={(v) => setSearch({ cols: v === "fundamentals" ? undefined : (v as "risk"), sort: undefined, dir: undefined })}
          options={(Object.keys(COL_SETS) as ColSet[]).map((k) => ({ v: k, l: SET_LABEL[k] }))}
        />
      }
    >
      {isSector && inds.length > 1 && (
        <div role="group" aria-label="Industry filter" className="flex flex-wrap gap-1 border-b px-3.5 py-2">
          <FilterChip on={!ind} onClick={() => setSearch({ ind: undefined })} label="All" n={rows.length} />
          {inds.map(([n, c]) => (
            <FilterChip key={n} on={ind === n} onClick={() => setSearch({ ind: ind === n ? undefined : n })} label={n} n={c} />
          ))}
        </div>
      )}
      <div ref={wrap} className={cn(!fits && "overflow-x-auto scrollbar-thin")}>
        <table className="w-full border-separate border-spacing-0 text-[13px]" style={{ minWidth: minW }}>
          <thead className="text-[11px] text-muted-foreground">
            <tr className={cn("[&>th]:border-b [&>th]:bg-card", fits && STICKY_HEAD_NAV)}>
              <SortTh k="tk" label="Company" align="left" first="asc" className="sticky left-0 !z-20 pl-3.5" {...th} />
              {wide && <SortTh k="industry" label="Industry" align="left" first="asc" className="max-sm:hidden" {...th} />}
              {keys.map((k) => {
                const c = COL_BY.get(k);
                const sp = SPECIAL[k];
                return (
                  <SortTh
                    key={k}
                    k={k}
                    label={c?.l ?? sp.l}
                    title={c?.t ?? sp.t}
                    align={k === "sig" ? "left" : "right"}
                    first={k === "pe" ? "asc" : "desc"}
                    className={cn(GROUP_START.has(k) && "border-l")}
                    {...th}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.tk} className="group [&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 [&>td]:transition-colors [&>td]:duration-150 hover:[&>td]:bg-secondary">
                <td className="sticky left-0 z-[1] max-w-[220px] bg-card pl-3.5 max-sm:max-w-[150px]">
                  <TickerMark ticker={r.tk} name={r.name} className="max-w-full" />
                </td>
                {wide && (
                  <td className="max-w-[196px] truncate text-[12px] text-muted-foreground max-sm:hidden" title={r.industry}>
                    {r.industry}
                  </td>
                )}
                {keys.map((k) => {
                  const c = COL_BY.get(k);
                  const rule = GROUP_START.has(k) && "border-l";
                  if (c) {
                    const v = c.get(r);
                    return (
                      <td
                        key={k}
                        className={cn("num text-right", c.unit === "ret" && tone(v), rule, k === "w" && "text-muted-foreground")}
                        title={k === "em" && r.prints ? `${r.prints} releases measured` : undefined}
                      >
                        {c.unit === "ratio" ? ratio(v) : byUnit(v, c.unit)}
                      </td>
                    );
                  }
                  if (k === "a200")
                    return (
                      <td key={k} className={cn("text-right", rule)}>
                        <Flag v={r.a200} yes="Above its 200-day average" no="Below its 200-day average" />
                      </td>
                    );
                  if (k === "nh")
                    return (
                      <td key={k} className={cn("text-right", rule)}>
                        <Flag v={r.nearHigh} yes="Within 2% of its 52-week high" no="More than 2% below its 52-week high" />
                      </td>
                    );
                  return (
                    <td key={k} className={cn("max-w-[240px] truncate text-[12px]", rule)} title={r.signals.map((s) => `${s.label}: ${s.rule} (${fmtDate(s.date)})`).join("\n") || undefined}>
                      {!r.inMarket ? (
                        <span className="text-muted-foreground">–</span>
                      ) : r.signals.length ? (
                        r.signals.map((s, i) => (
                          <span key={`${s.kind}-${s.date}`}>
                            {i > 0 && <span className="text-muted-foreground"> · </span>}
                            <span className={BIAS_TONE[s.bias]}>{s.label}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function FilterChip({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-agent-click
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-foreground/30 bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {label}
      <span className="num text-[11px] text-muted-foreground">{n}</span>
    </button>
  );
}

/* ---------- macro, KPIs, insiders, filings, segments ---------- */
const corrBg = (v: number | null | undefined) => heat(v, 0.6);

function Macro({ d }: { d: GroupFile }) {
  const rows = (d.macro ?? []).filter((m) => m.d || m.m).sort((a, b) => Math.abs(b.m?.corr ?? b.d?.corr ?? 0) - Math.abs(a.m?.corr ?? a.d?.corr ?? 0));
  if (!rows.length)
    return (
      <Section name="Macro sensitivity" title="Macro sensitivity">
        <QuietLine>No macro series with enough shared history for this group.</QuietLine>
      </Section>
    );
  const fac = new Map((d.factors ?? []).map((f) => [f.id, f]));
  const c = (v: number | undefined | null) => (v == null ? "–" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`);
  return (
    <Section name="Macro sensitivity" title="Macro sensitivity" caption="Correlation of the group's cap-weighted return with changes in each series; below about 0.2 either way is weak">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground [&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
            <th className="pl-3.5 text-left">Series</th>
            <th className="w-[84px] text-right">Daily, 1Y</th>
            <th className="w-[96px] text-right">Monthly, 10Y</th>
            <th className="w-[130px] text-right max-sm:hidden">Latest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const f = fac.get(m.id);
            return (
              <tr key={m.id} className="[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 last:[&>td]:border-b-0">
                <td className="max-w-0 truncate pl-3.5">
                  {f?.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={f.source}>
                      {m.name}
                    </a>
                  ) : (
                    m.name
                  )}
                </td>
                <td className="num text-right" style={corrBg(m.d?.corr)} title={m.d ? `${m.d.n} days, ${m.d.from} to ${m.d.to}` : undefined}>
                  {c(m.d?.corr)}
                </td>
                <td className="num text-right" style={corrBg(m.m?.corr)} title={m.m ? `${m.m.n} months` : undefined}>
                  {c(m.m?.corr)}
                </td>
                <td className="num text-right text-[12px] text-muted-foreground max-sm:hidden">{f?.latest ? `${f.latest[1]} · ${fmtDate(f.latest[0], { month: "short", day: "numeric" })}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">Rate and spread series use changes in basis points, the others percentage changes. Correlation is not causation.</p>
    </Section>
  );
}

function Drivers({ sector }: { sector: string }) {
  const summaries = useQuery(macroSummariesQuery);
  const list = useMemo(() => driversOf(MACRO_TILES, sector), [sector]);
  if (!list.length)
    return (
      <Section name="Macro drivers" title="Official drivers">
        <QuietLine>No official series in the macro store is tagged as a driver of {sector}.</QuietLine>
      </Section>
    );
  return (
    <Section name="Macro drivers" title="Official drivers" caption={`${list.length} official ${list.length === 1 ? "series" : "series"} tagged as leading ${sector} revenue or costs · open one in Macro`}>
      {summaries.isError ? (
        <QuietLine>The macro series did not load right now.</QuietLine>
      ) : !summaries.data ? (
        <Skeleton className="m-3.5 h-32" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              <col />
              <col className="w-[84px]" />
              <col className="w-[136px]" />
              <col className="w-[92px] max-sm:hidden" />
            </colgroup>
            <thead className="text-[11px] text-muted-foreground">
              <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th]:font-medium">
                <th className="pl-3.5 text-left">Series</th>
                <th className="text-right">Latest</th>
                <th className="text-right">Change</th>
                <th className="max-sm:hidden">
                  <span className="sr-only">Trend</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <DriverRow key={x.id} d={x} r={summaries.data.get(x.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Kpis({ d }: { d: GroupFile }) {
  const k = d.kpis ?? [];
  if (!k.length)
    return (
      <Section name="Industry KPIs" title="Industry KPIs">
        <QuietLine>No industry-specific KPIs are tracked for this group yet.</QuietLine>
      </Section>
    );
  return (
    <Section name="Industry KPIs" title="Industry KPIs" caption="From each company's filings or releases; median or sum as stated">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground [&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
            <th className="pl-3.5 text-left">KPI</th>
            <th className="w-[110px] text-right">Latest</th>
            <th className="w-[80px] text-right">Year ago</th>
            <th className="w-[80px] text-right">Companies</th>
          </tr>
        </thead>
        <tbody>
          {k.map((x) => {
            let i = x.agg.length - 1;
            while (i >= 0 && x.agg[i] == null) i--;
            const u = x.unit === "%" ? "%" : x.unit === "days" ? "days" : x.unit === "USD" ? "usd" : x.unit;
            return (
              <tr key={x.id} className="[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 last:[&>td]:border-b-0" title={x.definition}>
                <td className="max-w-0 truncate pl-3.5">
                  {x.name} <span className="text-[11px] text-muted-foreground">{x.how}{x.industry ? ` · ${x.industry}` : ""}</span>
                </td>
                <td className="num text-right">
                  {i >= 0 ? fmtMetric(x.agg[i], u) : "–"} <span className="text-[11px] text-muted-foreground">{i >= 0 ? qLabel(x.quarters[i]) : ""}</span>
                </td>
                <td className="num text-right text-muted-foreground">{i >= 4 ? fmtMetric(x.agg[i - 4], u) : "–"}</td>
                <td className="num text-right">{i >= 0 && x.n ? x.n[i] : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function Insiders({ d }: { d: GroupFile }) {
  const I = d.insiders;
  if (!I)
    return (
      <Section name="Insider activity" title="Insider activity">
        <QuietLine>No open-market insider trades recorded for this group.</QuietLine>
      </Section>
    );
  const cos = I.companies.filter((c) => c.buy || c.sell).slice(0, 10);
  return (
    <Section name="Insider activity" title="Insider activity" caption={`Open-market Form 4 trades since ${fmtDate(I.since)}`}>
      <div className="grid grid-cols-2 border-b">
        <div className="border-r px-3.5 py-2">
          <p className="text-[11px] text-muted-foreground">Bought</p>
          <p className="num text-[18px] font-semibold leading-6">{usd(I.buy)}</p>
          <p className="text-[11px] text-muted-foreground">{I.n_buy} trades</p>
        </div>
        <div className="px-3.5 py-2">
          <p className="text-[11px] text-muted-foreground">Sold</p>
          <p className="num text-[18px] font-semibold leading-6">{usd(I.sell)}</p>
          <p className="text-[11px] text-muted-foreground">{I.n_sell} trades</p>
        </div>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground [&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
            <th className="pl-3.5 text-left">Company</th>
            <th className="w-[80px] text-right">Insiders</th>
            <th className="w-[90px] text-right">Bought</th>
            <th className="w-[90px] text-right">Sold</th>
          </tr>
        </thead>
        <tbody>
          {cos.map((c) => (
            <tr key={c.tk} className="[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 last:[&>td]:border-b-0">
              <td className="max-w-0 pl-3.5">
                <TickerMark ticker={c.tk} name />
              </td>
              <td className="num text-right text-muted-foreground">{c.owners}</td>
              <td className="num text-right">{c.buy ? usd(c.buy) : "–"}</td>
              <td className="num text-right">{c.sell ? usd(c.sell) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Filings({ d }: { d: GroupFile }) {
  const f = (d.filings ?? []).filter((x) => x.form !== "144" && x.form !== "4").slice(0, 12);
  if (!f.length)
    return (
      <Section name="Recent filings" title="Recent filings">
        <QuietLine>No annual, quarterly or current reports in the last 30 days.</QuietLine>
      </Section>
    );
  return (
    <Section name="Recent filings" title="Recent filings" caption="Annual, quarterly and current reports from the group's companies">
      <ul>
        {f.map((x) => (
          <li key={x.accession} className="flex h-7 items-center gap-2 border-b px-3.5 text-[13px] last:border-b-0">
            <span className="num w-12 shrink-0 text-[12px] text-muted-foreground">{fmtDate(x.filed, { month: "short", day: "numeric" })}</span>
            <TickerMark ticker={x.ticker} className="w-[76px] shrink-0" />
            <span className="w-11 shrink-0 rounded border px-1 text-center text-[11px] leading-4">{x.form}</span>
            <a
              href={x.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate rounded-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {x.description || x.items}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Segments({ d }: { d: GroupFile }) {
  const s = (d.segments?.inside ?? []).slice(0, 12);
  if (!s.length) return null;
  return (
    <Section id="segments" name="Segment exposure" title="Exposure from other groups" caption="Reported business segments of companies classified elsewhere whose revenue belongs here">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground [&>th]:h-8 [&>th]:border-b [&>th]:px-2 [&>th:first-child]:pl-3.5 [&>th]:font-medium">
            <th className="pl-3.5 text-left">Company and segment</th>
            <th className="text-left max-sm:hidden">Counted in</th>
            <th className="w-[110px] text-right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {s.map((x) => (
            <tr key={`${x.tk}-${x.member}`} className="[&>td]:h-7 [&>td]:border-b [&>td]:px-2 [&>td:first-child]:pl-3.5 last:[&>td]:border-b-0">
              <td className="max-w-0 pl-3.5">
                <TickerMark ticker={x.tk}>
                  <span className="truncate text-muted-foreground">{x.label}</span>
                </TickerMark>
              </td>
              <td className="max-w-0 truncate text-[12px] text-muted-foreground max-sm:hidden">{x.industry}</td>
              <td className="num text-right">
                {usd(x.v)} <span className="text-[11px] text-muted-foreground">{x.fy}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
