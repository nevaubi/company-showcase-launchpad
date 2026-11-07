// Canvas state for the assistant: dashboard views the agent renders, file deliverables and browser
// tasks. Lives in memory for the current chat session (cleared on "New chat").
import { useSyncExternalStore } from "react";
import type { ViewSpec } from "@/lib/research/view-spec";

export { parseViewSpec, parseOrRepair, checkView, type ViewSpec } from "@/lib/research/view-spec";

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
  /** Render outcome per view id, reported by the canvas after mounting. */
  rendered: Record<string, { ok: boolean; error?: string }>;
  /** Label of a view the agent is building right now (shown as a loading card). */
  building: string | null;
}

let state: CanvasState = { open: false, tab: "views", views: [], files: [], runs: [], rendered: {}, building: null };
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
    const { [id]: _gone, ...rendered } = state.rendered;
    set({ views: state.views.filter((v) => v.id !== id), rendered });
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
    set({ open: false, tab: "views", views: [], files: [], runs: [], rendered: {}, building: null });
  },
  setBuilding(label: string | null) {
    if (state.building !== label) set(label && !state.open ? { building: label, open: true, tab: "views" } : { building: label });
  },
  reportRender(id: string, status: { ok: boolean; error?: string }) {
    const prev = state.rendered[id];
    if (prev && !prev.ok && status.ok) return; // a later "ok" never hides an error
    set({ rendered: { ...state.rendered, [id]: status } });
  },
  /** Resolve with a view's render outcome once the canvas reports it (or null after `ms`). */
  waitRender(id: string, ms = 1500): Promise<{ ok: boolean; error?: string } | null> {
    return new Promise((resolve) => {
      const done = (v: { ok: boolean; error?: string } | null) => {
        clearTimeout(t);
        unsub();
        resolve(v);
      };
      const unsub = canvas.subscribe(() => {
        const r = state.rendered[id];
        if (r && !r.ok) done(r);
      });
      const t = setTimeout(() => done(state.rendered[id] ?? null), ms);
    });
  },
};

/** Views in display order: pinned first, then insertion order. */
export function orderedViews(views: CanvasView[]) {
  return [...views.filter((v) => v.pinned), ...views.filter((v) => !v.pinned)];
}

export function useCanvas() {
  return useSyncExternalStore(canvas.subscribe, canvas.get, canvas.get);
}
