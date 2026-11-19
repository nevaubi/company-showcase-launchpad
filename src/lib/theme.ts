// Color theme for the signed-in app. The preference lives in prefs ("light" | "dark" | "system"); the `dark` class on
// <html> switches the tokens in styles.css. Public pages (landing, pricing, auth) always stay light, so the class is
// only set while the authenticated layout is mounted and by the head script on /app paths.
import { useEffect, useSyncExternalStore } from "react";
import { getPrefs, usePrefs, type ThemePref } from "@/lib/prefs";

export type ResolvedTheme = "light" | "dark";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** True for the signed-in app ("/app" and "/app/..."), not for public paths that merely start with "app". */
export function isAppPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return "light";
}

/** Adds or removes the `dark` class on the root element (defaults to document.documentElement). */
export function applyThemeClass(theme: ResolvedTheme | null, root?: HTMLElement) {
  const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  el.classList.toggle("dark", theme === "dark");
}

/** Rejects promise-like values at the type level; see withLightTheme. */
export type SyncOnly<T> = T & (T extends PromiseLike<unknown> ? never : unknown);

/**
 * Runs `fn` with the light tokens in effect, for code that reads computed styles to build exports (PNG, SVG, DOCX).
 * The class is restored before returning, in the same task, so the page never repaints in light. `fn` must be
 * synchronous: an async callback would keep running after the class is back, so its type is rejected.
 */
export function withLightTheme<T>(fn: () => SyncOnly<T>): T {
  const el = typeof document !== "undefined" ? document.documentElement : null;
  if (!el || !el.classList.contains("dark")) return fn();
  el.classList.remove("dark");
  try {
    return fn();
  } finally {
    el.classList.add("dark");
  }
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}

/**
 * Inline head script that sets the `dark` class before first paint on /app pages. Mirrors isAppPath, resolveTheme
 * and applyThemeClass; never throws.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var n=location.pathname;if(n!=="/app"&&n.indexOf("/app/")!==0)return;var t="light";var s=localStorage.getItem("fu:prefs");if(s){var p=JSON.parse(s);if(p&&(p.theme==="dark"||p.theme==="system"))t=p.theme;}var d=t==="dark"||(t==="system"&&typeof matchMedia==="function"&&matchMedia("${DARK_QUERY}").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

/** Applies the user's theme while mounted, follows the OS setting for "system", and restores light on unmount. */
export function useApplyTheme() {
  const [prefs] = usePrefs();
  const pref = prefs.theme;
  useEffect(() => {
    // Read the store directly: on the hydration render `pref` is still the server default, while the store already
    // holds the local copy the head script used, so this avoids undoing the script's class for one frame.
    const current = getPrefs().theme;
    applyThemeClass(resolveTheme(current, systemPrefersDark()));
    if (current !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => applyThemeClass(resolveTheme("system", e.matches));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  useEffect(() => () => applyThemeClass(null), []);
}

function subscribeThemeClass(onChange: () => void) {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

function themeClassSnapshot(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The theme currently applied to the page. It tracks the `dark` class itself, which useApplyTheme keeps in line with
 * the preference and the system setting, so a component reading CSS variables re-renders after they have changed
 * (and public pages, where the class is never set, always report light).
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeThemeClass, themeClassSnapshot, () => "light");
}
