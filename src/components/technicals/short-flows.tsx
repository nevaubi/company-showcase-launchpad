import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Panel } from "@/components/app/page-header";
import { MultiLine } from "@/components/charts/multi-line";
import { useSource } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { altQuery, flowsQuery, type ShortInterestRow } from "@/lib/technicals/data";

const fmtSh = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return a >= 1e9
    ? `${(v / 1e9).toFixed(2)}B`
    : a >= 1e6
      ? `${(v / 1e6).toFixed(1)}M`
      : a >= 1e3
        ? `${(v / 1e3).toFixed(0)}K`
        : v.toFixed(0);
};
const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(d)}%`;
const th = "px-3 py-1.5 text-[11px] font-medium text-muted-foreground";

/** FINRA short interest, Reg SHO daily short-sale volume, off-exchange share and SEC fails to deliver for one symbol. */
export function ShortAndFlows({ symbol }: { symbol: string }) {
  const flows = useQuery(flowsQuery(symbol));
  const alt = useQuery(altQuery(symbol));
  const uni = useUniverse();
  const { open } = useSource();
  const shares = uni.data?.companies.find((c) => c.ticker === symbol)?.sharesOutstanding ?? null;
  const si = flows.data?.short_interest ?? [];
  const last = si[si.length - 1];

  const svSeries = useMemo(() => {
    const rows = alt.data?.short_volume?.rows ?? [];
    const recent = rows.slice(-120);
    const ratio = recent.map((r) => ({ x: r[0], y: r[3] ? (r[1] / r[3]) * 100 : null }));
    // 20-day average of the daily ratio, for the level that matters
    const avg = ratio.map((p, i) => {
      const w = ratio
        .slice(Math.max(0, i - 19), i + 1)
        .map((q) => q.y)
        .filter((y): y is number => y != null);
      return { x: p.x, y: w.length >= 10 ? w.reduce((a, b) => a + b, 0) / w.length : null };
    });
    return [
      { key: "d", label: "Daily", color: "var(--muted-foreground)", points: ratio },
      { key: "a", label: "20-day avg", color: "var(--chart-1)", points: avg },
    ];
  }, [alt.data]);
  const offSeries = useMemo(() => {
    const w = (flows.data?.ats_weekly ?? []).filter((x) => x.offex_share != null);
    return [
      {
        key: "off",
        label: "All off-exch.",
        color: "var(--chart-1)",
        points: w.map((x) => ({ x: x.week, y: x.offex_share! * 100 })),
      },
      {
        key: "ats",
        label: "Dark pools",
        color: "var(--chart-3)",
        points: w.map((x) => ({ x: x.week, y: x.ats_share != null ? x.ats_share * 100 : null })),
      },
    ];
  }, [flows.data]);

  if (flows.isLoading || alt.isLoading) return null;
  if (!flows.data && !alt.data) return null;
  const src = flows.data?.src_short_interest;
  const openSi = (r: ShortInterestRow, label: string, value: number | null, unit: string) =>
    open({
      ticker: symbol,
      label,
      periodLabel: `settlement ${fmtDate(r.date)}`,
      unit,
      value: value ?? 0,
      external: {
        url:
          src?.page ?? "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data",
        date: r.date,
        quote: `${symbol} short interest for settlement date ${r.date}: ${r.short?.toLocaleString() ?? "–"} shares (previous ${r.prev?.toLocaleString() ?? "–"}, change ${r.chg_pct ?? "–"}%); average daily volume ${r.adv?.toLocaleString() ?? "–"}; days to cover ${r.dtc ?? "–"}.${r.revised ? " Revised by FINRA." : ""}`,
        confidence: `FINRA Query API consolidatedShortInterest, retrieved ${src?.retrieved_at?.slice(0, 10) ?? "–"}.${shares ? ` Percent of shares outstanding uses the cover-page count of ${shares.toLocaleString()} shares.` : ""}`,
      },
    });
  const ftd = alt.data?.ftd?.rows ?? [];
  const ftd60 = ftd.filter(
    (r) => r[0] >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10),
  );
  const ftdMax = ftd60.reduce((m, r) => (r[1] > m[1] ? r : m), ftd60[0] ?? ["", 0, 0, ""]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {si.length > 0 && (
        <Panel
          title="Short interest"
          subtitle="FINRA, twice a month by settlement date"
          collapse={false}
          bodyClassName="p-0"
        >
          {last && (
            <div className="grid grid-cols-2 border-b sm:grid-cols-4">
              {[
                [
                  "Shares short",
                  fmtSh(last.short),
                  () => openSi(last, "Short interest", last.short, "shares"),
                ],
                [
                  "% of shares out",
                  shares && last.short ? pct(last.short / shares, 2) : "–",
                  () =>
                    openSi(
                      last,
                      "Short interest, % of shares outstanding",
                      shares && last.short ? last.short / shares : null,
                      "pct",
                    ),
                ],
                [
                  "Days to cover",
                  last.dtc?.toFixed(2) ?? "–",
                  () => openSi(last, "Days to cover", last.dtc, "count"),
                ],
                [
                  "Change",
                  last.chg_pct != null
                    ? `${last.chg_pct > 0 ? "+" : ""}${last.chg_pct.toFixed(1)}%`
                    : "–",
                  () => openSi(last, "Change in short interest", last.chg_pct, "count"),
                ],
              ].map(([l, v, on]) => (
                <button
                  key={l as string}
                  type="button"
                  onClick={on as () => void}
                  className="border-r px-3.5 py-2 text-left last:border-r-0 hover:bg-secondary"
                >
                  <p className="text-[11px] text-muted-foreground">{l as string}</p>
                  <p className="num text-base font-medium tabular-nums">{v as string}</p>
                  <p className="text-[10.5px] text-muted-foreground">{fmtDate(last.date)}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex h-24 items-end gap-0.5 px-3.5 pt-2">
            {si.map((r) => {
              const max = Math.max(...si.map((x) => x.short ?? 0));
              return (
                <button
                  key={r.date}
                  type="button"
                  onClick={() => openSi(r, "Short interest", r.short, "shares")}
                  title={`${r.date}: ${fmtSh(r.short)} short, ${r.dtc ?? "–"} days to cover`}
                  className="flex-1 rounded-t-sm bg-chart-1/60 hover:bg-chart-1"
                  style={{ height: `${((r.short ?? 0) / (max || 1)) * 100}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between px-3.5 pb-1 text-[10px] text-muted-foreground">
            <span>{fmtDate(si[0].date)}</span>
            <span>{fmtDate(si[si.length - 1].date)}</span>
          </div>
          <table className="w-full border-t text-[12px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Settlement</th>
                <th className={cn(th, "text-right")}>Short</th>
                <th className={cn(th, "text-right")}>% shares out</th>
                <th className={cn(th, "text-right")}>Days to cover</th>
                <th className={cn(th, "text-right")}>Change</th>
              </tr>
            </thead>
            <tbody>
              {[...si]
                .reverse()
                .slice(0, 6)
                .map((r) => (
                  <tr
                    key={r.date}
                    className="cursor-pointer border-b last:border-0 hover:bg-secondary"
                    onClick={() => openSi(r, "Short interest", r.short, "shares")}
                  >
                    <td className="num px-3 py-1">{fmtDate(r.date)}</td>
                    <td className="num px-3 py-1 text-right">{fmtSh(r.short)}</td>
                    <td className="num px-3 py-1 text-right">
                      {shares && r.short ? pct(r.short / shares, 2) : "–"}
                    </td>
                    <td className="num px-3 py-1 text-right">{r.dtc?.toFixed(2) ?? "–"}</td>
                    <td
                      className={cn(
                        "num px-3 py-1 text-right",
                        (r.chg_pct ?? 0) > 0
                          ? "text-negative"
                          : (r.chg_pct ?? 0) < 0
                            ? "text-positive"
                            : "",
                      )}
                    >
                      {r.chg_pct != null
                        ? `${r.chg_pct > 0 ? "+" : ""}${r.chg_pct.toFixed(1)}%`
                        : "–"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
            Positions reported by broker-dealers as of each settlement date, published by FINRA
            about a week later. Days to cover = shares short ÷ average daily volume. Percent uses
            shares outstanding, not float.{" "}
            <a
              href={src?.page}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              FINRA data ↗
            </a>
          </p>
        </Panel>
      )}
      <div className="grid gap-4">
        {alt.data?.short_volume && (
          <Panel
            title="Short-sale share of off-exchange volume"
            subtitle="FINRA Reg SHO daily files, last 120 sessions, %"
            collapse={false}
          >
            <div className="px-3 py-2">
              <MultiLine
                series={svSeries}
                label="Daily short-sale volume as a share of FINRA-reported volume"
                format={(v) => `${v.toFixed(0)}%`}
                height={150}
                xFormat={(x) => fmtDate(x, { month: "short", day: "numeric" })}
              />
            </div>
            <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
              Short-sale volume is mostly market makers selling short to fill buy orders, so a ratio
              near 40–50% is normal; changes in the 20-day average matter more than the level. Not
              the same as short interest.{" "}
              <a
                href={alt.data.short_volume.url}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                Source ↗
              </a>
            </p>
          </Panel>
        )}
        {offSeries[0].points.length > 0 && (
          <Panel
            title="Off-exchange share of volume"
            subtitle="FINRA weekly ATS and non-ATS volume over consolidated volume, %"
            collapse={false}
          >
            <div className="px-3 py-2">
              <MultiLine
                series={offSeries}
                label="Weekly off-exchange share of volume"
                format={(v) => `${v.toFixed(0)}%`}
                height={150}
                xFormat={(x) => fmtDate(x, { month: "short", day: "numeric" })}
              />
            </div>
            <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
              Weeks are published two to four weeks late.{" "}
              {flows.data?.ats_venues.rows.length
                ? `Largest dark pools in the week of ${fmtDate(flows.data.ats_venues.week ?? "")}: ${flows.data.ats_venues.rows
                    .slice(0, 3)
                    .map((v) => `${v.name} ${pct(v.pct_of_ats, 0)}`)
                    .join(", ")}.`
                : ""}
              {ftd60.length
                ? ` SEC fails to deliver, last 60 days: peak ${ftdMax[1].toLocaleString()} shares on ${fmtDate(ftdMax[0])}.`
                : ""}{" "}
              <a
                href={flows.data?.src_weekly.page}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                FINRA OTC transparency ↗
              </a>
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
