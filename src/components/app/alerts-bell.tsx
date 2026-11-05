import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ExternalLink, FileText, Network, ShoppingBag, TrendingUp, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSource } from "@/components/source/source-context";
import { useWatchlist } from "@/lib/workspace";
import { buildAlerts, unreadCount, type Alert, type AlertKind } from "@/lib/alerts/core";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<AlertKind, typeof Bell> = { filing: FileText, insider: UserRound, supply: Network, alt: ShoppingBag, idea: TrendingUp };
const DAYS = 30;

export const alertsQuery = (tickers: string[]) => ({
  queryKey: ["alerts", tickers.join(",")],
  enabled: tickers.length > 0,
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<Alert[]> => {
    const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
    const [f, i, l, a, ideas] = await Promise.all([
      supabase.from("sec_filings").select("accn,ticker,form,filed,doc,description,items,discovered_at").in("ticker", tickers).gte("filed", since).limit(400),
      supabase.from("insider_trades").select("accn,seq,ticker,owner,role,code,shares,price,plan_10b5,trade_date,doc,filed,discovered_at").in("ticker", tickers).gte("filed", since).in("code", ["P", "S"]).limit(500),
      supabase.from("supply_links").select("id,ticker,counterparty,relation,detail,accn,doc,form,filed,created_at,is_current").in("ticker", tickers).eq("is_current", true).gte("filed", since).limit(300),
      supabase.from("alt_data").select("uid,ticker,dataset,title,date,source_url,created_at").in("ticker", tickers).eq("kind", "event").gte("date", since).limit(300),
      fetch("/data/signals.json").then((r) => r.json()).catch(() => ({ ideas: [] })),
    ]);
    return buildAlerts({
      tickers, since,
      filings: f.data ?? [], insiders: (i.data ?? []) as never, links: (l.data ?? []) as never, alt: a.data ?? [], ideas: ideas?.ideas ?? [],
    });
  },
});

export function useAlerts() {
  const wl = useWatchlist();
  const tickers = useMemo(() => (wl.data ?? []).map((w) => w.ticker).sort(), [wl.data]);
  return { tickers, ...useQuery(alertsQuery(tickers)) };
}

export function AlertsBell() {
  const { tickers, data, isLoading } = useAlerts();
  const qc = useQueryClient();
  const { open } = useSource();
  const [kind, setKind] = useState<AlertKind | "all">("all");
  const seen = useQuery({
    queryKey: ["alert_state"],
    queryFn: async () => (await supabase.from("alert_state").select("last_seen").maybeSingle()).data?.last_seen ?? null,
  });
  const alerts = data ?? [];
  const unread = unreadCount(alerts, seen.data ?? null);
  const markSeen = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const now = new Date().toISOString();
    await supabase.from("alert_state").upsert({ user_id: u.user.id, last_seen: now, updated_at: now });
    qc.setQueryData(["alert_state"], now);
  };
  const go = (a: Alert) => {
    if (a.filing) open({ ticker: a.ticker, label: a.title, unit: "", value: 0, doc: { ...a.filing, title: `${a.ticker} ${a.filing.form}` } });
    else if (a.url) window.open(a.url, "_blank", "noopener,noreferrer");
  };
  const shown = alerts.filter((a) => kind === "all" || a.kind === kind);

  return (
    <Popover onOpenChange={(o) => { if (!o && unread) void markSeen(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative shrink-0" aria-label={`Alerts${unread ? ` (${unread} new)` : ""}`}>
          <Bell />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-medium leading-4 text-destructive-foreground">{unread > 99 ? "99+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-medium">Watchlist alerts</p>
            <p className="text-[11px] text-muted-foreground">Last {DAYS} days · {tickers.length} companies</p>
          </div>
          {unread > 0 && <button onClick={markSeen} className="text-[11px] text-primary hover:underline">Mark all read</button>}
        </div>
        <div className="flex flex-wrap gap-1 border-b px-3 py-2">
          {(["all", "filing", "insider", "supply", "alt", "idea"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cn("rounded-full border px-2 py-0.5 text-[11px] capitalize", kind === k ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>
              {k === "all" ? "All" : k === "alt" ? "Alt data" : k === "idea" ? "Setups" : k === "supply" ? "Supply chain" : `${k}s`}
            </button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!tickers.length ? (
            <p className="p-6 text-center text-xs text-muted-foreground">Follow companies (★ on a company page) to get alerts.</p>
          ) : isLoading ? (
            <p className="p-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : !shown.length ? (
            <p className="p-6 text-center text-xs text-muted-foreground">Nothing new.</p>
          ) : (
            shown.slice(0, 80).map((a) => {
              const Icon = ICON[a.kind];
              const isNew = !seen.data || a.at > seen.data;
              const body = (
                <>
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{a.ticker}</span>
                      <span>{fmtDate(a.at.slice(0, 10))}</span>
                      {isNew && <span className="size-1.5 rounded-full bg-destructive" />}
                    </div>
                    <p className="truncate text-[13px]">{a.title}</p>
                    {a.detail && <p className="line-clamp-1 text-[11px] text-muted-foreground">{a.detail}</p>}
                  </div>
                  {a.url && <ExternalLink className="size-3 shrink-0 text-muted-foreground" />}
                </>
              );
              const cls = "flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-0 hover:bg-muted/50";
              return a.path ? <Link key={a.id} to="/app/ideas" className={cls}>{body}</Link> : <button key={a.id} onClick={() => go(a)} className={cls}>{body}</button>;
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
