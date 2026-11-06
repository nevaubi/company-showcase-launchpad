import { describe, expect, it } from "vitest";
import { activityText, assignableRoles, canAct, canRemove, readableOn, resolveBranding, upside } from "./core";

describe("firm roles", () => {
  it("analysts can edit coverage but not manage members", () => {
    expect(canAct("analyst", "analyst")).toBe(true);
    expect(canAct("analyst", "admin")).toBe(false);
    expect(canAct("viewer", "analyst")).toBe(false);
    expect(canAct(null, "viewer")).toBe(false);
  });

  it("only owners can grant or take away ownership", () => {
    expect(assignableRoles("admin", "analyst")).toEqual(["admin", "analyst", "viewer"]);
    expect(assignableRoles("admin", "owner")).toEqual([]);
    expect(assignableRoles("owner", "owner")).toContain("owner");
    expect(assignableRoles("analyst", "viewer")).toEqual([]);
  });

  it("the last owner can never be removed, even by themselves", () => {
    expect(canRemove("owner", "owner", true, 1)).toBe(false);
    expect(canRemove("owner", "owner", true, 2)).toBe(true);
    expect(canRemove("admin", "owner", false, 2)).toBe(false);
    expect(canRemove("admin", "analyst", false, 1)).toBe(true);
    expect(canRemove("analyst", "viewer", false, 1)).toBe(false);
    expect(canRemove("viewer", "viewer", true, 1)).toBe(true);
  });
});

describe("coverage", () => {
  it("computes upside to target", () => {
    expect(upside(100, 125)).toBeCloseTo(0.25);
    expect(upside(200, 150)).toBeCloseTo(-0.25);
    expect(upside(null, 150)).toBeNull();
    expect(upside(100, null)).toBeNull();
  });

  it("describes rating and restricted changes in the audit trail", () => {
    const text = activityText("coverage.updated", { rating: ["hold", "buy"], restricted: [false, true], reason: "MNPI" }, () => "Ann");
    expect(text).toBe("rating Hold → Buy, added to restricted list (MNPI)");
  });

  it("describes invites and branding changes", () => {
    expect(activityText("invite.sent", { email: "a@b.co", role: "viewer" }, () => "")).toBe("invited a@b.co as Viewer");
    expect(activityText("invite.revoked", { email: "a@b.co" }, () => "")).toBe("revoked the invite for a@b.co");
    expect(activityText("firm.branding", { logo: true }, () => "")).toBe("updated the logo and report branding");
  });
});

describe("branding", () => {
  it("falls back to defaults for invalid colors and keeps valid ones", () => {
    const b = resolveBranding({ primary: "red", accent: "#112233", font: "comic" as never });
    expect(b.primary).toBe("#1d1d1b");
    expect(b.accent).toBe("#112233");
    expect(b.font).toBe("sans");
  });

  it("picks readable text on light and dark brand colors", () => {
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#0a2342")).toBe("#ffffff");
  });
});
