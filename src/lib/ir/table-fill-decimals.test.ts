// A statement read from the document alone (no stored fact) that prints its money with a decimal:
// Skyworks' fourth-quarter fiscal 2026 release, "(in millions, except per share amounts)", figures as printed.
import { describe, expect, it } from "vitest";
import { fillCompany } from "@/lib/ir/table-fill-build";

const DOC = "7d3c5135-1a95-4bee-812c-144ddca2314f";
const money = (a: string, b: string, c: string, d: string, sign = false) =>
  [a, b, c, d].map((x) => `${sign ? "<td>$</td>" : "<td></td>"}<td>${x}</td>`).join("");
const row = (name: string, a: string, b: string, c: string, d: string, sign = false) => `<tr><td>${name}</td>${money(a, b, c, d, sign)}</tr>`;
const html = `<html><body>
<p>SKYWORKS SOLUTIONS, INC.</p><p>UNAUDITED CONSOLIDATED STATEMENTS OF OPERATIONS</p>
<table>
<tr><td></td><td colspan="4">Three Months Ended</td><td colspan="4">Twelve Months Ended</td></tr>
<tr><td>(in millions, except per share amounts)</td><td colspan="2">October 2, 2026</td><td colspan="2">October 3, 2025</td><td colspan="2">October 2, 2026</td><td colspan="2">October 3, 2025</td></tr>
${row("Net revenue", "1,045.7", "1,100.2", "3,959.6", "4,086.9", true)}
${row("Cost of goods sold", "618.3", "652.6", "2,344.7", "2,404.8")}
${row("Gross profit", "427.4", "447.6", "1,614.9", "1,682.1")}
<tr><td>Operating expenses:</td></tr>
${row("Research and development", "213.5", "223.1", "837.0", "785.5")}
${row("Selling, general, and administrative", "109.3", "111.7", "436.1", "371.5")}
${row("Amortization of intangibles", "0.2", "0.2", "0.9", "0.9")}
${row("Restructuring, impairment, and other charges", "82.1", "1.6", "124.2", "24.2")}
${row("Total operating expenses", "405.1", "336.6", "1,398.2", "1,182.1")}
${row("Operating income", "22.3", "111.0", "216.7", "500.0")}
${row("Interest expense", "(21.5)", "(6.8)", "(41.3)", "(27.1)")}
${row("Other income, net", "9.0", "17.8", "38.3", "53.8")}
${row("Income before income taxes", "9.8", "122.0", "213.7", "526.7")}
${row("Provision (benefit) for income taxes", "(13.6)", "(19.4)", "41.6", "49.6")}
${row("Net income", "23.4", "141.4", "172.1", "477.1", true)}
<tr><td>Earnings per share:</td></tr>
${row("Basic", "0.16", "0.95", "1.15", "3.09", true)}
${row("Diluted", "0.15", "0.94", "1.14", "3.08", true)}
<tr><td>Weighted average shares:</td></tr>
${row("Basic", "149.7", "148.6", "150.0", "154.4")}
${row("Diluted", "151.5", "149.8", "151.0", "155.1")}
</table></body></html>`;

describe("a statement printed in millions with a decimal, read with no stored fact", () => {
  it("reads its money as money at the printed scale and only the per-share rows per share", async () => {
    const run = await fillCompany([], async (id) => (id === DOC ? html : null), {
      docs: [{ id: DOC, filed: "2026-11-03", kind: "press-release", title: null }],
      reports: ["2026-10-02"],
    });
    const of = (label: RegExp, end: string, months: number, unit?: string) =>
      run.facts.find((f) => label.test(f.label) && f.period_end === end && f.months === months && (!unit || f.unit === unit));
    expect(of(/^net revenue$/i, "2026-10-02", 3)).toMatchObject({ unit: "usd", value: 1_045.7e6 });
    expect(of(/^net revenue$/i, "2025-10-03", 12)).toMatchObject({ unit: "usd", value: 4_086.9e6 });
    expect(of(/^interest expense$/i, "2026-10-02", 3)).toMatchObject({ unit: "usd", value: -21.5e6 });
    expect(of(/^net income$/i, "2026-10-02", 12)).toMatchObject({ unit: "usd", value: 172.1e6 });
    expect(of(/diluted/i, "2026-10-02", 3, "usdPerShare")?.value).toBe(0.15);
    expect(of(/basic/i, "2025-10-03", 12, "usdPerShare")?.value).toBe(3.09);
    // No money row is read as a per-share figure.
    const perShare = run.facts.filter((f) => f.unit === "usdPerShare").map((f) => f.label);
    expect(perShare.every((l) => /basic|diluted/i.test(l))).toBe(true);
    expect(run.facts.filter((f) => f.unit === "usd")).toHaveLength(14 * 4);
  });
});
