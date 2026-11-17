import { describe, expect, it } from "vitest";
import { drugYears, makerTicker, medicareRows, parseYear } from "./medicare";

const COVERED = [
  { ticker: "BMY", name: "Bristol-Myers Squibb", sector: "Health Care" },
  { ticker: "MRK", name: "Merck & Co.", sector: "Health Care" },
  { ticker: "INCY", name: "Incyte", sector: "Health Care" },
  { ticker: "BMRN", name: "BioMarin Pharmaceutical", sector: "Health Care" },
  { ticker: "BIO", name: "Bio-Rad Laboratories", sector: "Health Care" },
];

describe("Medicare maker matching", () => {
  it("maps truncated CMS manufacturer names to the parent company", () => {
    expect(makerTicker("BMS Primarycare", COVERED)).toBe("BMY");
    expect(makerTicker("Celgene/BMS", COVERED)).toBe("BMY");
    expect(makerTicker("E.R. Squibb & Sons, L.L.C.", COVERED)).toBe("BMY");
    expect(makerTicker("Merck Sharp & D", COVERED)).toBe("MRK");
    expect(makerTicker("Incyte Corporat", COVERED)).toBe("INCY");
    expect(makerTicker("Biomarin Pharma", COVERED)).toBe("BMRN");
  });
  it("never guesses: uncovered parents, roll-ups and short or ambiguous labels stay unmatched", () => {
    expect(makerTicker("Pfizer US Pharm", COVERED)).toBeNull(); // rule hit, but PFE isn't in this list
    expect(makerTicker("Overall", COVERED)).toBeNull();
    expect(makerTicker("Bio", COVERED)).toBeNull();
    expect(makerTicker("Teva USA", COVERED)).toBeNull();
  });
  it("reads CMS year labels", () => {
    expect(parseYear("2025 (Q1-Q4)")).toEqual({ year: 2025, quarters: null });
    expect(parseYear("2026 (Q1)")).toEqual({ year: 2026, quarters: 1 });
    expect(parseYear("2026 (Q1-Q2)")).toEqual({ year: 2026, quarters: 2 });
  });
});

describe("Medicare rows", () => {
  const annual = [
    { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "Overall", Tot_Spndng_2024: "999" },
    { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "BMS Primarycare", Tot_Spndng_2023: "16000000000", Tot_Spndng_2024: "18000000000", Tot_Clms_2024: "100" },
    { Brnd_Name: "Sprycel", Gnrc_Name: "Dasatinib", Mftr_Name: "E.R. Squibb & Sons", Tot_Spndng_2024: "1000000000" },
  ];
  const quarterly = [
    { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "BMS Primarycare", Year: "2024 (Q1-Q4)", Tot_Spndng: "17500000000" },
    { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "BMS Primarycare", Year: "2025 (Q1-Q4)", Tot_Spndng: "24000000000" },
    { Brnd_Name: "Eliquis", Gnrc_Name: "Apixaban", Mftr_Name: "BMS Primarycare", Year: "2026 (Q1)", Tot_Spndng: "2600000000" },
  ];
  const resolve = (m: string) => makerTicker(m, COVERED);
  const rows = medicareRows([...drugYears("partD", "quarterly", quarterly, resolve), ...drugYears("partD", "annual", annual, resolve)]);
  const total = (uid: string) => rows.find((r) => r.uid === uid);

  it("sums the company's drugs per year and skips the all-maker roll-up", () => {
    expect(total("cms:partD:BMY:2024")?.value).toBe(19_000_000_000); // annual file wins over the quarterly 17.5B
    expect(total("cms:partD:BMY:2025")?.value).toBe(24_000_000_000);
    expect(total("cms:partD:BMY:2026q1")).toMatchObject({ value: 2_600_000_000, date: "2026-03-31", meta: { ytd: true, quarters: 1 } });
  });
  it("links each drug reading to its exact CMS record", () => {
    const r = rows.find((x) => x.uid === "cms:partD:BMY:eliquis:2026q1")!;
    expect(r.title).toBe("Part D · Eliquis");
    expect(r.source_url).toContain("4ff7c618-4e40-483a-b390-c8a58c94fa15");
    expect(r.source_url).toContain("Eliquis");
    expect(rows.find((x) => x.uid === "cms:partD:BMY:eliquis:2024")!.source_url).toContain("7e0b4365");
  });
  it("Part B drugs take their company from the supplied owner", () => {
    const b = drugYears("partB", "annual", [{ Brnd_Name: "Keytruda", Gnrc_Name: "Pembrolizumab", Tot_Spndng_2024: "5000000000" }], resolve, (brand) => (brand === "Keytruda" ? { ticker: "MRK", maker: "Merck Sharp & Dohme LLC" } : null));
    expect(medicareRows(b).find((r) => r.uid === "cms:partB:MRK:2024")?.value).toBe(5_000_000_000);
  });
});
