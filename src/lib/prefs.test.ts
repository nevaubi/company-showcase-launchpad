import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
}));

import { getPrefs, sanitizePrefs, setTheme } from "@/lib/prefs";

describe("sanitizePrefs theme", () => {
  it("defaults to light when the field is missing", () => {
    expect(sanitizePrefs({}).theme).toBe("light");
    expect(sanitizePrefs(null).theme).toBe("light");
    expect(sanitizePrefs({ density: "dense", companyTabs: [] }).theme).toBe("light");
  });

  it("falls back to light for unknown values", () => {
    for (const theme of ["sepia", "DARK", "", 1, true, null, { mode: "dark" }]) {
      expect(sanitizePrefs({ theme }).theme).toBe("light");
    }
  });

  it("keeps valid values", () => {
    expect(sanitizePrefs({ theme: "light" }).theme).toBe("light");
    expect(sanitizePrefs({ theme: "dark" }).theme).toBe("dark");
    expect(sanitizePrefs({ theme: "system" }).theme).toBe("system");
  });

  it("leaves the other fields as before", () => {
    const p = sanitizePrefs({
      density: "dense",
      theme: "dark",
      companyTabs: [{ ticker: "aapl", path: "financials", at: 5 }],
    });
    expect(p).toEqual({
      density: "dense",
      theme: "dark",
      companyTabs: [{ ticker: "AAPL", path: "financials", at: 5 }],
    });
  });
});

describe("setTheme", () => {
  it("updates the store and the local copy", () => {
    setTheme("system");
    expect(getPrefs().theme).toBe("system");
    expect(JSON.parse(localStorage.getItem("fu:prefs") ?? "{}").theme).toBe("system");
    setTheme("light");
    expect(getPrefs().theme).toBe("light");
  });
});
