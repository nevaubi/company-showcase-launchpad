import { describe, expect, it } from "vitest";
import { HUB_GROUPS, SIDEBAR_HUBS } from "@/lib/nav";
import { isAppPath, siteMapText } from "./site-map";

describe("site map", () => {
  it("lists sidebar pages and company tabs with paths, leaving admin pages out", () => {
    const map = siteMapText("nvda");
    expect(map).toContain("- Screener · /app/screener · Filter companies on fundamentals");
    expect(map).toContain("- Insiders & influence · /app/companies/NVDA/insiders");
    expect(map).not.toContain("/app/admin");
    expect(siteMapText()).toContain("/app/companies/TICKER/financials");
  });

  it("only lets the assistant open real app pages", () => {
    expect(isAppPath("/app/supply-chain?t=RTX")).toBe(true);
    expect(isAppPath("/app/companies/BRK.B/financials")).toBe(true);
    expect(isAppPath("/app/companies/NVDA")).toBe(true);
    expect(isAppPath("/app/admin")).toBe(false);
    expect(isAppPath("/app/companies/NVDA/delete")).toBe(false);
    expect(isAppPath("https://example.com")).toBe(false);
    expect(isAppPath("/app/billing/../admin")).toBe(false);
  });

  it("lists every non-admin page in the navigation and no admin page", () => {
    const map = siteMapText();
    for (const g of HUB_GROUPS)
      for (const h of g.hubs)
        for (const p of h.pages) {
          const line = `- ${p.label} · ${p.to}`;
          if (g.admin) expect(map).not.toContain(line);
          else expect(map).toContain(line);
        }
  });

  it("says which entries are in the sidebar and which open from the account menu", () => {
    const map = siteMapText();
    for (const h of SIDEBAR_HUBS)
      expect(map).toContain(`Sidebar: ${h.label} · point with [data-tour='hub-${h.id}']`);
    expect(map).toContain(
      "Account menu (avatar at the bottom of the sidebar) · point with [data-tour='account']",
    );
    expect(map).not.toContain("Sidebar: Account");
    expect(map).toContain("open from the account menu, the avatar at the bottom of the sidebar");
    expect(map).toContain("Admin pages (admins only) are also in that menu");
    expect(map).toContain(
      "The theme switch (Light, Dark, System) is in the account menu and on the Settings page under Appearance.",
    );
    const lines = map.split("\n");
    const menu = lines.findIndex((l) => l.startsWith("Account menu"));
    expect(lines.slice(menu + 1, menu + 4)).toEqual([
      expect.stringContaining("- Settings · /app/settings"),
      expect.stringContaining("- Firm · /app/firm"),
      expect.stringContaining("- Plan and billing · /app/billing"),
    ]);
  });
});
