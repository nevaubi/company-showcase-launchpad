import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import LoadingState from "@/components/ui/loading-state";
import {
  groupUpcoming,
  pct,
  previewQuery,
  scoreQuery,
  seasonQuery,
  type Preview,
  type Scorecard,
  type SeasonReported,
} from "@/lib/earnings/workflow";
import { friendlyError } from "@/lib/errors";
import { fmtCompact, fmtCompactUsd, fmtDate, fmtRelative } from "@/lib/format";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const tone = (v: number | null | undefined) =>
  v == null
    ? ""
    : v > 0
      ? "text-emerald-700 dark:text-emerald-400"
      : v < 0
        ? "text-red-700 dark:text-red-400"
        : "";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ───────────────────────────── Season page

export function EarningsSeason() {
  const season = useQuery(seasonQuery);
  const watch = useWatchlist();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [sort, setSort] = useState<"filed" | "surprise" | "move">("filed");
  const mine = useMemo(
    () => new Set((watch.data ?? []).map((w: { ticker: string }) => w.ticker)),
    [watch.data],
  );

  if (season.isLoading)
    return <LoadingState label="Loading the earnings season" variant="Dots" className="mt-8" />;
  if (season.error || !season.data)
    return <p className="mt-8 text-sm text-muted-foreground">{friendlyError(season.error)}</p>;
  const s = season.data;
  const filter = scope === "mine" ? mine : undefined;
  const upcoming = groupUpcoming(s.upcoming, filter).slice(0, 14);
  const reported = s.reported
    .filter((r) => !filter || filter.has(r.ticker))
    .sort((a, b) =>
      sort === "filed"
        ? b.filed.localeCompare(a.filed)
        : sort === "surprise"
          ? Math.abs(b.surprise_pct ?? 0) - Math.abs(a.surprise_pct ?? 0)
          : Math.abs(b.excess ?? b.move ?? 0) - Math.abs(a.excess ?? a.move ?? 0),
    )
    .slice(0, 150);
  const d = s.drivers;
  return (
    <div className="mt-2 grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={scope}
          onChange={setScope}
          label="Companies"
          options={[
            { v: "all", l: "All covered" },
            { v: "mine", l: "Watchlist" },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Last {s.window_days} days · updated {fmtRelative(s.generated)}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          title="Beat rate by sector"
          note="Share of reports beating consensus EPS; median one-day move after the report."
        >
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="pb-1 font-normal">Sector</th>
                <th className="pb-1 text-right font-normal">n</th>
                <th className="pb-1 text-right font-normal">Beat</th>
                <th className="pb-1 text-right font-normal">Med. surprise</th>
                <th className="pb-1 text-right font-normal">Med. move</th>
              </tr>
            </thead>
            <tbody>
              {s.sectors.map((x) => (
                <tr key={x.sector} className="border-t border-border/60">
                  <td className="py-1 pr-2">{x.sector}</td>
                  <td className="py-1 text-right">{x.n}</td>
                  <td className="py-1 text-right">{Math.round(x.beat_rate * 100)}%</td>
                  <td className={cn("py-1 text-right", tone(x.median_surprise))}>
                    {pct(x.median_surprise)}
                  </td>
                  <td className={cn("py-1 text-right", tone(x.median_move))}>
                    {pct(x.median_move)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Does a beat move the stock?" note={d.basis}>
          <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
            <div>
              <dt className="text-xs text-muted-foreground">Beats</dt>
              <dd>
                {d.beats.n} reports, median move {pct(d.beats.median_move)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Beats that still fell</dt>
              <dd>
                {d.beats.share_down == null ? "–" : `${Math.round(d.beats.share_down * 100)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Misses</dt>
              <dd>
                {d.misses.n} reports, median move {pct(d.misses.median_move)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Surprise vs move, correlation</dt>
              <dd>
                {d.corr_surprise_move == null ? "–" : d.corr_surprise_move.toFixed(2)} ({d.n_pairs}{" "}
                pairs)
              </dd>
            </div>
          </dl>
        </Section>
        <Section
          title="Coming up"
          note="Dates from the consensus provider; estimated dates are marked."
        >
          {!upcoming.length ? (
            <p className="text-xs text-muted-foreground">
              Nothing scheduled{scope === "mine" ? " for your watchlist" : ""}.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {upcoming.map(([date, rows]) => (
                <li key={date}>
                  <div className="font-medium">
                    {fmtDate(date, { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {rows.slice(0, 18).map((r) => (
                      <Link
                        key={r.ticker}
                        to="/app/companies/$ticker/earnings"
                        params={{ ticker: r.ticker }}
                        title={`${r.name}${r.eps != null ? ` · consensus EPS ${r.eps.toFixed(2)}` : ""}${r.median_abs_move != null ? ` · typical move ±${(r.median_abs_move * 100).toFixed(1)}%` : ""}`}
                        className={cn(
                          "rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-muted/70",
                          r.is_estimate && "italic opacity-80",
                        )}
                      >
                        {r.ticker}
                      </Link>
                    ))}
                    {rows.length > 18 && (
                      <span className="text-muted-foreground">+{rows.length - 18}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section
        title="Reported"
        note="EPS against consensus and the one-day move after the report (excess = minus the S&P 500 move that day)."
      >
        <div className="mb-2 flex justify-end">
          <Segmented
            value={sort}
            onChange={setSort}
            label="Sort"
            options={[
              { v: "filed", l: "Latest" },
              { v: "surprise", l: "Largest surprise" },
              { v: "move", l: "Largest move" },
            ]}
          />
        </div>
        <ReportedTable rows={reported} />
      </Section>
    </div>
  );
}

function ReportedTable({ rows }: { rows: SeasonReported[] }) {
  if (!rows.length)
    return <p className="text-xs text-muted-foreground">No reports in the window.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="pb-1 font-normal">Company</th>
            <th className="pb-1 font-normal">Filed</th>
            <th className="pb-1 text-right font-normal">EPS</th>
            <th className="pb-1 text-right font-normal">Consensus</th>
            <th className="pb-1 text-right font-normal">Surprise</th>
            <th className="pb-1 text-right font-normal">Move</th>
            <th className="pb-1 text-right font-normal">Excess</th>
            <th className="pb-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.ticker}-${r.filed}`} className="border-t border-border/60">
              <td className="py-1 pr-2">
                <Link
                  to="/app/companies/$ticker/earnings"
                  params={{ ticker: r.ticker }}
                  className="font-mono hover:underline"
                >
                  {r.ticker}
                </Link>{" "}
                <span className="text-muted-foreground">{r.name}</span>
              </td>
              <td className="py-1">{r.filed}</td>
              <td className="py-1 text-right">{r.eps_actual?.toFixed(2) ?? "–"}</td>
              <td className="py-1 text-right">{r.eps_estimate?.toFixed(2) ?? "–"}</td>
              <td className={cn("py-1 text-right", tone(r.surprise_pct))}>{pct(r.surprise_pct)}</td>
              <td className={cn("py-1 text-right", tone(r.move))}>{pct(r.move)}</td>
              <td className={cn("py-1 text-right", tone(r.excess))}>{pct(r.excess)}</td>
              <td className="py-1 pl-2">
                {r.report_url && (
                  <a
                    href={r.report_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Report on SEC.gov"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────── Company panel: preview pack + latest scorecard

export function EarningsWorkflowPanel({ ticker }: { ticker: string }) {
  const preview = useQuery(previewQuery(ticker));
  const score = useQuery(scoreQuery(ticker));
  if (preview.isLoading && score.isLoading)
    return <LoadingState label="Loading the earnings pack" variant="Dots" />;
  if (!preview.data && !score.data) return null;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {score.data && <ScorecardView s={score.data} />}
      {preview.data && <PreviewView p={preview.data} />}
    </div>
  );
}

function ScorecardView({ s }: { s: Scorecard }) {
  const rows = [...s.metrics, ...s.kpis];
  const eps =
    s.metrics.find((m) => m.id === "eps_adjusted") ?? s.metrics.find((m) => m.id === "eps_gaap");
  const cons = s.consensus?.eps;
  return (
    <Section
      title={`Latest report: ${s.quarter_end ? `quarter ended ${s.quarter_end}` : s.filed}`}
      note={`8-K filed ${s.filed} (items ${s.items.join(", ")}). Each figure is quoted from the press release.`}
    >
      {eps && cons != null && eps.value != null && (
        <p className="mb-3 text-sm">
          {eps.label} {eps.printed} vs consensus ${cons.toFixed(2)}:{" "}
          <span className={tone(eps.value - cons)}>{pct((eps.value - cons) / Math.abs(cons))}</span>
        </p>
      )}
      <table className="w-full text-xs tabular-nums">
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-t border-border/60 align-top">
              <td className="py-1 pr-2">{m.label}</td>
              <td className="py-1 pr-2 text-right font-medium">{m.printed ?? "–"}</td>
              <td className="py-1 text-muted-foreground">
                {m.yoy_printed ? `${m.yoy_printed} · ` : ""}
                {m.quote ? `“${m.quote.slice(0, 120)}”` : ""}
                {m.unconfirmed ? " (unconfirmed)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.guidance.length ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Guidance in the release
          </h3>
          <ul className="mt-1 space-y-1 text-xs">
            {s.guidance.map((g, i) => (
              <li key={i}>
                {g.label ?? g.period ?? "Guidance"}:{" "}
                {g.text ?? g.quote ?? [g.low, g.high].filter((x) => x != null).join(" to ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex gap-3 text-xs">
        <a
          href={s.filing_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          Filing index
        </a>
        {s.exhibit_url && (
          <a
            href={s.exhibit_url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            Press release (Ex-99.1)
          </a>
        )}
      </div>
    </Section>
  );
}

function PreviewView({ p }: { p: Preview }) {
  const r = p.report;
  const c = p.consensus;
  return (
    <Section
      title={
        r.days_until >= 0
          ? `Next report ${r.days_until === 0 ? "today" : `in ${r.days_until} days`} (${fmtDate(r.date)}${r.is_estimate ? ", estimated" : ""})`
          : "Preview pack"
      }
      note={`What the Street expects, what changed since the last report and what to listen for. Updated ${fmtRelative(p.generated)}.`}
    >
      <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
        {c?.eps && (
          <div>
            <dt className="text-xs text-muted-foreground">
              Consensus EPS ({c.period.label.toLowerCase()})
            </dt>
            <dd>
              ${c.eps.avg.toFixed(2)}{" "}
              <span className="text-xs text-muted-foreground">
                range {c.eps.low.toFixed(2)}–{c.eps.high.toFixed(2)}, n={c.eps.n}
              </span>
              {c.eps.yoy != null && (
                <span className={cn("ml-1 text-xs", tone(c.eps.yoy))}>{pct(c.eps.yoy)} y/y</span>
              )}
            </dd>
          </div>
        )}
        {c?.revenue && (
          <div>
            <dt className="text-xs text-muted-foreground">Consensus revenue</dt>
            <dd>
              {fmtCompactUsd(c.revenue.avg)}{" "}
              {c.revenue.yoy != null && (
                <span className={cn("text-xs", tone(c.revenue.yoy))}>{pct(c.revenue.yoy)} y/y</span>
              )}
            </dd>
          </div>
        )}
        {p.last_report && (
          <div>
            <dt className="text-xs text-muted-foreground">
              Last report ({p.last_report.quarter_end})
            </dt>
            <dd>
              surprise{" "}
              <span className={tone(p.last_report.surprise_pct)}>
                {pct(p.last_report.surprise_pct)}
              </span>
              , move <span className={tone(p.last_report.move)}>{pct(p.last_report.move)}</span>
            </dd>
          </div>
        )}
        {p.street?.d90 && (
          <div>
            <dt className="text-xs text-muted-foreground">Analysts, last 90 days</dt>
            <dd className="text-xs">
              {p.street.d90.upgrades} up, {p.street.d90.downgrades} down,{" "}
              {p.street.d90.target_raises} target raises, {p.street.d90.target_cuts} cuts
            </dd>
          </div>
        )}
        {p.insiders && (
          <div>
            <dt className="text-xs text-muted-foreground">Insiders since last report</dt>
            <dd className="text-xs">
              {p.insiders.buys} buys ({fmtCompactUsd(p.insiders.buy_value)}), {p.insiders.sells}{" "}
              sells ({fmtCompactUsd(p.insiders.sell_value)};{" "}
              {fmtCompactUsd(p.insiders.discretionary_sell_value)} outside plans)
            </dd>
          </div>
        )}
        {p.filing_changes && (
          <div>
            <dt className="text-xs text-muted-foreground">
              Last {p.filing_changes.form} vs a year earlier
            </dt>
            <dd className="text-xs">
              <a
                href={p.filing_changes.url}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {p.filing_changes.totals.added} added, {p.filing_changes.totals.removed} removed,{" "}
                {p.filing_changes.totals.numbers} number changes
              </a>
            </dd>
          </div>
        )}
      </dl>
      {p.reactions?.rows?.length ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reaction to past reports (vs S&amp;P 500)
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] tabular-nums">
            {p.reactions.rows.slice(-8).map((x) => (
              <span
                key={x.filed}
                className={cn("rounded bg-muted px-1.5 py-0.5", tone(x.abn))}
                title={`Filed ${x.filed} ${x.timing}; 5-day ${pct(x.a5)}, 20-day ${pct(x.a20)}`}
              >
                {x.day0.slice(0, 7)} {pct(x.abn)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {p.kpis.length ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Operating numbers to watch
          </h3>
          <ul className="mt-1 space-y-1 text-xs tabular-nums">
            {p.kpis.slice(0, 6).map((k) => {
              const last = k.points[k.points.length - 1];
              const prev = k.points[k.points.length - 2];
              return (
                <li key={k.id} className="flex justify-between gap-2">
                  <span>{k.name}</span>
                  <span className="text-muted-foreground">
                    {last
                      ? `${last.label}: ${k.unit === "USD" ? fmtCompactUsd(last.v) : fmtCompact(last.v)}`
                      : "–"}
                    {prev && last
                      ? ` (prior ${k.unit === "USD" ? fmtCompactUsd(prev.v) : fmtCompact(prev.v)})`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {p.listen_for.length ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Listen for
          </h3>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs">
            {p.listen_for.map((q, i) => (
              <li key={i}>{q.text}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </Section>
  );
}
