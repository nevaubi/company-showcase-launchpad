// irstyle (round 8): the "At a glance" chart strip and the Financial map were taken off the IR tab to be
// redone later. Their files stay in the repo, unused; this keeps either from coming back by accident.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = "src/routes/_authenticated/app.companies.$ticker.ir.tsx";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("IR tab layout", () => {
  it("mounts no At a glance strip and no Financial map", () => {
    const route = readFileSync(ROUTE, "utf8");
    expect(route).not.toMatch(/IrTopViz|IrFinancialMap|financial-map/);
  });

  it("no page renders the removed views", () => {
    const users = sources("src").filter((p) => {
      if (p.endsWith("viz-slots.tsx") || p.endsWith("financial-map.tsx")) return false;
      if (p.includes(join("components", "ir", "viz"))) return false;
      const src = readFileSync(p, "utf8");
      return /\bIrTopViz\b|\bIrFinancialMap\b/.test(src) || /SummaryStrip[^"]*"@\/components\/ir\/viz/.test(src);
    });
    expect(users).toEqual([]);
  });

  it("shows the XBRL breakdowns without the Money map", () => {
    const route = readFileSync(ROUTE, "utf8");
    expect(route).not.toMatch(/\bMoneyMap\b|money-map/);
    const views = [...route.matchAll(/<FilingDetailView\b[^>]*>/g)].map((m) => m[0]);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) expect(v).toMatch(/\bmap=\{false\}/);
  });

  it("keeps the order KPIs, statements, XBRL breakdowns, documents", () => {
    const route = readFileSync(ROUTE, "utf8");
    const at = (s: string) => route.indexOf(s);
    expect(at("<IrStandardKpis")).toBeGreaterThan(0);
    expect(at("<IrStandardKpis")).toBeLessThan(at("<IrStatements"));
    expect(at("<IrStatements")).toBeLessThan(at("<IrXbrlBreakdowns ticker"));
    expect(at("<IrXbrlBreakdowns ticker")).toBeLessThan(at("<IrDocuments"));
  });
});
