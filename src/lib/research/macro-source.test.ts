import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { runTool } from "./execute";

describe("research macro source citations", () => {
  const treasury = "https://fiscaldata.treasury.gov/datasets";
  const debt = `${treasury}/debt-to-the-penny/debt-to-the-penny`;
  const rates = `${treasury}/average-interest-rates-treasury-securities/average-interest-rates-on-u-s-treasury-securities`;
  it.each([
    ["TSY_DEBT", debt],
    ["TSY_DEBT_PUBLIC", debt],
    ["TSY_AVG_RATE", rates],
    ["TOTALSA", "https://fred.stlouisfed.org/series/TOTALSA"],
    ["UNLISTED", "https://fred.stlouisfed.org/series/UNLISTED"],
  ])("quotes the data provider for %s", async (series_id, source) => {
    const client = new QueryClient();
    vi.spyOn(client, "fetchQuery").mockResolvedValue({
      title: series_id, units: "units", frequency: "Monthly", observations: [["2026-10-01", 3]],
    });
    const report = await runTool(client, "get_macro", { series_id });
    expect(report.output).toContain(`Source: ${source}\nLatest 2026-10-01: 3`);
  });
});
