import {
  act,
  cleanup,
  fireEvent,
  render as baseRender,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import jpm from "@/lib/ir/fixtures/statements/jpm.json";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { withCaptions } from "@/lib/ir/statements";
import { IrStatements } from "./statements";
import { gridColWidth } from "./table-style";

const open = vi.fn();
vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open }) }));
vi.mock("@/lib/data", () => ({ useCompany: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-plan", () => ({ useFeatureGate: () => () => true }));
vi.mock("@/hooks/use-preference", () => ({ useUnitScale: () => ["M", () => undefined] }));

const render = (ui: ReactElement) => baseRender(<TooltipProvider>{ui}</TooltipProvider>);
afterEach(cleanup);

let payload: IrPayload;
beforeAll(async () => {
  // jsdom has no IntersectionObserver: sections past the first few would wait for one.
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

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section")!;

// Each test renders the whole JPM payload: a few seconds alone, more on a loaded machine.
describe("IR statements", { timeout: 30_000 }, () => {
  it("lays out each printed table under its printed title, figures as printed, totals ticked when their parts add up", () => {
    const onSummary = vi.fn();
    render(
      <IrStatements
        ticker="JPM"
        payload={payload}
        onChecks={() => undefined}
        onSummary={onSummary}
      />,
    );
    const income = section("Consolidated statements of income");
    expect(
      within(income).getByText(
        "In millions, except per share and ratio data · Q4 FY24 to Q3 FY26 · 2 documents",
      ),
    ).toBeTruthy();
    const row = within(income)
      .getByRole("rowheader", { name: "Investment banking fees" })
      .closest("tr")!;
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.textContent?.trim())
        .at(-1),
    ).toBe("2,960");
    const total = within(income)
      .getByRole("rowheader", { name: "TOTAL NET REVENUE" })
      .closest("tr")!;
    expect(within(total).getAllByText("(parts add up)")).toHaveLength(8);
    expect(
      within(income)
        .getByRole("rowheader", { name: "Investment securities gains/(losses)" })
        .closest("tr")!.textContent,
    ).toContain("(658)");
    // Only the first section is laid out on first paint; the next mounts when it comes near (or on a jump).
    expect(
      screen.queryByRole("heading", { name: "Segment & corporate results - managed basis" }),
    ).toBeNull();
    const slot = document.querySelector('[data-statement-slot="0:8"]');
    expect(slot).toBeTruthy();
    act(() => void window.dispatchEvent(new CustomEvent("ir-statement-show", { detail: "0:8" })));
    expect(section("Segment & corporate results - managed basis")).toBeTruthy();
    expect(onSummary).toHaveBeenLastCalledWith(expect.objectContaining({ tieOk: 64, tieN: 64, sections: 2 }));
  });

  it("gives the tie-out mark its own slot: figures stay right-aligned beside it, one column width for the tab", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    const income = section("Consolidated statements of income");
    const total = within(income)
      .getByRole("rowheader", { name: "TOTAL NET REVENUE" })
      .closest("tr")!;
    for (const b of within(total).getAllByRole("button")) {
      const [figure, paren, mark, gutter] = [...b.children];
      expect(figure.textContent).toMatch(/^[\d,()]+$/);
      // the closing parenthesis, or its room on a positive figure, then the unit mark slot
      expect(paren.className).toContain("irg-paren");
      expect(mark.className).toContain("irg-mark");
      expect(gutter.hasAttribute("data-gutter")).toBe(true);
      expect(gutter.className).toContain("irg-flag");
      // the drawn tick, not an icon
      expect(gutter.querySelector("svg")).toBeNull();
      expect(gutter.children).toHaveLength(1);
    }
    // One column width for every section, set once on the grid: no section sets its own.
    const grid = income.closest("[data-statements-grid]") as HTMLElement;
    expect(grid.style.getPropertyValue("--col")).toMatch(
      /^max\(var\(--irt-colbase\), calc\(\d+ch \+ 42px\)\)$/,
    );
    expect(income.style.getPropertyValue("--col")).toBe("");
    expect(gridColWidth(9)).toBe("max(var(--irt-colbase), calc(9ch + 42px))");
  });

  it("finds a line: the matching line and the totals it rolls into, in every section that prints it", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Find a line"), { target: { value: "card income" } });
    const rows = within(section("Consolidated statements of income"))
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(rows).toEqual(["Card income", "Noninterest revenue", "TOTAL NET REVENUE"]);
    expect(
      screen.queryByRole("heading", { name: "Segment & corporate results - managed basis" }),
    ).toBeNull();
  });

  it("returns all matching statement rows when the search names a printed table", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Find a line"), { target: { value: "consolidated statements of income" } });
    const income = section("Consolidated statements of income");
    expect(within(income).getByRole("rowheader", { name: "Card income" })).toBeTruthy();
    expect(within(income).getByRole("rowheader", { name: "Investment banking fees" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Segment & corporate results - managed basis" })).toBeNull();
  });

  it("mounts a previously offscreen table immediately when filtering makes it the first result", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    expect(screen.queryByRole("heading", { name: "Segment & corporate results - managed basis" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Find a line"), { target: { value: "Segment & corporate results - managed basis" } });
    expect(section("Segment & corporate results - managed basis")).toBeTruthy();
  });

  it("opens the stored document at a figure, and widens to the whole history", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    const income = section("Consolidated statements of income");
    const row = within(income).getByRole("rowheader", { name: "Card income" }).closest("tr")!;
    fireEvent.click(within(row).getAllByRole("button").at(-1)!);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: "JPM",
        value: 1428000000,
        src: expect.objectContaining({ accn: "0001628280-26-065582" }),
      }),
    );
    expect(within(row).getAllByRole("button")).toHaveLength(8);
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Periods shown" })).getByRole("radio", {
        name: "All",
      }),
    );
    const wide = within(section("Consolidated statements of income"))
      .getByRole("rowheader", { name: "Card income" })
      .closest("tr")!;
    expect(within(wide).getAllByRole("button")).toHaveLength(9);
  });

  it("opens the checks for one section from its tie-out chip", () => {
    const onChecks = vi.fn();
    render(<IrStatements ticker="JPM" payload={payload} onChecks={onChecks} />);
    fireEvent.click(
      within(section("Consolidated statements of income")).getByTitle(
        /Open the checks for this section/,
      ),
    );
    expect(onChecks).toHaveBeenCalledWith("0:3", expect.any(Array));
    const shown = onChecks.mock.calls[0][1];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((x: {cell: {v:number}; check: {total:number; partial?:boolean}}) => x.cell.v === x.check.total && !x.check.partial)).toBe(true);
  });

  // irpolish: Statements ran about 28,000 px on JPM (33 sections): rows, headings and spacers are tightened to
  // the older site's density, a heading is one full-width line, and the jump control stays in reach.
  it("keeps the section jump in reach and lays rows out densely, headings on one full-width line", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    const bar = screen.getByLabelText("Go to a section").closest("[data-statements-bar]")!;
    expect(bar).toBeTruthy();
    expect(bar.closest("[data-statements-sticky]")!.className).toContain("sticky");
    expect(screen.getByLabelText("Find a line").closest("[data-statements-bar]")).toBe(bar);
    const income = section("Consolidated statements of income");
    const line = within(income).getByRole("rowheader", { name: "Card income" });
    // fixed-height grid rows: no cell or button pads itself taller
    expect(line.className).toContain("irg-fc");
    for (const b of within(line.closest("tr")!).getAllByRole("button"))
      expect(b.className).not.toMatch(/\bpy-/);
    const head = income.querySelector("th[scope=rowgroup]") as HTMLTableCellElement;
    const cols = line.closest("tr")!.children.length;
    expect(head.colSpan).toBe(cols);
    expect(head.className).toContain("whitespace-nowrap");
    const gap = income.querySelector("tr[aria-hidden] td") as HTMLElement | null;
    if (gap) expect(gap.className).not.toContain("h-3");
    // One column head row for the tab, in the same sticky layer as the bar; no section has its own.
    expect(income.querySelector("[data-head-strip]")).toBeNull();
    const layer = document.querySelector("[data-statements-sticky]")!;
    expect(layer.className).toContain("sticky");
    expect(layer.contains(bar)).toBe(true);
    expect(layer.querySelector("[data-head-strip]")).toBeTruthy();
  });
  it("shows tables only: no Table and Chart toggle, no chart mounted, placeholders as tall as their sections", () => {
    render(<IrStatements ticker="JPM" payload={payload} onChecks={() => undefined} />);
    expect(screen.queryByRole("radiogroup", { name: "View" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Chart" })).toBeNull();
    expect(document.querySelector("svg.recharts-surface, [data-ir-viz]")).toBeNull();
    // A section not mounted yet holds exactly its own height, from its rows.
    const hold = document.querySelector("[data-statement-hold]") as HTMLElement;
    expect(hold.style.getPropertyValue("--hold")).toMatch(
      /^calc\(var\(--irt-title\) \+ 0 \* var\(--irt-head\) \+ \d+ \* var\(--irt-row\) \+ \d+ \* var\(--irt-gap\)\)$/,
    );
  });
});
