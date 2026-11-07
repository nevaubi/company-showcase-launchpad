// Canvas state for the assistant: dashboard views the agent renders, file deliverables and browser
// tasks. Lives in memory for the current chat session (cleared on "New chat").
import { useSyncExternalStore } from "react";
import { z } from "zod";

const num = z.number().finite();
const cell = z.union([z.string().max(400), num, z.null()]);

const Kpi = z.object({
  label: z.string().min(1).max(60),
  value: z.union([z.string().max(40), num]),
  unit: z.enum(["$", "%", "x", ""]).optional(),
  delta: num.nullable().optional(),
  note: z.string().max(120).optional(),
});

export const ViewSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("kpis"), title: z.string().max(120).optional(), items: z.array(Kpi).min(1).max(12) }),
  z.object({
    type: z.literal("chart"),
    title: z.string().max(120).optional(),
    chart: z.enum(["line", "bar", "area"]),
    unit: z.enum(["$", "%", ""]).optional(),
    x: z.string().min(1).max(40),
    series: z.array(z.string().min(1).max(40)).min(1).max(6),
    data: z.array(z.record(z.string(), cell)).min(1).max(400),
  }),
  z.object({
    type: z.literal("table"),
    title: z.string().max(120).optional(),
    columns: z.array(z.string().min(1).max(60)).min(1).max(16),
    rows: z.array(z.array(cell)).min(1).max(300),
  }),
  z.object({ type: z.literal("note"), title: z.string().max(120).optional(), markdown: z.string().min(1).max(12000) }),
  z.object({
    type: z.literal("code"),
    title: z.string().max(120).optional(),
    code: z.string().max(12000),
    stdout: z.string().max(20000).optional(),
    result: z.string().max(20000).optional(),
    error: z.string().max(4000).optional(),
  }),
  z.object({ type: z.literal("image"), title: z.string().max(120).optional(), src: z.string().url().max(4000), caption: z.string().max(300).optional() }),
  z.object({ type: z.literal("file"), title: z.string().max(120).optional(), fileId: z.string().min(1).max(80) }),
]);

export type ViewSpec = z.infer<typeof ViewSpecSchema>;

/** Validate a render_view spec. Returns a readable error for the model on failure. */
export function parseViewSpec(input: unknown): { ok: true; spec: ViewSpec } | { ok: false; error: string } {
  const r = ViewSpecSchema.safeParse(input);
  if (r.success) {
    const s = r.data;
    if (s.type === "chart") {
      const keys = new Set(s.data.flatMap((d) => Object.keys(d)));
      const missing = [s.x, ...s.series].filter((k) => !keys.has(k));
      if (missing.length) return { ok: false, error: `chart data has no field(s): ${missing.join(", ")}` };
    }
    if (s.type === "table" && s.rows.some((row) => row.length !== s.columns.length)) {
      return { ok: false, error: `every table row must have ${s.columns.length} cells` };
    }
    return { ok: true, spec: s };
  }
  const issue = r.error.issues[0];
  const t = (input as { type?: unknown } | null)?.type;
  if (issue?.code === "invalid_union_discriminator") return { ok: false, error: `unknown view type ${JSON.stringify(t)}; use kpis, chart, table, note, code, image or file` };
  return { ok: false, error: `${issue?.path.join(".") || "spec"}: ${issue?.message ?? "invalid"}` };
}

export interface CanvasView {
  id: string;
  spec: ViewSpec;
  pinned: boolean;
  at: number;
}

export interface CanvasFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Object URL (client-made) or presigned URL (browser downloads; short-lived). */
  url: string;
  source: "assistant" | "browser";
  at: number;
  preview?: string;
}

export interface BrowserRun {
  id: string;
  token: string;
  goal: string;
  status: string;
  done: boolean;
  liveUrl?: string | null;
  currentUrl?: string | null;
  pageTitle?: string | null;
  result?: string | null;
  error?: string | null;
  steps?: { id: number; tool: string; input: string; output: string; status: string }[];
  texts?: string[];
  costUsd?: string | null;
  startedAt: number;
}

export interface CanvasState {
  open: boolean;
  tab: "views" | "browser" | "files";
  views: CanvasView[];
  files: CanvasFile[];
  runs: BrowserRun[];
}

let state: CanvasState = { open: false, tab: "views", views: [], files: [], runs: [] };
const subs = new Set<() => void>();
const set = (next: Partial<CanvasState>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f());
};
let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const canvas = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  show(tab?: CanvasState["tab"]) {
    set({ open: true, ...(tab ? { tab } : {}) });
  },
  hide() {
    set({ open: false });
  },
  setTab(tab: CanvasState["tab"]) {
    set({ tab });
  },
  addView(spec: ViewSpec) {
    const v: CanvasView = { id: uid("v"), spec, pinned: false, at: Date.now() };
    set({ views: [...state.views, v], open: true, tab: "views" });
    return v;
  },
  removeView(id: string) {
    set({ views: state.views.filter((v) => v.id !== id) });
  },
  togglePin(id: string) {
    set({ views: state.views.map((v) => (v.id === id ? { ...v, pinned: !v.pinned } : v)) });
  },
  moveView(id: string, dir: -1 | 1) {
    const vs = [...state.views];
    const i = vs.findIndex((v) => v.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= vs.length) return;
    [vs[i], vs[j]] = [vs[j], vs[i]];
    set({ views: vs });
  },
  addFile(f: Omit<CanvasFile, "id" | "at">) {
    const file: CanvasFile = { ...f, id: uid("f"), at: Date.now() };
    set({ files: [...state.files, file] });
    return file;
  },
  file(id: string) {
    return state.files.find((f) => f.id === id);
  },
  upsertRuns(runs: Partial<BrowserRun>[]) {
    const byId = new Map(state.runs.map((r) => [r.id, r]));
    for (const r of runs) {
      if (!r.id) continue;
      const prev = byId.get(r.id);
      byId.set(r.id, { ...(prev ?? { token: "", goal: "", status: "queued", done: false, startedAt: Date.now() }), ...r } as BrowserRun);
    }
    set({ runs: [...byId.values()] });
  },
  run(id: string) {
    return state.runs.find((r) => r.id === id);
  },
  reset() {
    for (const f of state.files) if (f.url.startsWith("blob:")) URL.revokeObjectURL(f.url);
    set({ open: false, tab: "views", views: [], files: [], runs: [] });
  },
};

/** Views in display order: pinned first, then insertion order. */
export function orderedViews(views: CanvasView[]) {
  return [...views.filter((v) => v.pinned), ...views.filter((v) => !v.pinned)];
}

export function useCanvas() {
  return useSyncExternalStore(canvas.subscribe, canvas.get, canvas.get);
}
