import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Sparkline } from "@/components/charts/sparkline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/hooks/use-plan";
import { AUTOPILOT_LIMIT } from "@/lib/billing/plans";
import { fmtPct } from "@/lib/format";
import { botStats, BotRulesSchema, type BotRules } from "@/lib/signals/bots";
import { dayLong, pct } from "@/lib/signals/format";
import { botsQuery, setupsQuery, type BotRow, type BotsList } from "@/lib/signals/queries";
import { FAMILY_LABEL } from "@/lib/signals/strategies";
import { isNearMiss } from "@/lib/signals/setups";
import { rulesSummary, variantLabel } from "@/components/autopilot/shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/autopilots/")({
  validateSearch: z.object({ variant: z.string().max(40).optional() }),
  head: () => ({
    meta: [
      { title: "Paper autopilots · FiledUnder" },
      { name: "description", content: "Automatic paper trading of short-term strategies: signals queued after each close, filled at the next open, tracked against the S&P 500." },
      { property: "og:title", content: "Paper autopilots · FiledUnder" },
      { property: "og:description", content: "Rule-based paper trading bots with daily equity curves, hit rates and drawdowns versus the S&P 500." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutopilotsPage,
});

function AutopilotsPage() {
  const { variant } = Route.useSearch();
  const { data, isLoading, error, refetch } = useQuery(botsQuery);
  const { data: plan } = usePlan();
  const [uid, setUid] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setUid(u.user?.id ?? null));
  }, []);
  useEffect(() => {
    if (variant) setCreating(true);
  }, [variant]);

  if (error) return <DataUnavailable title="Autopilots could not load" error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>;
  const house = data.bots.filter((b) => !b.user_id);
  const mine = data.bots.filter((b) => b.user_id && b.user_id === uid);
  const limit = AUTOPILOT_LIMIT[plan?.tier ?? "none"];
  const lastRun = data.bots.map((b) => b.last_as_of).filter(Boolean).sort().at(-1);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Signals"
        title="Paper autopilots"
        description="Automatic paper trading of the rules on the Setups page. After each close an autopilot queues that day's signals, fills them at the next open and closes them after the tested holding period, or at a stop or target if you choose. Results are tracked against the S&P 500. Paper only: no real orders."
        actions={
          <>
            {lastRun && <span className="text-[11px] text-muted-foreground">Updated through {dayLong(lastRun)} · runs after every close</span>}
            <Button size="xs" onClick={() => setCreating(true)} disabled={!limit}>
              <Plus aria-hidden /> New autopilot
            </Button>
          </>
        }
      />

      <Panel title="House autopilots" subtitle="Run by Filed Under on the same rules for everyone: a live forward test of the backtests" collapse={false}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-section="House autopilots">
          {house.map((b) => <BotCard key={b.id} bot={b} data={data} />)}
        </div>
      </Panel>

      <Panel
        title="Your autopilots"
        subtitle={limit ? `${mine.length} of ${limit} on your plan` : "Autopilots are locked after the free trial. Choose a plan to create or resume them."}
        actions={!limit && <Button asChild size="xs" variant="outline"><Link to="/app/billing">See plans</Link></Button>}
        collapse={false}
      >
        {mine.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-section="Your autopilots">
            {mine.map((b) => <BotCard key={b.id} bot={b} data={data} own />)}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-5 text-muted-foreground" data-section="Your autopilots">
            <span>None yet. Pick rules from the setups scoreboard, set position sizes and exits, and an autopilot paper-trades every signal from the next close on.</span>
            {limit > 0 && (
              <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
                <Plus aria-hidden /> New autopilot
              </Button>
            )}
          </div>
        )}
      </Panel>

      {creating && uid && (
        <CreateDialog
          uid={uid}
          prefill={variant}
          atLimit={mine.length >= limit}
          limit={limit}
          onClose={() => {
            setCreating(false);
            if (variant) navigate({ to: "/app/autopilots", search: {}, replace: true });
          }}
        />
      )}
    </div>
  );
}

function BotCard({ bot, data, own }: { bot: BotRow; data: BotsList; own?: boolean }) {
  const qc = useQueryClient();
  const eq = data.equity.get(bot.id) ?? [];
  const closed = data.closed.get(bot.id) ?? [];
  const activeRows = data.active.get(bot.id) ?? [];
  const openN = activeRows.filter((r) => r.status === "open").length;
  const queuedN = activeRows.length - openN;
  const s = botStats(Number(bot.capital), eq, closed);
  const toggle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("paper_bots").update({ status: bot.status === "active" ? "paused" : "active" }).eq("id", bot.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilots"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const tone = (v: number | null) => (v ? (v > 0 ? "text-positive" : "text-negative") : "");
  return (
    <div className="flex min-w-0 flex-col rounded-md border bg-card p-3.5 shadow-paper">
      <div className="flex items-start justify-between gap-2">
        <Link to="/app/autopilots/$botId" params={{ botId: bot.id }} className="min-w-0 text-[13px] font-semibold leading-5 underline-offset-2 hover:underline">{bot.name}</Link>
        <span className={cn("inline-flex h-[18px] shrink-0 items-center rounded border px-1.5 text-[11px] leading-none", bot.status === "active" ? "border-positive/50 text-positive" : "text-muted-foreground")}>{bot.status === "active" ? "Running" : "Paused"}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{bot.description || rulesSummary(bot.rules)[0]}</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <CardFact label="Return"><span className={cn("font-medium", tone(s.totalReturn))}>{pct(s.totalReturn)}</span></CardFact>
        <CardFact label="vs S&P 500"><span className={tone(s.excess)}>{pct(s.excess)}</span></CardFact>
        <CardFact label="Trades"><span title={`${s.trades} closed, ${openN} open, ${queuedN} queued for the next open`}>{s.trades}<span className="text-muted-foreground">{openN ? ` · ${openN} open` : ""}{queuedN ? ` · ${queuedN} queued` : ""}</span></span></CardFact>
        <CardFact label="Win rate">{pct(s.hit, 0, false)}</CardFact>
      </div>
      <div className="mt-3 flex h-10 items-center">
        {eq.length > 1 ? <Sparkline values={eq.map((e) => e.equity)} className="h-10 w-full" /> : <span className="text-[11px] text-muted-foreground">Equity curve appears after the second trading day</span>}
      </div>
      <div className="mt-2 text-[11px] leading-4 text-muted-foreground">Since {dayLong(bot.started_on)} · worst fall from a peak {pct(s.maxDrawdown, 1, false)}</div>
      {bot.last_error && <p className="mt-2 text-[11px] text-negative">{bot.last_error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button asChild size="xs" variant="outline"><Link to="/app/autopilots/$botId" params={{ botId: bot.id }}>Positions and trades</Link></Button>
        {own && (
          <Button size="xs" variant="ghost" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            {bot.status === "active" ? <><Pause aria-hidden /> Pause</> : <><Play aria-hidden /> Resume</>}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A caption over a figure on an autopilot card; figures stay on one line in tabular digits. */
function CardFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] leading-4 text-muted-foreground">{label}</div>
      <div className="whitespace-nowrap text-[13px] tabular-nums leading-5">{children}</div>
    </div>
  );
}

const FAMILY_CHOICES = ["reversal", "momentum", "events", "links", "multi"] as const;

function CreateDialog({ uid, prefill, onClose, atLimit, limit }: { uid: string; prefill?: string; onClose: () => void; atLimit: boolean; limit: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: setups } = useQuery(setupsQuery);
  const [name, setName] = useState(prefill ? `${variantLabel(prefill)}` : "My autopilot");
  const [capital, setCapital] = useState("100000");
  const [rules, setRules] = useState<BotRules>(() =>
    BotRulesSchema.parse(prefill ? { select: "variants", variants: [prefill], maxPositions: 10, positionPct: 0.1 } : { select: "watch", maxPositions: 10, positionPct: 0.1 }),
  );
  const set = <K extends keyof BotRules>(k: K, v: BotRules[K]) => setRules((r) => ({ ...r, [k]: v }));
  const variants = useMemo(() => (setups?.variants ?? []).filter((v) => v.family !== "pairs").sort((a, b) => Number(b.passed) - Number(a.passed) || (b.outSample.t ?? -9) - (a.outSample.t ?? -9)), [setups]);

  const create = useMutation({
    mutationFn: async () => {
      const cap = Number(capital);
      if (!(cap >= 1000 && cap <= 1e8)) throw new Error("Starting capital must be between $1,000 and $100,000,000");
      if (rules.select === "family" && !rules.families.length) throw new Error("Choose at least one strategy family");
      if (rules.select === "variants" && !rules.variants.length) throw new Error("Choose at least one strategy");
      const { data, error } = await supabase.from("paper_bots").insert({ user_id: uid, name: name.trim().slice(0, 80) || "My autopilot", description: null, rules: BotRulesSchema.parse(rules) as never, capital: cap, status: "active" }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("Autopilot created. It starts with tonight's signals.");
      qc.invalidateQueries({ queryKey: ["autopilots"] });
      onClose();
      navigate({ to: "/app/autopilots/$botId", params: { botId: id } });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New paper autopilot</DialogTitle>
          <DialogDescription>Trades start with the signals from the next close. You can pause, reset or delete it any time.</DialogDescription>
        </DialogHeader>
        {atLimit && <p className="rounded border px-3 py-2 text-xs text-negative">Your plan allows {limit} personal autopilots. Delete one or upgrade to add more.</p>}
        <div className="grid grid-cols-1 gap-4 text-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="ap-name">Name</Label>
            <Input id="ap-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>What it trades</Label>
            <Select value={rules.select} onValueChange={(v) => set("select", v as BotRules["select"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="proven">Proven strategies only</SelectItem>
                <SelectItem value="watch">Proven strategies and closest candidates</SelectItem>
                <SelectItem value="family">Every signal from chosen families (forward test)</SelectItem>
                <SelectItem value="variants">Chosen strategies (forward test)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {rules.select === "proven" ? "Only signals from strategies that pass all eight checks, and only in market regimes where they've worked. It may sit in cash for long stretches." : rules.select === "watch" ? "Adds the near misses: positive after costs out of sample (t ≥ 1.5) but not proven." : "Trades every signal from your selection regardless of its backtest. Useful to watch a rule live."}
            </p>
          </div>
          {rules.select === "family" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FAMILY_CHOICES.map((f) => (
                <label key={f} className="flex items-center gap-2 text-xs">
                  <Checkbox checked={rules.families.includes(f)} onCheckedChange={(c) => set("families", c ? [...rules.families, f] : rules.families.filter((x) => x !== f))} />
                  {FAMILY_LABEL[f]}
                </label>
              ))}
            </div>
          )}
          {rules.select === "variants" && (
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded border p-2">
              {variants.map((v) => (
                <label key={v.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <Checkbox checked={rules.variants.includes(v.key)} onCheckedChange={(c) => set("variants", c ? [...rules.variants, v.key] : rules.variants.filter((x) => x !== v.key))} />
                    <span className="truncate">{variantLabel(v.key)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{v.passed ? "proven" : isNearMiss(v) ? "near miss" : ""} {fmtPct(v.outSample.avgNet, 2, true)}</span>
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Direction</Label>
            <ToggleGroup type="single" value={rules.side} onValueChange={(v) => v && set("side", v as BotRules["side"])} className="justify-start">
              <ToggleGroupItem value="both" size="sm" className="h-7 px-3 text-xs">Long and short</ToggleGroupItem>
              <ToggleGroupItem value="long" size="sm" className="h-7 px-3 text-xs">Long only</ToggleGroupItem>
              <ToggleGroupItem value="short" size="sm" className="h-7 px-3 text-xs">Short only</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumField label="Max positions" value={rules.maxPositions} min={1} max={30} onChange={(v) => set("maxPositions", v)} />
            <NumField label="Size each (%)" value={Math.round(rules.positionPct * 100)} min={1} max={25} onChange={(v) => set("positionPct", v / 100)} />
            <NumField label="Max per sector" value={rules.maxPerSector} min={1} max={30} onChange={(v) => set("maxPerSector", v)} />
            <div className="grid gap-1.5">
              <Label htmlFor="ap-cap" className="text-xs">Starting capital ($)</Label>
              <Input id="ap-cap" inputMode="numeric" value={capital} onChange={(e) => setCapital(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Exits</Label>
            <ToggleGroup type="single" value={rules.exits} onValueChange={(v) => v && set("exits", v as BotRules["exits"])} className="justify-start">
              <ToggleGroupItem value="time" size="sm" className="h-7 px-3 text-xs">Tested holding period</ToggleGroupItem>
              <ToggleGroupItem value="stops" size="sm" className="h-7 px-3 text-xs">Holding period + stop / target</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[11px] text-muted-foreground">The backtests use the holding period only. Stops sit 2–2.5 daily ranges away; targets 1.5–2× that.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || atLimit}>{create.isPending ? "Creating…" : "Create autopilot"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))} />
    </div>
  );
}
