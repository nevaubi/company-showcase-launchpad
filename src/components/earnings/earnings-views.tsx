import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import LoadingState from "@/components/ui/loading-state";
import {
  groupUpcoming,
  seasonQuery,
  type SeasonReported,
} from "@/lib/earnings/workflow";
import { friendlyError } from "@/lib/errors";
import { signedPct as pct } from "./figures";
import { fmtDate, fmtRelative } from "@/lib/format";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

/** Two decimals with a true minus, the quiet en dash when missing. */
const num2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(2).replace("-", "−"));
const tone = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "");

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section data-section={title} className="min-w-0 border-y bg-card/40">
      <header className="border-b px-4 py-2.5">
        <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
        {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      </header>
      <div className="min-w-0 px-4 py-3">{children}</div>
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
    return <p className="mt-8 text-[13px] text-muted-foreground">{friendlyError(season.error)}</p>;
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
        <p className="text-[11px] text-muted-foreground">
          Last {s.window_days} days · updated {fmtRelative(s.generated)}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Section
          title="Beat rate by sector"
          note="Share of reports beating consensus EPS; median one-day move after the report."
        >
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="pb-1 font-normal">Sector</th>
                <th className="pb-1 pl-3 text-right font-normal">Reports</th>
                <th className="pb-1 pl-3 text-right font-normal">Beat</th>
                <th className="pb-1 pl-3 text-right font-normal">Med. surprise</th>
                <th className="pb-1 pl-3 text-right font-normal">Med. move</th>
              </tr>
            </thead>
            <tbody>
              {s.sectors.map((x) => (
                <tr key={x.sector} className="border-t border-border/60">
                  <td className="py-1 pr-2">{x.sector}</td>
                  <td className="num py-1 pl-3 text-right">{x.n}</td>
                  <td className="num py-1 pl-3 text-right">{Math.round(x.beat_rate * 100)}%</td>
                  <td className={cn("num py-1 pl-3 text-right", tone(x.median_surprise))}>
                    {pct(x.median_surprise)}
                  </td>
                  <td className={cn("num py-1 pl-3 text-right", tone(x.median_move))}>
                    {pct(x.median_move)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Does a beat move the stock?" note={d.basis}>
          <dl className="grid grid-cols-2 gap-3 text-[13px] tabular-nums">
            <div>
              <dt className="text-[11px] text-muted-foreground">Beats</dt>
              <dd>
                {d.beats.n} {d.beats.n === 1 ? "report" : "reports"}, median move {pct(d.beats.median_move)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Beats that still fell</dt>
              <dd>
                {d.beats.share_down == null ? "–" : `${Math.round(d.beats.share_down * 100)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Misses</dt>
              <dd>
                {d.misses.n} {d.misses.n === 1 ? "report" : "reports"}, median move {pct(d.misses.median_move)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Surprise vs move, correlation</dt>
              <dd>
                {num2(d.corr_surprise_move)} ({d.n_pairs}{" "}
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
            <p className="text-[11px] text-muted-foreground">
              Nothing scheduled{scope === "mine" ? " for your watchlist" : ""}.
            </p>
          ) : (
            <ul className="space-y-2 text-[13px]">
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
                        title={`${r.name}${r.is_estimate ? " · estimated date" : ""}${r.eps != null ? ` · consensus EPS ${r.eps.toFixed(2)}` : ""}${r.median_abs_move != null ? ` · typical move ±${(r.median_abs_move * 100).toFixed(1)}%` : ""}`}
                        className={cn("inline-flex h-7 items-center rounded-md border px-1.5 transition-colors duration-150 hover:bg-secondary", r.is_estimate && "border-dashed")}
                      >
                        <TickerMark ticker={r.ticker} link={false} />
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
    return <p className="text-[11px] text-muted-foreground">No reports in the window.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px] tabular-nums">
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
                <Link to="/app/companies/$ticker/earnings" params={{ ticker: r.ticker }} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
                  <TickerMark ticker={r.ticker} link={false} />
                  <span className="truncate text-muted-foreground">{r.name}</span>
                </Link>
              </td>
              <td className="py-1">{r.filed}</td>
              <td className="py-1 text-right">{num2(r.eps_actual)}</td>
              <td className="py-1 text-right">{num2(r.eps_estimate)}</td>
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
