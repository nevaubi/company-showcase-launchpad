import { describe, expect, it } from "vitest";
import { buildFred, catalogueTitles, isCut, parseFredTitle } from "../../../../scripts/lib/source-catalog/fred";
import { buildMer, parseMerListing } from "../../../../scripts/lib/source-catalog/mer";
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
  grain: "Sector/instrument series \u00d7 period",
  rows: 305,
  retrieved_at: "2026-11-24T10:00:00.000Z",
});

describe("listing titles", () => {
  it("keeps the publisher's words and turns its dashes into commas or ranges", () => {
    expect(listingTitle("Financial accounts matrix--transactions")).toBe("Financial accounts matrix, transactions");
    expect(listingTitle("Total economy - current account")).toBe("Total economy, current account");
    expect(listingTitle("Prices, 2020\u20132025")).toBe("Prices, 2020 to 2025");
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

/** Two entries of EIA's MER table list as the page writes them; table 4.4 has no title on its CSV link. */
const MER_HTML = `
<li><span class="number">1.1</span>Primary energy overview</a></li>
<li><span class="number"></span><span class="formats">Available formats:</span> <a href="./pdf/sec1_3.pdf" title="Table 1.1 Primary energy overview"><span class="ico pdf"></span></a> <a href="/totalenergy/data/browser/xls.php?tbl=T01.01&freq=m" title="Table 1.1 Primary energy overview"></a> <a href="/totalenergy/data/browser/csv.php?tbl=T01.01" title="Table 1.1 Primary energy overview"></a></li>
<li><span class="number">4.4</span>Underground storage</li>
<li><a href="./pdf/sec4_7.pdf" title="Table 4.4 Underground storage"></a> <a href="/totalenergy/data/browser/xls.php?tbl=T04.04&freq=m" title="Table 4.4 Underground storage"></a> <a href="/totalenergy/data/browser/csv.php?tbl=T04.04"></a> <a href="/totalenergy/data/browser/index.php?tbl=T04.04#/?f=M&start=200001" title="Table 4.4 Underground storage  - View in Total Energy Browser"></a></li>
<li><a href="/totalenergy/data/browser/csv.php?tbl=TC1" title="Table C1. Electric Vehicle Charging Infrastructure"></a></li>`;

describe("MER table list", () => {
  it("reads each table's number and title, from the XLS link where the CSV link has none", () => {
    expect(parseMerListing(MER_HTML)).toEqual([
      { tbl: "T01.01", number: "1.1", title: "Primary energy overview" },
      { tbl: "T04.04", number: "4.4", title: "Underground storage" },
      { tbl: "TC1", number: "C1", title: "Electric Vehicle Charging Infrastructure" },
    ]);
  });

  it("titles only single tables read from their own CSV address", () => {
    const base = "https://www.eia.gov/totalenergy/data/browser/csv.php?tbl=";
    const raw = { ...row("official_04_energy_raw_mer_t04_04_6b27d1604d", "MER T04.04"), source_url: `${base}T04.04`, source_id: "EIA_MER" };
    const union = { ...row("official_04_energy_csv_mer_all_107_tables_all_history_3e7c636fc7", "EIA Monthly Energy Review, all 107 tables"), source_url: `${base}T01.01`, source_id: "EIA_MER" };
    const wrongName = { ...row("official_04_energy_raw_mer_t01_01_50b683cd84", "MER T01.02"), source_url: `${base}T01.01`, source_id: "EIA_MER" };
    const url = "https://www.eia.gov/totalenergy/data/monthly/";
    const result = buildMer([raw, union, wrongName], { url, status: 200, body: MER_HTML });
    expect(result.titles).toEqual({ [raw.id]: { title: "Underground storage", code: "MER 4.4", source: url } });
    expect(result.unmatched.map((u) => u.id)).toEqual([union.id, wrongName.id]);
  });
});

describe("FRED series", () => {
  const page = (title: string) => `<html><head><meta property="og:title" content="${title}"/></head></html>`;

  it("reads the title FRED states for the series", () => {
    expect(parseFredTitle(page("Manufacturers&#039; New Orders: Total Manufacturing"))).toBe(
      "Manufacturers' New Orders: Total Manufacturing",
    );
    expect(parseFredTitle("<html></html>")).toBeNull();
  });

  it("does not use catalogue titles the kit cut at an apostrophe", () => {
    expect(isCut("Manufacturers", 9)).toBe(true);
    expect(isCut("Consumer Price Index for All Urban Consumers: Owners", 1)).toBe(true);
    expect(isCut("Federal Funds Effective Rate", 2)).toBe(false);
    expect(isCut("M2", 1)).toBe(false);
    expect(isCut("Initial Claims", 1)).toBe(false);
    const titles = catalogueTitles({
      catalogues: [
        { dataset: "a", snapshot: "s", rows: [[1, "AMTMNO", "Manufacturers"], [2, "AMTMVS", "Manufacturers"], [3, "DGORDER", "Manufacturers"], [4, "UNRATE", "Unemployment Rate"]] },
      ],
    });
    expect([...titles]).toEqual([["UNRATE", "Unemployment Rate"]]);
  });

  it("prefers the series page, falls back to the catalogue, and says where the title is from", () => {
    const unrate = { ...row("official_00_universal_raw_fred_unrate_3286ca8718", "UNRATE"), source_id: "FRED_UNRATE" };
    const amtmno = { ...row("official_06_industrials_raw_fred_amtmno_17ff88a923", "AMTMNO"), source_id: "FRED_AMTMNO" };
    const pages = new Map([
      ["https://fred.stlouisfed.org/series/AMTMNO", { url: "https://fred.stlouisfed.org/series/AMTMNO", status: 200, body: page("Manufacturers&#039; New Orders: Total Manufacturing") }],
    ]);
    const result = buildFred([unrate, amtmno], pages, new Map([["UNRATE", "Unemployment Rate"]]));
    expect(result.titles).toEqual({
      [unrate.id]: { title: "Unemployment Rate", code: "UNRATE", source: "https://fred.stlouisfed.org/series/UNRATE" },
      [amtmno.id]: { title: "Manufacturers' New Orders: Total Manufacturing", code: "AMTMNO", source: "https://fred.stlouisfed.org/series/AMTMNO" },
    });
    expect(buildFred([amtmno], new Map(), new Map()).unmatched).toHaveLength(1);
  });
});
