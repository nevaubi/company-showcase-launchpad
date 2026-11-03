import { useCallback, useSyncExternalStore } from "react";
import type { Scale } from "@/lib/format";

// Tiny localStorage-backed preference store shared across components and tabs.
const listeners = new Set<() => void>();
const KEY = "fu:prefs";

function readAll(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

let cache: Record<string, unknown> | null = null;
const snapshot = () => (cache ??= readAll());

function write(key: string, value: unknown) {
  const next = { ...snapshot(), [key]: value };
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** A persisted UI preference. Server render and first client render use the fallback. */
export function usePreference<T>(key: string, fallback: T, valid?: (v: unknown) => v is T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const v = snapshot()[key];
      return v === undefined || (valid && !valid(v)) ? fallback : (v as T);
    },
    () => fallback,
  );
  const set = useCallback((v: T) => write(key, v), [key]);
  return [value, set];
}

const SCALE_VALUES = new Set(["full", "K", "M", "B"]);
const isScale = (v: unknown): v is Scale => typeof v === "string" && SCALE_VALUES.has(v);

/** Dollar display scale used by every financial table (Full / $K / $M / $B). */
export const useUnitScale = () => usePreference<Scale>("unitScale", "M", isScale);
