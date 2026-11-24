import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { BotStatStrip, EquityChart, rulesSummary, variantLabel } from "@/components/autopilot/shared";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtPct, fmtPrice, toneClass, toneOf } from "@/lib/format";
import { parseRules, type Position } from "@/lib/signals/bots";
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

function Side({ side }: { side: 1 | -1 }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", side > 0 ? "text-positive" : "text-negative")}>
      {side > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {side > 0 ? "Long" : "Short"}
    </span>
  );
}

function Stock({ p }: { p: Position }) {
  return (
    <Link to="/app/companies/$ticker" params={{ ticker: p.ticker }} className="flex items-center gap-2">
      <CompanyLogo ticker={p.ticker} size="sm" />
      <span className="min-w-0">
        <span className="block font-medium">{p.ticker}</span>
        <span className="block max-w-[9rem] truncate text-[11px] text-muted-foreground">{p.name}</span>
      </span>
    </Link>
  );
}

function BotPage() {
  const { botId } = Route.useParams();
  const { data, isLoading, error } = useQuery(botDetailQuery(botId));
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
      toast.success("Autopilot reset — it starts again with tonight's signals");
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

  if (error) return <p className="text-sm text-muted-foreground">This autopilot could not load: {(error as Error).message}</p>;
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
        eyebrow={<Link to="/app/autopilots" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="h-3 w-3" /> Autopilots</Link>}
        title={bot.name}
        description={bot.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("rounded border px-1.5 py-0.5", bot.status === "active" ? "text-positive" : "text-muted-foreground")}>{bot.status === "active" ? "Running" : "Paused"}</span>
            <span className="text-muted-foreground">{bot.last_as_of ? `Updated through ${fmtDate(bot.last_as_of)}` : "Starts after the next close"} · {bot.user_id ? "yours" : "house autopilot"}</span>
            {own && (
              <>
                <Button size="sm" variant="outline" className="h-7" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
                  {bot.status === "active" ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pause</> : <><Play className="mr-1 h-3.5 w-3.5" /> Resume</>}
                </Button>
                <Confirm title="Reset this autopilot?" body="All its positions, trades and equity history are deleted and it starts again from its starting capital." action="Reset" onConfirm={() => reset.mutate()}>
                  <Button size="sm" variant="ghost" className="h-7"><RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset</Button>
                </Confirm>
                <Confirm title="Delete this autopilot?" body="Its positions, trades and history are deleted. This can't be undone." action="Delete" onConfirm={() => remove.mutate()}>
                  <Button size="sm" variant="ghost" className="h-7 text-negative"><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button>
                </Confirm>
              </>
            )}
          </div>
        }
      />
      {bot.last_error && <p className="rounded border px-3 py-2 text-xs text-negative">{bot.last_error}</p>}

      <BotStatStrip capital={Number(bot.capital)} equity={data.equity} closed={closed} open={open.length + pending.length} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <Panel title="Equity vs the S&P 500" subtitle="Both rebased to 100 on the first day; marked at each close" collapse={false}>
          <div data-section="Equity curve"><EquityChart capital={Number(bot.capital)} equity={data.equity} /></div>
        </Panel>
        <Panel title="Rules" subtitle={`Started ${fmtDate(bot.started_on)} with ${fmtPrice(Number(bot.capital))}`} collapse={false}>
          <ul className="list-disc space-y-1 pl-4 text-xs" data-section="Rules">
            {rulesSummary(bot.rules).map((r) => <li key={r}>{r}</li>)}
            <li className="text-muted-foreground">Signals are queued after the close and filled at the next open. Trading costs and short borrow are charged on each exit.</li>
          </ul>
          {rules.select === "variants" && rules.variants.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">See each rule's evidence on the <Link to="/app/setups" className="underline">setups scoreboard</Link>.</p>
          )}
        </Panel>
      </div>

      <Panel title="Open positions" subtitle={open.length ? `${open.length} open · marked at the latest close` : "None open"} collapse={false}>
        {open.length ? (
          <div className="overflow-x-auto" data-section="Open positions">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">Stock</th>
                  <th className="pr-3 font-normal">Strategy</th>
                  <th className="pr-3 font-normal">Entered</th>
                  <th className="pr-3 text-right font-normal">Entry</th>
                  <th className="pr-3 text-right font-normal">Last</th>
                  <th className="pr-3 text-right font-normal">Return</th>
                  <th className="pr-3 text-right font-normal">Size</th>
                  {rules.exits === "stops" && <th className="pr-3 text-right font-normal">Stop / target</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {open.map((p) => {
                  const last = data.last.get(p.ticker);
                  const ret = last && p.entry_price ? (p.side * (last.close - p.entry_price)) / p.entry_price : null;
                  return (
                    <tr key={p.id} className="border-t align-middle">
                      <td className="py-2 pr-3"><Stock p={p} /></td>
                      <td className="pr-3"><div className="flex items-center gap-1.5"><Side side={p.side} /><span>{strategyName(p.strategy)}</span></div><div className="text-[11px] text-muted-foreground">Hold {p.horizon} days{p.close_requested ? " · closing at next close" : ""}</div></td>
                      <td className="pr-3 text-xs">{fmtDate(p.entry_date!)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPrice(p.entry_price)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPrice(last?.close)}</td>
                      <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(ret)])}>{fmtPct(ret, 2, true)}</td>
                      <td className="pr-3 text-right tabular-nums text-xs text-muted-foreground">{fmtPrice(p.notional)}</td>
                      {rules.exits === "stops" && <td className="pr-3 text-right text-xs tabular-nums text-muted-foreground">{fmtPrice(p.stop)} / {fmtPrice(p.target)}</td>}
                      <td className="text-right">
                        {own && !p.close_requested && <Button size="sm" variant="ghost" className="h-7" onClick={() => closePos.mutate(p.id!)} disabled={closePos.isPending}><X className="mr-1 h-3.5 w-3.5" /> Close</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">{pending.length ? "Orders are queued for the next open." : bot.status === "active" ? "Waiting for signals that match the rules." : "Paused — no new positions."}</p>
        )}
      </Panel>

      {pending.length > 0 && (
        <Panel title="Queued for the next open" subtitle="From the latest close's signals" collapse={false}>
          <div className="overflow-x-auto" data-section="Queued orders">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">Stock</th>
                  <th className="pr-3 font-normal">Strategy</th>
                  <th className="pr-3 font-normal">Signal</th>
                  <th className="pr-3 text-right font-normal">Signal close</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2 pr-3"><Stock p={p} /></td>
                    <td className="pr-3"><div className="flex items-center gap-1.5"><Side side={p.side} /><span className="text-xs">{variantLabel(p.variant)}</span></div></td>
                    <td className="pr-3 text-xs">{fmtDate(p.signal_date)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtPrice(p.signal_price)}</td>
                    <td className="text-right">{own && !p.close_requested && <Button size="sm" variant="ghost" className="h-7" onClick={() => closePos.mutate(p.id!)}><X className="mr-1 h-3.5 w-3.5" /> Cancel</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Closed trades" subtitle={closed.length ? `${closed.length} trades · returns after costs` : "None yet"}>
        {closed.length ? (
          <div className="overflow-x-auto" data-section="Closed trades">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">Stock</th>
                  <th className="pr-3 font-normal">Strategy</th>
                  <th className="pr-3 font-normal">Held</th>
                  <th className="pr-3 text-right font-normal">Entry → exit</th>
                  <th className="pr-3 font-normal">Why it closed</th>
                  <th className="pr-3 text-right font-normal">P&L</th>
                  <th className="pr-3 text-right font-normal">Return</th>
                  <th className="pr-3 text-right font-normal">S&P same days</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2 pr-3"><Stock p={p} /></td>
                    <td className="pr-3"><div className="flex items-center gap-1.5"><Side side={p.side} /><span>{strategyName(p.strategy)}</span></div></td>
                    <td className="pr-3 text-xs">{fmtDate(p.entry_date!)} – {fmtDate(p.exit_date!)}</td>
                    <td className="pr-3 text-right tabular-nums text-xs">{fmtPrice(p.entry_price)} → {fmtPrice(p.exit_price)}</td>
                    <td className="pr-3 text-xs">{p.exit_reason}</td>
                    <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(p.pnl)])}>{fmtPrice(p.pnl)}</td>
                    <td className={cn("pr-3 text-right tabular-nums", toneClass[toneOf(p.ret)])}>{fmtPct(p.ret, 2, true)}</td>
                    <td className="pr-3 text-right tabular-nums text-muted-foreground">{fmtPct(p.ret_spy, 2, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">Trades appear here once their holding period ends.</p>
        )}
        {cancelled.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{cancelled.length} queued order{cancelled.length === 1 ? " was" : "s were"} cancelled (no cash, no trading, or cancelled by you).</p>}
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
