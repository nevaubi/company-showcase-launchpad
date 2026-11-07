import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { FirmLogo } from "@/components/estimates/firm-logo";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import type { Estimates as LiveEstimates } from "@/lib/estimates/core";
import { startOf } from "@/lib/statements/filed";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ACTION_LABEL,
  BZ,
  PERIOD_NAME,
  actionKindOf,
  ago,
  basisLabel,
  cleanQuote,
  fCnt,
  fEps,
  fPct,
  fPctS,
  fPx,
  fUnit,
  fUsd,
  rangeText,
  secDoc,
  tone,
  type Action,
  type ActionKind,
  type ConsensusPeriod,
  type GuidanceItem,
  type GuidanceVsConsensus,
  type PeriodCode,
  type StreetBundle,
  type Surprise,
} from "@/lib/estimates/street";

/* ---------- source openers ---------- */
type Open = (t: SourceTarget) => void;

function useOpeners(ticker: string, d: StreetBundle) {
  const { open } = useSource();
  const yahooUrl = d.consensus?.url ?? `https://finance.yahoo.com/quote/${ticker}/analysis/`;
  const yahooDate = d.consensus?.as_of ?? d.sources?.yahoo?.retrieved_at;
  return useMemo(() => {
    const yahoo = (
      label: string,
      periodLabel: string,
      value: number | null | undefined,
      unit: string,
      quote: string,
    ) =>
      open({
        ticker,
        label,
        periodLabel,
        unit,
        value: value ?? 0,
        external: {
          url: yahooUrl,
          quote,
          date: yahooDate?.slice(0, 10),
          confidence:
            "Yahoo Finance consensus, compiled from sell-side analysts. Not from company filings; basis is the provider's (EPS generally adjusted).",
        },
      });
    const period = (
      p: ConsensusPeriod,
      metric: "eps" | "revenue",
      field: "avg" | "low" | "high" | "n" | "year_ago",
    ) => {
      const r = p[metric];
      const f = metric === "eps" ? fEps : fUsd;
      const name = metric === "eps" ? "EPS" : "revenue";
      yahoo(
        `${p.label} ${name} consensus`,
        `period ending ${fmtDate(p.end)}`,
        field === "n" ? r.n : r[field],
        field === "n" ? "count" : metric === "eps" ? "usdPerShare" : "usd",
        `${p.label} (fiscal period ending ${p.end}) ${name}: average ${f(r.avg)}, low ${f(r.low)}, high ${f(r.high)}, ${fCnt(r.n)} analysts; year-ago ${f(r.year_ago)}.${p.end_fixed ? ` Period end corrected by Filed Under: ${p.end_fixed}.` : ""}`,
      );
    };
    const action = (a: Action) =>
      open({
        ticker,
        label: `${a.firm}${a.analyst ? ` · ${a.analyst}` : ""}`,
        periodLabel: fmtDate(a.date),
        unit: "usd",
        value: a.pt_current ?? 0,
        external: {
          url: a.url ?? `https://www.benzinga.com/quote/${ticker}/analyst-ratings`,
          date: a.date,
          quote: `${a.date}${a.time ? ` ${a.time} ET` : ""}: ${a.firm}${a.analyst ? ` (${a.analyst})` : ""} ${a.action.toLowerCase()} ${a.rating_prior && a.rating_prior !== a.rating_current ? `${a.rating_prior} → ` : ""}${a.rating_current ?? ""}${a.pt_current != null ? `; price target ${a.pt_prior != null && a.pt_prior !== a.pt_current ? `${fPx(a.pt_prior)} → ` : ""}${fPx(a.pt_current)}${a.action_pt ? ` (${a.action_pt.toLowerCase()})` : ""}` : ""}.${a.adj_pt_current != null && a.adj_pt_current !== a.pt_current ? ` Split-adjusted target ${fPx(a.adj_pt_current)}.` : ""}`,
          confidence: `${BZ}. Benzinga analyst ratings record ${a.id}.`,
        },
      });
    const sec = (
      label: string,
      fact: { v: number; end: string; accn: string },
      concept: string,
      unit: string,
    ) =>
      open({
        ticker,
        label,
        periodLabel: `quarter ending ${fmtDate(fact.end)}`,
        unit,
        value: fact.v,
        src: {
          accn: fact.accn,
          concept,
          start: startOf(fact.end, 1),
          end: fact.end,
          value: fact.v,
        },
      });
    const guide = (g: {
      label: string;
      period: string;
      low: number | null;
      high: number | null;
      unit: string;
      quote?: string;
      doc?: string;
      issued: string;
    }) => {
      const doc = g.doc ? d.guidance?.docs?.[g.doc] : undefined;
      const s = secDoc(doc?.url);
      const quote = cleanQuote(g.quote);
      const base = {
        ticker,
        label: `${g.label} guidance`,
        periodLabel: g.period,
        unit: g.unit === "USD_per_share" ? "usdPerShare" : g.unit === "USD" ? "usd" : g.unit,
        value: g.low ?? g.high ?? 0,
      };
      if (s)
        return open({
          ...base,
          doc: { accn: s.accn, doc: s.doc, title: doc?.title, search: quote.slice(0, 160) },
        });
      open({
        ...base,
        external: {
          url: doc?.url ?? "",
          quote,
          date: g.issued,
          confidence: `Quoted from ${doc?.title ?? "the company's release"}; extracted by Filed Under.`,
        },
      });
    };
    return { yahoo, period, action, sec, guide };
  }, [open, ticker, d, yahooUrl, yahooDate]);
}

/* ---------- layout bits ---------- */
function Chip({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded border px-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
function V({
  children,
  onClick,
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  if (!onClick) return <span className={cn("num tabular-nums", className)}>{children}</span>;
  return (
    <button
      type="button"
      title={title ?? "Open source"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "num rounded-sm tabular-nums decoration-dotted underline-offset-2 hover:bg-highlight-soft hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="border-t px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const th = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

/* ---------- headline strip ---------- */
function Headline({
  ticker,
  d,
  o,
}: {
  ticker: string;
  d: StreetBundle;
  o: ReturnType<typeof useOpeners>;
}) {
  const P = d.consensus?.periods ?? [];
  const q0 = P.find((p) => p.code === "0q");
  const T = d.targets?.stats;
  const R = d.ratings?.counts ?? {};
  const s90 = d.summary?.d90;
  const ne = d.consensus?.next_earnings;
  const sur = (d.surprises ?? []).filter((r) => r.beat != null);
  const beats = sur.filter((r) => (r.beat ?? 0) > 0).length;
  const r30 = d.revisions?.["0y"]?.["30"];
  const rated = (R.buy ?? 0) + (R.hold ?? 0) + (R.sell ?? 0);
  const cells: { l: string; v: string; sub: string; on?: () => void; t?: string }[] = [
    {
      l: "Ratings",
      v: rated ? `${R.buy ?? 0}·${R.hold ?? 0}·${R.sell ?? 0}` : "–",
      sub: "buy · hold · sell (firms)",
      on: rated
        ? () =>
            document
              .getElementById("st-targets")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
        : undefined,
    },
    {
      l: "Mean target",
      v: fPx(T?.mean),
      sub: T ? `${fPctS(T.upside_mean)} vs ${fPx(d.price?.close)}` : "no targets",
      t: tone(T?.upside_mean),
      on: T
        ? () =>
            document
              .getElementById("st-targets")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
        : undefined,
    },
    {
      l: "Next report",
      v: ne ? fmtDate(ne.date) : "–",
      sub: ne ? (ne.is_estimate ? "date estimated by provider" : "date confirmed by provider") : "",
      on: ne
        ? () =>
            o.yahoo(
              "Next earnings date",
              fmtDate(ne.date),
              0,
              "count",
              `Next earnings ${ne.date}${ne.is_estimate ? " (estimated)" : " (confirmed)"}; consensus EPS ${fEps(ne.eps?.avg)}, revenue ${fUsd(ne.revenue?.avg)}.`,
            )
        : undefined,
    },
    {
      l: "Qtr EPS consensus",
      v: fEps(q0?.eps.avg),
      sub: q0
        ? `${fCnt(q0.eps.n)} analysts · qtr ending ${fmtDate(q0.end, { month: "short", year: "numeric" })}`
        : "",
      on: q0 ? () => o.period(q0, "eps", "avg") : undefined,
    },
    {
      l: "FY EPS, 30d revision",
      v: r30 ? fPctS(r30.eps_pct) : "–",
      sub: r30
        ? `from ${fEps(r30.eps_from)} on ${fmtDate(r30.from_date)}`
        : `history from ${d.snapshots?.[0] ? fmtDate(d.snapshots[0].as_of) : "–"}`,
      t: tone(r30?.eps_pct),
    },
    {
      l: "Last 90 days",
      v: `${s90?.upgrades ?? 0}↑ ${s90?.downgrades ?? 0}↓`,
      sub: `${s90?.target_raises ?? 0} target raises · ${s90?.target_cuts ?? 0} cuts`,
      on: () =>
        document
          .getElementById("st-actions")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      l: "EPS beat rate",
      v: sur.length ? `${beats}/${sur.length}` : "–",
      sub: sur.length ? "recent quarters, provider basis" : "",
    },
  ];
  return (
    <section
      aria-label={`${ticker} street summary`}
      className="grid grid-cols-2 border-y bg-card/40 sm:grid-cols-4 xl:grid-cols-7"
    >
      {cells.map((c) => (
        <div
          key={c.l}
          className="min-w-0 border-b border-r px-3.5 py-2.5 last:border-r-0 xl:border-b-0"
        >
          <p className="text-[11px] text-muted-foreground">{c.l}</p>
          {c.on ? (
            <V onClick={c.on} className={cn("mt-0.5 block text-lg font-medium", c.t)}>
              {c.v}
            </V>
          ) : (
            <p className={cn("num mt-0.5 text-lg font-medium tabular-nums", c.t)}>{c.v}</p>
          )}
          <p className="truncate text-[11px] text-muted-foreground" title={c.sub}>
            {c.sub || " "}
          </p>
        </div>
      ))}
    </section>
  );
}

/* ---------- consensus ---------- */
function RangeCell({
  r,
  f,
  onPick,
}: {
  r: ConsensusPeriod["eps"];
  f: (v: number | null) => string;
  onPick: (k: "avg" | "low" | "high" | "n") => void;
}) {
  const pos =
    r.avg != null && r.low != null && r.high != null && r.high > r.low
      ? Math.min(1, Math.max(0, (r.avg - r.low) / (r.high - r.low)))
      : null;
  return (
    <div className="min-w-[10rem]">
      <div className="flex items-baseline justify-between gap-2">
        <V onClick={() => onPick("avg")} className="font-medium">
          {f(r.avg)}
        </V>
        <V onClick={() => onPick("n")} className="text-[11px] text-muted-foreground">
          {fCnt(r.n)} est.
        </V>
      </div>
      <div className="relative mt-1 h-1 rounded-full bg-secondary">
        {pos != null && (
          <span
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${pos * 100}%` }}
          />
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <V onClick={() => onPick("low")}>{f(r.low)}</V>
        <V onClick={() => onPick("high")}>{f(r.high)}</V>
      </div>
    </div>
  );
}

function Consensus({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const P = d.consensus?.periods ?? [];
  if (!P.length)
    return (
      <Panel title="Consensus estimates">
        <p className="p-4 text-sm text-muted-foreground">
          No consensus estimates from the provider for this company.
        </p>
      </Panel>
    );
  const growth = (now: number | null, ya: number | null) =>
    now != null && ya ? (now - ya) / Math.abs(ya) : null;
  return (
    <Panel
      title="Consensus estimates"
      subtitle={`Yahoo Finance · as of ${fmtDate(d.consensus!.as_of.slice(0, 10))}`}
      collapse={false}
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="text-left">
            <tr className="border-b">
              <th className={th}>Period</th>
              <th className={th}>EPS · low – high</th>
              <th className={cn(th, "text-right")}>Year ago</th>
              <th className={cn(th, "text-right")}>Growth</th>
              <th className={th}>Revenue · low – high</th>
              <th className={cn(th, "text-right")}>Year ago</th>
              <th className={cn(th, "text-right")}>Growth</th>
            </tr>
          </thead>
          <tbody>
            {P.map((p) => {
              const ge = growth(p.eps.avg, p.eps.year_ago),
                gr = growth(p.revenue.avg, p.revenue.year_ago);
              return (
                <tr key={p.code} className="border-b align-top last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{p.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      ends {fmtDate(p.end)}
                      {p.end_fixed && (
                        <span title={`${p.end_fixed}; provider listed ${p.end_provider}`}> †</span>
                      )}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <RangeCell r={p.eps} f={fEps} onPick={(k) => o.period(p, "eps", k)} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <V onClick={() => o.period(p, "eps", "year_ago")}>{fEps(p.eps.year_ago)}</V>
                  </td>
                  <td className={cn("num px-3 py-2.5 text-right tabular-nums", tone(ge))}>
                    {fPctS(ge)}
                  </td>
                  <td className="px-3 py-2.5">
                    <RangeCell r={p.revenue} f={fUsd} onPick={(k) => o.period(p, "revenue", k)} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <V onClick={() => o.period(p, "revenue", "year_ago")}>
                      {fUsd(p.revenue.year_ago)}
                    </V>
                  </td>
                  <td className={cn("num px-3 py-2.5 text-right tabular-nums", tone(gr))}>
                    {fPctS(gr)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note>
        Average, low and high analyst forecasts compiled by Yahoo Finance; third-party, not from
        filings. Growth is against the provider's year-ago figure.
        {P.some((p) => p.end_fixed) &&
          " † Period end corrected: the provider repeated an already reported or earlier period end."}{" "}
        Click any value for its record.
      </Note>
    </Panel>
  );
}

/* ---------- street view (AI summary over the stored records) ---------- */
function StreetView({
  ticker,
  d,
  o,
}: {
  ticker: string;
  d: StreetBundle;
  o: ReturnType<typeof useOpeners>;
}) {
  const S = d.street_view;
  const openRef = (r: string) => {
    if (r.startsWith("A:")) {
      const a = d.actions?.find((x) => `A:${x.id}` === r);
      if (a) o.action(a);
      return;
    }
    if (r.startsWith("C:")) {
      const p = d.consensus?.periods.find((x) => x.code === r.slice(2));
      if (p) o.period(p, "eps", "avg");
      return;
    }
    if (r.startsWith("S:")) {
      const s = d.surprises?.find((x) => x.quarter_end === r.slice(2));
      if (s)
        o.yahoo("EPS surprise", fmtDate(s.quarter_end), s.surprise_pct, "pct", surpriseQuote(s));
      return;
    }
    if (r.startsWith("G:")) {
      const g = d.guidance?.vs_consensus?.find((x) => `G:${x.guide_id}` === r);
      if (g) o.guide(gvcItem(g));
      return;
    }
    document
      .getElementById(r === "T" || r === "D" ? "st-targets" : "st-actions")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const refLabel = (r: string) =>
    r.startsWith("A:")
      ? (d.actions?.find((a) => `A:${a.id}` === r)?.firm ?? "action")
      : r
          .replace(/^C:/, "consensus ")
          .replace(/^R:.*/, "revision")
          .replace(/^S:/, "surprise ")
          .replace(/^G:.*/, "guidance")
          .replace(/^T$/, "targets")
          .replace(/^D$/, "ratings");
  return (
    <Panel
      title="Street view"
      subtitle={
        S
          ? `AI-generated from the records on this page · ${fmtDate(S.generated_at.slice(0, 10))} · ${S.model}`
          : "AI-generated summary"
      }
      collapse={false}
    >
      {!S ? (
        <p className="p-4 text-sm text-muted-foreground">
          The nightly estimates job writes this summary from the stored records on this page. It has
          not run for {ticker} yet.
        </p>
      ) : (
        <div className="space-y-2 px-3.5 py-3 text-[13px] leading-relaxed">
          {S.headline && (
            <p className="font-medium">
              {S.headline}
              <span
                className="font-normal text-muted-foreground"
                title="The headline is not checked against the records"
              >
                {" "}
                (unverified summary)
              </span>
            </p>
          )}
          <ul className="list-disc space-y-1.5 pl-4">
            {S.points.map((p, i) => (
              <li key={i}>
                {p.text}{" "}
                {p.refs.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => openRef(r)}
                    className="mr-1 rounded border px-1 text-[11px] text-link hover:bg-highlight-soft"
                  >
                    {refLabel(r)}
                  </button>
                ))}
                {p.verified === false && (
                  <Chip
                    className="border-highlight text-foreground"
                    title={`Numbers not found in the cited records: ${(p.unsupported_numbers ?? []).join(", ")}`}
                  >
                    unverified
                  </Chip>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Note>Generated only from the stored records each point cites. Not investment advice.</Note>
    </Panel>
  );
}

/* ---------- revisions ---------- */
const CODES: PeriodCode[] = ["0q", "+1q", "0y", "+1y"];
const SERIES_COLOR = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

function RevisionChart({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const snaps = d.snapshots ?? [];
  const series = CODES.map((c, i) => ({
    c,
    color: SERIES_COLOR[i],
    pts: snaps
      .filter((s) => s.p[c]?.eps != null)
      .map((s) => ({ t: Date.parse(s.as_of), v: s.p[c]!.eps!, s })),
  })).filter((s) => s.pts.length > 1);
  const all = series.flatMap((s) => s.pts);
  const H = 180,
    m = { t: 10, r: 12, b: 22, l: 48 };
  if (!all.length) return null;
  const t0 = Math.min(...all.map((p) => p.t)),
    t1 = Math.max(...all.map((p) => p.t));
  const v0 = Math.min(...all.map((p) => p.v)),
    v1 = Math.max(...all.map((p) => p.v));
  const pad = (v1 - v0) * 0.08 || Math.abs(v1) * 0.05 || 1;
  const x = (t: number) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - ((v - (v0 - pad)) / (v1 - v0 + 2 * pad)) * (H - m.t - m.b);
  const ticks = [v0 - pad, (v0 + v1) / 2, v1 + pad];
  return (
    <div ref={ref} className="px-3.5 pt-3">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Consensus EPS by snapshot date">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text
                x={m.l - 6}
                y={y(v) + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {fEps(v)}
              </text>
            </g>
          ))}
          <text x={m.l} y={H - 6} fontSize={10} fill="var(--muted-foreground)">
            {fmtDate(new Date(t0).toISOString().slice(0, 10))}
          </text>
          <text x={W - m.r} y={H - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
            {fmtDate(new Date(t1).toISOString().slice(0, 10))}
          </text>
          {series.map((s) => (
            <g key={s.c}>
              <path
                d={s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.v)}`).join("")}
                fill="none"
                stroke={s.color}
                strokeWidth={1.6}
              />
              {s.pts.map((p) => (
                <circle
                  key={p.t}
                  cx={x(p.t)}
                  cy={y(p.v)}
                  r={3}
                  fill={s.color}
                  className="cursor-pointer"
                  onClick={() =>
                    o.yahoo(
                      `${PERIOD_NAME[s.c]} EPS consensus`,
                      `snapshot ${fmtDate(p.s.as_of)}`,
                      p.v,
                      "usdPerShare",
                      `Snapshot ${p.s.as_of}: ${PERIOD_NAME[s.c]} (period ending ${p.s.p[s.c]!.end}) consensus EPS ${fEps(p.v)} from ${fCnt(p.s.p[s.c]!.eps_n)} analysts, range ${fEps(p.s.p[s.c]!.eps_lo)} – ${fEps(p.s.p[s.c]!.eps_hi)}. Stored by Filed Under from Yahoo Finance.`,
                    )
                  }
                >
                  <title>{`${PERIOD_NAME[s.c]} · ${p.s.as_of}: ${fEps(p.v)}`}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      )}
      <div className="flex flex-wrap gap-3 pb-1 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.c} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3" style={{ background: s.color }} />
            {PERIOD_NAME[s.c]}
          </span>
        ))}
      </div>
    </div>
  );
}

function Revisions({
  ticker,
  d,
  o,
  live,
}: {
  ticker: string;
  d: StreetBundle;
  o: ReturnType<typeof useOpeners>;
  live?: LiveEstimates | null;
}) {
  const R = d.revisions ?? {};
  const P = d.consensus?.periods ?? [];
  const snaps = d.snapshots ?? [];
  const ours = snaps.length >= 2 && CODES.some((c) => Object.values(R[c] ?? {}).some(Boolean));
  const W = ["7", "30", "60", "90"] as const;
  return (
    <Panel
      title="Estimate revisions"
      subtitle={ours ? `${snaps.length} stored daily snapshots` : "Yahoo Finance EPS trend"}
      collapse={false}
    >
      {snaps.length >= 2 && <RevisionChart d={d} o={o} />}
      <div className="overflow-x-auto scrollbar-thin">
        {ours || !live?.periods.length ? (
          <table className="w-full min-w-[460px] text-[13px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Period</th>
                <th className={cn(th, "text-right")}>EPS now</th>
                {W.map((w) => (
                  <th key={w} className={cn(th, "text-right")}>
                    {w}d
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {P.map((p) => (
                <tr key={p.code} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2">{PERIOD_NAME[p.code]}</td>
                  <td className="px-3 py-2 text-right">
                    <V onClick={() => o.period(p, "eps", "avg")}>{fEps(p.eps.avg)}</V>
                  </td>
                  {W.map((w) => {
                    const r = R[p.code]?.[w];
                    return (
                      <td key={w} className="px-3 py-2 text-right">
                        {r ? (
                          <V
                            className={tone(r.eps_pct)}
                            onClick={() =>
                              o.yahoo(
                                `${PERIOD_NAME[p.code]} consensus revision`,
                                `${w} days`,
                                r.eps_pct,
                                "pct",
                                `Consensus EPS ${fEps(r.eps_from)} in our snapshot of ${r.from_date}, ${fEps(r.eps_to)} in the latest snapshot: ${fPctS(r.eps_pct)}. Revenue ${fUsd(r.rev_from)} → ${fUsd(r.rev_to)} (${fPctS(r.rev_pct)}).`,
                              )
                            }
                          >
                            {fPctS(r.eps_pct)}
                          </V>
                        ) : (
                          <span className="text-muted-foreground/60">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Period</th>
                {(["d90", "d60", "d30", "d7", "current"] as const).map((k) => (
                  <th key={k} className={cn(th, "text-right")}>
                    {k === "current" ? "Now" : `${k.slice(1)}d ago`}
                  </th>
                ))}
                <th className={cn(th, "text-right")}>90d</th>
                <th className={cn(th, "text-right")}>Up / down 30d</th>
              </tr>
            </thead>
            <tbody>
              {live.periods.map((p) => {
                const ch =
                  p.trend.current != null && p.trend.d90 ? p.trend.current / p.trend.d90 - 1 : null;
                const quote = `Yahoo Finance EPS trend for ${PERIOD_NAME[p.code as PeriodCode] ?? p.code}: now ${fEps(p.trend.current)}, 7 days ago ${fEps(p.trend.d7)}, 30 days ${fEps(p.trend.d30)}, 60 days ${fEps(p.trend.d60)}, 90 days ${fEps(p.trend.d90)}; ${p.revisions.up30 ?? 0} up and ${p.revisions.down30 ?? 0} down revisions in 30 days.`;
                return (
                  <tr key={p.code} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">
                      {PERIOD_NAME[p.code as PeriodCode] ?? p.code}
                    </td>
                    {(["d90", "d60", "d30", "d7", "current"] as const).map((k) => (
                      <td key={k} className="px-3 py-2 text-right">
                        <V
                          className={k === "current" ? "font-medium" : ""}
                          onClick={() =>
                            o.yahoo(
                              `${PERIOD_NAME[p.code as PeriodCode] ?? p.code} EPS trend`,
                              k === "current" ? "now" : `${k.slice(1)} days ago`,
                              p.trend[k],
                              "usdPerShare",
                              quote,
                            )
                          }
                        >
                          {fEps(p.trend[k])}
                        </V>
                      </td>
                    ))}
                    <td className={cn("num px-3 py-2 text-right tabular-nums", tone(ch))}>
                      {fPctS(ch)}
                    </td>
                    <td className="num px-3 py-2 text-right tabular-nums">
                      <span className="text-positive">{p.revisions.up30 ?? 0}</span> /{" "}
                      <span className="text-negative">{p.revisions.down30 ?? 0}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Note>
        {ours
          ? "Revisions compare the latest consensus with our own stored snapshot of the same fiscal period 7, 30, 60 and 90 days earlier."
          : `Our own snapshot history for ${ticker} starts ${snaps[0] ? fmtDate(snaps[0].as_of) : "with the next refresh"}; until 7 days have accumulated, the table shows Yahoo Finance's EPS trend, fetched live.`}
      </Note>
    </Panel>
  );
}

/* ---------- surprises ---------- */
function surpriseQuote(s: Surprise) {
  return `Quarter ending ${s.quarter_end}: reported EPS ${fEps(s.eps_actual)} against consensus ${fEps(s.eps_estimate)}, surprise ${fPctS(s.surprise_pct)} (Yahoo Finance basis, generally adjusted).${s.gaap_eps ? ` SEC diluted EPS ${fEps(s.gaap_eps.v)} (${s.gaap_eps.form} filed ${s.gaap_eps.filed}).` : ""}${s.reaction ? ` Next session after the earnings 8-K: ${fPctS(s.reaction.r1)} vs SPY ${fPctS(s.reaction.spy1)} on ${s.reaction.date}.` : ""}`;
}

function SurpriseBars({ rows, onPick }: { rows: Surprise[]; onPick: (s: Surprise) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const data = rows.filter((r) => r.surprise_pct != null);
  const H = 150,
    m = { t: 16, r: 8, b: 34, l: 8 };
  if (!data.length) return null;
  const lo = Math.min(0, ...data.map((r) => r.surprise_pct!)),
    hi = Math.max(0, ...data.map((r) => r.surprise_pct!));
  const y = (v: number) => m.t + ((hi - v) / (hi - lo || 1)) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / data.length;
  return (
    <div ref={ref} className="px-3.5 pt-3">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="EPS surprise by quarter">
          <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule)" />
          {data.map((r, i) => {
            const v = r.surprise_pct!;
            const x = m.l + i * bw + bw * 0.22;
            return (
              <g key={r.quarter_end} className="cursor-pointer" onClick={() => onPick(r)}>
                <rect
                  x={x}
                  width={bw * 0.56}
                  y={Math.min(y(v), y(0))}
                  height={Math.max(1, Math.abs(y(v) - y(0)))}
                  rx={2}
                  fill={v >= 0 ? "var(--positive)" : "var(--negative)"}
                  opacity={0.85}
                />
                <text
                  x={x + bw * 0.28}
                  y={v >= 0 ? y(v) - 3 : y(v) + 11}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--foreground)"
                >
                  {fPctS(v, 0)}
                </text>
                <text
                  x={x + bw * 0.28}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {fmtDate(r.quarter_end, { month: "short", year: "2-digit" })}
                </text>
                <title>{surpriseQuote(r)}</title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Surprises({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const rows = [...(d.surprises ?? [])].sort((a, b) => a.quarter_end.localeCompare(b.quarter_end));
  const pick = (s: Surprise, f: "est" | "act" | "pct" | "rx") =>
    o.yahoo(
      f === "rx"
        ? "Next-session reaction"
        : f === "pct"
          ? "EPS surprise"
          : f === "est"
            ? "EPS consensus before report"
            : "Reported EPS (provider)",
      `quarter ending ${fmtDate(s.quarter_end)}`,
      f === "est"
        ? s.eps_estimate
        : f === "act"
          ? s.eps_actual
          : f === "pct"
            ? s.surprise_pct
            : s.reaction?.r1,
      f === "est" || f === "act" ? "usdPerShare" : "pct",
      surpriseQuote(s),
    );
  const rs = d.revenue_surprises ?? [];
  return (
    <Panel
      title="Earnings surprises"
      subtitle="Yahoo Finance basis, GAAP EPS from SEC filings alongside"
      collapse={false}
    >
      <SurpriseBars rows={rows} onPick={(s) => pick(s, "pct")} />
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b text-left">
              <th className={th}>Quarter</th>
              <th className={cn(th, "text-right")}>Consensus</th>
              <th className={cn(th, "text-right")}>Reported</th>
              <th className={cn(th, "text-right")}>Surprise</th>
              <th className={cn(th, "text-right")} title="Diluted EPS from SEC filings (GAAP)">
                GAAP EPS
              </th>
              <th
                className={cn(th, "text-right")}
                title="Next session after the earnings 8-K, stock vs SPY"
              >
                Reaction
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((s) => (
              <tr key={s.quarter_end} className="border-b last:border-0">
                <td className="num px-3 py-2">{fmtDate(s.quarter_end)}</td>
                <td className="px-3 py-2 text-right">
                  <V onClick={() => pick(s, "est")}>{fEps(s.eps_estimate)}</V>
                </td>
                <td className="px-3 py-2 text-right">
                  <V onClick={() => pick(s, "act")}>{fEps(s.eps_actual)}</V>
                </td>
                <td className="px-3 py-2 text-right">
                  <V className={tone(s.surprise_pct)} onClick={() => pick(s, "pct")}>
                    {fPctS(s.surprise_pct)}
                  </V>
                </td>
                <td className="px-3 py-2 text-right">
                  {s.gaap_eps ? (
                    <V
                      title="Open the SEC filing at this value"
                      onClick={() =>
                        o.sec(
                          "EPS diluted (GAAP)",
                          s.gaap_eps!,
                          "us-gaap:EarningsPerShareDiluted",
                          "usdPerShare",
                        )
                      }
                    >
                      {fEps(s.gaap_eps.v)}
                    </V>
                  ) : (
                    <span
                      className="text-muted-foreground/60"
                      title="No quarterly diluted EPS in filings (often the fiscal Q4, reported only for the year)"
                    >
                      –
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {s.reaction ? (
                    <V
                      className={tone(s.reaction.r1)}
                      title={`SPY ${fPctS(s.reaction.spy1)}`}
                      onClick={() => pick(s, "rx")}
                    >
                      {fPctS(s.reaction.r1)}
                    </V>
                  ) : (
                    <span className="text-muted-foreground/60">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rs.length > 0 && (
          <table className="w-full min-w-[560px] border-t text-[13px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Revenue, quarter</th>
                <th className={cn(th, "text-right")}>Consensus (snapshot)</th>
                <th className={cn(th, "text-right")}>SEC revenue</th>
                <th className={cn(th, "text-right")}>Surprise</th>
              </tr>
            </thead>
            <tbody>
              {rs.map((r) => (
                <tr key={r.quarter_end} className="border-b last:border-0">
                  <td className="px-3 py-2">{fmtDate(r.quarter_end)}</td>
                  <td className="num px-3 py-2 text-right tabular-nums">
                    {fUsd(r.consensus)}{" "}
                    <span className="text-[11px] text-muted-foreground">
                      ({fmtDate(r.consensus_as_of)})
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.filing?.accn ? (
                      <V
                        onClick={() =>
                          o.sec(
                            "Revenue",
                            { v: r.actual, end: r.quarter_end, accn: r.filing!.accn! },
                            "us-gaap:Revenues",
                            "usd",
                          )
                        }
                      >
                        {fUsd(r.actual)}
                      </V>
                    ) : (
                      <V>{fUsd(r.actual)}</V>
                    )}
                  </td>
                  <td className={cn("num px-3 py-2 text-right tabular-nums", tone(r.surprise_pct))}>
                    {fPctS(r.surprise_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Note>
        Surprise is the provider's reported EPS against the provider's consensus, generally on the
        adjusted basis analysts forecast. GAAP diluted EPS from SEC filings is shown beside it and
        never mixed into the surprise. Reaction: next session after the earnings 8-K, from Filed
        Under prices.
      </Note>
    </Panel>
  );
}

/* ---------- analyst actions ---------- */
const KIND_STYLE: Record<ActionKind, string> = {
  upgrade: "border-positive/40 bg-positive-soft text-positive",
  downgrade: "border-negative/40 bg-negative-soft text-negative",
  initiate: "border-border bg-secondary text-foreground",
  target: "border-border text-foreground",
  reiterate: "border-border text-muted-foreground",
  drop: "border-border text-muted-foreground line-through",
};

function Actions({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const acts = useMemo(() => d.actions ?? [], [d.actions]);
  const [k, setK] = useState<"all" | ActionKind>("all");
  const [win, setWin] = useState<"90" | "365" | "all">("365");
  const [limit, setLimit] = useState(25);
  const rows = useMemo(() => {
    const since = win === "all" ? "" : ago(+win);
    return acts.filter((a) => a.date >= since && (k === "all" || actionKindOf(a) === k));
  }, [acts, k, win]);
  return (
    <div id="st-actions" className="scroll-mt-20">
      <Panel
        title="Analyst actions"
        subtitle={`${acts.length} actions${acts.length ? ` · ${fmtDate(acts[acts.length - 1].date)} to ${fmtDate(acts[0].date)}` : ""} · ${BZ}`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmented
              size="xs"
              label="Action type"
              value={k}
              onChange={(v) => {
                setK(v);
                setLimit(25);
              }}
              options={[
                { v: "all", l: "All" },
                { v: "upgrade", l: "Upgrades" },
                { v: "downgrade", l: "Downgrades" },
                { v: "initiate", l: "Initiations" },
                { v: "target", l: "Targets" },
              ]}
            />
            <Segmented
              size="xs"
              label="Window"
              value={win}
              onChange={(v) => {
                setWin(v);
                setLimit(25);
              }}
              options={[
                { v: "90", l: "90D" },
                { v: "365", l: "1Y" },
                { v: "all", l: "All" },
              ]}
            />
          </div>
        }
        collapse={false}
      >
        {!rows.length ? (
          <p className="p-4 text-sm text-muted-foreground">No analyst actions in this window.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Date</th>
                  <th className={th}>Firm · analyst</th>
                  <th className={th}>Action</th>
                  <th className={th}>Rating</th>
                  <th className={cn(th, "text-right")}>Price target</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((a) => {
                  const kk = actionKindOf(a);
                  const mv =
                    a.pt_current != null && a.pt_prior ? a.pt_current / a.pt_prior - 1 : null;
                  return (
                    <tr
                      key={a.id}
                      tabIndex={0}
                      onClick={() => o.action(a)}
                      onKeyDown={(e) => e.key === "Enter" && o.action(a)}
                      title="Open the Benzinga record"
                      className="cursor-pointer border-b last:border-0 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <td className="num whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {fmtDate(a.date)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <FirmLogo firm={a.firm} />
                          <span className="min-w-0">
                            <span className="block truncate">{a.firm}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {a.analyst || "analyst not named"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]",
                            KIND_STYLE[kk],
                          )}
                        >
                          {ACTION_LABEL[kk]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {a.rating_prior && a.rating_prior !== a.rating_current && (
                          <span className="text-muted-foreground">{a.rating_prior} → </span>
                        )}
                        {a.rating_current || "–"}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                        {a.pt_current == null ? (
                          <span className="text-muted-foreground/60">–</span>
                        ) : (
                          <>
                            {a.pt_prior != null && a.pt_prior !== a.pt_current && (
                              <span className="text-muted-foreground">{fPx(a.pt_prior)} → </span>
                            )}
                            {fPx(a.pt_current)}
                            {mv != null && Math.abs(mv) > 0.0005 && (
                              <span className={cn("ml-1.5", tone(mv))}>{fPctS(mv, 0)}</span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > limit && (
              <div className="border-t px-3.5 py-2">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + 60)}
                  className="text-xs text-link hover:underline"
                >
                  Show more ({rows.length - limit} more)
                </button>
              </div>
            )}
          </div>
        )}
        <Note>
          Benzinga's history on this feed starts{" "}
          {d.sources?.benzinga?.history_from
            ? fmtDate(d.sources.benzinga.history_from)
            : "July 2, 2025"}
          . Click a row for the full record. Analyst names are shown as published; no photos.
        </Note>
      </Panel>
    </div>
  );
}

/* ---------- targets & ratings ---------- */
function TargetStrip({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const rows = d.targets?.rows ?? [];
  const price = d.price?.close;
  const s = d.targets?.stats;
  if (!rows.length)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No firm-level price targets in the past year.
      </p>
    );
  const vals = rows.map((r) => r.pt).concat(price ? [price] : []);
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const H = 96,
    m = { l: 14, r: 14 };
  const x = (v: number) => m.l + ((v - lo) / (hi - lo || 1)) * (W - m.l - m.r);
  const yy = 54;
  const seen = new Map<number, number>();
  const color = (b?: string) =>
    b === "buy" ? "var(--positive)" : b === "sell" ? "var(--negative)" : "var(--muted-foreground)";
  return (
    <div ref={ref} className="px-3.5 pt-2">
      {W > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="Price targets by firm against the current price"
        >
          {s && (
            <rect
              x={x(s.low)}
              width={Math.max(1, x(s.high) - x(s.low))}
              y={yy - 6}
              height={12}
              rx={6}
              fill="var(--chart-1)"
              opacity={0.12}
            />
          )}
          {rows.map((r) => {
            const key = Math.round(x(r.pt) / 6);
            const n = seen.get(key) ?? 0;
            seen.set(key, n + 1);
            const a = d.actions?.find((z) => z.id === r.id);
            return (
              <circle
                key={r.id}
                cx={x(r.pt)}
                cy={yy + (n % 2 ? 1 : -1) * Math.min(14, Math.ceil(n / 2) * 4)}
                r={4}
                fill={color(r.bucket)}
                opacity={0.85}
                stroke="var(--background)"
                className="cursor-pointer"
                onClick={() => a && o.action(a)}
              >
                <title>{`${r.firm}${r.analyst ? ` · ${r.analyst}` : ""}: ${fPx(r.pt)}${r.adjusted ? " (split-adjusted)" : ""} · ${r.rating ?? ""} · ${r.date}`}</title>
              </circle>
            );
          })}
          {price != null && (
            <g>
              <line
                x1={x(price)}
                x2={x(price)}
                y1={14}
                y2={H - 18}
                stroke="var(--foreground)"
                strokeDasharray="2 2"
              />
              <text
                x={x(price)}
                y={10}
                fontSize={10}
                textAnchor={x(price) < W * 0.2 ? "start" : x(price) > W * 0.8 ? "end" : "middle"}
                fill="var(--foreground)"
              >
                Close {fPx(price)}
              </text>
            </g>
          )}
          {s && (
            <g>
              <line
                x1={x(s.mean)}
                x2={x(s.mean)}
                y1={yy - 12}
                y2={H - 18}
                stroke="var(--chart-1)"
              />
              <text
                x={x(s.mean)}
                y={H - 6}
                fontSize={10}
                textAnchor={x(s.mean) < W * 0.2 ? "start" : x(s.mean) > W * 0.8 ? "end" : "middle"}
                fill="var(--chart-1)"
              >
                Mean {fPx(s.mean)}
              </text>
            </g>
          )}
          <text x={m.l} y={H - 6} fontSize={10} fill="var(--muted-foreground)">
            {fPx(lo)}
          </text>
          <text x={W - m.r} y={H - 6} fontSize={10} textAnchor="end" fill="var(--muted-foreground)">
            {fPx(hi)}
          </text>
        </svg>
      )}
    </div>
  );
}

function RatingHistory({ d }: { d: StreetBundle }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H0 = (d.rating_history ?? []).filter((r) => r.n);
  if (H0.length < 2) return null;
  const H = 84,
    b = 16,
    max = Math.max(...H0.map((r) => r.n));
  const bw = W / H0.length;
  const y = (v: number) => ((H - b) * v) / max;
  return (
    <div ref={ref} className="px-3.5 pb-2">
      <p className="mb-1 text-[11px] text-muted-foreground">
        Latest rating per firm by month, trailing 12 months
      </p>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Rating distribution by month">
          {H0.map((r, i) => {
            let acc = 0;
            return (
              <g key={r.month}>
                {(["sell", "hold", "buy"] as const).map((k) => {
                  const h = y(r[k]);
                  const el = (
                    <rect
                      key={k}
                      x={i * bw + bw * 0.15}
                      width={bw * 0.7}
                      y={H - b - acc - h}
                      height={h}
                      fill={
                        k === "buy"
                          ? "var(--positive)"
                          : k === "sell"
                            ? "var(--negative)"
                            : "var(--muted-foreground)"
                      }
                      opacity={0.8}
                    />
                  );
                  acc += h;
                  return el;
                })}
                <title>{`${r.month}: buy ${r.buy} · hold ${r.hold} · sell ${r.sell}`}</title>
                {(i === H0.length - 1 || i % 3 === 0) && (
                  <text
                    x={i * bw + bw / 2}
                    y={H - 3}
                    fontSize={9.5}
                    textAnchor="middle"
                    fill="var(--muted-foreground)"
                  >
                    {fmtDate(`${r.month}-15`, { month: "short", year: "2-digit" })}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Targets({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const s = d.targets?.stats;
  const R = d.ratings;
  const c = R?.counts ?? {};
  const n = (c.buy ?? 0) + (c.hold ?? 0) + (c.sell ?? 0) + (c.other ?? 0);
  const openStat = (k: "low" | "median" | "mean" | "high" | "n") =>
    s &&
    o.yahoo(
      `Price target ${k === "n" ? "firms" : k}`,
      `latest per firm since ${fmtDate(d.targets!.since)}`,
      k === "n" ? s.n : s[k],
      k === "n" ? "count" : "usd",
      `${s.n} firms' latest price targets since ${d.targets!.since} (Benzinga): low ${fPx(s.low)}, median ${fPx(s.median)}, mean ${fPx(s.mean)}, high ${fPx(s.high)}. Calculated by Filed Under using split-adjusted targets; current price ${fPx(d.price?.close)} (close ${d.price?.date ?? "–"}).`,
    );
  return (
    <div id="st-targets" className="scroll-mt-20">
      <Panel title="Price targets and ratings" subtitle={BZ} collapse={false}>
        <TargetStrip d={d} o={o} />
        {s && (
          <div className="grid grid-cols-5 border-y text-center">
            {(["low", "median", "mean", "high", "n"] as const).map((k) => (
              <div key={k} className="border-r px-2 py-1.5 last:border-r-0">
                <p className="text-[10.5px] capitalize text-muted-foreground">
                  {k === "n" ? "Firms" : k}
                </p>
                <V onClick={() => openStat(k)} className="text-[13px]">
                  {k === "n" ? String(s.n) : fPx(s[k])}
                </V>
              </div>
            ))}
          </div>
        )}
        {n > 0 && (
          <div className="px-3.5 py-2.5">
            <div className="flex h-2.5 overflow-hidden rounded-full">
              {(["buy", "hold", "sell", "other"] as const).map((k) =>
                c[k] ? (
                  <span
                    key={k}
                    title={`${k}: ${c[k]} of ${n} firms`}
                    style={{
                      flex: c[k],
                      background:
                        k === "buy"
                          ? "var(--positive)"
                          : k === "sell"
                            ? "var(--negative)"
                            : k === "hold"
                              ? "var(--muted-foreground)"
                              : "var(--chart-5)",
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>Buy {c.buy ?? 0}</span>
              <span>Hold {c.hold ?? 0}</span>
              <span>Sell {c.sell ?? 0}</span>
              <span>
                {n} firms since {fmtDate(R!.since)}
              </span>
            </div>
          </div>
        )}
        <RatingHistory d={d} />
        <Note>
          Each firm's latest target and rating from the past 12 months; dropped coverage is
          excluded. Dots: green buy, grey hold, red sell; click one for the record. Rating labels
          are each firm's own scale, grouped by Filed Under.
        </Note>
      </Panel>
    </div>
  );
}

/* ---------- guidance ---------- */
const gvcItem = (g: GuidanceVsConsensus) => ({
  label: g.label,
  period: g.period,
  low: g.guide_low,
  high: g.guide_high,
  unit: g.metric === "eps" ? "USD_per_share" : "USD",
  quote: g.quote,
  doc: g.doc,
  issued: g.issued,
});

function Guidance({ d, o }: { d: StreetBundle; o: ReturnType<typeof useOpeners> }) {
  const G = d.guidance;
  const [shown, setShown] = useState(12);
  const [metric, setMetric] = useState("all");
  if (!G?.available)
    return (
      <Panel title="Company guidance">
        <p className="p-4 text-sm text-muted-foreground">
          {G?.reason ?? "No guidance extracted for this company."}
        </p>
      </Panel>
    );
  const vs = G.vs_consensus ?? [];
  const items = (G.items ?? []).filter((i) => i.quote);
  const metrics = [...new Set(items.map((i) => i.label))].slice(0, 6);
  const list = metric === "all" ? items : items.filter((i) => i.label === metric);
  const C = G.credibility;
  const oc = (G.outcomes ?? []).slice(0, 12);
  const openItem = (i: GuidanceItem) =>
    o.guide({
      label: i.label,
      period: i.period,
      low: i.low,
      high: i.high,
      unit: i.unit,
      quote: i.quote,
      doc: i.doc,
      issued: i.issued,
    });
  return (
    <>
      {vs.length > 0 && (
        <Panel
          title="Guidance vs consensus"
          subtitle="Company guidance · Yahoo Finance consensus"
          collapse={false}
        >
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Metric · period</th>
                  <th className={cn(th, "text-right")}>Guidance</th>
                  <th className={cn(th, "text-right")}>Consensus</th>
                  <th className={cn(th, "text-right")}>Gap to midpoint</th>
                  <th className={th}>Consensus vs range</th>
                </tr>
              </thead>
              <tbody>
                {vs.map((g) => {
                  const u = g.metric === "eps" ? "USD_per_share" : "USD";
                  const ok = g.scale_check !== false;
                  const p = d.consensus?.periods.find((x) => x.code === g.code);
                  return (
                    <tr key={g.guide_id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium">
                          {g.label} · {g.period}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          issued {fmtDate(g.issued)} · {PERIOD_NAME[g.code]}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <V
                          title="Open the release at the quoted guidance"
                          onClick={() => o.guide(gvcItem(g))}
                        >
                          {rangeText(g.guide_low, g.guide_high, u)}
                        </V>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <V
                          onClick={() =>
                            p && o.period(p, g.metric === "eps" ? "eps" : "revenue", "avg")
                          }
                        >
                          {u === "USD" ? fUsd(g.consensus) : fEps(g.consensus)}
                        </V>
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right tabular-nums",
                          ok && tone(g.gap_pct),
                        )}
                      >
                        {ok ? (
                          fPctS(g.gap_pct)
                        ) : (
                          <Chip
                            className="border-highlight"
                            title="Guidance and consensus differ by more than 2x; likely a period or unit mismatch in the extraction"
                          >
                            not comparable
                          </Chip>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {ok && g.position ? (
                          <Chip
                            className={
                              g.position === "above"
                                ? "border-positive/40 text-positive"
                                : g.position === "below"
                                  ? "border-negative/40 text-negative"
                                  : ""
                            }
                          >
                            {g.position === "within" ? "within range" : `${g.position} range`}
                          </Chip>
                        ) : (
                          "–"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Note>
            Latest company guidance for a fiscal period against the current consensus for the same
            period (period ends within 20 days; quarterly with quarterly, annual with annual).
            Guidance values open the release at the quoted sentence.
          </Note>
        </Panel>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Guidance timeline"
          subtitle={`${items.length} quoted forecasts from earnings releases and investor materials`}
          actions={
            metrics.length > 1 ? (
              <Segmented
                size="xs"
                label="Metric"
                value={metric}
                onChange={(v) => {
                  setMetric(v);
                  setShown(12);
                }}
                options={[{ v: "all", l: "All" }, ...metrics.map((m) => ({ v: m, l: m }))]}
              />
            ) : undefined
          }
          collapse={false}
        >
          <ol className="divide-y">
            {list.slice(0, shown).map((i) => (
              <li key={i.id} className={cn("px-3.5 py-2.5", i.withdrawn && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="num text-muted-foreground">{fmtDate(i.issued)}</span>
                  <span className="font-medium">{i.label}</span>
                  {basisLabel(i.basis) && <Chip>{basisLabel(i.basis)}</Chip>}
                  <span className="text-muted-foreground">{i.period}</span>
                  {i.action && i.action !== "initial" && (
                    <Chip
                      className={
                        i.action === "raised"
                          ? "border-positive/40 text-positive"
                          : i.action === "lowered"
                            ? "border-negative/40 text-negative"
                            : ""
                      }
                    >
                      {i.action}
                    </Chip>
                  )}
                  {i.withdrawn && <Chip className="border-highlight">withdrawn</Chip>}
                  <V
                    onClick={() => openItem(i)}
                    className="ml-auto font-medium"
                    title="Open the source document at this sentence"
                  >
                    {rangeText(i.low, i.high, i.unit)}
                  </V>
                </div>
                <button
                  type="button"
                  onClick={() => openItem(i)}
                  title="Open the source document with this quote highlighted"
                  className="mt-1 block w-full rounded-sm text-left text-[12.5px] leading-relaxed text-muted-foreground hover:bg-highlight-soft hover:text-foreground"
                >
                  “{cleanQuote(i.quote)}”
                </button>
              </li>
            ))}
          </ol>
          {list.length > shown && (
            <div className="border-t px-3.5 py-2">
              <button
                type="button"
                onClick={() => setShown((s) => s + 60)}
                className="text-xs text-link hover:underline"
              >
                Show more ({list.length - shown})
              </button>
            </div>
          )}
          <Note>
            Verbatim forward-looking statements from the company's earnings releases and investor
            materials. Each quote opens the source document.
          </Note>
        </Panel>
        <Panel
          title="Guidance credibility"
          subtitle="Final guidance against reported results"
          collapse={false}
        >
          {C ? (
            <div className="grid grid-cols-2 border-b">
              {[
                [
                  "Guidance met",
                  fPct(C.hit_rate),
                  `${C.n_met ?? "–"} of ${C.n_scored ?? "–"} scored forecasts`,
                ],
                ["Actual above range", fPct(C.above_rate), `below ${fPct(C.below_rate)}`],
                [
                  "Average surprise vs midpoint",
                  fPctS(C.avg_surprise),
                  C.tendency ? `tendency: ${C.tendency}` : "",
                ],
                [
                  "Track record",
                  `${C.n_series ?? "–"} series`,
                  `${C.first_issued ? fmtDate(C.first_issued) : "–"} – ${C.last_issued ? fmtDate(C.last_issued) : "–"}`,
                ],
              ].map(([l, v, sub]) => (
                <div
                  key={l}
                  className="border-b border-r px-3.5 py-2 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0"
                >
                  <p className="text-[11px] text-muted-foreground">{l}</p>
                  <p className="num text-base font-medium tabular-nums">{v}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Not enough scored guidance yet.</p>
          )}
          {oc.length > 0 && (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[460px] text-[12.5px]">
                <thead>
                  <tr className="border-b text-left">
                    <th className={th}>Period</th>
                    <th className={th}>Metric</th>
                    <th className={cn(th, "text-right")}>Final guidance</th>
                    <th className={cn(th, "text-right")}>Actual</th>
                    <th className={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {oc.map((x, idx) => {
                    const a = x.actual_inputs?.[0];
                    return (
                      <tr key={`${x.period}-${x.label}-${idx}`} className="border-b last:border-0">
                        <td className="num px-3 py-1.5">{x.period}</td>
                        <td className="px-3 py-1.5">{x.label}</td>
                        <td className="num px-3 py-1.5 text-right tabular-nums">
                          {rangeText(x.final_low, x.final_high, x.unit)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {a && x.actual != null ? (
                            <V
                              title={`${a.form} filed ${a.filed} · ${a.accession}`}
                              onClick={() =>
                                o.sec(
                                  x.label,
                                  { v: a.value, end: a.end, accn: a.accession },
                                  a.concept.includes(":") ? a.concept : `us-gaap:${a.concept}`,
                                  x.unit === "USD_per_share" ? "usdPerShare" : "usd",
                                )
                              }
                            >
                              {fUnit(x.actual, x.unit)}
                            </V>
                          ) : (
                            <V>{fUnit(x.actual, x.unit)}</V>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {x.scale_check === false ? (
                            <Chip
                              className="border-highlight"
                              title="Guidance and actual differ by more than 2x: likely a quarterly figure compared with an annual one"
                            >
                              period mismatch
                            </Chip>
                          ) : (
                            <Chip
                              className={
                                x.result === "above"
                                  ? "border-positive/40 text-positive"
                                  : x.result === "below"
                                    ? "border-negative/40 text-negative"
                                    : ""
                              }
                            >
                              {x.result ?? "–"}
                            </Chip>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Note>
            Compares the final guidance for each period with the reported figure from SEC filings.
            Rows flagged "period mismatch" compare different period lengths and are not a beat or
            miss.
          </Note>
        </Panel>
      </div>
    </>
  );
}

/* ---------- tab ---------- */
export function StreetTab({
  ticker,
  d,
  live,
}: {
  ticker: string;
  d: StreetBundle;
  live?: LiveEstimates | null;
}) {
  const o = useOpeners(ticker, d);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Headline ticker={ticker} d={d} o={o} />
      <Consensus d={d} o={o} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Revisions ticker={ticker} d={d} o={o} live={live} />
        <Surprises d={d} o={o} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Actions d={d} o={o} />
        <div className="grid min-w-0 gap-4">
          <Targets d={d} o={o} />
          <StreetView ticker={ticker} d={d} o={o} />
        </div>
      </div>
      <Guidance d={d} o={o} />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{BZ}</span> (analyst actions, ratings and
        price targets; retrieved{" "}
        {d.sources?.benzinga?.retrieved_at ? fmtRelative(d.sources.benzinga.retrieved_at) : "–"}).
        Consensus and surprises: Yahoo Finance (retrieved{" "}
        {d.consensus?.as_of ? fmtRelative(d.consensus.as_of) : "–"}). Actuals: SEC filings.
        Guidance: company releases. Bundle built {fmtRelative(d.generated)}.
      </p>
    </div>
  );
}
