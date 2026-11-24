import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  CalendarClock,
  Check,
  Download,
  Inbox,
  Pin,
  Play,
  Plus,
  Radar,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Segmented } from "@/components/app/segmented";
import { ResearchMarkdown } from "@/components/research/markdown";
import { ViewRenderer } from "@/components/research/viz/view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingState from "@/components/ui/loading-state";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DELIVERABLE_LABEL,
  describeCron,
  fetchInboxItem,
  MONITOR_LABEL,
  scopeLabel,
  useAgentAction,
  useAgentsState,
  type AgentMonitor,
  type AgentsState,
  type AgentTask,
  type Deliverable,
  type Evidence,
  type InboxCard,
  type Scope,
  type TemplateMonitor,
  type TemplateTask,
} from "@/lib/agents/client";
import { parseViewSpec } from "@/lib/research/view-spec";
import { friendlyError } from "@/lib/errors";
import { fmtRelative } from "@/lib/format";
import { useWatchlist } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export type AgentsTab = "inbox" | "tasks" | "monitors" | "interests";

export function AgentsPage({
  tab,
  item,
  onTab,
  onItem,
}: {
  tab: AgentsTab;
  item?: string;
  onTab: (t: AgentsTab) => void;
  onItem: (id?: string) => void;
}) {
  const state = useAgentsState({ poll: true });
  useWatchlistSync(state.data);

  if (state.isLoading)
    return <LoadingState label="Loading your agents" variant="Dots" className="mt-10" />;
  if (state.error || !state.data)
    return (
      <div className="mt-8 rounded-md border border-border p-6 text-sm">
        <p className="font-medium">Agents are unavailable right now.</p>
        <p className="mt-1 text-muted-foreground">{friendlyError(state.error)}</p>
      </div>
    );
  const s = state.data;
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<AgentsTab>
          value={tab}
          onChange={onTab}
          label="Agents section"
          options={[
            { v: "inbox", l: s.unread ? `Inbox (${s.unread})` : "Inbox" },
            { v: "tasks", l: `Tasks (${s.tasks.length})` },
            { v: "monitors", l: `Monitors (${s.monitors.length})` },
            { v: "interests", l: "Interests" },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Times in {s.tz.replace(/_/g, " ")} · watchlist {s.watchlist.length} companies
        </p>
      </div>
      {tab === "inbox" && <InboxTab s={s} openId={item} onOpen={onItem} />}
      {tab === "tasks" && <TasksTab s={s} />}
      {tab === "monitors" && <MonitorsTab s={s} />}
      {tab === "interests" && <InterestsTab s={s} />}
    </div>
  );
}

/** Keeps the agents' copy of the watchlist (used by watchlist-scoped tasks and monitors) in step with the app's. */
function useWatchlistSync(s: AgentsState | undefined) {
  const watch = useWatchlist();
  const act = useAgentAction();
  const tickers = useMemo(
    () => (watch.data ?? []).map((w: { ticker: string }) => w.ticker).sort(),
    [watch.data],
  );
  useEffect(() => {
    if (!s || !watch.data) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const same = JSON.stringify([...s.watchlist].sort()) === JSON.stringify(tickers);
    if (same && (!tz || tz === s.tz)) return;
    act.mutate({ action: "sync", watchlist: tickers, tz });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.watchlist.join(","), s?.tz, tickers.join(",")]);
}

// ───────────────────────────── Inbox

const SEVERITY: Record<string, string> = {
  high: "bg-destructive/15 text-destructive",
  notable: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  info: "bg-muted text-muted-foreground",
};

function InboxTab({
  s,
  openId,
  onOpen,
}: {
  s: AgentsState;
  openId?: string;
  onOpen: (id?: string) => void;
}) {
  const act = useAgentAction();
  const [filter, setFilter] = useState<"all" | "unread" | "pinned" | "report" | "alert">("all");
  const cards = s.inbox.filter((c) =>
    filter === "all"
      ? true
      : filter === "unread"
        ? !c.read_at
        : filter === "pinned"
          ? c.pinned
          : c.kind === filter,
  );
  const open = s.inbox.find((c) => c.id === openId);
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Segmented
            value={filter}
            onChange={setFilter}
            label="Inbox filter"
            options={[
              { v: "all", l: "All" },
              { v: "unread", l: "Unread" },
              { v: "pinned", l: "Pinned" },
              { v: "report", l: "Reports" },
              { v: "alert", l: "Alerts" },
            ]}
          />
          {s.unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => act.mutate({ action: "inbox.read_all" })}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        {!cards.length ? (
          <EmptyInbox s={s} />
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {cards.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(c.id);
                    if (!c.read_at) act.mutate({ action: "inbox.update", id: c.id, read: true });
                  }}
                  className={cn(
                    "w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                    openId === c.id && "bg-muted/60",
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {!c.read_at && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unread" />
                    )}
                    <span className="uppercase tracking-wide">{c.kind}</span>
                    <span>·</span>
                    <span>{c.source?.task ?? c.source?.monitor ?? "Agent"}</span>
                    <span className="ml-auto tabular-nums">{fmtRelative(c.created_at)}</span>
                    {c.pinned && <Pin className="h-3 w-3" />}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-sm font-medium">{c.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {c.summary}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {c.severity && c.severity !== "info" && (
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          SEVERITY[c.severity] ?? SEVERITY.info,
                        )}
                      >
                        {c.severity}
                      </span>
                    )}
                    {(c.tickers ?? []).slice(0, 6).map((t) => (
                      <span
                        key={t}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {t}
                      </span>
                    ))}
                    {c.n_views > 0 && (
                      <span className="text-[10px] text-muted-foreground">{c.n_views} views</span>
                    )}
                    {c.n_files > 0 && (
                      <span className="text-[10px] text-muted-foreground">{c.n_files} files</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        {open ? (
          <InboxDetail card={open} onClose={() => onOpen(undefined)} />
        ) : (
          <p className="mt-10 text-sm text-muted-foreground">
            Select a report or alert to read it.
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyInbox({ s }: { s: AgentsState }) {
  return (
    <div className="mt-3 rounded-md border border-dashed border-border p-5 text-sm">
      <p className="font-medium">Nothing here yet.</p>
      <p className="mt-1 text-muted-foreground">
        {s.tasks.length || s.monitors.length
          ? "Reports land here when a task runs; alerts when a monitor finds something new."
          : "Set up a task or a monitor and its results arrive here."}
      </p>
    </div>
  );
}

function EvidenceList({ items }: { items: Evidence[] }) {
  if (!items.length) return null;
  const md = items
    .slice(0, 40)
    .map((e) =>
      e.url ? `- [${e.label}](${e.url})` : e.cite ? `- [${e.label}](${e.cite})` : `- ${e.label}`,
    )
    .join("\n");
  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Sources
      </h3>
      <ResearchMarkdown className="mt-2 text-sm">{md}</ResearchMarkdown>
    </section>
  );
}

function InboxDetail({ card, onClose }: { card: InboxCard; onClose: () => void }) {
  const act = useAgentAction();
  const item = useQuery({
    queryKey: ["agents-item", card.id],
    queryFn: () => fetchInboxItem(card.id),
    staleTime: 5 * 60_000,
  });
  return (
    <article className="rounded-md border border-border p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {card.kind} · {card.source?.task ?? card.source?.monitor ?? "Agent"} ·{" "}
            {fmtRelative(card.created_at)}
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-tight">{card.title}</h2>
          {card.tickers?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.tickers.slice(0, 12).map((t) => (
                <Link
                  key={t}
                  to="/app/companies/$ticker"
                  params={{ ticker: t }}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted/70"
                >
                  {t}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              act.mutate({ action: "inbox.update", id: card.id, pinned: !card.pinned })
            }
          >
            <Pin className={cn("mr-1 h-3.5 w-3.5", card.pinned && "fill-current")} />{" "}
            {card.pinned ? "Unpin" : "Pin"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              act.mutate(
                { action: "inbox.delete", id: card.id },
                { onSuccess: () => onClose(), onError: (e) => toast.error(friendlyError(e)) },
              )
            }
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </header>
      {item.isLoading ? (
        <LoadingState label="Opening" variant="Dots" className="mt-6" />
      ) : item.error || !item.data ? (
        <p className="mt-6 text-sm text-muted-foreground">{friendlyError(item.error)}</p>
      ) : (
        <div className="mt-5">
          {item.data.report_md ? (
            <ResearchMarkdown className="text-sm">{item.data.report_md}</ResearchMarkdown>
          ) : (
            <p className="text-sm">{card.summary}</p>
          )}
          {item.data.hits?.length ? (
            <ul className="mt-4 divide-y divide-border rounded-md border border-border">
              {item.data.hits.slice(0, 50).map((h) => (
                <li key={h.key} className="px-3 py-2 text-sm">
                  <div className="font-medium">{h.title}</div>
                  {h.summary && <div className="text-xs text-muted-foreground">{h.summary}</div>}
                </li>
              ))}
            </ul>
          ) : null}
          {(item.data.views ?? []).map((v, i) => {
            const p = parseViewSpec(v);
            return p.ok ? (
              <div key={i} className="mt-6">
                <ViewRenderer spec={p.spec} />
              </div>
            ) : null;
          })}
          {item.data.files?.length ? (
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Files
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {item.data.files.map((f) => (
                  <li key={f.name}>
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/50"
                      >
                        <Download className="h-3.5 w-3.5" /> {f.name}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{f.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <EvidenceList items={item.data.evidence ?? []} />
          {item.data.model && (
            <p className="mt-6 text-[11px] text-muted-foreground">
              Written by {item.data.model}; every figure is checked against the cited data before
              delivery.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// ───────────────────────────── Tasks

type TaskDraft = {
  id?: string;
  name: string;
  prompt: string;
  notes: string;
  cron: string;
  once: boolean;
  scope: Scope;
  deliverable: Deliverable;
  deep: boolean;
  enabled: boolean;
  budget_usd: number;
  template?: string | null;
};

function draftFromTask(t: AgentTask): TaskDraft {
  return {
    id: t.id,
    name: t.name,
    prompt: t.prompt,
    notes: t.notes ?? "",
    cron: t.schedule.kind === "cron" ? t.schedule.cron : "0 7 * * 1",
    once: t.schedule.kind === "once",
    scope: t.scope,
    deliverable: t.deliverable,
    deep: t.deep,
    enabled: t.enabled,
    budget_usd: t.budget_usd,
    template: t.template,
  };
}

function draftFromTemplate(t: TemplateTask): TaskDraft {
  return {
    name: t.name,
    prompt: t.prompt,
    notes: "",
    cron: t.cron,
    once: false,
    scope: t.scope,
    deliverable: t.deliverable,
    deep: t.deep,
    enabled: true,
    budget_usd: t.deep ? 1 : 0.4,
    template: t.id,
  };
}

const BLANK_TASK: TaskDraft = {
  name: "",
  prompt: "",
  notes: "",
  cron: "0 7 * * 1",
  once: false,
  scope: { kind: "watchlist" },
  deliverable: "report",
  deep: false,
  enabled: true,
  budget_usd: 0.4,
};

function TasksTab({ s }: { s: AgentsState }) {
  const act = useAgentAction();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  return (
    <div className="mt-5 space-y-8">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Your tasks</h2>
          <Button size="sm" onClick={() => setDraft({ ...BLANK_TASK, cron: "0 7 * * 1" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New task
          </Button>
        </div>
        {!s.tasks.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No scheduled tasks yet. Start from a template below or write your own.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {s.tasks.map((t) => {
              const last = t.runs[0];
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.name}</span>
                      {!t.enabled && <Badge variant="secondary">Paused</Badge>}
                      {t.deep && <Badge variant="outline">Deep</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t.schedule.kind === "cron"
                        ? describeCron(t.schedule.cron, t.schedule.tz)
                        : "Run once"}{" "}
                      · {scopeLabel(t.scope)} · {DELIVERABLE_LABEL[t.deliverable]}
                      {t.next_at && t.enabled ? ` · next ${fmtRelative(t.next_at)}` : ""}
                    </div>
                    {t.running ? (
                      <LoadingState
                        label="Running"
                        variant="Drive"
                        since={t.running_since ? Date.parse(t.running_since) : undefined}
                        className="mt-1.5"
                      />
                    ) : last ? (
                      <div
                        className={cn(
                          "mt-1 text-[11px]",
                          last.status === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        Last run {last.started_at ? fmtRelative(last.started_at) : ""}:{" "}
                        {last.status}
                        {last.error ? ` (${last.error.slice(0, 120)})` : ""}
                        {last.seconds ? ` · ${Math.round(last.seconds)}s` : ""}
                        {last.cost_usd_est != null ? ` · ~$${last.cost_usd_est.toFixed(2)}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={t.running}
                      onClick={() =>
                        act.mutate(
                          { action: "task.run", id: t.id },
                          {
                            onSuccess: () =>
                              toast.success(
                                "Queued: results arrive in your inbox in a few minutes",
                              ),
                            onError: (e) => toast.error(friendlyError(e)),
                          },
                        )
                      }
                    >
                      <Play className="mr-1 h-3.5 w-3.5" /> Run now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDraft(draftFromTask(t))}>
                      Edit
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-sm font-semibold">Templates</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {s.templates.tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDraft(draftFromTemplate(t))}
              className="rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="text-sm font-medium">{t.name}</div>
              <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{t.description}</div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {describeCron(t.cron, s.tz)} · {DELIVERABLE_LABEL[t.deliverable]}
              </div>
            </button>
          ))}
        </div>
      </section>
      {draft && <TaskDialog draft={draft} tz={s.tz} onClose={() => setDraft(null)} />}
    </div>
  );
}

function ScopeField({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const [tickers, setTickers] = useState(value.kind === "tickers" ? value.tickers.join(", ") : "");
  const [sector, setSector] = useState(
    value.kind === "sector" ? value.sector : "Information Technology",
  );
  return (
    <div className="space-y-2">
      <Segmented
        value={value.kind}
        onChange={(k) =>
          onChange(
            k === "tickers"
              ? {
                  kind: "tickers",
                  tickers: tickers
                    .split(/[\s,]+/)
                    .map((x) => x.trim().toUpperCase())
                    .filter(Boolean),
                }
              : k === "sector"
                ? { kind: "sector", sector }
                : ({ kind: k } as Scope),
          )
        }
        label="Scope"
        options={[
          { v: "watchlist", l: "Watchlist" },
          { v: "portfolio", l: "Portfolio" },
          { v: "tickers", l: "Tickers" },
          { v: "sector", l: "Sector" },
          { v: "universe", l: "All" },
        ]}
      />
      {value.kind === "tickers" && (
        <Input
          value={tickers}
          placeholder="NVDA, AMD, AVGO"
          onChange={(e) => {
            setTickers(e.target.value);
            onChange({
              kind: "tickers",
              tickers: e.target.value
                .split(/[\s,]+/)
                .map((x) => x.trim().toUpperCase())
                .filter(Boolean),
            });
          }}
        />
      )}
      {value.kind === "sector" && (
        <Input
          value={sector}
          placeholder="Information Technology"
          onChange={(e) => {
            setSector(e.target.value);
            onChange({ kind: "sector", sector: e.target.value });
          }}
        />
      )}
    </div>
  );
}

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Weekdays 7:00", cron: "0 7 * * 1-5" },
  { label: "Mondays 7:00", cron: "0 7 * * 1" },
  { label: "Daily 18:00", cron: "0 18 * * *" },
  { label: "1st of month", cron: "0 7 1 * *" },
];

function TaskDialog({
  draft: initial,
  tz,
  onClose,
}: {
  draft: TaskDraft;
  tz: string;
  onClose: () => void;
}) {
  const act = useAgentAction();
  const [d, setD] = useState(initial);
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = (runNow: boolean) =>
    act.mutate(
      {
        action: "task.save",
        run_now: runNow,
        task: {
          id: d.id,
          name: d.name,
          prompt: d.prompt,
          notes: d.notes,
          template: d.template ?? null,
          schedule: d.once ? { kind: "once" } : { kind: "cron", cron: d.cron, tz },
          scope: d.scope,
          deliverable: d.deliverable,
          deep: d.deep,
          enabled: d.enabled,
          budget_usd: d.budget_usd,
        },
      },
      {
        onSuccess: () => {
          toast.success(runNow ? "Saved and queued" : "Task saved");
          onClose();
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit task" : "New scheduled task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-name">Name</Label>
            <Input
              id="task-name"
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Monday watchlist changes"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-prompt">What should the agent do?</Label>
            <Textarea
              id="task-prompt"
              rows={6}
              value={d.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              placeholder="For each company in {scope}, summarize new risk factors, insider trades over $250K and estimate moves since last week. Cite every figure."
            />
            <p className="text-[11px] text-muted-foreground">
              {"{scope}"} is replaced with the companies in scope.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Companies</Label>
            <ScopeField value={d.scope} onChange={(s) => set("scope", s)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Schedule</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!d.once}
                  onCheckedChange={(v) => set("once", !v)}
                  id="task-recurring"
                />
                <label htmlFor="task-recurring" className="text-sm">
                  Recurring
                </label>
              </div>
              {!d.once && (
                <>
                  <div className="flex flex-wrap gap-1">
                    {CRON_PRESETS.map((p) => (
                      <Button
                        key={p.cron}
                        type="button"
                        variant={d.cron === p.cron ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => set("cron", p.cron)}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                  <Input
                    value={d.cron}
                    onChange={(e) => set("cron", e.target.value)}
                    className="font-mono text-xs"
                    aria-label="Cron expression"
                  />
                  <p className="text-[11px] text-muted-foreground">{describeCron(d.cron, tz)}</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Deliverable</Label>
              <Segmented
                value={d.deliverable}
                onChange={(v) => set("deliverable", v)}
                label="Deliverable"
                options={(Object.keys(DELIVERABLE_LABEL) as Deliverable[]).map((k) => ({
                  v: k,
                  l: DELIVERABLE_LABEL[k],
                }))}
              />
              <div className="mt-3 flex items-center gap-2">
                <Switch
                  checked={d.deep}
                  onCheckedChange={(v) =>
                    setD((x) => ({
                      ...x,
                      deep: v,
                      budget_usd: v ? Math.max(x.budget_usd, 1) : x.budget_usd,
                    }))
                  }
                  id="task-deep"
                />
                <label htmlFor="task-deep" className="text-sm">
                  Deep research (more sources, slower)
                </label>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Label htmlFor="task-budget" className="text-xs font-normal text-muted-foreground">
                  Cost cap per run ($)
                </Label>
                <Input
                  id="task-budget"
                  type="number"
                  min={0.05}
                  max={5}
                  step={0.05}
                  value={d.budget_usd}
                  onChange={(e) => set("budget_usd", Number(e.target.value))}
                  className="h-8 w-24"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-notes">Notes for the agent (optional)</Label>
            <Textarea
              id="task-notes"
              rows={2}
              value={d.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Skip companies with nothing new. Keep it under one page."
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={d.enabled}
              onCheckedChange={(v) => set("enabled", v)}
              id="task-enabled"
            />
            <label htmlFor="task-enabled" className="text-sm">
              Enabled
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {d.id ? (
            <Button
              variant="ghost"
              onClick={() =>
                act.mutate(
                  { action: "task.delete", id: d.id! },
                  { onSuccess: onClose, onError: (e) => toast.error(friendlyError(e)) },
                )
              }
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={act.isPending} onClick={() => save(true)}>
              Save and run now
            </Button>
            <Button disabled={act.isPending} onClick={() => save(false)}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Monitors

type MonitorDraft = Partial<AgentMonitor> & {
  type: AgentMonitor["type"];
  name: string;
  scope: Scope;
  params: Record<string, unknown>;
};

function MonitorsTab({ s }: { s: AgentsState }) {
  const act = useAgentAction();
  const [draft, setDraft] = useState<MonitorDraft | null>(null);
  return (
    <div className="mt-5 space-y-8">
      <section>
        <h2 className="text-sm font-semibold">Your monitors</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Monitors check the published data on a schedule and send an alert only when something new
          matches. Most run without the model.
        </p>
        {!s.monitors.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No monitors yet. Add one from the list below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {s.monitors.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <Radar className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {!m.enabled && <Badge variant="secondary">Paused</Badge>}
                    {m.escalate && <Badge variant="outline">Write-up</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {MONITOR_LABEL[m.type]} · {scopeLabel(m.scope)} · {m.seen_count} items seen
                    {m.last_checked
                      ? ` · checked ${fmtRelative(m.last_checked)}`
                      : " · first check pending"}
                  </div>
                  {m.last_error && (
                    <div className="mt-0.5 text-[11px] text-destructive">
                      {m.last_error.slice(0, 160)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={m.enabled}
                    onCheckedChange={(v) =>
                      act.mutate({ action: "monitor.save", monitor: { ...m, enabled: v } })
                    }
                    aria-label="Enabled"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      act.mutate(
                        { action: "monitor.check", id: m.id },
                        { onSuccess: () => toast.success("Checking now") },
                      )
                    }
                  >
                    Check now
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDraft({ ...m })}>
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {s.suggestions?.length ? (
        <section>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Suggested for you
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {s.suggestions.map((sug, i) => (
              <li key={i} className="rounded-md border border-border p-3">
                <div className="text-sm font-medium">{sug.name}</div>
                {sug.reason && (
                  <div className="mt-1 text-xs text-muted-foreground">{sug.reason}</div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() =>
                    act.mutate(
                      { action: "suggestion.accept", index: i },
                      { onSuccess: () => toast.success("Monitor added") },
                    )
                  }
                >
                  Add monitor
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2 className="text-sm font-semibold">Add a monitor</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {s.templates.monitors.map((t: TemplateMonitor) => (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                setDraft({
                  name: t.name,
                  type: t.type,
                  params: t.params,
                  scope: t.scope,
                  escalate: t.escalate,
                  enabled: true,
                  cooldown_hours: 0,
                })
              }
              className="rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" /> {t.name}
              </div>
              <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{t.description}</div>
              <div className="mt-2 text-[11px] text-muted-foreground">{MONITOR_LABEL[t.type]}</div>
            </button>
          ))}
        </div>
      </section>
      {draft && <MonitorDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

/** Editable parameters: numbers and strings shown as fields, booleans as switches, lists as comma-separated text. */
function ParamFields({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(params).filter(
    ([, v]) =>
      ["number", "string", "boolean"].includes(typeof v) ||
      (Array.isArray(v) && v.every((x) => typeof x === "string")),
  );
  if (!entries.length) return null;
  const label = (k: string) => k.replace(/_/g, " ");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="space-y-1">
          <Label className="text-xs capitalize">{label(k)}</Label>
          {typeof v === "boolean" ? (
            <div>
              <Switch
                checked={v}
                onCheckedChange={(x) => onChange({ ...params, [k]: x })}
                aria-label={label(k)}
              />
            </div>
          ) : Array.isArray(v) ? (
            <Input
              value={v.join(", ")}
              onChange={(e) =>
                onChange({ ...params, [k]: e.target.value.split(/\s*,\s*/).filter(Boolean) })
              }
            />
          ) : (
            <Input
              type={typeof v === "number" ? "number" : "text"}
              value={String(v)}
              onChange={(e) =>
                onChange({
                  ...params,
                  [k]: typeof v === "number" ? Number(e.target.value) : e.target.value,
                })
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

function MonitorDialog({ draft: initial, onClose }: { draft: MonitorDraft; onClose: () => void }) {
  const act = useAgentAction();
  const [d, setD] = useState(initial);
  const save = () =>
    act.mutate(
      { action: "monitor.save", monitor: d },
      {
        onSuccess: () => {
          toast.success(d.id ? "Monitor saved" : "Monitor added; first check runs now");
          onClose();
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {d.id ? "Edit monitor" : `New monitor: ${MONITOR_LABEL[d.type]}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mon-name">Name</Label>
            <Input
              id="mon-name"
              value={d.name}
              onChange={(e) => setD({ ...d, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Companies</Label>
            <ScopeField value={d.scope} onChange={(scope) => setD({ ...d, scope })} />
          </div>
          <ParamFields params={d.params} onChange={(params) => setD({ ...d, params })} />
          <div className="flex items-center gap-2">
            <Switch
              checked={!!d.escalate}
              onCheckedChange={(v) => setD({ ...d, escalate: v })}
              id="mon-escalate"
            />
            <label htmlFor="mon-escalate" className="text-sm">
              Add a short written analysis when it fires
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="mon-cool" className="text-xs font-normal text-muted-foreground">
              Quiet period after an alert (hours)
            </Label>
            <Input
              id="mon-cool"
              type="number"
              min={0}
              max={720}
              value={d.cooldown_hours ?? 0}
              onChange={(e) => setD({ ...d, cooldown_hours: Number(e.target.value) })}
              className="h-8 w-24"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {d.id ? (
            <Button
              variant="ghost"
              onClick={() =>
                act.mutate({ action: "monitor.delete", id: d.id! }, { onSuccess: onClose })
              }
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={act.isPending} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Interests

function Weights({ title, w }: { title: string; w: Record<string, number> }) {
  const rows = Object.entries(w)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  const max = rows[0]?.[1] || 1;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {!rows.length ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate font-mono">{k}</span>
              <span className="h-1.5 flex-1 rounded bg-muted">
                <span
                  className="block h-1.5 rounded bg-foreground/60"
                  style={{ width: `${Math.max(4, (v / max) * 100)}%` }}
                />
              </span>
              <span className="w-10 text-right tabular-nums text-muted-foreground">
                {v.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListEditor({
  label,
  values,
  onSave,
}: {
  label: string;
  values: string[];
  onSave: (v: string[]) => void;
}) {
  const [text, setText] = useState(values.join(", "));
  useEffect(() => setText(values.join(", ")), [values.join(",")]);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSave(text.split(/\s*,\s*/).filter(Boolean))}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function InterestsTab({ s }: { s: AgentsState }) {
  const act = useAgentAction();
  const it = s.interests;
  return (
    <div className="mt-5 grid gap-8 lg:grid-cols-2">
      <section>
        <h2 className="text-sm font-semibold">What the agents think you care about</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Built from the companies you open, the questions you ask, your watchlist and saved
          screens. It shapes the "Insights for you" note and suggested monitors. {it.events} signals
          recorded
          {it.updated_at ? `, updated ${fmtRelative(it.updated_at)}` : ""}.
        </p>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <Weights title="Companies" w={it.weights.tickers} />
          <Weights title="Topics" w={it.weights.topics} />
          <Weights title="Sectors" w={it.weights.sectors} />
        </div>
      </section>
      <section className="space-y-5">
        <Toggle
          label="Learn from my activity"
          hint="Off stops recording; nothing already saved is used for new suggestions until you turn it back on."
          checked={it.learning}
          onChange={(v) => act.mutate({ action: "interests.update", learning: v })}
        />
        <div className="space-y-1.5">
          <Label className="text-xs">"Insights for you" note</Label>
          <Segmented
            value={s.settings.insights}
            onChange={(v) => act.mutate({ action: "settings", insights: v })}
            label="Insights frequency"
            options={[
              { v: "weekly", l: "Weekly" },
              { v: "daily", l: "Daily" },
              { v: "off", l: "Off" },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() =>
              act.mutate(
                { action: "insights.run" },
                { onSuccess: () => toast.success("Generating; it arrives in your inbox shortly") },
              )
            }
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Generate now
          </Button>
        </div>
        <Toggle
          label="Email me new reports and alerts"
          hint={
            s.email_configured
              ? `Sent to ${s.email ?? "your account email"}.`
              : "Email isn't set up on the server yet; everything still arrives in the inbox."
          }
          checked={s.settings.email}
          disabled={!s.email_configured}
          onChange={(v) => act.mutate({ action: "settings", email: v })}
        />
        <ListEditor
          label="Always include these companies"
          values={it.pins.tickers}
          onSave={(v) => act.mutate({ action: "interests.update", pins: { tickers: v } })}
        />
        <ListEditor
          label="Never suggest these companies"
          values={it.muted.tickers}
          onSave={(v) => act.mutate({ action: "interests.update", muted: { tickers: v } })}
        />
        <ListEditor
          label="Topics to follow"
          values={it.pins.topics}
          onSave={(v) => act.mutate({ action: "interests.update", pins: { topics: v } })}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            act.mutate(
              { action: "interests.update", clear: true },
              { onSuccess: () => toast.success("Cleared") },
            )
          }
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear what was learned
        </Button>
        {it.recent.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent signals
            </h3>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {it.recent.slice(0, 12).map((e, i) => (
                <li key={i}>
                  {fmtRelative(e.ts)} · {e.kind}
                  {e.t ? ` ${e.t}` : ""}
                  {e.q ? `: "${e.q.slice(0, 60)}"` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
        className="mt-0.5"
      />
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export function AgentsInboxIcon() {
  return <Inbox className="h-4 w-4" />;
}
