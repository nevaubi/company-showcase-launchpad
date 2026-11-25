import { describe, expect, it } from "vitest";
import { listingTitle } from "../../../../scripts/lib/source-catalog/text";
import { buildZ1, parseZ1Listing, z1Stem, z1Title } from "../../../../scripts/lib/source-catalog/z1";
import type { DatasetRow } from "../../../../scripts/lib/source-catalog/types";

/** Markup as the Board's Z.1 table listing writes it (cut down to two sections). */
const Z1_HTML = `
<h5 class="tablehead" id="summaries">Summaries</h5>
<table id="t1"><thead><tr>
<th id="t1r0c1" class="colhead">Title</th><th id="t1r0c2" class="colhead">Table</th>
</tr></thead><tbody><tr>
<th id="t1r1c1" headers="t1r0c1" class="">Financial accounts matrix--transactions</th>
<td id="t1r1c2" headers="t1r0c2 t1r1c1" class=""><a href="M3_t.htm" title="M3.t: Financial accounts matrix--transactions">M3.t</a></td>
</tr></tbody></table>
<h5 class="tablehead" id="sectors">Sectors</h5>
<table id="t2"><thead><tr>
<th id="t2r0c1" class="colhead">Title</th><th id="t2r0c2" class="colhead">Transactions</th><th id="t2r0c3" class="colhead">Stocks</th>
</tr></thead><tbody><tr>
<th id="t2r35c1" headers="t2r0c1 t2r9c1" class="in1">Property-casualty insurance companies</th>
<td id="t2r35c2" headers="t2r0c2 t2r35c1" class=""><a href="S1282_1_t.htm" title="S1282.1.t: Property-casualty insurance companies">S1282.1.t</a></td>
<td id="t2r35c3" headers="t2r0c3 t2r35c1" class=""><a href="S1282_1_s.htm" title="S1282.1.s: Property-casualty insurance companies">S1282.1.s</a></td>
</tr></tbody></table>
<h5 class="tablehead" id="integrated">Integrated macroeconomic accounts for the United States</h5>
<table id="t6"><thead><tr>
<th id="t6r0c1" class="colhead">Title</th><th id="t6r0c2" class="colhead">Annual</th><th id="t6r0c3" class="colhead">Quarterly</th>
</tr></thead><tbody><tr>
<th id="t6r1c1" headers="t6r0c1" class="">Total economy - current account</th>
<td id="t6r1c2" headers="t6r0c2 t6r1c1" class=""><a href="S1_1_i_a.htm" title="S1.1.i.a: Total economy - current account">S1.1.i.a</a></td>
<td id="t6r1c3" headers="t6r0c3 t6r1c1" class=""><a href="S1_1_i_q.htm" title="S1.1.i.q: Total economy - current account">S1.1.i.q</a></td>
</tr></tbody></table>`;

const row = (id: string, name: string): DatasetRow => ({
  id,
  name,
  sector: "01_financials",
  agency: "Federal Reserve Board",
  source_id: "FED_Z1",
  source_url: "https://www.federalreserve.gov/releases/z1/",
  grain: "Sector/instrument series × period",
  rows: 305,
  retrieved_at: "2026-11-24T10:00:00.000Z",
});

describe("listing titles", () => {
  it("keeps the publisher's words and turns its dashes into commas or ranges", () => {
    expect(listingTitle("Financial accounts matrix--transactions")).toBe("Financial accounts matrix, transactions");
    expect(listingTitle("Total economy - current account")).toBe("Total economy, current account");
    expect(listingTitle("Prices, 2020–2025")).toBe("Prices, 2020 to 2025");
    expect(listingTitle("Mortgage real estate investment trusts &amp; funds  ")).toBe("Mortgage real estate investment trusts & funds");
    expect(listingTitle("Ownership&#39;s share")).toBe("Ownership's share");
  });
});

describe("Z.1 listing", () => {
  it("reads every table cell with its code, row title, column and section", () => {
    const cells = parseZ1Listing(Z1_HTML);
    expect(cells.map((c) => c.code)).toEqual(["M3.t", "S1282.1.t", "S1282.1.s", "S1.1.i.a", "S1.1.i.q"]);
    expect(cells[1]).toEqual({
      file: "S1282_1_t",
      code: "S1282.1.t",
      title: "Property-casualty insurance companies",
      column: "Transactions",
      section: "Sectors",
    });
    expect(cells.map(z1Title)).toEqual([
      "Financial accounts matrix, transactions",
      "Property-casualty insurance companies, transactions",
      "Property-casualty insurance companies, stocks",
      "Total economy, current account (integrated macroeconomic accounts, annual)",
      "Total economy, current account (integrated macroeconomic accounts, quarterly)",
    ]);
  });

  it("titles a stored table only when its file stem is a listed file", () => {
    const listed = row("official_01_financials_data_fed_z1_native_tables_csv_s1282_1_t_c4dff3aa45", "S1282 1 t");
    const unlisted = row("official_01_financials_data_fed_z1_native_tables_csv_s1282_1_t_tu_27bef5791c", "S1282 1 t tu");
    expect(z1Stem(listed.id)).toBe("s1282_1_t");
    expect(z1Stem("official_01_financials_data_fed_z1_complete_table_inventory_3994040352")).toBeNull();
    const url = "https://www.federalreserve.gov/releases/z1/current/html/default.htm";
    const result = buildZ1([listed, unlisted], { url, status: 200, body: Z1_HTML });
    expect(result.titles).toEqual({
      [listed.id]: { title: "Property-casualty insurance companies, transactions", code: "Z.1 S1282.1.t", source: url },
    });
    expect(result.unmatched.map((u) => u.id)).toEqual([unlisted.id]);
    expect(buildZ1([listed], { url, status: 503, body: "" }).titles).toEqual({});
  });
});
