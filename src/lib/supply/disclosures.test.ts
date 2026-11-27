import { describe, expect, it } from "vitest";
import { disclosureEvidence, disclosurePaths, type Disclosure } from "./disclosures";

const link = (provider: string, recipient: string, overrides: Partial<Disclosure> = {}): Disclosure => ({
  id: provider + recipient, provider_key: provider, recipient_key: recipient, provider_name: provider, recipient_name: recipient,
  stage: "planned", product: "Wafer", pathway: "Arizona silicon", detail: "An announced program",
  publisher: "Issuer", source_date: "2026-08-01", reviewed_on: "2026-11-27", source_url: "https://example.com/source", source_phrase: "Wafer", ...overrides,
});

describe("issuer-disclosed product pathways", () => {
  const first = link("A", "B");
  const second = link("B", "C", { product: "Finished silicon", stage: "in_use" });
  it("matches the shared product program and keeps each leg's stage and source", () => {
    const rows = [first, second, link("B", "D", { pathway: "Unrelated program" }), link("C", "B", { pathway: null })];
    for (const t of ["A", "B", "C"]) {
      const paths = disclosurePaths(t, rows);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatchObject({ first, second });
    }
    expect(disclosurePaths("D", rows)).toEqual([]);
  });
  it("never closes cycles or promotes an ended leg, even if the older evidence remains", () => {
    expect(disclosurePaths("A", [first, link("B", "A")])).toEqual([]);
    expect(disclosurePaths("A", [first, second, { ...first, id: "later", source_date: "2026-11-01", stage: "ended" }])).toEqual([]);
  });
  it("keeps supplier/customer direction, filter, and depth in the assistant", () => {
    const records = { direct: [first, second], paths: disclosurePaths("B", [first, second]) };
    const output = disclosureEvidence("B", records, "supplier", "wafer", 1);
    expect(output).toContain("A → B");
    expect(output).not.toContain("B → C");
    expect(disclosureEvidence("B", records, "customer", "silicon", 2)).toContain("first leg Planned");
    expect(disclosureEvidence("B", records, "supplier", "silicon", 2)).toBe("");
  });
});
