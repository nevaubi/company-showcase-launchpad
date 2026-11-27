// Year-to-date sections (findings irrules-05, irrules-06) on a synthetic cash flow statement printed year to
// date only: columns as printed under their length and end date, quarters only on request and marked as
// calculated with their formula, the Annual switch on full years.
import { cleanup, fireEvent, render as baseRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import type { Statement } from "@/lib/ir/statements";
import fx from "./fixtures/ytd-cashflow.synthetic.json";
import { IrStatements } from "./statements";
import {
  isYtdSection,
  parseYtdKey,
  sortYtd,
  ytdCellsOf,
  ytdHead,
  ytdInSpan,
  ytdLong,
  ytdRowCells,
} from "./ytd";

const open = vi.fn();
vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open }) }));
vi.mock("@/lib/data", () => ({ useCompany: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-plan", () => ({ useFeatureGate: () => () => true }));
vi.mock("@/hooks/use-preference", () => ({ useUnitScale: () => ["M", () => undefined] }));
// The rules side marks the section (`basis: "ytd"`); until it lands the fixture's statement stands in for it.
vi.mock("@/lib/ir/statements", async (orig) => {
  const real = await orig<typeof import("@/lib/ir/statements")>();
  const data = (await import("./fixtures/ytd-cashflow.synthetic.json")).default;
  return {
    ...real,
    assembleStatements: () => [structuredClone(data.statement) as unknown as Statement],
  };
});

const render = (ui: ReactElement) => baseRender(<TooltipProvider>{ui}</TooltipProvider>);
afterEach(() => {
  cleanup();
  open.mockClear();
});

const payload = fx.payload as unknown as IrPayload;
const byKey = new Map(payload.series.map((s) => [s.k, s as PayloadSeries]));
beforeAll(() => {
  globalThis.IntersectionObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

const section = () =>
  screen
    .getByRole("heading", { name: "Condensed consolidated statements of cash flows" })
    .closest("section")!;
// A year-to-date section prints its own head row; any other section reads the tab's head row.
const heads = (sec: HTMLElement) =>
  [
    ...(
      sec.querySelector("thead.irg-ownhead") ?? document.querySelector("[data-head-strip]")!
    ).querySelectorAll("th"),
  ]
    .slice(1)
    .map((th) => th.textContent);
const rowOf = (sec: HTMLElement, name: string) =>
  within(sec).getByRole("rowheader", { name }).closest("tr")!;
const figures = (tr: HTMLElement) =>
  within(tr)
    .getAllByRole("button")
    .map((b) => b.children[0].textContent);

describe("year-to-date columns", () => {
  it("reads printed year-to-date figures with the printed first quarters and full years, never a derived quarter", () => {
    const cfo = byKey.get("cfo")!;
    expect(sortYtd(Object.keys(ytdCellsOf(cfo)))).toEqual([
      "3:2025-03-31",
      "6:2025-06-30",
      "9:2025-09-30",
      "12:2025-12-31",
      "3:2026-03-31",
      "6:2026-06-30",
      "9:2026-09-30",
    ]);
    expect(Object.values(ytdCellsOf(cfo)).every((c) => !c.f && c.d != null)).toBe(true);
    // a line with no year-to-date printing has no year-to-date columns, its quarters and years stay out
    expect(ytdCellsOf({ ...cfo, ytd: undefined } as PayloadSeries)).toEqual({});
    expect(ytdRowCells(["cfo"], byKey).cells["9:2026-09-30"].v).toBe(3674e6);
    expect(parseYtdKey("2026-09-30")).toBeNull();
    expect(ytdHead("9:2026-09-30")).toEqual({
      main: "9 months to",
      sub: "30 Sep 2026",
      short: "9 months to 30 Sep 2026",
    });
    expect(ytdLong("6:2026-06-30")).toBe("6 months ended 30 June 2026");
    expect(
      ytdInSpan(
        ["9:2025-09-30", "9:2026-09-30"],
        ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"],
        "4",
      ),
    ).toEqual(["9:2026-09-30"]);
    expect(isYtdSection(fx.statement as unknown as Statement)).toBe(true);
  });

  it("shows the section's columns as printed, each under its length and end date, never as quarters", () => {
    render(<IrStatements ticker="YTDX" payload={payload} onChecks={() => undefined} />);
    const sec = section();
    expect(heads(sec)).toEqual([
      "3 months to31 Mar 2025",
      "6 months to30 Jun 2025",
      "9 months to30 Sep 2025",
      "12 months to31 Dec 2025",
      "3 months to31 Mar 2026",
      "6 months to30 Jun 2026",
      "9 months to30 Sep 2026",
    ]);
    expect(sec.textContent).not.toMatch(/Q[1-4] FY/);
    expect(
      within(sec).getByText(/Year-to-date columns as printed · 31 Mar 2025 to 30 Sep 2026/),
    ).toBeTruthy();
    const cfo = rowOf(sec, "Net cash provided by operating activities");
    expect(figures(cfo)).toEqual(["690", "2,015", "3,390", "4,740", "718", "2,161", "3,674"]);
    // printed figures only: nothing in the section is marked as calculated
    expect(sec.querySelector(".decoration-dotted")).toBeNull();
    const last = within(cfo).getAllByRole("button").at(-1)!;
    expect(last.title).toContain("9 months ended 30 September 2026");
    expect(last.title).toContain("Printed as “3,674”");
    fireEvent.click(last);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({
      value: 3674e6,
      periodLabel: "9 months ended September 30, 2026",
    });
    // a long printed name stays readable in full on hover
    const wc = within(sec).getByRole("rowheader", { name: /^Changes in operating assets/ });
    expect(wc.getAttribute("title")).toBe(byKey.get("wc")!.label);
  });

  it("switches one section to quarters, each calculated quarter marked with its formula and opening both printed parts", () => {
    render(<IrStatements ticker="YTDX" payload={payload} onChecks={() => undefined} />);
    fireEvent.click(within(section()).getByRole("radio", { name: "Quarters" }));
    const sec = section();
    expect(heads(sec).at(-1)).toMatch(/^Q3/);
    expect(
      within(sec).getByText(/Quarters, calculated from the year-to-date figures where not printed/),
    ).toBeTruthy();
    const cfo = rowOf(sec, "Net cash provided by operating activities");
    // Q3 2026 = nine months 3,674 less six months 2,161
    expect(figures(cfo).at(-1)).toBe("1,513");
    const q3 = within(cfo).getAllByRole("button").at(-1)!;
    expect(q3.title).toContain("Calculated: Nine months YTD − six months YTD");
    expect(q3.querySelector(".decoration-dotted")).toBeTruthy();
    fireEvent.click(q3);
    const target = open.mock.calls[0][0];
    expect(target.derived).toBeTruthy();
    expect(JSON.stringify(target.derived)).toContain("Nine months ending 2026-09-30");
    // and back
    fireEvent.click(within(section()).getByRole("radio", { name: "Year to date" }));
    expect(heads(section()).at(-1)).toBe("9 months to30 Sep 2026");
  });

  it("shows full years under Annual, without the year-to-date note or switch", () => {
    render(<IrStatements ticker="YTDX" payload={payload} onChecks={() => undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: "Annual" }));
    const sec = section();
    expect(within(sec).queryByText(/Year-to-date columns/)).toBeNull();
    expect(within(sec).queryByRole("radio", { name: "Quarters" })).toBeNull();
    expect(figures(rowOf(sec, "Net cash provided by operating activities"))).toEqual(["4,740"]);
  });
});
