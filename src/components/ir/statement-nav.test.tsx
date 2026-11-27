import { cleanup, fireEvent, render as baseRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import jpm from "@/lib/ir/fixtures/statements/jpm.json";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, withCaptions } from "@/lib/ir/statements";
import { jumpGroups, sectorOf } from "@/lib/ir/sector-order";
import { filterOptions, missingNote, sectionFilter } from "./statement-nav";
import { totalKinds } from "./table-style";
import { IrStatements } from "./statements";

const open = vi.fn();
vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open }) }));
vi.mock("@/lib/data", () => ({ useCompany: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-plan", () => ({ useFeatureGate: () => () => true }));
vi.mock("@/hooks/use-preference", () => ({ useUnitScale: () => ["M", () => undefined] }));

const render = (ui: ReactElement) => baseRender(<TooltipProvider>{ui}</TooltipProvider>);
afterEach(cleanup);

let payload: IrPayload;
beforeAll(async () => {
  globalThis.IntersectionObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  const fx = jpm as unknown as {
    ticker: string;
    facts: IrFact[];
    captions: Record<string, TableCaption[]>;
  };
  const p = buildPayload(fx.ticker, fx.facts);
  payload = await withCaptions(p, async (d) => fx.captions[p.docs[d].id]);
});

describe("statement controls from the sections' kinds", () => {
  it("names chips by whole tables and offers only the ones the company's tables fill", () => {
    expect(filterOptions([{ kind: "income" }, { kind: "average" }, { kind: "capital" }])).toEqual([
      { v: "all", l: "All", n: 3 },
      { v: "profit", l: "Results and segments", n: 1 },
      { v: "balance", l: "Balances", n: 2 },
    ]);
    expect(sectionFilter({ filter: "revenue", kind: "income" })).toBe("revenue");
    expect(sectionFilter({})).toBeNull();
  });

  it("writes one quiet sentence for what the documents do not print", () => {
    expect(missingNote([], [])).toBeNull();
    expect(missingNote(["average", "capital"], ["CET1 ratio", "Return on equity"])).toBe(
      "Outside the available statement tables: average balances and yields and capital. These tables do not show CET1 ratio and return on equity.",
    );
  });

  it("groups JPM's jump list as a bank's, and the page keeps the supplement's order", () => {
    const secs = assembleStatements(payload, {
      sector: "Financials",
      industry: "Diversified Banks",
    });
    expect(secs.every((s) => s.kind && s.filter)).toBe(true);
    const groups = jumpGroups(secs, sectorOf("Financials", "Diversified Banks"));
    expect(groups[0].label).toBe("Income statement");
    expect(groups[0].sections[0].title).toBe("Consolidated statements of income");
    expect(groups.map((g) => g.label)).toContain("Segment results");
  });

  it("filters whole tables: Balances drops the income statement and the segment table", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    const bar = document.querySelector("[data-statements-bar]") as HTMLElement;
    const chips = within(bar)
      .getAllByRole("radio")
      .map((b) => b.textContent);
    expect(chips[0]).toBe("All");
    expect(chips).toContain("Results and segments");
    expect(screen.getByRole("heading", { name: "Consolidated statements of income" })).toBeTruthy();
    if (chips.includes("KPIs and ratios")) {
      fireEvent.click(within(bar).getByRole("radio", { name: "KPIs and ratios" }));
      expect(
        screen.queryByRole("heading", { name: "Consolidated statements of income" }),
      ).toBeNull();
    }
  });

  it("states the bank statements the JPM fixture does not hold, without alarm styling", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    const note = document.querySelector("[data-statements-absent]");
    expect(note?.textContent).toMatch(/^Outside the available statement tables: .*balance sheet/);
    expect(note?.className).not.toMatch(/amber|warning|destructive|red/);
  });

  it("sets a top-level total of totals as grand: JPM's total net revenue", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    const income = screen
      .getByRole("heading", { name: "Consolidated statements of income" })
      .closest("section")!;
    const tr = within(income).getByRole("rowheader", { name: "TOTAL NET REVENUE" }).closest("tr")!;
    expect(tr.className).toContain("irt-grand");
  });

  it("never lets a line only older printings carry close the table", () => {
    const k = totalKinds([
      { kind: "line", depth: 1 },
      { kind: "line", depth: 0, total: true, bold: true },
      { kind: "head" },
      { kind: "line", depth: 0, old: true, total: true },
    ]);
    expect(k).toEqual(["none", "grand", "none", "none"]);
    expect(
      totalKinds([
        { kind: "line", depth: 1, up: 2 },
        { kind: "line", depth: 1, total: true, up: 2 },
        { kind: "line", depth: 0, total: true },
        { kind: "line", depth: 0 },
        { kind: "line", depth: 0, total: true },
      ]),
    ).toEqual(["none", "sub", "grand", "none", "grand"]);
  });
});

describe("grid geometry", () => {
  it("knows a section's height from its rows: title band, printed heads, rows and spacers", async () => {
    const { GRID, sectionHeight, gridLabelPad } = await import("./table-style");
    expect(GRID.desktop).toMatchObject({ label: 320, col: 104, row: 28 });
    expect(GRID.phone).toMatchObject({ label: 168, col: 88, row: 32 });
    expect(sectionHeight({ rows: 10, gaps: 2, heads: 0 }, GRID.desktop)).toBe(48 + 280 + 16);
    expect(sectionHeight({ rows: 10, gaps: 2, heads: 1 }, GRID.phone)).toBe(48 + 36 + 320 + 16);
    expect([0, 1, 2, 3].map(gridLabelPad)).toEqual([12, 24, 36, 48]);
  });
});

describe("whole period columns", () => {
  it("fits two period columns beside a label of about 150 px on a phone, the label taking the slack elsewhere", async () => {
    const { fitGrid } = await import("./table-style");
    // 390 px phone, frame 327: two columns of 88 px, the label takes the rest (about 150 px).
    expect(fitGrid(327, 8, 80, true)).toEqual({ label: 151, col: 88 });
    // 430 px phone, frame 367: two columns of 108 px.
    expect(fitGrid(367, 8, 80, true)).toEqual({ label: 151, col: 108 });
    // Figures that need more than half: the label gives way, never under 112 px.
    expect(fitGrid(327, 8, 100, true)).toEqual({ label: 127, col: 100 });
    // 768 px tablet, frame 704, desktop widths: label 320 + whole columns of 104 px, the label takes the rest.
    const t = fitGrid(704, 8, 90, false);
    expect(t.col).toBe(104);
    expect((704 - t.label) % 104).toBe(0);
    expect(t.label).toBe(392);
    // Everything fits: the label keeps its width and the table is narrower than the frame.
    expect(fitGrid(1160, 6, 90, false)).toEqual({ label: 320, col: 104 });
  });
});

describe("short form of long figures", () => {
  it("shortens only figures in full units, never a figure in a printed scale", async () => {
    const { gridFigure } = await import("./table-style");
    expect(gridFigure("50,000,000", 5e7, 1, "", 7)).toBe("50M");
    expect(gridFigure("(1,800,000,000,000.0)", -1.8e12, 1, "", 10)).toBe("(1.8T)");
    // Apple's shares in thousands stay as printed: "15M" would read as fifteen million shares.
    expect(gridFigure("14,948,500", 1.49485e10, 1e3, "", Infinity)).toBe("14,948,500");
  });
});
