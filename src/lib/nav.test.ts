import { describe, expect, it } from "vitest";
import {
  ADMIN_PATHS,
  HUB_GROUPS,
  SIDEBAR_HUBS,
  groupByHub,
  hubFor,
  isAdminPath,
  isPageActive,
} from "./nav";

describe("navigation hubs", () => {
  it("members see exactly six sidebar pages, in order", () => {
    const visible = HUB_GROUPS.filter((g) => !g.admin && g.menu !== false).flatMap((g) => g.hubs);
    expect(visible.map((h) => [h.id, h.label])).toEqual([
      ["dashboard", "Overview"],
      ["companies", "Companies"],
      ["filings", "Filings and data"],
      ["markets", "Markets"],
      ["signals", "Signals"],
      ["research", "Research"],
    ]);
    expect(SIDEBAR_HUBS).toEqual(visible);
  });

  it("puts each page under its hub", () => {
    expect(hubFor("/app")?.id).toBe("dashboard");
    expect(hubFor("/app/screener")?.id).toBe("companies");
    expect(hubFor("/app/companies/AAPL/financials")?.id).toBe("companies");
    expect(hubFor("/app/supply-chain")?.id).toBe("filings");
    expect(hubFor("/app/alt-data")?.id).toBe("filings");
    expect(hubFor("/app/hedge-funds")?.id).toBe("markets");
    expect(hubFor("/app/agents")?.id).toBe("signals");
    expect(hubFor("/app/feed")?.id).toBe("signals");
    expect(hubFor("/app/autopilots/bot-1")?.id).toBe("signals");
    expect(hubFor("/app/research")?.id).toBe("research");
    expect(hubFor("/app/theses")?.id).toBe("research");
    expect(hubFor("/app/office/doc-1")?.id).toBe("research");
    expect(hubFor("/app/unknown")).toBeUndefined();
  });

  it("Overview has a single page, so it shows no tabs", () => {
    expect(hubFor("/app")?.pages).toHaveLength(1);
    expect(isPageActive({ to: "/app", exact: true }, "/app/feed")).toBe(false);
  });

  it("account pages resolve to the account hub and stay out of the sidebar", () => {
    expect(hubFor("/app/billing")?.id).toBe("account");
    expect(hubFor("/app/settings")?.id).toBe("account");
    expect(hubFor("/app/firm/coverage")?.id).toBe("account");
    expect(SIDEBAR_HUBS.some((h) => h.id === "account")).toBe(false);
  });

  it("admin pages are admin-only and not in the sidebar", () => {
    expect(isAdminPath("/app/status")).toBe(true);
    expect(isAdminPath("/app/admin")).toBe(true);
    expect(isAdminPath("/app/worker/jobs")).toBe(true);
    expect(isAdminPath("/app/feed")).toBe(false);
    expect(isAdminPath("/app/administrator")).toBe(false);
    const admin = HUB_GROUPS.find((g) => g.admin);
    expect(admin?.menu).toBe(false);
    expect(admin?.hubs.flatMap((h) => h.pages.map((p) => p.to))).toEqual(ADMIN_PATHS);
    expect(SIDEBAR_HUBS.some((h) => h.id === "admin")).toBe(false);
  });

  it("groups path-keyed items by hub in sidebar and tab order, leaving admin and unknown paths out", () => {
    const groups = groupByHub([
      { to: "/app/settings" },
      { to: "/app/agents" },
      { to: "/app/feed" },
      { to: "/app/admin" },
      { to: "/app/theses" },
      { to: "/app" },
      { to: "/app/nowhere" },
    ]);
    expect(groups.map((g) => [g.hub.id, g.items.map((i) => i.to)])).toEqual([
      ["dashboard", ["/app"]],
      ["signals", ["/app/feed", "/app/agents"]],
      ["research", ["/app/theses"]],
      ["account", ["/app/settings"]],
    ]);
  });

  it("lists every page once", () => {
    const paths = HUB_GROUPS.flatMap((g) => g.hubs.flatMap((h) => h.pages.map((p) => p.to)));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
