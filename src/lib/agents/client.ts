import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client for the partner service's agents API (/api/app-agents): scheduled tasks, monitors, the inbox and
 * interest learning. State lives server-side per user; every call carries the Supabase session token.
 */
const PARTNER_DATA_URL =
  (import.meta.env.VITE_PARTNER_DATA_URL as string | undefined) ??
  "https://filedunderai.vercel.app/api/app-data";
const AGENTS_URL =
  PARTNER_DATA_URL && PARTNER_DATA_URL !== "off"
    ? PARTNER_DATA_URL.replace(/app-data$/, "app-agents")
    : null;

export type Scope =
  | { kind: "watchlist" }
  | { kind: "portfolio" }
  | { kind: "universe" }
  | { kind: "tickers"; tickers: string[] }
  | { kind: "sector"; sector: string };

export type Deliverable = "report" | "dashboard" | "memo" | "csv" | "xlsx";
export type MonitorType =
  | "insider"
  | "filing_change"
  | "contracts"
  | "estimates"
  | "price"
  | "tech_signal"
  | "upcoming"
  | "ir_document"
  | "screen"
  | "feed";

export interface TaskRun {
  id?: string;
  started_at?: string;
  finished_at?: string;
  status?: string;
  error?: string | null;
  seconds?: number | null;
  cost_usd_est?: number | null;
  inbox_id?: string | null;
}

export interface AgentTask {
  id: string;
  name: string;
  prompt: string;
  notes?: string;
  template?: string | null;
  schedule: { kind: "cron"; cron: string; tz: string } | { kind: "once" };
  scope: Scope;
  deliverable: Deliverable;
  deep: boolean;
  enabled: boolean;
  budget_usd: number;
  next_at: string | null;
  running: boolean;
  running_since: string | null;
  runs: TaskRun[];
  created_at: string;
  updated_at: string;
}

export interface AgentMonitor {
  id: string;
  name: string;
  type: MonitorType;
  params: Record<string, unknown>;
  scope: Scope;
  escalate: boolean;
  enabled: boolean;
  cooldown_hours: number;
  every_minutes: number | null;
  next_at: string | null;
  last_checked?: string | null;
  last_hits?: number | null;
  last_error?: string | null;
  seen_count: number;
  created_at: string;
}

export interface InboxCard {
  id: string;
  kind: "report" | "alert" | "insight";
  title: string;
  summary: string;
  created_at: string;
  source?: {
    task_id?: string;
    task?: string;
    monitor_id?: string;
    monitor?: string;
    type?: string;
    run_id?: string;
  };
  tickers?: string[];
  severity?: "info" | "notable" | "high" | string;
  read_at: string | null;
  pinned: boolean;
  n_views: number;
  n_files: number;
  n_evidence: number;
}

export interface Evidence {
  label: string;
  url?: string;
  cite?: string;
}

export interface InboxItem extends Omit<
  InboxCard,
  "read_at" | "pinned" | "n_views" | "n_files" | "n_evidence"
> {
  report_md?: string;
  views?: unknown[];
  files?: { name: string; url: string | null; bytes?: number; content_type?: string }[];
  evidence?: Evidence[];
  hits?: {
    key: string;
    title: string;
    summary?: string;
    tickers?: string[];
    severity?: string;
    evidence?: Evidence[];
  }[];
  model?: string;
}

export interface TemplateTask {
  id: string;
  name: string;
  description: string;
  cron: string;
  scope: Scope;
  deliverable: Deliverable;
  deep: boolean;
  prompt: string;
}

export interface TemplateMonitor {
  id: string;
  name: string;
  type: MonitorType;
  params: Record<string, unknown>;
  scope: Scope;
  escalate: boolean;
  description: string;
}

export interface Interests {
  weights: {
    tickers: Record<string, number>;
    sectors: Record<string, number>;
    topics: Record<string, number>;
  };
  pins: { tickers: string[]; topics: string[] };
  muted: { tickers: string[]; topics: string[] };
  updated_at: string | null;
  events: number;
  recent: { kind: string; ts: string; t?: string; path?: string; section?: string; q?: string }[];
  learning: boolean;
}

export interface AgentsState {
  tz: string;
  settings: {
    email: boolean;
    learning: boolean;
    insights: "weekly" | "daily" | "off";
    insights_next_at: string | null;
  };
  watchlist: string[];
  portfolio: { ticker: string; weight?: number | null; shares?: number | null }[];
  tasks: AgentTask[];
  monitors: AgentMonitor[];
  inbox: InboxCard[];
  unread: number;
  suggestions: (Partial<AgentMonitor> & { reason?: string })[];
  interests: Interests;
  templates: { tasks: TemplateTask[]; monitors: TemplateMonitor[] };
  email_configured: boolean;
  email?: string | null;
}

async function token() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Sign in to use agents");
  return t;
}

async function call<T>(init?: { body?: unknown }): Promise<T> {
  if (!AGENTS_URL) throw new Error("Agents are turned off");
  const res = await fetch(AGENTS_URL, {
    method: init?.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `Agents service returned ${res.status}`);
  return out;
}

export const agentsKey = ["agents-state"] as const;

export function useAgentsState(opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: agentsKey,
    queryFn: () => call<AgentsState>(),
    staleTime: 30_000,
    refetchInterval: opts?.poll ? 30_000 : 120_000,
    retry: 1,
  });
}

export type AgentAction =
  | { action: "sync"; watchlist?: string[]; portfolio?: AgentsState["portfolio"]; tz?: string }
  | { action: "task.save"; task: Partial<AgentTask>; run_now?: boolean }
  | { action: "task.delete" | "task.run"; id: string }
  | { action: "monitor.save"; monitor: Partial<AgentMonitor> }
  | { action: "monitor.delete" | "monitor.check"; id: string }
  | { action: "inbox.update"; id: string; read?: boolean; pinned?: boolean }
  | { action: "inbox.read_all" }
  | { action: "inbox.delete"; id: string }
  | {
      action: "interests.update";
      clear?: boolean;
      pins?: Partial<Interests["pins"]>;
      muted?: Partial<Interests["muted"]>;
      learning?: boolean;
    }
  | {
      action: "settings";
      email?: boolean;
      insights?: "weekly" | "daily" | "off";
      learning?: boolean;
    }
  | { action: "insights.run" }
  | { action: "suggestion.accept"; index: number };

export function useAgentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentAction) =>
      call<{ state?: AgentsState } & Record<string, unknown>>({ body }),
    onSuccess: (out) => {
      if (out.state) qc.setQueryData(agentsKey, out.state);
    },
  });
}

export function fetchInboxItem(id: string) {
  return call<{ item: InboxItem }>({ body: { action: "inbox.item", id } }).then((r) => r.item);
}

// ---- interest learning: page views are batched and sent every 30 seconds (only when learning is on server-side).
type InterestEvent = {
  kind: "view" | "section" | "question" | "screen" | "watch" | "task";
  t?: string;
  path?: string;
  section?: string;
  q?: string;
  ts: string;
};
const queue: InterestEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  if (!queue.length || !AGENTS_URL) return;
  const events = queue.splice(0, queue.length);
  void call({ body: { action: "events", events } }).catch(() => undefined);
}

export function recordInterest(e: Omit<InterestEvent, "ts">) {
  if (typeof window === "undefined") return;
  queue.push({ ...e, ts: new Date().toISOString() });
  if (queue.length > 150) queue.splice(0, queue.length - 150);
  if (!timer) timer = setTimeout(flush, 30_000);
}

/** Records a company page view once per mount (after 5 seconds, so quick bounces don't count). */
export function useCompanyInterest(ticker: string | undefined) {
  useEffect(() => {
    if (!ticker) return;
    const t = setTimeout(
      () => recordInterest({ kind: "view", t: ticker, path: window.location.pathname }),
      5000,
    );
    return () => clearTimeout(t);
  }, [ticker]);
}

// ---- display helpers
export function scopeLabel(s: Scope) {
  switch (s.kind) {
    case "watchlist":
      return "Watchlist";
    case "portfolio":
      return "Portfolio";
    case "universe":
      return "All covered companies";
    case "tickers":
      return s.tickers.join(", ");
    case "sector":
      return s.sector;
  }
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Plain-English reading of the common cron shapes the templates use; falls back to the expression itself. */
export function describeCron(cron: string, tz?: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [mi, h, dom, mon, dow] = parts;
  const zone = tz ? ` (${tz.replace(/^America\//, "").replace(/_/g, " ")})` : "";
  if (h === "*" && /^\d+$/.test(mi)) return `Hourly at :${mi.padStart(2, "0")}`;
  if (!/^\d+$/.test(mi) || !/^\d+$/.test(h)) return cron;
  const hh = Number(h);
  const time = `${((hh + 11) % 12) + 1}:${mi.padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${time}${zone}`;
  if (dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${time}${zone}`;
  if (dom === "*" && mon === "*" && /^\d$/.test(dow))
    return `${DOW[Number(dow)]}days at ${time}${zone}`;
  if (/^\d+$/.test(dom) && mon === "*" && dow === "*")
    return `Monthly on day ${dom} at ${time}${zone}`;
  return `${cron}${zone}`;
}

export const MONITOR_LABEL: Record<MonitorType, string> = {
  insider: "Insider trades",
  filing_change: "Filing changes",
  contracts: "Federal contracts",
  estimates: "Estimate revisions",
  price: "Price level",
  tech_signal: "Technical signal",
  upcoming: "Upcoming dates",
  ir_document: "New IR documents",
  screen: "Screen membership",
  feed: "What-changed feed",
};

export const DELIVERABLE_LABEL: Record<Deliverable, string> = {
  report: "Report",
  dashboard: "Dashboard",
  memo: "Memo (Word)",
  csv: "CSV",
  xlsx: "Excel",
};
