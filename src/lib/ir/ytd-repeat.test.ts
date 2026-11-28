// A release that prints its statement of operations twice, for the quarter and for the year to date, under one
// title: the year-to-date table is not a second section of the quarter's figures.
// Entegris, third quarter 2026 release (8-K of October 29, 2026), in millions: rows as printed.
import { describe, expect, it } from "vitest";
import { buildPayload } from "@/lib/ir/payload";
import { budgetPayload } from "@/lib/ir/payload-budget";
import { assembleStatements, withCaptions, ytdCols } from "@/lib/ir/statements";
import { fillCompany, withFill } from "@/lib/ir/table-fill-build";

const row = (name: string, figures: string[]) =>
  `<tr><td colspan="6">${name}</td>${figures.map((x) => `<td colspan="3">${x}</td>`).join("")}</tr>`;
const table = (head: string, dates: string[], rows: [string, string[]][]) =>
  `<p>Entegris, Inc. and Subsidiaries</p><p>Condensed Consolidated Statements of Operations</p><p>(In millions, except per share data)</p><p>(Unaudited)</p>
<table>
<tr><td colspan="6"></td><td colspan="${dates.length * 3}">${head}</td></tr>
<tr><td colspan="6"></td>${dates.map((d) => `<td colspan="3">${d}</td>`).join("")}</tr>
${rows.map(([n, f]) => row(n, f)).join("\n")}
</table>`;
const quarter = table("Three months ended", ["Sep 26, 2026", "Sep 27, 2025", "Jun 27, 2026"], [
  ["Net sales", ["$1,005.7", "$807.1", "$883.2"]],
  ["Cost of sales", ["505.5", "455.8", "463.2"]],
  ["Gross profit", ["500.2", "351.3", "420.0"]],
  ["Selling, general and administrative expenses", ["136.5", "101.8", "126.5"]],
  ["Engineering, research and development expenses", ["87.5", "80.9", "82.8"]],
  ["Amortization of intangible assets", ["45.6", "46.0", "46.1"]],
  ["Operating income", ["230.6", "122.6", "164.6"]],
  ["Interest expense, net", ["43.9", "46.1", "46.7"]],
  ["Income before income tax expense", ["186.5", "72.3", "110.1"]],
  ["Income tax expense", ["28.7", "1.5", "16.5"]],
  ["Net income", ["$157.8", "$70.5", "$93.6"]],
]);
const nineMonths = table("Nine months ended", ["Sep 26, 2026", "Sep 27, 2025"], [
  ["Net sales", ["$2,700.8", "$2,372.7"]],
  ["Cost of sales", ["1,399.8", "1,313.4"]],
  ["Gross profit", ["1,301.0", "1,059.3"]],
  ["Selling, general and administrative expenses", ["380.6", "320.2"]],
  ["Engineering, research and development expenses", ["245.6", "250.0"]],
  ["Amortization of intangible assets", ["138.0", "138.1"]],
  ["Operating income", ["536.8", "351.0"]],
  ["Interest expense, net", ["137.6", "146.2"]],
  ["Income before income tax expense", ["389.8", "199.5"]],
  ["Income tax expense", ["46.2", "12.5"]],
  ["Net income", ["$343.4", "$186.2"]],
]);
const html = `<html><body>${quarter}${nineMonths}</body></html>`;

async function build() {
  const run = await fillCompany([], async () => html, {
    docs: [{ id: "entg-3q26", filed: "2026-10-29", kind: "press-release", title: "8-K 2026-10-29 entgq32026ex991.htm (Items 2.02,9.01)" }],
    reports: ["2026-09-26", "2026-06-27", "2026-03-28", "2025-12-31"],
  });
  let p = buildPayload("ENTG", run.facts);
  for (let round = 0; round < 3; round++) {
    const docs = p.docs;
    p = await withCaptions(p, async (d) => run.captions.get(docs[d]?.id ?? ""));
    p = withFill(p, run);
  }
  return p;
}

describe("a year-to-date statement printed beside the quarter's", () => {
  it("records each table's printed columns", async () => {
    const p = await build();
    const caps = Object.values(p.tables ?? {});
    const ytd = caps.filter((c) => ytdCols(c) === true);
    expect(ytd).toHaveLength(1);
    expect(ytd[0].cols?.map((c) => [c[1], c[2]])).toEqual([[9, "2026-09-26"], [9, "2025-09-27"]]);
    expect(caps.filter((c) => ytdCols(c) === false)[0]?.cols?.map((c) => [c[1], c[2]])).toEqual([[3, "2026-09-26"], [3, "2025-09-27"], [3, "2026-06-27"]]);
  });
  it("is not listed as a second section of the quarter's figures", async () => {
    const p = await build();
    const main = assembleStatements(p).filter((s) => s.group === "main");
    expect(main.map((s) => s.title)).toEqual(["Condensed consolidated statements of operations"]);
  });
  it("stays out after the page-size pass, which keeps its columns on record", async () => {
    const p = budgetPayload(await build(), { cap: Infinity }).payload;
    expect(Object.values(p.tables ?? {}).some((c) => ytdCols(c) === true)).toBe(true);
    expect(assembleStatements(p).filter((s) => s.group === "main")).toHaveLength(1);
  });
});
