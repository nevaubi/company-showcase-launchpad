import { cleanup, fireEvent, render as baseRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AAPL } from "./fixtures/aapl";
import { fixturePayload } from "./fixtures/build";
import { JPM } from "./fixtures/jpm";
import { defaultBridge } from "./model";
import { bankFiguresOf, marginFiguresOf, partsOf, segmentMixOf, summaryTilesOf } from "./from-payload";
import { BankPanel, BridgeChart, MarginPanel, SectionChart, SummaryStrip } from "./index";

const open = vi.fn();
vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open }) }));

const render = (ui: ReactElement) => baseRender(<TooltipProvider>{ui}</TooltipProvider>);
afterEach(cleanup);

const jpm = fixturePayload(JPM);
const aapl = fixturePayload(AAPL);

describe("IR viz components", () => {
  it("a missing chart is a one-line note, never an empty frame", () => {
    render(<BridgeChart bridge={null} reason="The lines of Fees do not add up to the printed total in Sep ’26, so no bridge is drawn." scale="M" />);
    expect(screen.getByText(/do not add up/)).toBeTruthy();
    const { container } = render(<SectionChart title="Empty" series={[]} scale="M" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("No figures to chart for Empty.")).toBeTruthy();
  });

  it("no bank panel for a company without bank figures; Apple's margin note", () => {
    const { container } = render(<BankPanel figures={bankFiguresOf(aapl, "AAPL")} scale="M" />);
    expect(container.innerHTML).toBe("");
    render(<MarginPanel figures={marginFiguresOf(aapl, "AAPL")} scale="M" />);
    expect(screen.getByText(/prints no margin as a percentage/)).toBeTruthy();
  });

  it("JPM bank panel names the printed lines and never computes the ratio", () => {
    render(<BankPanel figures={bankFiguresOf(jpm, "JPM")} scale="M" />);
    expect(screen.getByText("Overhead ratio as the company prints it; not computed here.")).toBeTruthy();
    expect(screen.getAllByText("NET YIELD ON INTEREST-EARNING ASSETS").length).toBeGreaterThan(0);
  });

  it("tiles carry the latest figure, YoY and the as-filed text, and open the source", () => {
    open.mockClear();
    render(<SummaryStrip tiles={summaryTilesOf(jpm, "JPM")} mix={segmentMixOf(jpm, "JPM")} scale="M" />);
    const tile = screen.getByRole("button", { name: /^Net interest income, Quarter ended September 30, 2026: \$27,036M, \+12\.8% on a year/ });
    expect(tile.getAttribute("aria-label")).toMatch(/As filed 27,036/);
    fireEvent.click(tile);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ ticker: "JPM", label: "Net interest income", value: 27_036e6 }));
  });

  it("keyboard: arrows move between periods, Enter opens the active figure", () => {
    open.mockClear();
    const g = jpm.groups.find((x) => x.id === "g_seg")!;
    const parts = partsOf(jpm, "JPM", g)!;
    render(<SectionChart title="Segments" series={parts.parts} parts={parts} view="stacked" scale="M" />);
    const chart = screen.getByRole("group", { name: /^Segments/ });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toMatch(/Quarter ended June 30, 2026/);
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ label: "Consumer & Community Banking", value: 20_272e6 }));
  });

  it("bridge rows are buttons named with both as-filed figures", () => {
    const g = jpm.groups.find((x) => x.id === "g_seg")!;
    const { bridge } = defaultBridge(partsOf(jpm, "JPM", g)!);
    render(<BridgeChart bridge={bridge} scale="M" />);
    expect(screen.getByRole("button", { name: /^Corporate: −\$1,610M, from \$1,703M \(Sep ’25\) to \$93M \(Sep ’26\), as filed 1,703 and 93$/ })).toBeTruthy();
  });
});
