import { useMemo, useState } from "react";
import { EvidenceButton } from "@/components/source/evidence-button";
import { Button } from "@/components/ui/button";
import { fmtAlt, type AltRow } from "@/lib/alt/query";
import { STATES, TOTAL_TITLE } from "@/lib/alt/sod";
import { cn } from "@/lib/utils";
import { UsTileMap } from "./us-tile-map";

export const isStateDeposit = (r: { dataset: string; title: string }) => r.dataset === "deposits" && r.title !== TOTAL_TITLE;

const pct = (v: number | undefined | null, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

/** A bank's deposits by state (FDIC Summary of Deposits): a tile map, the state table and its largest metro areas. */
export function DepositsByState({ ticker, rows }: { ticker: string; rows: AltRow[] }) {
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const v = useMemo(() => {
    const years = [...new Set(rows.map((r) => r.meta?.year as number).filter(Boolean))].sort((a, b) => b - a);
    const y = years[0];
    const y0 = years.find((x) => x <= y - 5) ?? years[years.length - 1];
    const at = (year: number) => new Map(rows.filter((r) => r.meta?.year === year && isStateDeposit(r)).map((r) => [r.meta.state as string, r]));
    const now = at(y);
    const then = y0 !== y ? at(y0) : new Map<string, AltRow>();
    const total = rows.find((r) => r.title === TOTAL_TITLE && r.meta?.year === y);
    const totalThen = rows.find((r) => r.title === TOTAL_TITLE && r.meta?.year === y0);
    const states = [...now.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return { y, y0, now, then, total, totalThen, states };
  }, [rows]);
  if (!v.y || !v.states.length) return null;
  const { y, y0, now, then, total, totalThen, states } = v;
  const shown = all ? states : states.slice(0, 12);
  const metros = (total?.meta?.metros ?? []) as { name: string; value: number; branches: number; share: number }[];
  const growth = total && totalThen && y0 !== y ? (total.value ?? 0) / (totalThen.value ?? 1) - 1 : null;
  const pick = sel ? now.get(sel) : null;

  return (
    <div className="grid grid-cols-1 gap-4 p-3.5 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-[12px]">
          <div className="bg-card px-2.5 py-1.5"><p className="text-[11px] text-muted-foreground">Branch deposits, Jun {y}</p><p className="num font-semibold">{fmtAlt(total?.value ?? null, "USD")}</p></div>
          <div className="bg-card px-2.5 py-1.5"><p className="text-[11px] text-muted-foreground">States · branches</p><p className="num font-semibold">{total?.meta?.states ?? states.length} · {(total?.meta?.branches ?? 0).toLocaleString()}</p></div>
          <div className="bg-card px-2.5 py-1.5"><p className="text-[11px] text-muted-foreground">Since Jun {y0}</p><p className={cn("num font-semibold", growth != null && growth < 0 && "text-negative")}>{growth == null ? "—" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`}</p></div>
        </div>
        <UsTileMap
          values={Object.fromEntries(states.map((r) => [r.meta.state, r.meta.share ?? 0]))}
          label={(st) => (now.get(st) ? pct(now.get(st)!.meta.share, 0) : null)}
          title={(st) => {
            const r = now.get(st);
            return r ? `${STATES[st] ?? st}: ${fmtAlt(r.value, "USD")} · ${pct(r.meta.share)} of the bank's deposits · ${pct(r.meta.market_share)} of the state's · ${r.meta.branches} branches` : `${STATES[st] ?? st}: no branches`;
          }}
          selected={sel}
          onSelect={(st) => setSel((s) => (s === st ? null : st))}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {pick ? (
            <>
              <span className="font-medium text-foreground">{STATES[pick.meta.state] ?? pick.meta.state}</span>: {fmtAlt(pick.value, "USD")} in {pick.meta.branches} branches — {pct(pick.meta.share)} of the bank's deposits and {pct(pick.meta.market_share)} of all deposits in the state.
            </>
          ) : (
            "Shaded by each state's share of the bank's branch deposits. Tap a state for detail."
          )}
        </p>
      </div>
      <div className="min-w-0">
        <div className="overflow-x-auto">
          <table className="research-table w-full">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">State</th>
                <th className="px-2 py-2 text-right font-medium">Deposits</th>
                <th className="px-2 py-2 text-right font-medium" title="Share of the bank's branch deposits">Of bank</th>
                <th className="px-2 py-2 text-right font-medium" title="Share of all FDIC-insured deposits in the state">Of state</th>
                <th className="px-2 py-2 text-right font-medium">Branches</th>
                <th className="px-2 py-2 text-right font-medium">vs {y0}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const old = then.get(r.meta.state);
                const g = old?.value ? (r.value ?? 0) / old.value - 1 : null;
                return (
                  <tr key={r.uid} className={cn("border-b last:border-0", sel === r.meta.state && "bg-secondary")} onMouseEnter={() => setSel(r.meta.state)}>
                    <td className="px-2 py-1.5"><span className="num font-medium">{r.meta.state}</span> <span className="text-[11px] text-muted-foreground">{STATES[r.meta.state]}</span></td>
                    <td className="num px-2 text-right">{fmtAlt(r.value, "USD")}</td>
                    <td className="num px-2 text-right">{pct(r.meta.share)}</td>
                    <td className="num px-2 text-right">{pct(r.meta.market_share)}</td>
                    <td className="num px-2 text-right">{r.meta.branches?.toLocaleString()}</td>
                    <td className={cn("num px-2 text-right", g == null ? "text-muted-foreground" : g < 0 ? "text-negative" : "")}>{g == null ? (old ? "—" : "new") : `${g >= 0 ? "+" : ""}${(g * 100).toFixed(0)}%`}</td>
                    <td className="px-1 text-right">{r.source_url && <EvidenceButton ticker={ticker} title={`${ticker} deposits in ${STATES[r.meta.state] ?? r.meta.state}, June ${y}`} url={r.source_url} date={r.date ?? undefined} />}</td>
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
        {metros.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Largest metro areas, Jun {y}</p>
            <ul className="grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
              {metros.slice(0, 10).map((m) => (
                <li key={m.name} className="flex items-baseline justify-between gap-2 border-b border-dashed py-1">
                  <span className="truncate" title={m.name}>{m.name}</span>
                  <span className="num shrink-0 text-muted-foreground">{fmtAlt(m.value, "USD")} · {pct(m.share, 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
