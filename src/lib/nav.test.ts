import { describe, expect, it } from "vitest";
import { hubFor, isAdminPath, HUB_GROUPS } from "./nav";

describe("navigation hubs", () => {
  it("groups merged pages under one hub", () => {
    expect(hubFor("/app/screener")?.id).toBe("companies");
    expect(hubFor("/app/agents")?.id).toBe("dashboard");
    expect(hubFor("/app")?.id).toBe("dashboard");
    expect(hubFor("/app/billing")?.id).toBe("firm");
    expect(hubFor("/app/companies/AAPL/financials")?.id).toBe("companies");
  });
  it("data status and waitlist are admin-only", () => {
    expect(isAdminPath("/app/status")).toBe(true);
    expect(isAdminPath("/app/admin")).toBe(true);
    expect(isAdminPath("/app/feed")).toBe(false);
  });
  it("the sidebar shows at most 9 entries to members", () => {
    const n = HUB_GROUPS.filter((g) => !g.admin && g.menu !== false).reduce((s, g) => s + g.hubs.length, 0);
    expect(n).toBeLessThanOrEqual(9);
  });
});
