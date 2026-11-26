// irpolish: At a glance tiles printed raw dollars ("$50,907,000,000") while the statements print the company's
// scale ("50,907" in millions). A tile shows a compact reader figure with its unit in words, the same way on
// every tile and on the bank panel, whatever the page's $ scale; the tooltip keeps the figure as printed.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fmtReader, printedScaleWords } from "./format";
import { BankPanel, SummaryStrip } from "./index";
import type { VizSeries } from "./types";

vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open: vi.fn() }) }));
afterEach(cleanup);

const ends = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
const line = (key: string, label: string, vals: number[]): VizSeries => ({
  key,
  label,
  unit: "usd",
  cadence: "q",
  points: vals.map((v, i) => ({
    period: ends[i],
    periodLabel: `Quarter ended ${ends[i]}`,
    short: ends[i].slice(0, 7),
    value: v * 1e6,
    printed: v.toLocaleString("en-US"),
  })),
});
const revenue = line("rev", "TOTAL NET REVENUE", [47_120, 46_767, 50_536, 58_022, 50_907]);
const nii = line("nii", "Net interest income", [23_335, 25_053, 24_891, 25_412, 27_036]);
const loss = line("corp", "Corporate", [1_695, 825, 307, 699, -455]);

describe("irpolish: tile figures", () => {
  it("writes a reader figure with its unit in words", () => {
    expect(fmtReader(50_907e6, "usd")).toBe("$50.9 billion");
    expect(fmtReader(27_036e6, "usd")).toBe("$27.0 billion");
    expect(fmtReader(-455e6, "usd")).toBe("−$455 million");
    expect(fmtReader(1.2e12, "usd")).toBe("$1.20 trillion");
    expect(fmtReader(912_000, "usd")).toBe("$912 thousand");
    expect(fmtReader(18.5, "pct")).toBe("18.5%");
    expect(printedScaleWords(50_907e6, "50,907")).toBe("in millions");
    expect(printedScaleWords(5.2e9, "5.2")).toBe("in billions");
    expect(printedScaleWords(18.5, "18.5%")).toBe("");
  });
  it.each(["full", "M"] as const)("shows tiles in reader figures at the %s scale, the printed figure in the tooltip", (scale) => {
    const { container } = render(
      <TooltipProvider>
        <SummaryStrip tiles={[revenue, nii, loss]} mix={null} scale={scale} />
      </TooltipProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("$50.9 billion");
    expect(text).toContain("$27.0 billion");
    expect(text).toContain("−$455 million");
    expect(text).not.toMatch(/\$[\d,]{8,}/);
    expect(text).not.toContain("$50,907M");
    const tile = screen.getByRole("button", { name: /TOTAL NET REVENUE/ });
    expect(tile.getAttribute("title")).toBe("As filed: 50,907 (in millions)");
  });
  it("writes the bank panel's headline figures the same way", () => {
    const { container } = render(
      <TooltipProvider>
        <BankPanel figures={{ nii, nim: null, noninterest: null, noninterestLines: [], efficiency: null, credit: [], capital: [], balances: [] }} scale="full" />
      </TooltipProvider>,
    );
    expect(container.textContent).toContain("$27.0 billion");
    expect(container.textContent).not.toContain("27,036,000,000");
  });
});
