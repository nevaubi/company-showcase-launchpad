// Server-only client for the Browser Use Cloud API (v4 agent runs). The key is read from
// process.env.BROWSER_USE_API_KEY inside each call and never leaves the server.
//
// A run is one browser agent working on one goal. Its events carry the live view URL
// (browser.ready / browser.reattached), each tool step (core.event tool_use), text output and
// the terminal state; files the agent saved land in the run's workspace, files the browser
// downloaded in the browser session's downloads.

export const BU_BASE = "https://api.browser-use.com/api/v4";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BuStep {
  id: number;
  tool: string;
  input: string;
  output: string;
  status: "running" | "completed" | "error";
  at: number | null;
}

export interface BuRunView {
  id: string;
  task: string;
  title: string | null;
  status: string;
  done: boolean;
  result: string | null;
  error: string | null;
  liveUrl: string | null;
  browserSessionId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  currentUrl: string | null;
  pageTitle: string | null;
  steps: BuStep[];
  texts: string[];
  costUsd: string | null;
}

export interface BuFile {
  name: string;
  path: string;
  size: number;
  url: string | null;
  source: "workspace" | "download";
  modified: string | null;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "stopped", "error", "timed_out"]);

export function browserUseKey(): string | null {
  const k = process.env["BROWSER_USE_API_KEY"];
  return k && k.trim() ? k.trim() : null;
}

export class BrowserUseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(f: FetchLike, key: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await f(`${BU_BASE}${path}`, {
    ...init,
    headers: { "X-Browser-Use-API-Key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { detail?: unknown; message?: string };
      detail = typeof j.detail === "string"
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? ""}`).join("; ")
          : j.message ?? JSON.stringify(j.detail ?? j).slice(0, 300);
    } catch {
      /* not JSON */
    }
    const what = res.status === 401 || res.status === 403 ? "Browser Use rejected the API key" : res.status === 402 ? "Browser Use account is out of credit" : `Browser Use request failed (${res.status})`;
    throw new BrowserUseError(`${what}: ${detail}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface CreateRunInput {
  goal: string;
  startUrl?: string | null;
  mode?: "fast" | "thorough";
  maxCostUsd?: number;
  /** Ask the agent to save a full-page screenshot to its workspace. */
  screenshot?: boolean;
}

export function taskText(t: CreateRunInput) {
  const parts = [t.goal.trim()];
  if (t.startUrl) parts.unshift(`Start at ${t.startUrl}.`);
  if (t.screenshot) parts.push("When done, save a full-page PNG screenshot of the most relevant page to your workspace as screenshot.png.");
  parts.push("Save any files you download or create to your workspace. Finish with a concise summary of what you found, including the URLs you used.");
  return parts.join("\n");
}

export async function createRun(t: CreateRunInput, f: FetchLike = fetch, key = browserUseKey()) {
  if (!key) throw new BrowserUseError("Browser Use is not configured (set BROWSER_USE_API_KEY)", 503);
  const body: Record<string, unknown> = {
    task: taskText(t),
    maxCostUsd: Math.min(Math.max(t.maxCostUsd ?? 1, 0.1), 5),
  };
  if (t.mode !== "thorough") body.model = "bu-fast";
  const r = await call<{ id: string; status: string; sessionId: string; workspaceId: string }>(f, key, "/runs", { method: "POST", body: JSON.stringify(body) });
  return { id: r.id, status: r.status, sessionId: r.sessionId, workspaceId: r.workspaceId };
}

interface RawEvent {
  id: number;
  ts?: string;
  type: string;
  data: Record<string, unknown>;
}

const clip = (s: unknown, n: number) => {
  const v = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  return v.length > n ? `${v.slice(0, n)}…` : v;
};

/** Fold raw run events into a step list, live view URL, latest page and text output. */
export function foldEvents(events: RawEvent[]) {
  let liveUrl: string | null = null;
  let browserSessionId: string | null = null;
  let currentUrl: string | null = null;
  let pageTitle: string | null = null;
  let terminal: string | null = null;
  const steps = new Map<string, BuStep>();
  const texts: string[] = [];
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === "browser.ready" || e.type === "browser.reattached") {
      liveUrl = typeof d.live_view_url === "string" ? d.live_view_url : liveUrl;
      browserSessionId = typeof d.browser_session_id === "string" ? d.browser_session_id : browserSessionId;
    } else if (e.type === "run.completed" || e.type === "run.failed" || e.type === "run.cancelled") {
      terminal = e.type.slice(4);
    } else if (e.type === "core.event") {
      const part = (d.part ?? {}) as { type?: string; tool?: string; text?: string; state?: { input?: Record<string, unknown>; output?: unknown; status?: string; error?: unknown } };
      if (part.type === "tool") {
        const callId = String((d.part as { callID?: string }).callID ?? e.id);
        const input = part.state?.input ?? {};
        const output = part.state?.output ?? part.state?.error ?? "";
        const status = part.state?.status === "completed" ? "completed" : part.state?.status === "error" ? "error" : "running";
        const prev = steps.get(callId);
        steps.set(callId, {
          id: prev?.id ?? e.id,
          tool: String(part.tool ?? "action"),
          input: clip(typeof input.code === "string" ? input.code : input, 400),
          output: clip(output, 800),
          status,
          at: prev?.at ?? (typeof d.timestamp === "number" ? d.timestamp : null),
        });
        const m = typeof output === "string" ? output.match(/\[state\]\s*([^|\n]*)\|\s*(https?:\/\/\S+)/) : null;
        if (m) {
          pageTitle = m[1].trim() || pageTitle;
          currentUrl = m[2];
        }
        const u = typeof output === "string" ? output.match(/url:\s*'(https?:\/\/[^']+)'/) : null;
        if (u) currentUrl = u[1];
        const code = typeof input.code === "string" ? input.code : "";
        const opened = code.match(/(?:open|goto|navigate)\(\s*['"`](https?:\/\/[^'"`]+)/);
        if (opened && !currentUrl) currentUrl = opened[1];
      } else if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        texts.push(clip(part.text.trim(), 4000));
      }
    }
  }
  return { liveUrl, browserSessionId, currentUrl, pageTitle, terminal, steps: [...steps.values()].sort((a, b) => a.id - b.id), texts };
}

async function allEvents(f: FetchLike, key: string, id: string, maxPages = 6) {
  const out: RawEvent[] = [];
  let after: number | null = null;
  for (let p = 0; p < maxPages; p++) {
    const q = new URLSearchParams({ limit: "200", include_output: "true" });
    if (after != null) q.set("after", String(after));
    const r = await call<{ events: RawEvent[]; nextAfter: number | null; hasMore: boolean }>(f, key, `/runs/${encodeURIComponent(id)}/events?${q}`);
    out.push(...(r.events ?? []));
    if (!r.hasMore || r.nextAfter == null) break;
    after = r.nextAfter;
  }
  return out;
}

export async function getRun(id: string, f: FetchLike = fetch, key = browserUseKey()): Promise<BuRunView> {
  if (!key) throw new BrowserUseError("Browser Use is not configured (set BROWSER_USE_API_KEY)", 503);
  const [run, events] = await Promise.all([
    call<{ id: string; task: string; title: string | null; status: string; result: string | null; error: string | null; sessionId: string; workspaceId: string | null; totalCostUsd?: string }>(f, key, `/runs/${encodeURIComponent(id)}`),
    allEvents(f, key, id),
  ]);
  const ev = foldEvents(events);
  const status = run.status || ev.terminal || "running";
  return {
    id: run.id,
    task: run.task,
    title: run.title,
    status,
    done: TERMINAL.has(status),
    result: run.result,
    error: run.error,
    liveUrl: ev.liveUrl,
    browserSessionId: ev.browserSessionId,
    workspaceId: run.workspaceId,
    sessionId: run.sessionId,
    currentUrl: ev.currentUrl,
    pageTitle: ev.pageTitle,
    steps: ev.steps.slice(-40),
    texts: ev.texts.slice(-6),
    costUsd: run.totalCostUsd ?? null,
  };
}

export async function cancelRun(id: string, f: FetchLike = fetch, key = browserUseKey()) {
  if (!key) throw new BrowserUseError("Browser Use is not configured (set BROWSER_USE_API_KEY)", 503);
  await call(f, key, `/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
  return { id, cancelled: true };
}

export async function listRunFiles(
  ids: { workspaceId?: string | null; browserSessionId?: string | null },
  f: FetchLike = fetch,
  key = browserUseKey(),
): Promise<BuFile[]> {
  if (!key) throw new BrowserUseError("Browser Use is not configured (set BROWSER_USE_API_KEY)", 503);
  const out: BuFile[] = [];
  const base = (p: string) => p.split("/").pop() || p;
  if (ids.workspaceId) {
    const w = await call<{ files: { path: string; size: number; lastModified?: string; url?: string | null }[] }>(
      f, key, `/workspaces/${encodeURIComponent(ids.workspaceId)}/files?includeUrls=true`,
    );
    for (const x of w.files ?? []) out.push({ name: base(x.path), path: x.path, size: x.size, url: x.url ?? null, source: "workspace", modified: x.lastModified ?? null });
  }
  if (ids.browserSessionId) {
    const d = await call<{ files: { path: string; size: number; lastModified?: string; url?: string | null }[] }>(
      f, key, `/browsers/${encodeURIComponent(ids.browserSessionId)}/downloads?includeUrls=true`,
    ).catch(() => ({ files: [] }));
    for (const x of d.files ?? []) out.push({ name: base(x.path), path: x.path, size: x.size, url: x.url ?? null, source: "download", modified: x.lastModified ?? null });
  }
  return out;
}
