import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { count, dayLong, pct, pctTone, ruleNameOf } from "@/lib/signals/format";
import { STRATEGY, type StrategyId } from "@/lib/signals/strategies";
import { cn } from "@/lib/utils";
import { NUM, SECTION_OFFSET, TD, TH } from "./parts";

const n = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const snapshot = z.object({
  asOf: day, benchmarkSha256: z.string().regex(/^[a-f0-9]{64}$/), generatedAt: z.string(),
  population: n, completed: n, eligible: n, historyStart: day.nullable(), oosStart: day,
  scope: z.string(), methodology: z.string(),
  variants: z.array(z.object({
    key: z.string().regex(/^[^:]+:[LS]:[1-9]\d*$/), trades: n, issuers: n, months: n, net: z.number().nullable(),
    positiveMonths: n, hit: z.number().min(0).max(1).nullable(), first: day.nullable(), last: day.nullable(),
  })),
});

async function readSnapshot(signal: AbortSignal) {
  // The managed RPC returns JSONB. Validate its published contract before displaying any metrics.
  const client: Pick<SupabaseClient, "rpc"> = supabase;
  const { data, error } = await client.rpc("read_setup_replay_scoreboard_v1").abortSignal(signal);
  if (error) throw error;
  return data === null ? null : snapshot.parse(data);
}

const preview = 8;

export function HistoricalReplayScoreboard() {
  const [expanded, setExpanded] = useState(false);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["setups", "historical-replay-scoreboard", 1],
    queryFn: ({ signal }) => readSnapshot(signal),
    staleTime: 15 * 60_000, gcTime: 60 * 60_000, retry: 1,
  });

  const rows = [...(data?.variants ?? [])].sort((a, b) => ruleNameOf(a.key).localeCompare(ruleNameOf(b.key), "en", { numeric: true }));
  const trades = rows.reduce((total, row) => total + row.trades, 0);
  return (
    <Panel id="historical-replay" className={SECTION_OFFSET} title="Historical replay scoreboard"
      subtitle={data ? `Frozen through ${dayLong(data.asOf)} · Out-of-sample results from ${dayLong(data.oosStart)}` : undefined}
      collapse={false}>
      {data ? (
        <div className="space-y-3" data-section="Historical replay scoreboard">
          <div className="grid grid-cols-2 divide-x divide-border rounded border bg-card sm:grid-cols-3">
            <div className="px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Issuers in this snapshot</p>
              <p className="num text-lg font-semibold">{count(data.eligible)} <span className="text-xs font-normal text-muted-foreground">of {count(data.population)}</span></p>
              <p className="text-[11px] text-muted-foreground">{count(data.completed)} completed replays across the universe</p>
            </div>
            <div className="px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Out-of-sample rule trades</p>
              <p className="num text-lg font-semibold">{count(trades)}</p>
              <p className="text-[11px] text-muted-foreground">Each rule counts its own trades</p>
            </div>
            <div className="col-span-2 border-t px-3 py-2 sm:col-span-1 sm:border-t-0">
              <p className="text-[11px] text-muted-foreground">Rule variants tested</p>
              <p className="num text-lg font-semibold">{count(rows.length)}</p>
              <p className="text-[11px] text-muted-foreground">{count(rows.filter(r => r.trades > 0).length)} with observed trades</p>
            </div>
          </div>
          <div className="overflow-x-auto" role="region" aria-label="Historical replay outcomes by rule" tabIndex={0}>
            <table className="w-full text-left">
              <caption className="sr-only">Out-of-sample trades by historical rule, listed alphabetically</caption>
              <thead className="border-y bg-muted/30">
                <tr>
                  <th scope="col" className={TH}>Rule and holding period</th>
                  <th scope="col" className={cn(TH, NUM)}>Trades</th>
                  <th scope="col" className={cn(TH, NUM)}>Issuers</th>
                  <th scope="col" className={cn(TH, NUM)}>Net sector excess</th>
                  <th scope="col" className={cn(TH, NUM)}>Positive trades</th>
                  <th scope="col" className={cn(TH, NUM)}>Positive months</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {(expanded ? rows : rows.slice(0, preview)).map(r => {
                  const [strategy, side, hold] = r.key.split(":");
                  return <tr key={r.key}>
                    <th scope="row" className={cn(TD, "min-w-40 text-left font-normal")}>
                      <span className="block font-medium">{STRATEGY[strategy as StrategyId]?.label ?? strategy}</span>
                      <span className="block text-[11px] leading-4 text-muted-foreground">{side === "L" ? "Long" : "Short"} · {hold} trading {hold === "1" ? "day" : "days"}</span>
                    </th>
                    <td className={cn(TD, NUM)} title={r.first && r.last ? `${dayLong(r.first)} to ${dayLong(r.last)}` : undefined}>{count(r.trades)}</td>
                    <td className={cn(TD, NUM)}>{count(r.issuers)}</td>
                    <td className={cn(TD, NUM, "font-medium", pctTone(r.net))}>{pct(r.net)}</td>
                    <td className={cn(TD, NUM)}>{pct(r.hit, 1, false)}</td>
                    <td className={cn(TD, NUM)}>{r.months ? `${count(r.positiveMonths)} / ${count(r.months)}` : "–"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {rows.length > preview && <Button type="button" size="xs" variant="outline" aria-expanded={expanded}
            onClick={() => setExpanded(v => !v)}>{expanded ? "Show fewer rules" : `Show all ${count(rows.length)} rules`}</Button>}
          <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
            Net sector excess is the average return above the sector benchmark after estimated costs, with equal weight for each observed month.
            Positive trades shows the share of individual trades with net sector excess above zero. This historical record describes the covered sample.
          </p>
          <details className="border-t pt-2 text-xs leading-5 text-muted-foreground">
            <summary className="w-fit cursor-pointer font-medium text-foreground">Coverage and calculation</summary>
            <div className="mt-2 max-w-4xl space-y-1">
              <p>{data.scope}</p><p>{data.methodology}</p>
              <p>History begins {dayLong(data.historyStart)} · Snapshot generated {dayLong(data.generatedAt)}</p>
              <p className="break-all">Benchmark SHA-256 <code>{data.benchmarkSha256}</code></p>
            </div>
          </details>
        </div>
      ) : error ? <DataUnavailable compact title="Historical replay could not load" error={error} onRetry={() => void refetch()} />
        : isPending ? <Skeleton className="h-20" aria-label="Loading historical replay" />
          : <p className="text-sm text-muted-foreground">The first verified historical snapshot is pending.</p>}
    </Panel>
  );
}
