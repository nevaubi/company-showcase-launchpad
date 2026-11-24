import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader, Panel } from "@/components/app/page-header";
import { TickerMark } from "@/components/app/ticker";
import { EquityChart, rulesSummary } from "@/components/autopilot/shared";
import { BotStrip } from "@/components/signals/bot-strip";
import { NUM, SideTag, TD, TH } from "@/components/signals/parts";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { fmtPrice } from "@/lib/format";
import { parseRules, type Position } from "@/lib/signals/bots";
import { dayLong, dayShort, holdLabel, nameOf, pct, price } from "@/lib/signals/format";
import { botDetailQuery } from "@/lib/signals/queries";
import { STRATEGY, type StrategyId } from "@/lib/signals/strategies";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/autopilots/$botId")({
  head: () => ({
    meta: [
      { title: "Autopilot positions and trades · FiledUnder" },
      { name: "description", content: "Open paper positions, queued orders, closed trades and the equity curve of one paper autopilot against the S&P 500." },
      { property: "og:title", content: "Autopilot positions and trades · FiledUnder" },
      { property: "og:description", content: "Daily-updated paper trading results for a rule-based short-term autopilot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BotPage,
});

const strategyName = (s: string) => STRATEGY[s as StrategyId]?.label ?? s;
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "text-positive" : "text-negative");

/** Logo, symbol and name in one 28 px cell; the name is dropped on a phone so the figures stay in reach. */
function Stock({ p }: { p: Position }) {
  return (
    <>
      <TickerMark ticker={p.ticker} className="align-top sm:hidden" />
      <TickerMark ticker={p.ticker} name={nameOf(p.ticker) ?? p.name ?? undefined} className="hidden align-top sm:inline-flex" />
    </>
  );
}

function BotPage() {
  const { botId } = Route.useParams();
  const { data, isLoading, error, refetch } = useQuery(botDetailQuery(botId));
  const [uid, setUid] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setUid(u.user?.id ?? null));
  }, []);
  const refresh = () => qc.invalidateQueries({ queryKey: ["autopilots"] });
  const own = !!data?.bot?.user_id && data.bot.user_id === uid;

  const toggle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("paper_bots").update({ status: data!.bot!.status === "active" ? "paused" : "active" }).eq("id", botId);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const reset = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reset_paper_bot", { _bot: botId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Autopilot reset. It starts again with tonight's signals.");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("paper_bots").delete().eq("id", botId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Autopilot deleted");
      refresh();
      navigate({ to: "/app/autopilots" });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const closePos = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("request_bot_close", { _position: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("It will close at the next session's close (queued orders are cancelled)");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (error) return <DataUnavailable title="This autopilot could not load" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-20" /><Skeleton className="h-56" /></div>;
  if (!data.bot) return <p className="text-sm text-muted-foreground">This autopilot doesn't exist or isn't shared with you. <Link to="/app/autopilots" className="underline">Back to autopilots</Link></p>;
  const bot = data.bot;
  const rules = parseRules(bot.rules);
  const open = data.positions.filter((p) => p.status === "open");
  const pending = data.positions.filter((p) => p.status === "pending");
  const closed = data.positions.filter((p) => p.status === "closed").sort((a, b) => (b.exit_date ?? "").localeCompare(a.exit_date ?? ""));
  const cancelled = data.positions.filter((p) => p.status === "cancelled");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<Link to="/app/autopilots" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="h-3 w-3" aria-hidden /> Autopilots</Link>}
        title={bot.name}
        description={bot.description ?? undefined}
        actions={
          <>
            <span className={cn("inline-flex h-[18px] items-center rounded border px-1.5 text-[11px] leading-none", bot.status === "active" ? "border-positive/50 text-positive" : "text-muted-foreground")}>{bot.status === "active" ? "Running" : "Paused"}</span>
            <span className="text-[11px] text-muted-foreground">{bot.last_as_of ? `Updated through ${dayLong(bot.last_as_of)}` : "Starts after the next close"} · {bot.user_id ? "yours" : "house autopilot"}</span>
            {own && (
              <>
                <Button size="xs" variant="outline" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
                  {bot.status === "active" ? <><Pause aria-hidden /> Pause</> : <><Play aria-hidden /> Resume</>}
                </Button>
                <Confirm title="Reset this autopilot?" body="All its positions, trades and equity history are deleted and it starts again from its starting capital." action="Reset" onConfirm={() => reset.mutate()}>
                  <Button size="xs" variant="ghost"><RotateCcw aria-hidden /> Reset</Button>
                </Confirm>
                <Confirm title="Delete this autopilot?" body="Its positions, trades and history are deleted. This can't be undone." action="Delete" onConfirm={() => remove.mutate()}>
                  <Button size="xs" variant="ghost" className="text-negative"><Trash2 aria-hidden /> Delete</Button>
                </Confirm>
              </>
            )}
          </>
        }
      />
      {bot.last_error && <p className="rounded border px-3 py-2 text-[11px] leading-4 text-negative">{bot.last_error}</p>}

      <BotStrip capital={Number(bot.capital)} equity={data.equity} closed={closed} open={open.length + pending.length} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Equity against the S&P 500" subtitle="Both rebased to 100 on the first day and marked at each close" collapse={false}>
          <div data-section="Equity curve"><EquityChart capital={Number(bot.capital)} equity={data.equity} /></div>
        </Panel>
        <Panel title="Rules" subtitle={`Started ${dayLong(bot.started_on)} with ${fmtPrice(Number(bot.capital))}`} collapse={false}>
          <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5" data-section="Rules">
            {rulesSummary(bot.rules).map((r) => <li key={r}>{r}</li>)}
            <li className="text-muted-foreground">Signals are queued after the close and filled at the next open. Trading costs and short borrow are charged on each exit.</li>
          </ul>
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Each rule's evidence is on the <Link to="/app/setups" className="underline underline-offset-2">setups scoreboard</Link>.</p>
        </Panel>
      </div>

      <Panel title="Open positions" subtitle={open.length ? `${open.length} open, marked at the latest close` : "None open"} collapse={false}>
        {open.length ? (
          <div className="-mx-3.5 overflow-x-auto" data-section="Open positions">
            <table className="w-full min-w-[620px] border-collapse sm:min-w-[860px]">
              <thead>
                <tr className="border-b">
                  <th scope="col" className={cn(TH, "pl-3.5")}>Stock</th>
                  <th scope="col" className={TH}>Side</th>
                  <th scope="col" className={TH}>Rule</th>
                  <th scope="col" className={cn(TH, "text-right")}>Hold</th>
                  <th scope="col" className={cn(TH, "text-right")}>Entered</th>
                  <th scope="col" className={cn(TH, "text-right")}>Entry</th>
                  <th scope="col" className={cn(TH, "text-right")}>Last</th>
                  <th scope="col" className={cn(TH, "text-right")}>Return</th>
                  <th scope="col" className={cn(TH, "text-right")}>Size</th>
                  {rules.exits === "stops" && <th scope="col" className={cn(TH, "text-right")}>Stop</th>}
                  {rules.exits === "stops" && <th scope="col" className={cn(TH, "text-right")}>Target</th>}
                  <th className={cn(TH, "pr-3.5")} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {open.map((p) => {
                  const last = data.last.get(p.ticker);
                  const ret = last && p.entry_price ? (p.side * (last.close - p.entry_price)) / p.entry_price : null;
                  return (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className={cn(TD, "max-w-[15rem] pl-3.5")}><Stock p={p} /></td>
                      <td className={TD}><SideTag side={p.side} /></td>
                      <td className={cn(TD, "whitespace-nowrap")}>{strategyName(p.strategy)}{p.close_requested ? <span className="text-muted-foreground"> · closing at the next close</span> : null}</td>
                      <td className={cn(TD, "whitespace-nowrap text-right text-muted-foreground")}>{holdLabel(p.horizon)}</td>
                      <td className={cn(TD, NUM, "text-muted-foreground")}>{dayShort(p.entry_date)}</td>
                      <td className={cn(TD, NUM)}>{price(p.entry_price)}</td>
                      <td className={cn(TD, NUM)}>{price(last?.close)}</td>
                      <td className={cn(TD, NUM, tone(ret))}>{pct(ret)}</td>
                      <td className={cn(TD, NUM, "text-muted-foreground")}>{fmtPrice(p.notional)}</td>
                      {rules.exits === "stops" && <td className={cn(TD, NUM)}>{price(p.stop)}</td>}
                      {rules.exits === "stops" && <td className={cn(TD, NUM)}>{price(p.target)}</td>}
                      <td className={cn(TD, "py-0 pr-3.5 text-right")}>
                        {own && !p.close_requested && <Button size="xs" variant="ghost" onClick={() => closePos.mutate(p.id!)} disabled={closePos.isPending}><X aria-hidden /> Close</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] leading-5 text-muted-foreground" data-section="Open positions">{pending.length ? "Orders are queued for the next open." : bot.status === "active" ? "Waiting for signals that match the rules." : "Paused: no new positions."}</p>
        )}
      </Panel>

      {pending.length > 0 && (
        <Panel title="Queued for the next open" subtitle="From the latest close's signals" collapse={false}>
          <div className="-mx-3.5 overflow-x-auto" data-section="Queued orders">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th scope="col" className={cn(TH, "pl-3.5")}>Stock</th>
                  <th scope="col" className={TH}>Side</th>
                  <th scope="col" className={TH}>Rule</th>
                  <th scope="col" className={cn(TH, "text-right")}>Hold</th>
                  <th scope="col" className={cn(TH, "text-right")}>Signal</th>
                  <th scope="col" className={cn(TH, "text-right")}>Signal close</th>
                  <th className={cn(TH, "pr-3.5")} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0">
                    <td className={cn(TD, "max-w-[15rem] pl-3.5")}><Stock p={p} /></td>
                    <td className={TD}><SideTag side={p.side} /></td>
                    <td className={cn(TD, "whitespace-nowrap")}>{strategyName(p.strategy)}</td>
                    <td className={cn(TD, "whitespace-nowrap text-right text-muted-foreground")}>{holdLabel(p.horizon)}</td>
                    <td className={cn(TD, NUM, "text-muted-foreground")}>{dayShort(p.signal_date)}</td>
                    <td className={cn(TD, NUM)}>{price(p.signal_price)}</td>
                    <td className={cn(TD, "py-0 pr-3.5 text-right")}>{own && !p.close_requested && <Button size="xs" variant="ghost" onClick={() => closePos.mutate(p.id!)}><X aria-hidden /> Cancel</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Closed trades" subtitle={closed.length ? `${closed.length} trades, returns after costs` : "None yet"} collapse={false}>
        {closed.length ? (
          <div className="-mx-3.5 overflow-x-auto" data-section="Closed trades">
            <table className="w-full min-w-[620px] border-collapse sm:min-w-[900px]">
              <thead>
                <tr className="border-b">
                  <th scope="col" className={cn(TH, "pl-3.5")}>Stock</th>
                  <th scope="col" className={TH}>Side</th>
                  <th scope="col" className={TH}>Rule</th>
                  <th scope="col" className={cn(TH, "text-right")}>Entered</th>
                  <th scope="col" className={cn(TH, "text-right")}>Exited</th>
                  <th scope="col" className={cn(TH, "text-right")}>Entry</th>
                  <th scope="col" className={cn(TH, "text-right")}>Exit</th>
                  <th scope="col" className={TH}>Why it closed</th>
                  <th scope="col" className={cn(TH, "text-right")}>Profit</th>
                  <th scope="col" className={cn(TH, "text-right")}>Return</th>
                  <th scope="col" className={cn(TH, "pr-3.5 text-right")} title="The S&P 500 over the same days">S&P 500</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0">
                    <td className={cn(TD, "max-w-[15rem] pl-3.5")}><Stock p={p} /></td>
                    <td className={TD}><SideTag side={p.side} /></td>
                    <td className={cn(TD, "whitespace-nowrap")}>{strategyName(p.strategy)}</td>
                    <td className={cn(TD, NUM, "text-muted-foreground")}>{dayShort(p.entry_date)}</td>
                    <td className={cn(TD, NUM, "text-muted-foreground")}>{dayShort(p.exit_date)}</td>
                    <td className={cn(TD, NUM)}>{price(p.entry_price)}</td>
                    <td className={cn(TD, NUM)}>{price(p.exit_price)}</td>
                    <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{p.exit_reason}</td>
                    <td className={cn(TD, NUM, tone(p.pnl))}>{p.pnl == null ? "–" : `${p.pnl < 0 ? "−" : ""}${fmtPrice(Math.abs(p.pnl))}`}</td>
                    <td className={cn(TD, NUM, tone(p.ret))}>{pct(p.ret)}</td>
                    <td className={cn(TD, NUM, "pr-3.5 text-muted-foreground")}>{pct(p.ret_spy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] leading-5 text-muted-foreground" data-section="Closed trades">Trades appear here once their holding period ends.</p>
        )}
        {cancelled.length > 0 && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{cancelled.length} queued order{cancelled.length === 1 ? " was" : "s were"} cancelled (no cash, no trading, or cancelled by you).</p>}
      </Panel>
    </div>
  );
}

function Confirm({ title, body, action, onConfirm, children }: { title: string; body: string; action: string; onConfirm: () => void; children: React.ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
