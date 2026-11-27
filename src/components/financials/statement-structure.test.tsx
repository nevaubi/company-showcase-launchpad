import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceProvider } from "@/components/source/source-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Statement } from "@/lib/financials/types";
// Statements built by the repo's builder from SEC companyfacts (finfix's local build, newest four periods).
import fx from "./fixtures/sector-statements.json";
import { StatementTable } from "./statement-table";
import { classConcept, statementKeyOf, statementStructure } from "./statement-structure";

vi.mock("@/lib/data", () => ({ useCompany: () => ({ data: undefined }) }));
afterEach(cleanup);
// jsdom has no ResizeObserver; the table only uses it to decide which trend columns fit.
if (!("ResizeObserver" in globalThis))
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

type T = "JPM" | "PGR" | "UNH" | "PLD" | "NEE";
const st = (t: T, s: "income" | "balance" | "cashflow", f: "annual" | "quarterly" = "quarterly") =>
  (fx as unknown as Record<T, Record<string, Record<string, Statement>>>)[t][f][s];

function table(statement: Statement) {
  return render(
    <SourceProvider>
      <TooltipProvider>
        <StatementTable statement={statement} ticker="X" filingsByAccn={new Map()} />
      </TooltipProvider>
    </SourceProvider>,
  ).container;
}
const rowOf = (c: HTMLElement, key: string, s: Statement) => {
  const i = s.rows.filter((r) => r.cells.some(Boolean)).findIndex((r) => r.key === key);
  return c.querySelectorAll<HTMLTableRowElement>("tbody tr.irt-line")[i];
};
const heads = (c: HTMLElement) => [...c.querySelectorAll("tbody tr.irt-group")].map((x) => x.textContent);

describe("standardized statements set by their structure", () => {
  it("knows the statement from its rows", () => {
    expect(statementKeyOf(st("PLD", "balance").rows)).toBe("balance");
    expect(statementKeyOf(st("PLD", "cashflow").rows)).toBe("cashflow");
    expect(statementKeyOf(st("JPM", "income").rows)).toBe("income");
  });

  it("a bank's income statement: its own lines in the builder's order, total net revenue a subtotal, no gross profit or EBITDA", () => {
    const s = st("JPM", "income");
    const c = table(s);
    const keys = s.rows.map((r) => r.key);
    expect(keys.slice(0, 5)).toEqual(["bankInterestIncome", "bankInterestExpense", "netInterestIncome", "nonInterestIncome", "revenue"]);
    expect(keys).not.toContain("grossProfit");
    expect(keys).not.toContain("ebitda");
    expect(rowOf(c, "revenue", s).dataset.kind).toBe("sub");
    expect(rowOf(c, "bankInterestIncome", s).classList).toContain("irt-l1");
    expect(rowOf(c, "netIncome", s).dataset.kind).toBe("grand");
    expect(rowOf(c, "pretaxIncome", s).dataset.kind).toBe("sub");
    expect(heads(c)).toEqual(["Earnings per share", "Weighted average shares"]);
  });

  it("an insurer's: premiums and investment lines over total revenues, total expenses a subtotal", () => {
    const s = st("PGR", "income");
    const k = statementStructure("income", s.rows);
    const at = (key: string) => k[s.rows.findIndex((r) => r.key === key)].kind;
    expect(at("revenue")).toBe("sub");
    expect(at("insuranceExpenses")).toBe("sub");
    expect(at("premiumsEarned")).toBe("line");
    expect(s.rows.map((r) => r.key)).not.toContain("ebitda");
  });

  it("managed care: the medical cost ratio is a calculated line, net income before and after noncontrolling interests", () => {
    const s = st("UNH", "income");
    const c = table(s);
    const ratio = rowOf(c, "medicalCostRatio", s);
    expect(ratio.querySelector(".sr-only")?.textContent).toContain("calculated: Medical costs ÷ Premiums");
    expect(ratio.querySelector("[title^=Calculated]")).not.toBeNull();
    expect(rowOf(c, "netIncomeInclNci", s).dataset.kind).toBe("sub");
    expect(rowOf(c, "nciIncome", s).classList).toContain("irt-l1");
    expect(rowOf(c, "netIncome", s).dataset.kind).toBe("grand");
    // A reported line is never marked calculated now that the builder flags calculated rows.
    expect(rowOf(c, "premiums", s).querySelector(".sr-only")).toBeNull();
  });

  it("a REIT's balance sheet: assets, liabilities and equity heads, both closing totals grand", () => {
    const s = st("PLD", "balance");
    const c = table(s);
    expect(heads(c)).toEqual(["Assets", "Liabilities", "Equity"]);
    expect(rowOf(c, "totalAssets", s).dataset.kind).toBe("grand");
    expect(rowOf(c, "liabilitiesAndEquity", s).dataset.kind).toBe("grand");
    expect(rowOf(c, "totalLiabilities", s).dataset.kind).toBe("sub");
    // Stripes restart under each head.
    const first = rowOf(c, "cash", s);
    expect(first.classList).not.toContain("irt-stripe");
  });

  it("a cash flow statement: the three activities headed, their net cash subtotals, free cash flow calculated", () => {
    const s = st("PLD", "cashflow");
    const c = table(s);
    expect(heads(c)).toEqual(["Operating activities", "Investing activities", "Financing activities"]);
    expect(rowOf(c, "cfo", s).dataset.kind).toBe("sub");
    expect(rowOf(c, "fcf", s).querySelector(".sr-only")?.textContent).toContain("Cash from operations − Capex");
  });

  it("a utility's operating lines over total operating expenses, gains below them", () => {
    const s = st("NEE", "income");
    const keys = s.rows.map((r) => r.key);
    expect(keys.indexOf("fuelPower")).toBeLessThan(keys.indexOf("opex"));
    expect(keys).not.toContain("grossProfit");
    const k = statementStructure("income", s.rows);
    expect(k[keys.indexOf("opex")].kind).toBe("sub");
  });

  it("names a class-of-stock fact by the filing's own concept and class", () => {
    expect(classConcept("classB:EarningsPerShareBasic")).toEqual({
      concept: "us-gaap:EarningsPerShareBasic",
      label: "us-gaap:EarningsPerShareBasic, Class B shares",
    });
    expect(classConcept("us-gaap:EarningsPerShareBasic").concept).toBe("us-gaap:EarningsPerShareBasic");
  });
});

describe("whole figure columns beside the labels", () => {
  it("lets the label column take the slack so no figure is cut under it", async () => {
    const { wholeColumnsLabel } = await import("./statement-table");
    // A 390 px phone: frame 356, labels styled 176, figure columns of 80: a third column would leave the labels
    // less than their styled width, so two whole columns and labels of 196.
    expect(wholeColumnsLabel(356, 176, [80, 80, 80, 80, 80])).toBe(196);
    // Too narrow for one whole column beside a 128 px label: left as styled.
    expect(wholeColumnsLabel(300, 176, [180, 180])).toBeNull();
    expect(wholeColumnsLabel(320, 176, [180, 180])).toBe(140);
  });
});

describe("sector heads", () => {
  it("heads a managed care company's operating costs from medical costs on, and a REIT's from property expenses", () => {
    const unh = st("UNH", "income");
    const k = statementStructure("income", unh.rows);
    expect(k[unh.rows.findIndex((r) => r.key === "medicalCosts")].head).toBe("Operating expenses");
    const pld = st("PLD", "income");
    const kp = statementStructure("income", pld.rows);
    expect(kp[pld.rows.findIndex((r) => r.key === "propertyExpenses")].head).toBe("Operating expenses");
  });
});
