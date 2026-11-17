import { useMemo, useState } from "react";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { fmtAlt, type AltRow } from "@/lib/alt/query";
import { STATES } from "@/lib/alt/sod";
import { TRI_FACILITIES, TRI_PAGE, TRI_PRODUCTION, TRI_RELEASES, type TriFacility } from "@/lib/alt/tri";
import { cn } from "@/lib/utils";
import { UsTileMap } from "./us-tile-map";

const lb = (v: number | null | undefined) => (v == null ? "—" : fmtAlt(v, "lbs"));
const chg = (r: number | null | undefined) => (r == null ? "—" : `${r >= 1 ? "+" : ""}${((r - 1) * 100).toFixed(0)}%`);
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Lp|Co)\b/g, (w) => w.toUpperCase());

/**
 * A company's US plants from the EPA Toxics Release Inventory: plants by state, releases,
 * the production index (each plant's reported production this year ÷ last year) and the plant
 * list; every plant opens its EPA page.
 */
export function PlantsTri({ ticker, rows }: { ticker: string; rows: AltRow[] }) {
  const { open } = useSource();
  const years = useMemo(() => [...new Set(rows.map((r) => r.meta?.year as number).filter(Boolean))].sort((a, b) => b - a), [rows]);
  const [year, setYear] = useState<number | null>(null);
  const [st, setSt] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const y = year ?? years[0];
  const get = (t: string, yr: number) => rows.find((r) => r.title === t && r.meta?.year === yr);
  const fac = get(TRI_FACILITIES, y);
  const rel = get(TRI_RELEASES, y);
  const prod = get(TRI_PRODUCTION, y);
  const relPrev = get(TRI_RELEASES, y - 1);
  const facilities = useMemo(() => ((fac?.meta?.facilities ?? []) as TriFacility[]), [fac]);
  const shownAll = st ? facilities.filter((f) => f.state === st) : facilities;
  const shown = all ? shownAll : shownAll.slice(0, 15);
  if (!y || !fac) return null;
  const states = (fac.meta.states ?? []) as { state: string; facilities: number; releases: number }[];
  const chems = (fac.meta.top_chemicals ?? []) as { chemical: string; releases: number }[];
  const relChg = rel?.value != null && relPrev?.value ? rel.value / relPrev.value - 1 : null;
  const src = (f: TriFacility) => open({ ticker, label: `${title(f.name)} (${f.city}, ${f.state}) — EPA TRI ${y}`, unit: "usd", value: 0, external: { url: f.url, date: `${y}-12-31`, quote: `${lb(f.releases)} released · ${f.chemicals} chemicals${f.ratio != null ? ` · production ratio ${f.ratio.toFixed(2)}` : ""}` } });

  return (
    <div className="grid grid-cols-1 gap-4 p-3.5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border text-[12px]">
          <div className="bg-card px-2.5 py-1.5">
            <p className="text-[11px] text-muted-foreground">Plants reporting, {y}</p>
            <p className="num font-semibold">{fac.value} <span className="font-normal text-muted-foreground">in {states.length} states</span></p>
          </div>
          <div className="bg-card px-2.5 py-1.5" title="Median of the plants' reported production ratios (this year's production ÷ last year's, per chemical)">
            <p className="text-[11px] text-muted-foreground">Production index</p>
            <p className="num font-semibold">{prod ? `${prod.value?.toFixed(2)}×` : "—"} {prod && <span className="font-normal text-muted-foreground">{prod.meta.up}↑ {prod.meta.down}↓</span>}</p>
          </div>
          <div className="bg-card px-2.5 py-1.5">
            <p className="text-[11px] text-muted-foreground">Releases</p>
            <p className="num font-semibold">{lb(rel?.value)} {relChg != null && <span className={cn("font-normal", relChg > 0 ? "text-negative" : "text-positive")}>{relChg >= 0 ? "+" : ""}{(relChg * 100).toFixed(0)}%</span>}</p>
          </div>
          <div className="bg-card px-2.5 py-1.5" title="Releases of chemicals EPA lists as carcinogens">
            <p className="text-[11px] text-muted-foreground">Of which carcinogens</p>
            <p className="num font-semibold">{lb(rel?.meta?.carcinogens)}</p>
          </div>
        </div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{st ? <>Showing {STATES[st] ?? st} · <button type="button" className="underline underline-offset-2" onClick={() => setSt(null)}>all states</button></> : "Plants per state · tap to filter the list"}</p>
          {years.length > 1 && (
            <select value={y} onChange={(e) => { setYear(Number(e.target.value)); setSt(null); }} aria-label="Year" className="h-7 rounded-md border bg-background px-2 text-[12px]">
              {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </select>
          )}
        </div>
        <UsTileMap
          values={Object.fromEntries(states.map((s) => [s.state, s.facilities]))}
          label={(s) => { const x = states.find((z) => z.state === s); return x ? String(x.facilities) : null; }}
          title={(s) => { const x = states.find((z) => z.state === s); return x ? `${STATES[s] ?? s}: ${x.facilities} plants · ${lb(x.releases)} released` : `${STATES[s] ?? s}: no reporting plants`; }}
          selected={st}
          onSelect={(s) => setSt((cur) => (cur === s || !states.some((z) => z.state === s) ? null : s))}
        />
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">By year</p>
          <table className="research-table w-full text-[12px]">
            <thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-1.5 py-1 font-medium">Year</th><th className="px-1.5 py-1 text-right font-medium">Plants</th><th className="px-1.5 py-1 text-right font-medium">Releases</th><th className="px-1.5 py-1 text-right font-medium" title="Median plant production ratio">Production</th></tr></thead>
            <tbody>
              {years.map((yr) => {
                const p = get(TRI_PRODUCTION, yr);
                return (
                  <tr key={yr} className={cn("border-b last:border-0", yr === y && "bg-secondary")}>
                    <td className="num px-1.5 py-1"><button type="button" onClick={() => { setYear(yr); setSt(null); }} className="hover:underline">{yr}</button></td>
                    <td className="num px-1.5 text-right">{get(TRI_FACILITIES, yr)?.value ?? "—"}</td>
                    <td className="num px-1.5 text-right">{lb(get(TRI_RELEASES, yr)?.value)}</td>
                    <td className="num px-1.5 text-right">{p ? chg(p.value) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="min-w-0">
        <div className="overflow-x-auto">
          <table className="research-table w-full">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Plant</th>
                <th className="hidden px-2 py-2 font-medium lg:table-cell xl:hidden 2xl:table-cell">Industry</th>
                <th className="px-2 py-2 text-right font-medium">Released</th>
                <th className="px-2 py-2 text-right font-medium" title="The plant's median reported production ratio: this year's production ÷ last year's">Production</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="max-w-[16rem] px-2 py-1.5">
                    <p className="truncate text-[12.5px] font-medium" title={f.name}>{title(f.name)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{title(f.city)}, {f.state}{f.parent && fac.meta.parents?.length > 1 ? ` · ${title(f.parent)}` : ""}</p>
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-2 text-[12px] text-muted-foreground lg:table-cell xl:hidden 2xl:table-cell" title={`NAICS ${f.naics}`}>{f.sector}</td>
                  <td className="num px-2 text-right">{lb(f.releases)}</td>
                  <td className="num px-2 text-right">{chg(f.ratio)}</td>
                  <td className="px-1 text-right"><Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => src(f)}>Source</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shownAll.length > 15 && (
          <Button size="xs" variant="ghost" className="mt-1" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `All ${shownAll.length} plants`}
          </Button>
        )}
        {fac.meta.more > 0 && !st && <p className="mt-1 text-[11px] text-muted-foreground">Plus {fac.meta.more} smaller plants not listed.</p>}
        {chems.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Largest releases by chemical, {y}</p>
            <ul className="grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
              {chems.slice(0, 8).map((c) => (
                <li key={c.chemical} className="flex items-baseline justify-between gap-2 border-b border-dashed py-1">
                  <span className="truncate" title={c.chemical}>{title(c.chemical)}</span>
                  <span className="num shrink-0 text-muted-foreground">{lb(c.releases)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          US plants with 10+ employees that handle listed chemicals above EPA thresholds, under the parent company they report ({(fac.meta.parents ?? []).slice(0, 3).map(title).join("; ")}{fac.meta.parents?.length > 3 ? "…" : ""}). Production is each plant's own ratio of this year's activity to last year's.{" "}
          <a href={rel?.source_url ?? TRI_PAGE} target="_blank" rel="noreferrer" className="underline underline-offset-2">EPA {y} data file</a>
        </p>
      </div>
    </div>
  );
}
