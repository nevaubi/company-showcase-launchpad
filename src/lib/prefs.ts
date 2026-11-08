// Per-user interface preferences (density, open company tabs). Stored in the user's own `documents` row of kind
// "ui_prefs" so they follow the user across devices; localStorage holds a copy so the first paint is right.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export const PREFS_KIND = "ui_prefs";
const LS_KEY = "fu:prefs";

export type Density = "reading" | "dense";

export interface CompanyTab {
  ticker: string;
  /** last company sub-path visited, e.g. "financials" ("" = overview) */
  path: string;
  at: number;
}

export interface Prefs {
  density: Density;
  companyTabs: CompanyTab[];
}

const DEFAULTS: Prefs = { density: "reading", companyTabs: [] };
const MAX_TABS = 8;

let state: Prefs = DEFAULTS;
let rowId: string | null = null;
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): Prefs {
  const r = (raw ?? {}) as Partial<Prefs>;
  const density: Density = r.density === "dense" ? "dense" : "reading";
  const tabs = Array.isArray(r.companyTabs)
    ? r.companyTabs
        .filter((t): t is CompanyTab => !!t && typeof t.ticker === "string")
        .map((t) => ({ ticker: t.ticker.toUpperCase(), path: typeof t.path === "string" ? t.path.replace(/[^a-z0-9-]/gi, "") : "", at: Number(t.at) || 0 }))
        .slice(0, MAX_TABS)
    : [];
  return { density, companyTabs: tabs };
}

function emit() {
  for (const l of listeners) l();
}

function applyDensity(d: Density) {
  if (typeof document !== "undefined") document.documentElement.dataset.density = d;
}

function readLocal() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) state = sanitize(JSON.parse(s));
  } catch {
    /* storage unavailable */
  }
  applyDensity(state.density);
}

async function loadRemote() {
  if (loaded) return;
  loaded = true;
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data } = await supabase
      .from("documents")
      .select("id, content")
      .eq("kind", PREFS_KIND)
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      rowId = data.id;
      state = sanitize(data.content);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      } catch {
        /* storage unavailable */
      }
      applyDensity(state.density);
      emit();
    }
  } catch {
    /* keep local prefs */
  }
}

function scheduleSave() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const content = state as unknown as Json;
      if (rowId) {
        await supabase.from("documents").update({ content, updated_at: new Date().toISOString() }).eq("id", rowId);
      } else {
        const { data } = await supabase
          .from("documents")
          .insert({ user_id: auth.user.id, kind: PREFS_KIND, title: "Interface preferences", content })
          .select("id")
          .single();
        rowId = data?.id ?? null;
      }
    } catch {
      /* best effort: local copy stays */
    }
  }, 800);
}

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = sanitize({ ...state, ...next });
  applyDensity(state.density);
  emit();
  scheduleSave();
}

export const getPrefs = () => state;

let booted = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!booted && typeof window !== "undefined") {
    booted = true;
    readLocal();
    void loadRemote();
  }
  return () => listeners.delete(l);
}

export function usePrefs(): [Prefs, typeof setPrefs] {
  const p = useSyncExternalStore(subscribe, getPrefs, () => DEFAULTS);
  return [p, setPrefs];
}

export function toggleDensity() {
  setPrefs((p) => ({ density: p.density === "dense" ? "reading" : "dense" }));
}

/** Record a visit to a company page; keeps the most recent MAX_TABS companies. */
export function touchCompanyTab(ticker: string, path: string) {
  const t = ticker.toUpperCase();
  setPrefs((p) => {
    const rest = p.companyTabs.filter((x) => x.ticker !== t);
    const existing = p.companyTabs.find((x) => x.ticker === t);
    if (existing && existing.path === path) return {};
    const tab = { ticker: t, path, at: Date.now() };
    // keep the strip order stable for tabs already open; new tabs go at the end
    const tabs = existing ? p.companyTabs.map((x) => (x.ticker === t ? tab : x)) : [...rest, tab];
    while (tabs.length > MAX_TABS) {
      let oldest = -1;
      tabs.forEach((x, i) => {
        if (x.ticker !== t && (oldest < 0 || x.at < tabs[oldest].at)) oldest = i;
      });
      tabs.splice(oldest, 1);
    }
    return { companyTabs: tabs };
  });
}

export function closeCompanyTab(ticker: string) {
  setPrefs((p) => ({ companyTabs: p.companyTabs.filter((x) => x.ticker !== ticker.toUpperCase()) }));
}

/** One-key density toggle ("D"), ignored while typing. */
export function useDensityHotkey() {
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "d" || e.repeat) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest("[role=dialog] input, [contenteditable=true]"))) return;
    e.preventDefault();
    toggleDensity();
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);
}
