import { describe, expect, it } from "vitest";
import { BDC_PAGE, BDC_README, H8_PAGE, NMFP_PAGE, NMFP_README, OFR_DATASETS, buildBdc, buildH8, buildNmfp, buildOfr, listedMonths, parseBdcReadme, parseNmfpReadme } from "../../../../scripts/lib/source-catalog/banks-funds";
import { EIA860_PAGE, EIA861_PAGE, build860, build861, parse860, parse861 } from "../../../../scripts/lib/source-catalog/eia-forms";
import { buildFred, catalogueTitles, isCut, parseFredTitle } from "../../../../scripts/lib/source-catalog/fred";
import { buildMer, parseMerListing } from "../../../../scripts/lib/source-catalog/mer";
import { listingTitle } from "../../../../scripts/lib/source-catalog/text";
import { USGS_LISTING, buildUsgs, commodityName, fileStem, parseUsgsFilePage, parseUsgsListing, usgsTitle } from "../../../../scripts/lib/source-catalog/usgs";
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

/** Rows of the USGS Data Series 140 listing as the page writes them. */
const USGS_HTML = `<table class="usa-table"><thead><tr><th colspan="3"><h3>Supply-Demand Statistics</h3></th></tr></thead><tbody>
<tr><td data-label="Supply-Demand Statistics"><strong>Commodity</strong></td><td><strong>Format</strong></td><td><strong>Update year</strong></td></tr>
<tr><td data-label="Supply-Demand Statistics"><a name="abrasives-natural">Abrasives (natural)-(discontinued- see garnet, industrial)</a></td><td><a href="https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/mineral-pubs/historical-statistics/ds140-abran.xlsx">XLSX</a></td><td>2014</td></tr>
<tr><td data-label="Supply-Demand Statistics"><a name="copper">Copper</a></td><td><a href="/media/files/copper-historical-statistics-data-series-140">XLSX</a></td><td>2020</td></tr>
<tr><td data-label="Supply-Demand Statistics"><a name="nickel">Nickel</a></td><td><a href="/media/files/nickel-historical-statistics-data-series-140">XLSX</a></td><td>2019</td></tr>
</tbody></table>`;

describe("USGS Data Series 140 listing", () => {
  it("reads commodity, workbook link and update year, without the discontinued note", () => {
    expect(commodityName("Abrasives (natural)-(discontinued- see garnet, industrial)")).toBe("Abrasives (natural)");
    expect(parseUsgsListing(USGS_HTML)).toEqual([
      { commodity: "Abrasives (natural)", href: "https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/mineral-pubs/historical-statistics/ds140-abran.xlsx", year: "2014" },
      { commodity: "Copper", href: "https://www.usgs.gov/media/files/copper-historical-statistics-data-series-140", year: "2020" },
      { commodity: "Nickel", href: "https://www.usgs.gov/media/files/nickel-historical-statistics-data-series-140", year: "2019" },
    ]);
    expect(parseUsgsFilePage('<a href="https://d9-wret.s3.us-west-2.amazonaws.com/x/media/files/ds140-copper-2020.xlsx">Download</a>')).toBe(
      "https://d9-wret.s3.us-west-2.amazonaws.com/x/media/files/ds140-copper-2020.xlsx",
    );
    expect(fileStem("https://x/ds140-construction-sand-and%20gravel-2022.xlsx")).toBe("ds140 construction sand and 20gravel 2022");
  });

  it("names the commodity alone where the sheet only restates it", () => {
    expect(usgsTitle("Copper", "Copper")).toBe("Copper");
    expect(usgsTitle("Lithium", "Lithium statistics")).toBe("Lithium");
    expect(usgsTitle("Stone (crushed)", "Crushed stone")).toBe("Stone (crushed)");
    expect(usgsTitle("Nickel", "Primary production")).toBe("Nickel: Primary production");
  });

  it("matches each stored sheet to its workbook by file name, through the file page", () => {
    const sheet = (id: string, name: string): DatasetRow => ({ ...row(id, name), source_id: "USGS_DS140", sector: "07_materials" });
    const copper = sheet("official_07_materials_csv_ds140_ds140_copper_2020_copper_fe7a2ceced", "DS140 ds140 copper 2020 Copper");
    const nickel = sheet("official_07_materials_csv_ds140_ds140_nickel_2019_consumption_5da20e19e2", "DS140 ds140 nickel 2019 Consumption");
    const abran = sheet("official_07_materials_csv_ds140_ds140_abran_tripoli_210edb484c", "DS140 ds140 abran Tripoli");
    const other = sheet("official_07_materials_csv_ds140_ds140_tin_2021_tin_5a2c59d762", "DS140 ds140 tin 2021 Tin");
    const page = (url: string, body: string) => [url, { url, status: 200, body }] as const;
    const pages = new Map([
      page(USGS_LISTING, USGS_HTML),
      page("https://www.usgs.gov/media/files/copper-historical-statistics-data-series-140", '<a href="https://s3.example/ds140-copper-2020.xlsx">x</a>'),
      page("https://www.usgs.gov/media/files/nickel-historical-statistics-data-series-140", '<a href="https://s3.example/ds140-nickel-2019.xlsx">x</a>'),
    ]);
    const result = buildUsgs([copper, nickel, abran, other], pages);
    expect(result.titles).toEqual({
      [copper.id]: { title: "Copper", code: "DS140 copper-2020", source: USGS_LISTING },
      [nickel.id]: { title: "Nickel: Consumption", code: "DS140 nickel-2019", source: USGS_LISTING },
      [abran.id]: { title: "Abrasives (natural): Tripoli", code: "DS140 abran", source: USGS_LISTING },
    });
    expect(result.unmatched.map((u) => u.id)).toEqual([other.id]);
  });
});

/** EIA-860's list of data files, as the form page writes it (cut down). */
const EIA860_HTML = `<p>Detailed data are compressed (zip) and contain the following files:</p>
<ul><li><strong>1___UtilityYyyyy</strong> &#x2014; Contains utility-level data.</li>
<li><strong>3_4_Energy_StorageYyyyy </strong> &#x2014; Contains additional details, split into two tabs:</li>
<li class="list-item"><ul><li>The <em>Operable</em> tab includes those generators which are currently operating;</li></ul>
<ul><li>The <em>Retired and Canceled</em> tab includes those generators which were cancelled.</li></ul>
<ul><li>The retired tab only includes those retired generators which were reported.</li></ul></li>
<li><strong>4___OwnerYyyyy</strong> &#x2014; Contains owner and/or operator data.</li>
<li><strong>6_2_EnviroEquipYyyyy</strong> &#x2014; Contains environmental equipment data.</li>
<li class="list-item"><ul><li>The <em>Emission Standards & Strategies</em> tab shows boiler data;</li></ul></li></ul>
<h3>Superseded Form EIA-860A (Utility) & B (Non-Utility)</h3>`;

const EIA861_HTML = `<ul><li class="head">Demand Response</li><li class="list-item"><li><strong>Survey:</strong> Form EIA-861</li></li>
<li class="head">Non-Net Metering Distributed</li><li class="head">Sales to Ultimate Customers</li></ul>`;

describe("EIA form pages", () => {
  it("reads EIA-860's files with the tabs the page names for each", () => {
    expect(parse860(EIA860_HTML).map((f) => [f.file, f.subject, f.tabs])).toEqual([
      ["1___UtilityYyyyy", "Utility", []],
      ["3_4_Energy_StorageYyyyy", "Energy Storage", ["Operable", "Retired and Canceled"]],
      ["4___OwnerYyyyy", "Owner", []],
      ["6_2_EnviroEquipYyyyy", "EnviroEquip", ["Emission Standards & Strategies"]],
    ]);
    expect(parse861(EIA861_HTML)).toEqual(["Demand Response", "Non-Net Metering Distributed", "Sales to Ultimate Customers"]);
  });

  it("titles EIA-860 tables only for listed files and named tabs", () => {
    const t = (id: string, name: string): DatasetRow => ({ ...row(id, name), source_id: "EIA860_X", sector: "05_utilities" });
    const utility = t("a_utility", "EIA860 1 Utility Y2025 Utility");
    const operable = t("b_storage_operable", "EIA860 3 4 Energy Storage Y2025 Operable");
    const proposed = t("c_storage_proposed", "EIA860 3 4 Energy Storage Y2025 Proposed");
    const owner = t("d_owner", "EIA860 4 Owner Y2025 Ownership");
    const strategies = t("e_strategies", "EIA860 6 2 EnviroEquip Y2025 Emission Standards Strategies");
    const result = build860([utility, operable, proposed, owner, strategies], { url: EIA860_PAGE, status: 200, body: EIA860_HTML });
    expect(result.titles).toEqual({
      a_utility: { title: "Utility, 2025", code: "EIA-860 1___UtilityY2025", source: EIA860_PAGE },
      b_storage_operable: { title: "Energy Storage, Operable, 2025", code: "EIA-860 3_4_Energy_StorageY2025", source: EIA860_PAGE },
      e_strategies: { title: "EnviroEquip, Emission Standards & Strategies, 2025", code: "EIA-860 6_2_EnviroEquipY2025", source: EIA860_PAGE },
    });
    expect(result.unmatched.map((u) => u.id)).toEqual(["c_storage_proposed", "d_owner"]);
  });

  it("titles EIA-861 tables whose file name is a listed name, without repeating it", () => {
    const t = (id: string, name: string): DatasetRow => ({ ...row(id, name), source_id: "EIA861_X", sector: "05_utilities" });
    const states = t("a", "EIA861 Demand Response 2025 Demand Response States");
    const distributed = t("b", "EIA861 Non Net Metering Distributed 2025 Territories");
    const sales = t("c", "EIA861 Sales Ult Cust 2025 States");
    const result = build861([states, distributed, sales], { url: EIA861_PAGE, status: 200, body: EIA861_HTML });
    expect(result.titles).toEqual({
      a: { title: "Demand Response, States, 2025", source: EIA861_PAGE },
      b: { title: "Non-Net Metering Distributed, Territories, 2025", source: EIA861_PAGE },
    });
    expect(result.unmatched.map((u) => u.id)).toEqual(["c"]);
  });
});

describe("banks and funds", () => {
  const page = (url: string, body: string) => [url, { url, status: 200, body }] as const;
  const t = (id: string, name: string, source_id: string): DatasetRow => ({ ...row(id, name), source_id });

  it("reads what each N-MFP file holds from the SEC's readme, and titles October 2026 tables", () => {
    const readme = `        12. COLLATERALISSUERS data provides details of collateral issuers and securities subjected to repurchase
            agreements, with each row having the primary key ACCESSION_NUMBER, SECURITY_ID.

        13. NRSRO data provides rating information, name of the assigning NRSRO, and the identity of a demand feature
            issuer, enhancement provider, guarantor, or NRSRO, with each row having the primary key ACCESSION_NUMBER.`;
    expect([...parseNmfpReadme(readme)]).toEqual([
      ["COLLATERALISSUERS", "Collateral issuers and securities subjected to repurchase agreements"],
      ["NRSRO", "Rating information"],
    ]);
    const html = '<a href="/files/x/20261008-20261106_nmfp.zip">2026 October NMFP</a>';
    expect([...listedMonths(html, "NMFP")]).toEqual(["2026-10"]);
    const cells = t("official_01_financials_data_sec_nmfp_2026_10_native_nmfp_collateralissuers_4be038f7ab", "NMFP COLLATERALISSUERS", "SEC_NMFP");
    const older = t("official_01_financials_data_sec_nmfp_2026_09_native_nmfp_nrsro_0000000000", "NMFP NRSRO", "SEC_NMFP");
    const result = buildNmfp([cells, older], new Map([page(NMFP_README, readme), page(NMFP_PAGE, html)]));
    expect(result.titles).toEqual({
      [cells.id]: { title: "Collateral issuers and securities subjected to repurchase agreements, October 2026", code: "N-MFP COLLATERALISSUERS", source: NMFP_README },
    });
    expect(result.unmatched.map((u) => u.id)).toEqual([older.id]);
  });

  it("names BDC tables from the readme and only for months the page lists", () => {
    const readme = "    5.01    SUB (Submissions)\n    5.08    SOI (Schedule of Investments)\n";
    expect([...parseBdcReadme(readme)]).toEqual([["SUB", "Submissions"], ["SOI", "Schedule of Investments"]]);
    const html = ["July", "August", "September", "October"].map((m) => `<a href="x">2026 ${m} BDC</a>`).join("");
    const soi = t("official_01_financials_data_sec_bdc_2026_jul_oct_full_schedule_of_investments_40c5eb7b93", "sec bdc 2026 jul oct full schedule of investments", "SEC_BDC");
    const result = buildBdc([soi], new Map([page(BDC_README, readme), page(BDC_PAGE, html)]));
    expect(result.titles[soi.id]).toEqual({ title: "Schedule of Investments, July to October 2026", code: "BDC SOI", source: BDC_README });
    expect(buildBdc([soi], new Map([page(BDC_README, readme), page(BDC_PAGE, html.replace("2026 August BDC", ""))])).titles).toEqual({});
  });

  it("names H.8 tables after the release and the five OFR datasets after the listing", () => {
    const h8 = "<h2>Assets and Liabilities of Commercial Banks in the United States - H.8</h2>";
    const whole = t("official_01_financials_data_fed_h8_complete_native_observations_76de662a76", "fed h8 complete native observations", "FED_H8");
    const view = t("official_01_financials_data_fed_h8_monthly_headline_balances_2000_latest_ad2cb5f5f5", "H.8 monthly all-bank headline balances", "FED_H8");
    expect(buildH8([whole, view], new Map([page(H8_PAGE, h8)])).titles).toEqual({
      [whole.id]: { title: "Assets and Liabilities of Commercial Banks in the United States (H.8)", code: "H.8", source: H8_PAGE },
      [view.id]: { title: "Assets and Liabilities of Commercial Banks in the United States (H.8): monthly all-bank headline balances", code: "H.8", source: H8_PAGE },
    });
    const json = JSON.stringify({
      fnyr: { short_name: "Reference Rates" },
      mmf: { short_name: "U.S. Money Market Funds" },
      nypd: { short_name: "Primary Dealer Statistics" },
      repo: { short_name: "U.S. Repo Markets" },
      tyld: { short_name: "Treasury Constant Maturity Rates" },
    });
    const all = t("official_01_financials_data_ofr_all_five_datasets_complete_timeseries_a2c31c8c80", "ofr all five datasets complete timeseries", "OFR_STFM");
    expect(buildOfr([all], new Map([page(OFR_DATASETS, json)])).titles[all.id].title).toBe(
      "Reference Rates, U.S. Money Market Funds, Primary Dealer Statistics, U.S. Repo Markets and Treasury Constant Maturity Rates, all series",
    );
  });
});
