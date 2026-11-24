import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { coverageOf } from "@/lib/coverage";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSource } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import { rankRegion, regionCounts, regionName, type ExposureIndex, type RegionExposure } from "@/lib/xbrl/exposure";
import { useSessionState } from "@/lib/use-session-state";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fy, median, ratioTarget, valTarget } from "./open";

type Col = "share" | "value" | "change" | "total" | "t";
interface Row {
  ticker: string;
  name: string;
  sector: string;
  r: RegionExposure;
  change: number | null;
}

const CHIPS = 14;
const PAGE = 60;

export function RegionExposures({ index }: { index: ExposureIndex }) {
  const uni = useUniverse();
  const { open } = useSource();
  const counts = useMemo(() => regionCounts(index), [index]);
  const [region, setRegion] = useSessionState("fu:exposures:region", "china");
  const [sector, setSector] = useSessionState("fu:exposures:sector", "all");
  const [sort, setSort] = useState<{ c: Col; d: 1 | -1 }>({ c: "share", d: -1 });
  const [all, setAll] = useState(false);
  const key = counts.some((c) => c.key === region) ? region : (counts[0]?.key ?? "us");

  const byTk = useMemo(() => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c])), [uni.data]);
  const sectors = useMemo(() => [...new Set((uni.data?.companies ?? []).map((c) => c.sector).filter(Boolean))].sort(), [uni.data]);

  const rows = useMemo<Row[]>(() => {
    const out = rankRegion(index, key).map(({ ticker, r }) => {
      const u = byTk.get(ticker);
      return { ticker, name: u?.name ?? ticker, sector: u?.sector ?? "", r, change: r.prior ? r.share - r.prior.share : null };
    });
    const f = sector === "all" ? out : out.filter((x) => x.sector === sector);
    const v = (x: Row): number | string | null => (sort.c === "t" ? x.ticker : sort.c === "share" ? x.r.share : sort.c === "value" ? x.r.value.v : sort.c === "total" ? x.r.total.v : x.change);
    return [...f].sort((a, b) => {
      const va = v(a);
      const vb = v(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.d;
    });
  }, [index, key, byTk, sector, sort]);

  const shown = all ? rows : rows.slice(0, PAGE);
  const med = median(rows.map((x) => x.r.share));
  const sum = rows.reduce((n, x) => n + x.r.value.v, 0);
  const top = [...rows].sort((a, b) => b.r.value.v - a.r.value.v)[0];
  const moved = rows.filter((x) => x.change != null);
  const up = moved.filter((x) => x.change! > 0.005).length;
  const down = moved.filter((x) => x.change! < -0.005).length;

  const Th = ({ c, children, className, title }: { c: Col; children: React.ReactNode; className?: string; title?: string }) => (
    <th aria-sort={sort.c === c ? (sort.d === 1 ? "ascending" : "descending") : "none"} className={cn("sticky top-0 z-20 border-b bg-card px-3 py-2 text-right align-bottom", className)}>
      <button type="button" title={title} onClick={() => setSort((s) => ({ c, d: s.c === c ? (-s.d as 1 | -1) : c === "t" ? 1 : -1 }))} className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground hover:text-foreground">
        {children}
        {sort.c === c && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="mt-4 min-w-0" data-section="Revenue by region">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {counts.slice(0, CHIPS).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setRegion(c.key);
              setAll(false);
            }}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs", c.key === key ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            {regionName(c.key)} <span className="opacity-60">{c.n}</span>
          </button>
        ))}
        {counts.length > CHIPS && (
          <Select value={counts.slice(0, CHIPS).some((c) => c.key === key) ? "" : key} onValueChange={(v) => setRegion(v)}>
            <SelectTrigger aria-label="More regions" className="h-7 w-44 text-xs">
              <SelectValue placeholder={`${counts.length - CHIPS} more regions`} />
            </SelectTrigger>
            <SelectContent>
              {counts.slice(CHIPS).map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {regionName(c.key)} · {c.n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger aria-label="Sector" className="ml-auto h-7 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4">
        <Stat label={`Companies breaking out ${regionName(key)}`} value={String(rows.length)} />
        <Stat label="Median share of revenue" value={fmtPct(med)} />
        <Stat label="Revenue there, combined" value={fmtCompactUsd(sum)} hint={top ? `largest: ${top.ticker} ${fmtCompactUsd(top.r.value.v)}` : undefined} />
        <Stat label="Share vs ~3 years earlier" value={moved.length ? `${up} up · ${down} down` : "–"} hint={moved.length ? `of ${moved.length} with an earlier year` : undefined} />
      </div>

      {!rows.length ? (
        <p className="rounded-md border bg-card p-6 text-sm text-muted-foreground">No company in this sector breaks out {regionName(key)} in its 10-K.</p>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-paper">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r bg-card px-3 py-2 text-left">
                    <button type="button" onClick={() => setSort((s) => ({ c: "t", d: s.c === "t" ? (-s.d as 1 | -1) : 1 }))} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Company
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 border-b bg-card px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">As filed</th>
                  <Th c="value">Revenue</Th>
                  <Th c="share" className="w-56">Share of revenue</Th>
                  <Th c="change" title="Change in share, in percentage points, vs about three years earlier (from the earlier 10-K)">vs ~3 yrs ago</Th>
                  <Th c="total">Total revenue</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => {
                  const p = fy(x.r.value.parts[0].end);
                  return (
                    <tr key={x.ticker} className="group">
                      <td className="sticky left-0 z-10 max-w-52 border-b border-r bg-card px-3 py-1 group-hover:bg-secondary">
                        <span className="flex items-center gap-2">
                          <CompanyLogo ticker={x.ticker} className="size-5" />
                          <Link to="/app/companies/$ticker/financials" params={{ ticker: x.ticker }} search={{ basis: "detail" }} className="num font-medium hover:underline">
                            {x.ticker}
                          </Link>
                          <span className="hidden truncate text-[13px] text-muted-foreground sm:inline" title={`${x.name}${x.sector ? ` · ${x.sector}` : ""}`}>
                            {coverageOf(x.ticker)?.shortName ?? x.name}
                          </span>
                        </span>
                      </td>
                      <td className="max-w-48 truncate whitespace-nowrap border-b px-3 py-1 text-xs text-muted-foreground group-hover:bg-secondary" title={x.r.label}>
                        {x.r.label} <span className="opacity-70">· {x.r.period}</span>
                      </td>
                      <td className="border-b px-3 py-1 text-right group-hover:bg-secondary">
                        <button type="button" className="num whitespace-nowrap tabular-nums hover:underline" onClick={() => open(valTarget(x.ticker, `${x.r.label} revenue`, p, x.r.value))}>
                          {fmtCompactUsd(x.r.value.v)}
                        </button>
                      </td>
                      <td className="border-b px-3 py-1 group-hover:bg-secondary">
                        <button type="button" className="flex w-full items-center justify-end gap-2" onClick={() => open(ratioTarget(x.ticker, `${x.r.label} share of revenue`, p, x.r.value, x.r.total, `${x.r.label} revenue ÷ total revenue`, x.r.share))}>
                          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
                            <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, x.r.share * 100)}%` }} />
                          </span>
                          <span className="num w-12 text-right tabular-nums hover:underline">{fmtPct(x.r.share)}</span>
                        </button>
                      </td>
                      <td className="border-b px-3 py-1 text-right group-hover:bg-secondary">
                        {x.r.prior ? (
                          <button
                            type="button"
                            title={`${x.r.prior.period}: ${fmtPct(x.r.prior.share)} of revenue`}
                            className={cn("num whitespace-nowrap tabular-nums hover:underline", x.change! > 0.005 ? "text-positive" : x.change! < -0.005 ? "text-negative" : "text-muted-foreground")}
                            onClick={() => open(ratioTarget(x.ticker, `${x.r.label} share of revenue`, x.r.prior!.period, x.r.prior!.value, x.r.prior!.total, `${x.r.label} revenue ÷ total revenue`, x.r.prior!.share))}
                          >
                            {x.change! >= 0 ? "+" : "−"}
                            {Math.abs(x.change! * 100).toFixed(1)} pts
                          </button>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                      <td className="border-b px-3 py-1 text-right group-hover:bg-secondary">
                        <button type="button" className="num tabular-nums text-muted-foreground hover:text-foreground hover:underline" onClick={() => open(valTarget(x.ticker, "Total revenue", p, x.r.total))}>
                          {fmtCompactUsd(x.r.total.v)}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE && (
            <div className="border-t px-3 py-2 text-center">
              <Button size="xs" variant="ghost" onClick={() => setAll((a) => !a)}>
                {all ? "Show fewer" : `Show all ${rows.length}`}
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Each company names its own regions, so "{regionName(key)}" collects the filed names that mean it (shown under As filed). Shares use the same table's consolidated total; "other" and "rest of world" lines are left out.
      </p>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="num text-base font-semibold tabular-nums">{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
