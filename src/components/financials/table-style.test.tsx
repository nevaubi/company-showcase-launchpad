import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SourceProvider } from "@/components/source/source-context";
import type { CompanyDataset, Row, Statement } from "@/lib/financials/types";
import aapl from "@/test/fixtures/companies/AAPL.json";
import jpm from "@/test/fixtures/companies/JPM.json";
import { StatementTable, statementRowKind } from "./statement-table";
import { FiledGrid, gridRowKind, type GridRow } from "./filed-grid";
import { orderColumns, shapeLines, sumsTo, type LineFacts } from "./as-reported-structure";
import { templateLineKind } from "./industry-template";

beforeAll(() => {
  // jsdom has no ResizeObserver; the statement table only uses it to decide which trend columns fit.
  if (!("ResizeObserver" in globalThis))
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

const income = (d: unknown) => (d as CompanyDataset).statements.annual.income as Statement;
const balance = (d: unknown) => (d as CompanyDataset).statements.annual.balance as Statement;

function renderTable(statement: Statement) {
  return render(
    <SourceProvider>
      <TooltipProvider>
        <StatementTable statement={statement} ticker="AAPL" filingsByAccn={new Map()} maxPeriods={5} />
      </TooltipProvider>
    </SourceProvider>,
  );
}

const rowOf = (c: HTMLElement, label: string) => {
  const th = [...c.querySelectorAll<HTMLElement>("tbody th[scope=row]")].find(
    (x) => x.querySelector(":scope > span > span:nth-of-type(2)")?.firstChild?.textContent?.trim() === label,
  );
  if (!th) throw new Error(`no row ${label}`);
  return th.closest("tr")!;
};

describe("standardized statement rows, from the row data", () => {
  it("sets kinds from bold, keys, units and the calculated flag, never from the label", () => {
    const row = (p: Partial<Row>): Row => ({ key: "x", label: "Total anything", unit: "usd", cells: [], ...p });
    expect(statementRowKind(row({}))).toBe("line");
    expect(statementRowKind(row({ bold: true }))).toBe("sub");
    expect(statementRowKind(row({ key: "netIncome", label: "Profit" }))).toBe("grand");
    expect(statementRowKind(row({ key: "liabilitiesAndEquity" }))).toBe("grand");
    expect(statementRowKind(row({ bold: true, unit: "usdPerShare" }))).toBe("emph");
    expect(statementRowKind(row({ bold: true, kind: "kpi" }))).toBe("emph");
    // A total flag from the builder wins over the key.
    expect(statementRowKind({ ...row({ key: "netIncome" }), total: "sub" } as Row)).toBe("sub");
  });

  it("renders AAPL's income statement: head strip, levels, subtotals, grand total, per-share and calculated lines", () => {
    const { container } = renderTable(income(aapl));
    expect(container.querySelector(".irt-root")).not.toBeNull();
    expect(container.querySelector(".irg.irg-fin")).not.toBeNull();
    expect(container.querySelector("thead.irg-head")).not.toBeNull();
    const heads = container.querySelectorAll("thead th");
    // Line item, five periods, CAGR, trend.
    expect(heads[5].classList.contains("irg-latest")).toBe(true);
    expect(heads[5].querySelector(".irg-period")?.textContent).toBe("FY2025");
    expect(heads[5].querySelector(".irg-date")).not.toBeNull();
    expect(container.querySelector("tbody.irg-body")).not.toBeNull();

    const revenue = rowOf(container, "Revenue");
    expect(revenue.dataset.kind).toBe("sub");
    expect(revenue.classList).toContain("irt-sub");
    expect(revenue.classList).toContain("irt-l0");

    const cost = rowOf(container, "Cost of revenue");
    expect(cost.dataset.kind).toBe("line");
    expect(cost.classList).toContain("irt-l1");

    const net = rowOf(container, "Net income");
    expect(net.dataset.kind).toBe("grand");
    expect(net.classList).toContain("irt-grand");

    const eps = rowOf(container, "EPS, diluted");
    expect(eps.dataset.kind).toBe("emph");
    expect(eps.classList).toContain("irt-ratio");
    expect(eps.classList).not.toContain("irt-sub");

    const ebitda = rowOf(container, "EBITDA");
    expect(ebitda.querySelector(".sr-only")?.textContent).toContain("calculated");
    expect(ebitda.querySelector("[aria-label=derived]")).toBeNull();

    // A quiet grid: no banded lines; one fixed label column; one width for every period column.
    expect(container.querySelector("tbody tr.irt-stripe")).toBeNull();
    expect(revenue.querySelector("th")!.classList).toContain("irg-fc");
    // (column widths come from the grid's variables: one label width, one width for every period column)
    expect(container.querySelectorAll("colgroup col")).toHaveLength(8);
    expect((container.querySelector(".irg-fin") as HTMLElement).style.getPropertyValue("--col")).toMatch(/^max\(var\(--irt-colbase\)/);
    // Digits line up: a positive figure keeps the room of a closing parenthesis.
    const fig = revenue.querySelector("td button .irg-fig")!;
    expect(fig.querySelector(".irg-paren")).not.toBeNull();
  });

  it("marks a period with no figure as missing, with a title", () => {
    const st = income(aapl);
    const { container } = render(
      <SourceProvider>
        <TooltipProvider>
          <StatementTable statement={st} ticker="AAPL" filingsByAccn={new Map()} />
        </TooltipProvider>
      </SourceProvider>,
    );
    const missing = container.querySelector("tbody td.irt-missing");
    expect(missing?.textContent?.trim()).toBe("–");
    expect(missing?.getAttribute("title")).toMatch(/no figure/i);
  });

  it("sets a bank's balance sheet closing lines as grand totals", () => {
    const { container } = renderTable(balance(jpm));
    expect(rowOf(container, "Total assets").dataset.kind).toBe("grand");
    expect(rowOf(container, "Total liabilities").dataset.kind).toBe("sub");
    expect(rowOf(container, "Retained earnings (deficit)").classList).toContain("irt-l1");
  });
});

describe("filed grid rows", () => {
  const rows: GridRow[] = [
    { key: "h", label: "Current assets:", kind: "group", cells: [] },
    { key: "a", label: "Cash", depth: 1, empty: "blank", cells: [{ text: "10" }, null] },
    { key: "b", label: "Receivables", depth: 1, cells: [{ text: "5" }, null] },
    { key: "t", label: "Total current assets", kind: "total", cells: [{ text: "15" }, { text: "12" }] },
    { key: "s", label: "", kind: "spacer", cells: [] },
    { key: "g", label: "Total assets", kind: "grand", cells: [{ text: "40" }, { text: "38" }] },
    { key: "m", label: "Americas", kind: "sub", cells: [{ text: "4" }, { text: "3" }] },
    { key: "r", label: "Margin", ratio: true, cells: [{ text: "12.5%" }, { text: "11.0%" }] },
  ];
  it("renders heads, levels, totals, breakdowns, ratio marks, blanks and missing figures", () => {
    const { container } = render(<FiledGrid head="Balance sheet" columns={[{ key: "2026", top: "As of", bottom: "Sep 2026", latest: true }, { key: "2025", top: "As of", bottom: "Sep 2025" }]} rows={rows} />);
    const trs = [...container.querySelectorAll<HTMLElement>("tbody tr")];
    expect(trs.map((t) => t.dataset.kind)).toEqual(["head", "line", "line", "sub", "gap", "grand", "breakdown", "line"]);
    expect(trs[0].classList).toContain("irt-group");
    expect(trs[1].classList).toContain("irt-l1");
    expect(trs[3].classList).toContain("irt-sub");
    expect(trs[5].classList).toContain("irt-grand");
    expect(trs[6].classList).toContain("irt-l1");
    expect(trs[7].classList).toContain("irt-ratio");
    expect(trs[7].querySelector(".irt-mark")?.textContent).toBe("%");
    // Blank: the filing prints the column but nothing here; missing: no figure for the period.
    expect(trs[1].querySelectorAll("td")[1].textContent).toBe(" ");
    expect(trs[2].querySelectorAll("td")[1].textContent).toBe("–");
    expect(container.querySelector("thead th.irt-latest .irt-date")?.textContent).toBe("Sep 2026");
    expect(trs[1].querySelectorAll("td")[0].classList).toContain("irt-latest");
  });
  it("names each row kind", () => {
    expect(gridRowKind({ key: "", label: "", cells: [] })).toBe("line");
    expect(gridRowKind({ key: "", label: "", kind: "total", cells: [] })).toBe("sub");
  });
});

describe("as-reported structure from the filing's data", () => {
  const L = (values: (number | null)[], o: Partial<LineFacts> = {}): LineFacts => ({ hasFacts: values.some((v) => v != null), totalTag: false, grandTag: false, values, ...o });
  const H = () => L([null, null]);

  it("reads headings, levels and totals of a balance sheet", () => {
    const shapes = shapeLines([
      H(), // Assets
      H(), // Current assets:
      L([10, 9]),
      L([5, 4]),
      L([15, 13]), // Total current assets (sums to its block)
      L([25, 24]), // Property
      L([40, 37], { grandTag: true }), // Total assets
      H(), // Liabilities and equity
      H(), // Current liabilities:
      L([7, 6]),
      L([3, 3]),
      L([10, 9], { totalTag: true }),
      H(), // Equity:
      L([20, 20]),
      L([10, 8]),
      L([30, 28]),
      L([40, 37], { grandTag: true }),
    ]);
    expect(shapes.map((s) => (s.head ? `h${s.depth}` : `${s.total ?? "l"}${s.depth}`))).toEqual([
      "h0", "h1", "l2", "l2", "sub1", "l1", "grand0",
      "h0", "h1", "l2", "l2", "sub1", "h1", "l2", "l2", "sub1", "grand0",
    ]);
  });

  it("closes a heading with a sum and replaces an unclosed heading", () => {
    const shapes = shapeLines([H(), L([1]), L([2]), H(), L([3]), L([4]), L([7]), L([9], { totalTag: true })]);
    expect(shapes.map((s) => (s.head ? `h${s.depth}` : `${s.total ?? "l"}${s.depth}`))).toEqual(["h0", "l1", "l1", "h0", "l1", "l1", "sub0", "sub0"]);
  });

  it("takes a top-level line that sums the top-level totals above it as a total (a bank's total net revenue)", () => {
    const shapes = shapeLines([L([1]), L([2]), L([3], { totalTag: true }), L([10]), L([4]), L([6], { totalTag: true }), L([9]), L([5])]);
    expect(shapes.map((s) => s.total)).toEqual([null, null, "sub", null, null, "sub", "sub", null]);
  });

  it("does not take a coincidence in one block of one line as a total", () => {
    expect(sumsTo(L([5]), [L([5])])).toBe(false);
    expect(sumsTo(L([8, 6]), [L([5, 3]), L([3, 2])])).toBe(false);
    expect(sumsTo(L([8, null]), [L([5, 3]), L([3, 2])])).toBe(true);
  });

  it("orders columns as filings print them: three months first, newest first", () => {
    expect(orderColumns([["2025-09-30", 3], ["2026-09-30", 3], ["2025-09-30", 1], ["2026-09-30", 1]])).toEqual([
      ["2026-09-30", 1], ["2025-09-30", 1], ["2026-09-30", 3], ["2025-09-30", 3],
    ]);
    expect(orderColumns([["2025-12-31", 0], ["2026-09-30", 0]])).toEqual([["2026-09-30", 0], ["2025-12-31", 0]]);
  });
});

describe("industry template lines", () => {
  it("sets closing lines as grand totals and the cash flow's opening net income as a line", () => {
    expect(templateLineKind("is_net_income")).toBe("grand");
    expect(templateLineKind("bs_liab_equity")).toBe("grand");
    expect(templateLineKind("bs_total_current_assets")).toBe("total");
    expect(templateLineKind("cf_net_income")).toBeUndefined();
    expect(templateLineKind("is_revenue_detail")).toBeUndefined();
  });
});
