import { useMemo, useState } from "react";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtAlt, type AltRow } from "@/lib/alt/query";
import { GEO_PAGE, GEO_TOTAL, type GeoDrug } from "@/lib/alt/medicare-geo";
import { STATES } from "@/lib/alt/sod";
import { cn } from "@/lib/utils";
import { UsTileMap } from "./us-tile-map";

const pct = (v: number | undefined | null, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v > 0 && v < 0.0005 && d <= 1 ? "<0.1%" : `${(v * 100).toFixed(d)}%`);
const idx = (v: number | undefined | null) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}×`);

/**
 * A drug maker's Medicare Part D drug costs by prescriber state (CMS): tile map by share of the
 * company's costs or by index against Medicare overall, the state table with each state's top
 * drugs, and the company's largest drugs. Every figure opens its CMS record.
 */
export function MedicareByState({ ticker, rows }: { ticker: string; rows: AltRow[] }) {
  const { open } = useSource();
  const years = useMemo(() => [...new Set(rows.map((r) => r.meta?.year as number).filter(Boolean))].sort((a, b) => b - a), [rows]);
  const [year, setYear] = useState<number | null>(null);
  const [mode, setMode] = useState<"share" | "index">("share");
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const y = year ?? years[0];
  const y0 = years[years.length - 1];
  const v = useMemo(() => {
    const at = (yr: number) => new Map(rows.filter((r) => r.meta?.year === yr && r.title !== GEO_TOTAL).map((r) => [r.meta.state as string, r]));
    const now = at(y);
    const then = y0 !== y ? at(y0) : new Map<string, AltRow>();
    const total = rows.find((r) => r.title === GEO_TOTAL && r.meta?.year === y);
    const totalThen = rows.find((r) => r.title === GEO_TOTAL && r.meta?.year === y0);
    const states = [...now.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return { now, then, total, totalThen, states };
  }, [rows, y, y0]);
  if (!y || !v.states.length) return null;
  const { now, then, total, totalThen, states } = v;
  const shown = all ? states : states.slice(0, 12);
  const growth = total && totalThen && y0 !== y && totalThen.value ? (total.value ?? 0) / totalThen.value - 1 : null;
  const pick = sel ? now.get(sel) : null;
  const drugs = (total?.meta?.top_drugs ?? []) as GeoDrug[];
  const src = (label: string, value: number | null, url: string | null) =>
    url && open({ ticker, label, unit: "usd", value: value ?? 0, external: { url, date: `${y}-12-31` } });
  const meaningful = states.filter((r) => (r.meta.share ?? 0) >= 0.005);
  const over = [...meaningful].sort((a, b) => (b.meta.index ?? 0) - (a.meta.index ?? 0));

  return (
    <div className="grid grid-cols-1 gap-4 p-3.5 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-[12px]">
          <div className="bg-card px-2.5 py-1.5">
            <p className="text-[11px] text-muted-foreground">Part D drug costs, {y}</p>
            <p className="num font-semibold">{fmtAlt(total?.value ?? null, "USD")}</p>
          </div>
          <div className="bg-card px-2.5 py-1.5" title="Share of the company's Part D spending in CMS's Spending by Drug file that this state view covers (brands its own labelers hold ≥95% of)">
            <p className="text-[11px] text-muted-foreground">Brands · coverage</p>
            <p className="num font-semibold">{total?.meta?.drugs ?? "—"} · {pct(total?.meta?.coverage, 0)}</p>
          </div>
          <div className="bg-card px-2.5 py-1.5">
            <p className="text-[11px] text-muted-foreground">Since {y0}</p>
            <p className={cn("num font-semibold", growth != null && growth < 0 && "text-negative")}>{growth == null ? "—" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(0)}%`}</p>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup type="single" value={mode} onValueChange={(m) => m && setMode(m as typeof mode)} className="justify-start gap-1" aria-label="Map shading">
            <ToggleGroupItem value="share" size="sm" className="h-7 px-2.5 text-xs">Share of company</ToggleGroupItem>
            <ToggleGroupItem value="index" size="sm" className="h-7 px-2.5 text-xs">vs Medicare overall</ToggleGroupItem>
          </ToggleGroup>
          {years.length > 1 && (
            <select value={y} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="h-7 rounded-md border bg-background px-2 text-[12px]">
              {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </select>
          )}
        </div>
        <UsTileMap
          values={Object.fromEntries(states.map((r) => [r.meta.state, mode === "share" ? r.meta.share ?? 0 : r.meta.index ?? 0]))}
          diverge={mode === "index" ? 1 : undefined}
          label={(st) => {
            const r = now.get(st);
            if (!r) return null;
            return mode === "share" ? (r.meta.share < 0.005 ? "<1%" : pct(r.meta.share, 0)) : r.meta.index != null ? r.meta.index.toFixed(1) : null;
          }}
          title={(st) => {
            const r = now.get(st);
            return r ? `${STATES[st] ?? st}: ${fmtAlt(r.value, "USD")} · ${pct(r.meta.share)} of the company's Part D costs · ${pct(r.meta.market_share, 2)} of all Part D costs in the state · ${idx(r.meta.index)} Medicare overall` : `${STATES[st] ?? st}: no prescriptions of its brands`;
          }}
          selected={sel}
          onSelect={(st) => setSel((s) => (s === st ? null : st))}
        />
        <div className="mt-2 text-[11px] text-muted-foreground">
          {pick ? (
            <div>
              <p>
                <span className="font-medium text-foreground">{STATES[pick.meta.state] ?? pick.meta.state}</span>: {fmtAlt(pick.value, "USD")} — {pct(pick.meta.share)} of the company's Part D costs and {pct(pick.meta.market_share, 2)} of all Part D drug costs prescribed there; {idx(pick.meta.index)} its weight in Medicare overall.
              </p>
              <ul className="mt-1 space-y-0.5">
                {(pick.meta.drugs as GeoDrug[] | undefined)?.map((d) => (
                  <li key={d.brand} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{d.brand} <span className="text-muted-foreground">({d.generic})</span></span>
                    <button type="button" className="num shrink-0 underline decoration-dotted underline-offset-2 hover:text-foreground" onClick={() => src(`${ticker} ${d.brand} Part D costs in ${STATES[pick.meta.state] ?? pick.meta.state}, ${y}`, d.value, d.url)}>{fmtAlt(d.value, "USD")}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : mode === "share" ? (
            "Shaded by each state's share of the company's Part D drug costs. Tap a state for its drugs."
          ) : (
            <>
              <span className="text-chart-1">Blue</span>: its drugs make up more of the state's Medicare prescriptions than of Medicare overall; <span className="text-chart-2">amber</span>: less. Tap a state for its drugs.
            </>
          )}
        </div>
        {over.length > 6 && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">Most over-indexed</p>
              {over.slice(0, 4).map((r) => <p key={r.uid} className="flex justify-between border-b border-dashed py-0.5"><span>{STATES[r.meta.state] ?? r.meta.state}</span><span className="num">{idx(r.meta.index)}</span></p>)}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">Most under-indexed</p>
              {over.slice(-4).reverse().map((r) => <p key={r.uid} className="flex justify-between border-b border-dashed py-0.5"><span>{STATES[r.meta.state] ?? r.meta.state}</span><span className="num">{idx(r.meta.index)}</span></p>)}
            </div>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="overflow-x-auto">
          <table className="research-table w-full">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">State</th>
                <th className="px-2 py-2 text-right font-medium">Part D costs</th>
                <th className="px-2 py-2 text-right font-medium" title="Share of the company's Part D drug costs">Of company</th>
                <th className="px-2 py-2 text-right font-medium" title="Share of all Part D drug costs prescribed in the state">Of state</th>
                <th className="px-2 py-2 text-right font-medium" title="State's share of the company's costs ÷ state's share of all Part D costs">Index</th>
                <th className="px-2 py-2 text-right font-medium">vs {y0}</th>
                <th className="hidden px-2 py-2 font-medium md:table-cell">Largest drug</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const old = then.get(r.meta.state);
                const g = old?.value && y0 !== y ? (r.value ?? 0) / old.value - 1 : null;
                const top = (r.meta.drugs as GeoDrug[] | undefined)?.[0];
                return (
                  <tr key={r.uid} className={cn("border-b last:border-0", sel === r.meta.state && "bg-secondary")} onMouseEnter={() => setSel(r.meta.state)}>
                    <td className="px-2 py-1.5"><span className="num font-medium">{r.meta.state}</span> <span className="hidden text-[11px] text-muted-foreground sm:inline">{STATES[r.meta.state]}</span></td>
                    <td className="num px-2 text-right">
                      <button type="button" className="underline decoration-dotted underline-offset-2" onClick={() => src(`${ticker} Part D costs in ${STATES[r.meta.state] ?? r.meta.state}, ${y} (largest drug's record)`, r.value, r.source_url)}>{fmtAlt(r.value, "USD")}</button>
                    </td>
                    <td className="num px-2 text-right">{pct(r.meta.share)}</td>
                    <td className="num px-2 text-right">{pct(r.meta.market_share, 2)}</td>
                    <td className={cn("num px-2 text-right", r.meta.index > 1.15 ? "text-chart-1" : r.meta.index < 0.87 ? "text-chart-2" : "")}>{idx(r.meta.index)}</td>
                    <td className={cn("num px-2 text-right", g != null && g < 0 && "text-negative")} title={old?.value != null ? `${y0}: ${fmtAlt(old.value, "USD")}` : undefined}>{g == null ? (y0 === y ? "—" : "new") : `${g >= 0 ? "+" : ""}${(g * 100).toFixed(0)}%`}</td>
                    <td className="hidden max-w-[11rem] truncate px-2 text-[12px] text-muted-foreground md:table-cell" title={top ? `${top.brand} (${top.generic}) ${fmtAlt(top.value, "USD")}` : undefined}>{top?.brand ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {states.length > 12 && (
          <Button size="xs" variant="ghost" className="mt-1" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `All ${states.length} states`}
          </Button>
        )}
        {drugs.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Largest drugs nationally, {y}</p>
            <ul className="grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
              {drugs.slice(0, 8).map((d) => (
                <li key={d.brand + d.generic} className="flex items-baseline justify-between gap-2 border-b border-dashed py-1">
                  <span className="truncate" title={`${d.brand} (${d.generic})`}>{d.brand}</span>
                  <button type="button" className="num shrink-0 text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground" onClick={() => src(`${ticker} ${d.brand} Part D costs, ${y}`, d.value, d.url)}>{fmtAlt(d.value, "USD")}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Gross drug costs before rebates, placed by the prescriber's state (not the patient's). Counts only brands whose labelers belong to the company for at least 95% of their Part D spending, so multi-source generics are left out.{" "}
          <a href={GEO_PAGE} target="_blank" rel="noreferrer" className="underline underline-offset-2">CMS dataset</a>
        </p>
      </div>
    </div>
  );
}
