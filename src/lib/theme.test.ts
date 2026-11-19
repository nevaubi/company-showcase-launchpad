import { readFileSync } from "node:fs";
import path from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
}));

import { setTheme, type ThemePref } from "@/lib/prefs";
import {
  applyThemeClass,
  isAppPath,
  resolveTheme,
  THEME_BOOT_SCRIPT,
  useApplyTheme,
  useResolvedTheme,
  withLightTheme,
} from "@/lib/theme";

type Listener = (e: MediaQueryListEvent) => void;

function stubMatchMedia(initial: boolean) {
  const state = { matches: initial, listeners: new Set<Listener>() };
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return state.matches;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, l: Listener) => state.listeners.add(l),
    removeEventListener: (_: string, l: Listener) => state.listeners.delete(l),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    state,
    set(next: boolean) {
      state.matches = next;
      for (const l of state.listeners) l({ matches: next } as MediaQueryListEvent);
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

const root = () => document.documentElement;

beforeEach(() => {
  root().classList.remove("dark");
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  root().classList.remove("dark");
});

describe("isAppPath", () => {
  it("accepts /app and its sub-paths only", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/")).toBe(true);
    expect(isAppPath("/app/companies/AAPL")).toBe(true);
    for (const p of ["/", "/approach", "/apps", "/pricing", "/auth", "/application/app", "app"]) {
      expect(isAppPath(p)).toBe(false);
    }
  });
});

describe("resolveTheme", () => {
  it.each<[ThemePref, boolean, "light" | "dark"]>([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ])("%s with system dark = %s resolves to %s", (pref, systemDark, expected) => {
    expect(resolveTheme(pref, systemDark)).toBe(expected);
  });
});

describe("applyThemeClass", () => {
  it("adds and removes the dark class on the document element", () => {
    applyThemeClass("dark");
    expect(root().classList.contains("dark")).toBe(true);
    applyThemeClass("light");
    expect(root().classList.contains("dark")).toBe(false);
    applyThemeClass("dark");
    applyThemeClass(null);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("targets a given element when one is passed", () => {
    const el = document.createElement("div");
    applyThemeClass("dark", el);
    expect(el.classList.contains("dark")).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
  });
});

describe("head boot script", () => {
  const run = () => new Function(THEME_BOOT_SCRIPT)();

  it.each<[ThemePref, boolean]>([
    ["light", false],
    ["light", true],
    ["dark", false],
    ["dark", true],
    ["system", false],
    ["system", true],
  ])("matches resolveTheme for %s with system dark = %s", (pref, systemDark) => {
    const mm = stubMatchMedia(systemDark);
    try {
      window.history.replaceState(null, "", "/app/companies");
      localStorage.setItem("fu:prefs", JSON.stringify({ theme: pref }));
      run();
      expect(root().classList.contains("dark")).toBe(resolveTheme(pref, systemDark) === "dark");
    } finally {
      mm.restore();
    }
  });

  it.each(["/pricing", "/", "/auth", "/approach", "/apps", "/application/app"])(
    "does nothing on %s",
    (p) => {
      window.history.replaceState(null, "", p);
      localStorage.setItem("fu:prefs", JSON.stringify({ theme: "dark" }));
      run();
      expect(root().classList.contains("dark")).toBe(false);
    },
  );

  it.each(["/app", "/app/", "/app/settings"])("applies on %s", (p) => {
    window.history.replaceState(null, "", p);
    localStorage.setItem("fu:prefs", JSON.stringify({ theme: "dark" }));
    run();
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("falls back to light on missing, unknown or broken prefs without throwing", () => {
    window.history.replaceState(null, "", "/app");
    run();
    expect(root().classList.contains("dark")).toBe(false);
    localStorage.setItem("fu:prefs", JSON.stringify({ theme: "sepia" }));
    run();
    expect(root().classList.contains("dark")).toBe(false);
    localStorage.setItem("fu:prefs", "{not json");
    expect(run).not.toThrow();
    expect(root().classList.contains("dark")).toBe(false);
  });
});

describe("useApplyTheme", () => {
  it("applies the preference, follows the system setting and clears the class on unmount", () => {
    const mm = stubMatchMedia(false);
    try {
      act(() => setTheme("dark"));
      const { unmount } = renderHook(() => useApplyTheme());
      expect(root().classList.contains("dark")).toBe(true);

      act(() => setTheme("light"));
      expect(root().classList.contains("dark")).toBe(false);

      act(() => setTheme("system"));
      expect(root().classList.contains("dark")).toBe(false);
      act(() => mm.set(true));
      expect(root().classList.contains("dark")).toBe(true);
      act(() => mm.set(false));
      expect(root().classList.contains("dark")).toBe(false);

      act(() => mm.set(true));
      unmount();
      expect(root().classList.contains("dark")).toBe(false);
      expect(mm.state.listeners.size).toBe(0);
    } finally {
      mm.restore();
      setTheme("light");
    }
  });
});

describe("useResolvedTheme", () => {
  it("reports light by default and follows the dark class", async () => {
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
    await act(async () => applyThemeClass("dark"));
    expect(result.current).toBe("dark");
    await act(async () => applyThemeClass("light"));
    expect(result.current).toBe("light");
  });

  it("follows the system setting through useApplyTheme when the preference is system", async () => {
    const mm = stubMatchMedia(false);
    try {
      act(() => setTheme("system"));
      const { result } = renderHook(() => {
        useApplyTheme();
        return useResolvedTheme();
      });
      await act(async () => {});
      expect(result.current).toBe("light");
      await act(async () => mm.set(true));
      expect(result.current).toBe("dark");
      await act(async () => mm.set(false));
      expect(result.current).toBe("light");
    } finally {
      mm.restore();
      setTheme("light");
    }
  });
});

describe("withLightTheme", () => {
  it("runs with the dark class removed and restores it, also when the callback throws", () => {
    applyThemeClass("dark");
    expect(withLightTheme(() => root().classList.contains("dark"))).toBe(false);
    expect(root().classList.contains("dark")).toBe(true);
    expect(() =>
      withLightTheme(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("accepts only synchronous callbacks (checked by tsc)", () => {
    const n: number = withLightTheme(() => 1);
    const label: string = withLightTheme(() => "x");
    expect([n, label]).toEqual([1, "x"]);
    const reject = () => {
      // @ts-expect-error async callbacks would run past the restored class, so the type forbids them
      withLightTheme(async () => 1);
      // @ts-expect-error promise-returning callbacks are rejected too
      withLightTheme(() => Promise.resolve(1));
    };
    expect(typeof reject).toBe("function");
  });

  it("leaves a light page untouched", () => {
    expect(withLightTheme(() => root().classList.contains("dark"))).toBe(false);
    expect(root().classList.contains("dark")).toBe(false);
  });
});

describe("styles.css theme blocks", () => {
  const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {\n`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("\n}\n", start));
  };

  it("keeps the logo plate and its text light in every theme", () => {
    expect(block(":root")).toContain("--logo-plate-foreground: oklch(0.19 0.012 260);");
    expect(block(".dark")).not.toContain("--logo-plate-foreground");
    expect(block(".dark")).toContain("--logo-plate: oklch(0.996 0.003 85);");
  });

  it("pins reports and Office document pages to every light token", () => {
    const root = block(":root");
    const report = block(".dark .report-doc,\n.dark .office-paper");
    const tokens = root.split("\n").filter((l) => /^\s+--(?!radius)/.test(l));
    expect(tokens.length).toBeGreaterThan(40);
    for (const line of tokens) expect(report).toContain(line.trim());
  });
});
