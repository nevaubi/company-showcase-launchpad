import { describe, expect, it } from "vitest";
import { drugKey, geoCompanyText, geoDistributions, geoRows, parseCsv, parseGeoCsv, partDOwners } from "./medicare-geo";

const HEAD = "Prscrbr_Geo_Lvl,Prscrbr_Geo_Cd,Prscrbr_Geo_Desc,Brnd_Name,Gnrc_Name,Tot_Prscrbrs,Tot_Clms,Tot_30day_Fills,Tot_Drug_Cst,Tot_Benes";
const csv = [
  HEAD,
  'National,,National,Eliquis,Apixaban,10,100,1,1000,50',
  'State,48,Texas,Eliquis,Apixaban,5,60,1,600,30',
  'State,06,California,Eliquis,Apixaban,5,40,1,400,20',
  'National,,National,"Pen Needle, Diabetic","Pen Needle, Diabetic",1,1,1,50,1',
  'State,48,Texas,"Pen Needle, Diabetic","Pen Needle, Diabetic",1,1,1,50,1',
  'State,06,California,Atorvastatin,Atorvastatin,1,1,1,3950,1',
  'State,,Unknown,Eliquis,Apixaban,1,1,1,0,1',
].join("\n");

describe("parseCsv", () => {
  it("keeps commas and escaped quotes inside quoted fields", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
});

describe("parseGeoCsv", () => {
  it("reads national and state rows, maps state names to codes and drops zero-cost rows", () => {
    const r = parseGeoCsv(csv);
    expect(r).toHaveLength(6);
    expect(r[1]).toMatchObject({ national: false, state: "TX", brand: "Eliquis", cost: 600, claims: 60 });
    expect(r[3].brand).toBe("Pen Needle, Diabetic");
  });
});

describe("partDOwners", () => {
  const resolve = (m: string) => (/^bms/i.test(m) ? "BMY" : /^pfizer/i.test(m) ? "PFE" : null);
  it("gives a brand to the company whose labelers carry at least 95% of its spending that year", () => {
    const o = partDOwners(
      [
        { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "Overall", Tot_Spndng_2024: "1000" },
        { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "BMS Primarycare", Tot_Spndng_2024: "1000" },
        { Brnd_Name: "Atorvastatin", Gnrc_Name: "Atorvastatin", Mftr_Name: "Pfizer", Tot_Spndng_2024: "900", Tot_Spndng_2023: "990" },
        { Brnd_Name: "Atorvastatin", Gnrc_Name: "Atorvastatin", Mftr_Name: "Some Generic Co", Tot_Spndng_2024: "100", Tot_Spndng_2023: "10" },
      ],
      resolve,
    );
    expect(o.get(2024)!.get(drugKey("Eliquis", "Apixaban"))).toBe("BMY");
    // 90% isn't enough: a multi-source generic stays unattributed …
    expect(o.get(2024)!.has(drugKey("Atorvastatin", "Atorvastatin"))).toBe(false);
    // … while a year with 99% from one maker counts
    expect(o.get(2023)!.get(drugKey("Atorvastatin", "Atorvastatin"))).toBe("PFE");
  });
});

describe("geoRows", () => {
  it("sums the company's drugs by state with shares, the state's slice and an index against Medicare overall", () => {
    const owners = new Map([[drugKey("Eliquis", "Apixaban"), "BMY"]]);
    const rows = geoRows(2024, parseGeoCsv(csv), owners, "ds-1", { spend: new Map([["BMY", 1250]]) });
    const total = rows.find((r) => r.uid === "cmsgeo:BMY:2024:total")!;
    expect(total.value).toBe(1000);
    expect(total.meta.coverage).toBeCloseTo(0.8);
    expect(total.meta.states).toBe(2);
    const tx = rows.find((r) => r.uid === "cmsgeo:BMY:2024:TX")!;
    expect(tx.value).toBe(600);
    expect(tx.meta.share).toBeCloseTo(0.6);
    expect(tx.meta.market_share).toBeCloseTo(600 / 650);
    // Texas holds 650 of all 5,000 state-placed Part D dollars (13%) but 60% of the company's
    expect(tx.meta.index).toBeCloseTo(0.6 / (650 / 5000));
    const ca = rows.find((r) => r.uid === "cmsgeo:BMY:2024:CA")!;
    expect(ca.meta.index).toBeCloseTo(0.4 / (4350 / 5000));
    expect(ca.meta.rank).toBe(2);
    expect(tx.source_url).toContain("filter%5BPrscrbr_Geo_Desc%5D=Texas&filter%5BBrnd_Name%5D=Eliquis");
    expect(rows.some((r) => r.ticker !== "BMY")).toBe(false);
  });
});

describe("geoDistributions", () => {
  it("links each year's own API version rather than the moving 'latest' alias", () => {
    const m = geoDistributions({
      dataset: [
        {
          title: "Medicare Part D Prescribers - by Geography and Drug : 2024-12-01",
          distribution: [
            { accessURL: "https://data.cms.gov/data-api/v1/dataset/c8ea3f8e-3a09-4fea-86f2-8902fb4b0920/data", description: "latest" },
            { downloadURL: "https://data.cms.gov/sites/default/files/x/DY24_Geo.csv" },
            { accessURL: "https://data.cms.gov/data-api/v1/dataset/9b4c142c-69cc-4a96-a09a-7cf2ba7f5816/data" },
          ],
        },
        { title: "Something else : 2024", distribution: [] },
      ],
    });
    expect(m.get(2024)).toEqual({ csv: "https://data.cms.gov/sites/default/files/x/DY24_Geo.csv", id: "9b4c142c-69cc-4a96-a09a-7cf2ba7f5816" });
    expect(m.size).toBe(1);
  });
});

describe("geoCompanyText", () => {
  it("lists the latest year's states with share, slice of the state, index, change and their record links", () => {
    const owners = new Map([[drugKey("Eliquis", "Apixaban"), "BMY"]]);
    const recs = parseGeoCsv(csv);
    const half = parseGeoCsv(csv).map((r) => ({ ...r, cost: r.cost / 2 }));
    const rows = [...geoRows(2023, half, owners, "ds-0"), ...geoRows(2024, recs, owners, "ds-1")].map((r) => ({ ...r, ticker: r.ticker }));
    const t = geoCompanyText(rows, "BMY");
    expect(t).toContain("BMY Medicare Part D gross drug costs by prescriber state, 2024");
    expect(t).toMatch(/TX \$1K · 60\.0% of company · 92\.31% of the state's Part D · index 4\.62 · \+100% vs 2023/);
    expect(t).toContain("filter%5BPrscrbr_Geo_Desc%5D=Texas");
  });
});
