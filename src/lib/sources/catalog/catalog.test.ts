import { describe, expect, it } from "vitest";
import { cleanName, isBareName, merTableNumber, withoutLongDashes } from "./clean";
import { COLLECTIONS, collectionFor } from "./collections";
import { familyFor } from "./families";
import { COLLECTIONS as EXPORTED_COLLECTIONS, PUBLISHERS, describeDataset, staleAgainstParent } from "./index";
import { publisherFor } from "./publishers";
import type { CatalogInput } from "./types";

const base: CatalogInput = {
  id: "official_00_universal_raw_fred_unrate_3286ca8718",
  name: "UNRATE",
  sector: "00_universal",
  agency: "U.S. Bureau of Labor Statistics via Federal Reserve Bank of St. Louis",
  source_id: "FRED_UNRATE",
  source_url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE&cosd=2000-01-01&coed=2026-11-24",
  grain: "US aggregate time series",
  rows: 322,
  retrieved_at: "2026-11-24T09:58:23Z",
};

describe("publisherFor", () => {
  it("keeps the original publisher of a FRED copy and says via FRED", () => {
    expect(publisherFor(base.agency)).toEqual({
      id: "bls",
      name: "U.S. Bureau of Labor Statistics",
      short: "BLS",
      via: "FRED",
    });
  });

  it("maps the spellings of one publisher to one entry", () => {
    expect(publisherFor("US SEC").id).toBe("sec");
    expect(publisherFor("U.S. Securities and Exchange Commission").id).toBe("sec");
    expect(publisherFor("TWSE; Taiwan Stock Exchange")).toEqual(publisherFor("Taiwan Stock Exchange"));
    expect(publisherFor("Taipei Exchange").id).toBe("tpex");
    expect(publisherFor("Board of Governors of the Federal Reserve System (US) via Federal Reserve Bank of St. Louis")).toMatchObject({ id: "frb", via: "FRED" });
    expect(publisherFor("Federal Reserve Board").via).toBeUndefined();
  });

  it("calls a joined list of agencies several agencies", () => {
    const joined =
      "S&P Dow Jones Indices LLC via Federal Reserve Bank of St. Louis; U.S. Bureau of Labor Statistics via Federal Reserve Bank of St. Louis; U.S. Census Bureau via Federal Reserve Bank of St. Louis";
    expect(publisherFor(joined)).toMatchObject({ id: "several", via: "FRED" });
  });

  it("handles the strings that name no publisher", () => {
    expect(publisherFor("FiledUnder collection specifications").id).toBe("internal");
    expect(publisherFor("Source attribution unresolved").id).toBe("unresolved");
    expect(
      publisherFor(
        "Official publisher identified by retained source URL",
        "https://static.nhtsa.gov/nhtsa/downloads/Safercar/Safercar_data.csv",
      ).id,
    ).toBe("nhtsa");
    expect(publisherFor("Official publisher identified by retained source URL", null).id).toBe("unresolved");
  });

  it("does not call the St. Louis Fed's own series a copy", () => {
    expect(publisherFor("Federal Reserve Bank of St. Louis via Federal Reserve Bank of St. Louis")).toEqual({
      id: "stlouisfed",
      name: "Federal Reserve Bank of St. Louis",
      short: "St. Louis Fed",
    });
  });

  it("returns an unknown agency as its own publisher instead of failing", () => {
    expect(publisherFor("Bank of Canada")).toEqual({ id: "bank-of-canada", name: "Bank of Canada", short: "Bank of Canada" });
    expect(publisherFor("").id).toBe("unresolved");
  });

  it("has unique ids and short names", () => {
    expect(new Set(PUBLISHERS.map((p) => p.id)).size).toBe(PUBLISHERS.length);
    expect(new Set(PUBLISHERS.map((p) => p.short)).size).toBe(PUBLISHERS.length);
  });
});

describe("collections", () => {
  it("lists 15 collections in a strict order, the internal one last", () => {
    expect(COLLECTIONS).toBe(EXPORTED_COLLECTIONS);
    expect(COLLECTIONS).toHaveLength(15);
    expect(COLLECTIONS.map((c) => c.order)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(COLLECTIONS[14]).toMatchObject({ id: "14_source_atlas", internal: true });
    expect(COLLECTIONS.every((c) => c.blurb.endsWith(".") && !/[\u2013\u2014]/.test(c.name + c.blurb))).toBe(true);
  });

  it("shows an unknown collection under its own id", () => {
    expect(collectionFor("15_space_weather")).toMatchObject({ id: "15_space_weather", name: "Space weather", order: 16 });
  });
});

describe("name rules", () => {
  it("replaces long dashes by meaning", () => {
    expect(withoutLongDashes("Plant annual net generation, 2020\u20132025")).toBe("Plant annual net generation, 2020 to 2025");
    expect(withoutLongDashes("FHFA House Price Index \u2014 complete master history")).toBe("FHFA House Price Index, complete master history");
    expect(withoutLongDashes("EIA charging-port microdata \u2014 complete June 2015\u2013September 2026")).toBe(
      "EIA charging-port microdata, complete June 2015 to September 2026",
    );
  });

  it("removes file-name marks and nothing else", () => {
    expect(cleanName("DS140 ds140 copper 2020 Copper")).toBe("DS140 copper 2020 Copper");
    expect(cleanName("EIA923 Generation Fuel 2025 FULL")).toBe("EIA923 Generation Fuel 2025");
    expect(cleanName("CSV ATTRIBUTES ACTIVE")).toBe("ATTRIBUTES ACTIVE");
    expect(cleanName("fed_h8  complete native_observations")).toBe("fed h8 complete native observations");
    expect(cleanName("Largest 500 insured banks at 2026Q2")).toBe("Largest 500 insured banks at 2026Q2");
  });

  it("recognises a name that is still a code or a file stem", () => {
    for (const bare of ["UNRATE", "FS220", "BHCF20260630", "S1282 1 t", "F4 3 s", "M3s A", "aircraft assets", "MER T01.01", ""]) {
      expect(isBareName(bare)).toBe(true);
    }
    for (const written of ["FDIC drug applications", "Largest 500 insured banks at 2026Q2", "H.8 monthly all-bank headline balances"]) {
      expect(isBareName(written)).toBe(false);
    }
  });

  it("turns EIA's table ids into the numbers EIA prints", () => {
    expect(merTableNumber("T01.01")).toBe("1.1");
    expect(merTableNumber("T07.02A")).toBe("7.2a");
    expect(merTableNumber("T10.04C")).toBe("10.4c");
    expect(merTableNumber("TA1")).toBe("A1");
    expect(merTableNumber("nonsense")).toBeNull();
  });
});

describe("families", () => {
  it("reads the family from source_id, or from the file stem when there is none", () => {
    expect(familyFor({ id: base.id, source_id: "FRED_UNRATE" })?.id).toBe("fred");
    expect(familyFor({ id: "x", source_id: "FED_Z1" })?.name).toBe("Financial Accounts of the United States (Z.1)");
    expect(familyFor({ id: "x", source_id: "EIA861_SALES" })?.id).toBe("eia-861");
    expect(familyFor({ id: "official_08_consumer_discretionary_monthly_panel_beeb05f44e", source_id: null })?.id).toBe("fred");
    expect(familyFor({ id: "official_02_technology_csv_twse_tech_companies_014b5e897f", source_id: null })?.id).toBe("twse-profiles");
    expect(familyFor({ id: "x", source_id: "SOMETHING_NEW" })).toBeNull();
  });
});

describe("describeDataset", () => {
  it("describes a FRED series", () => {
    const e = describeDataset(base);
    expect(e.publisher).toMatchObject({ id: "bls", via: "FRED" });
    expect(e.collection.id).toBe("00_universal");
    expect(e.family).toBe("fred");
    expect(e.kind).toBe("native");
    expect(e.hiddenByDefault).toBe(false);
    expect(e.issues).toEqual([]);
  });

  it("marks a projection with the parent the audit established", () => {
    const e = describeDataset({
      ...base,
      id: "official_11_real_estate_national_and_state_c21c1607a1",
      name: "National and state house price history",
      sector: "11_real_estate",
      agency: "Federal Housing Finance Agency",
      source_id: "FHFA_MASTER",
    });
    expect(e.kind).toBe("projection");
    expect(e.parentId).toBe("official_11_real_estate_hpi_master_all_0755e8292e");
    expect(e.issues.map((i) => i.id)).toEqual(["W5"]);
  });

  it("marks sums as derived, dictionaries as reference, kit sheets as internal and hidden", () => {
    const of = (id: string, more: Partial<CatalogInput> = {}) => describeDataset({ ...base, id, name: "x", source_id: null, ...more });
    expect(of("official_08_consumer_discretionary_recalls_year_d8884f5228")).toMatchObject({
      kind: "derived",
      parentId: "official_08_consumer_discretionary_recalls_all_product_records_c02255bd49",
    });
    expect(of("official_05_utilities_csv_egrid_field_dictionary_cb198314f3").kind).toBe("reference");
    expect(of("official_03_healthcare_csv_fda_marketingstatus_lookup_c3720aed4f").kind).toBe("reference");
    expect(of("official_06_industrials_monthly_panel_0189f33dde", { sector: "06_industrials" })).toMatchObject({
      kind: "projection",
      parentId: "official_06_industrials_indicators_all_observations_b5249d20d9",
    });
    expect(of("official_14_source_atlas_status_guide_a72f749764", { sector: "14_source_atlas" })).toMatchObject({
      kind: "internal",
      hiddenByDefault: true,
    });
    expect(of("official_07_materials_source_registry_667ab60cbb", { agency: "Source attribution unresolved" })).toMatchObject({
      kind: "internal",
      hiddenByDefault: true,
    });
  });

  it("hides an empty table and says why", () => {
    const e = describeDataset({ ...base, id: "official_12_sec_company_financials_ambiguous_facts_0440a6946c", rows: 0 });
    expect(e.hiddenByDefault).toBe(true);
    expect(e.issues).toEqual([{ id: "M10", text: "This table has no rows." }]);
    expect(describeDataset({ ...base, id: "brand_new", rows: 0 }).issues.map((i) => i.id)).toEqual(["M10"]);
  });

  it("drops the stale-copy issue once the table is retrieved after the new release", () => {
    const union = { ...base, id: "official_04_energy_csv_mer_all_107_tables_all_history_3e7c636fc7", sector: "04_energy", agency: "US EIA", source_id: "EIA_MER" };
    expect(describeDataset({ ...union, retrieved_at: "2026-11-24T09:55:00Z" }).issues.map((i) => i.id)).toEqual(["W1", "M4"]);
    expect(describeDataset({ ...union, retrieved_at: null }).issues.map((i) => i.id)).toEqual(["W1", "M4"]);
    expect(describeDataset({ ...union, retrieved_at: "2026-11-26T08:00:00Z" }).issues.map((i) => i.id)).toEqual(["M4"]);
  });

  it("never throws and keeps the stored name of a dataset it has not seen", () => {
    const e = describeDataset({ ...base, id: "official_99_new_thing", name: "new_thing 2027 \u2014 FULL", sector: "99_new", agency: "Bank of Canada", source_id: null });
    expect(e.title).toBe("new thing 2027");
    expect(e.kind).toBe("native");
    expect(e.issues).toEqual([]);
    expect(e.family).toBeNull();
    expect(() => describeDataset({} as CatalogInput)).not.toThrow();
    expect(() => describeDataset(null as unknown as CatalogInput)).not.toThrow();
  });
});

describe("staleAgainstParent", () => {
  it("is true only when both times are known and the parent is newer", () => {
    const child = { ...base, retrieved_at: "2026-11-24T10:09:00Z" };
    const parent = { ...base, retrieved_at: "2026-11-25T07:00:00Z" };
    expect(staleAgainstParent(child, parent)).toBe(true);
    expect(staleAgainstParent(parent, child)).toBe(false);
    expect(staleAgainstParent(child, child)).toBe(false);
    expect(staleAgainstParent({ ...child, retrieved_at: null }, parent)).toBe(false);
    expect(staleAgainstParent(child, { ...parent, retrieved_at: "not a date" })).toBe(false);
  });
});
