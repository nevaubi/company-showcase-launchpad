import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { MultiLine } from "@/components/charts/multi-line";
import { useSource } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { altQuery, flowsQuery, type ShortInterestRow } from "@/lib/technicals/data";
import { Note, T as S, TableWrap, TechPanel } from "./ui";

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
const chg = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const WRAP = "scroll-mt-[calc(var(--sticky-top,3.5rem)+3.25rem)]";

/**
 * FINRA short interest, Reg SHO daily short-sale volume, off-exchange share and SEC fails to deliver for one symbol.
 * Renders nothing when no file exists for the symbol, unless `placeholder` asks for a one-line note instead
 * (the Technicals page, where the section is in the page's navigation).
 */
export function ShortAndFlows({ symbol, placeholder }: { symbol: string; placeholder?: boolean }) {
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

  if (flows.isLoading || alt.isLoading) return placeholder ? <div id="flows" data-section="Short interest and flows" className={WRAP} /> : null;
  if (!flows.data && !alt.data)
    return placeholder ? (
      <div id="flows" className={WRAP}>
        <TechPanel section="Short interest and flows" title="Short interest and flows">
          <p className={cn("px-3 py-4", S.caption)}>No short-interest or off-exchange volume file is published for {symbol} yet.</p>
        </TechPanel>
      </div>
    ) : null;
  const src = flows.data?.src_short_interest;
  const openSi = (r: ShortInterestRow, label: string, value: number | null, unit: string) =>
    open({
      ticker: symbol,
      label,
      periodLabel: `settlement ${fmtDate(r.date)}`,
      unit,
      value: value ?? 0,
      external: {
        url: src?.page ?? "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data",
        date: r.date,
        quote: `${symbol} short interest for settlement date ${r.date}: ${r.short?.toLocaleString() ?? "–"} shares (previous ${r.prev?.toLocaleString() ?? "–"}, change ${r.chg_pct ?? "–"}%); average daily volume ${r.adv?.toLocaleString() ?? "–"}; days to cover ${r.dtc ?? "–"}.${r.revised ? " Revised by FINRA." : ""}`,
        confidence: `FINRA Query API consolidatedShortInterest, retrieved ${src?.retrieved_at?.slice(0, 10) ?? "–"}.${shares ? ` Percent of shares outstanding uses the cover-page count of ${shares.toLocaleString()} shares.` : ""}`,
      },
    });
  const ftd = alt.data?.ftd?.rows ?? [];
  const ftd60 = ftd.filter((r) => r[0] >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10));
  const ftdMax = ftd60.reduce((m, r) => (r[1] > m[1] ? r : m), ftd60[0] ?? ["", 0, 0, ""]);
  const siMax = Math.max(1, ...si.map((x) => x.short ?? 0));
  // two charts sit side by side only when there are two and no short-interest panel beside them
  const charts = (alt.data?.short_volume ? 1 : 0) + (offSeries[0].points.length > 0 ? 1 : 0);
  const stats: [string, string, () => void][] = last
    ? [
        ["Shares short", fmtSh(last.short), () => openSi(last, "Short interest", last.short, "shares")],
        [
          "Share of shares outstanding",
          shares && last.short ? pct(last.short / shares, 2) : "–",
          () => openSi(last, "Short interest, % of shares outstanding", shares && last.short ? last.short / shares : null, "pct"),
        ],
        ["Days to cover", last.dtc?.toFixed(2) ?? "–", () => openSi(last, "Days to cover", last.dtc, "count")],
        ["Change from prior report", chg(last.chg_pct), () => openSi(last, "Change in short interest", last.chg_pct, "count")],
      ]
    : [];
  return (
    <div id="flows" data-section="Short interest and flows" data-tour="tech-flows" className={cn(WRAP, "grid grid-cols-1 gap-4 [&>*]:min-w-0", si.length > 0 && "xl:grid-cols-2")}>
      {si.length > 0 && (
        <TechPanel section="Short interest" title="Short interest" subtitle={`FINRA, twice a month by settlement date${last ? `; latest ${fmtDate(last.date)}` : ""}`}>
          {last && (
            <div className="grid grid-cols-2 border-b sm:grid-cols-4">
              {stats.map(([l, v, on]) => (
                <button
                  key={l}
                  type="button"
                  data-agent-click
                  onClick={on}
                  title="Open the FINRA record"
                  className="border-r px-3 py-2 text-left transition-colors duration-150 last:border-r-0 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <p className={S.caption}>{l}</p>
                  <p className="num text-lg font-semibold leading-6 tabular-nums">{v}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex h-24 items-end gap-0.5 px-3 pt-2" role="img" aria-label={`Shares short at each of the last ${si.length} settlement dates`}>
            {si.map((r) => (
              <button
                key={r.date}
                type="button"
                onClick={() => openSi(r, "Short interest", r.short, "shares")}
                title={`${fmtDate(r.date)}: ${fmtSh(r.short)} short, ${r.dtc ?? "–"} days to cover`}
                aria-label={`${fmtDate(r.date)}: ${fmtSh(r.short)} shares short`}
                className="min-w-0 flex-1 rounded-t-sm bg-chart-1/60 transition-colors duration-150 hover:bg-chart-1 focus-visible:bg-chart-1 focus-visible:outline-none motion-reduce:transition-none"
                style={{ height: `${((r.short ?? 0) / siMax) * 100}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between px-3 pb-1 text-[10px] text-muted-foreground">
            <span className="num">{fmtDate(si[0].date)}</span>
            <span className="num">{fmtDate(si[si.length - 1].date)}</span>
          </div>
          <TableWrap min={420}>
            <table className="w-full border-collapse border-t">
              <thead>
                <tr className="border-b">
                  <th className={S.th}>Settlement</th>
                  <th className={S.thNum}>Shares short</th>
                  <th className={S.thNum}>Of shares out</th>
                  <th className={S.thNum}>Days to cover</th>
                  <th className={S.thNum}>Change</th>
                </tr>
              </thead>
              <tbody>
                {[...si]
                  .reverse()
                  .slice(0, 6)
                  .map((r) => (
                    <tr key={r.date} className={S.row}>
                      <td className={S.td}>
                        <button type="button" data-agent-click onClick={() => openSi(r, "Short interest", r.short, "shares")} title="Open the FINRA record" className={cn(S.cellButton, "num")}>
                          {fmtDate(r.date)}
                        </button>
                      </td>
                      <td className={S.num}>{fmtSh(r.short)}</td>
                      <td className={S.num}>{shares && r.short ? pct(r.short / shares, 2) : "–"}</td>
                      <td className={S.num}>{r.dtc?.toFixed(2) ?? "–"}</td>
                      <td className={S.num}>{chg(r.chg_pct)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableWrap>
          <Note>
            Positions reported by broker-dealers as of each settlement date, published by FINRA about a week later. Days to cover: shares short ÷ average daily volume. The share uses shares
            outstanding, not float.{" "}
            {src?.page && (
              <a href={src.page} target="_blank" rel="noreferrer" className="text-link hover:underline">
                FINRA data ↗
              </a>
            )}
          </Note>
        </TechPanel>
      )}
      <div className={cn("grid grid-cols-1 content-start gap-4 [&>*]:min-w-0", si.length === 0 && charts === 2 && "xl:grid-cols-2")}>
        {alt.data?.short_volume && (
          <TechPanel section="Short-sale volume" title="Short-sale share of off-exchange volume" subtitle="FINRA Reg SHO daily files, last 120 sessions">
            <div className="px-3 py-2">
              <MultiLine
                series={svSeries}
                label="Daily short-sale volume as a share of FINRA-reported volume"
                format={(v) => `${v.toFixed(0)}%`}
                height={150}
                xFormat={(x) => fmtDate(x, { month: "short", day: "numeric" })}
              />
            </div>
            <Note>
              Short-sale volume is mostly market makers selling short to fill buy orders, so a share near 40 to 50% is normal; changes in the 20-day average say more than the level. It is not
              short interest.{" "}
              <a href={alt.data.short_volume.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Source ↗
              </a>
            </Note>
          </TechPanel>
        )}
        {offSeries[0].points.length > 0 && (
          <TechPanel section="Off-exchange volume" title="Off-exchange share of volume" subtitle="FINRA weekly ATS and non-ATS volume over consolidated volume">
            <div className="px-3 py-2">
              <MultiLine
                series={offSeries}
                label="Weekly off-exchange share of volume"
                format={(v) => `${v.toFixed(0)}%`}
                height={150}
                xFormat={(x) => fmtDate(x, { month: "short", day: "numeric" })}
              />
            </div>
            <Note>
              Weeks are published two to four weeks late.{" "}
              {flows.data?.ats_venues.rows.length
                ? `Largest dark pools in the week of ${fmtDate(flows.data.ats_venues.week ?? "")}: ${flows.data.ats_venues.rows
                    .slice(0, 3)
                    .map((v) => `${v.name} ${pct(v.pct_of_ats, 0)}`)
                    .join(", ")}.`
                : ""}
              {ftd60.length ? ` SEC fails to deliver, last 60 days: peak ${ftdMax[1].toLocaleString()} shares on ${fmtDate(ftdMax[0])}.` : ""}{" "}
              {flows.data?.src_weekly.page && (
                <a href={flows.data.src_weekly.page} target="_blank" rel="noreferrer" className="text-link hover:underline">
                  FINRA OTC transparency ↗
                </a>
              )}
            </Note>
          </TechPanel>
        )}
      </div>
    </div>
  );
}
