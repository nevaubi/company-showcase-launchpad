import { cleanup, fireEvent, render as baseRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import jpm from "@/lib/ir/fixtures/statements/jpm.json";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { withCaptions } from "@/lib/ir/statements";
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

describe("IR statements", () => {
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
    expect(section("Segment & corporate results - managed basis")).toBeTruthy();
    expect(onSummary).toHaveBeenLastCalledWith({ tieOk: 64, tieN: 64, sections: 2 });
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
    expect(onChecks).toHaveBeenCalledWith("0:3");
  });
});
