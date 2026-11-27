import { describe, expect, it } from "vitest";
import { disclosureEvidence, disclosurePaths, disclosureSharedInputs, type Disclosure } from "./disclosures";

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
  it("preserves separately documented projects using the same product and parties", () => {
    const other = [
      { ...first, id: "otherA", pathway: "Another project", source_date: "2026-10-10" },
      { ...second, id: "otherB", pathway: "Another project", source_date: "2026-10-10" },
    ];
    expect(disclosurePaths("B", [first, second, ...other]).map((p) => p.label)).toEqual(["Another project", "Arizona silicon"]);
    const unassignedEnd = { ...first, id: "ended", pathway: null, stage: "ended", source_date: "2026-11-01" };
    expect(disclosurePaths("B", [first, second, ...other, unassignedEnd])).toEqual([]);
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

describe("parallel program inputs", () => {
  const platform = link("PLATFORM", "SERVICE", { product: "Software", pathway: "Managed service" });
  const infra = link("CLOUD", "SERVICE", { product: "Runtime", pathway: "Managed service", stage: "in_use" });
  const other = link("CLOUD", "OTHER", { pathway: "Different service" });
  it("preserves a common recipient and prevents a supplier-to-supplier inference", () => {
    const rows = [platform, infra, other];
    for (const focus of ["PLATFORM", "CLOUD", "SERVICE"]) {
      expect(disclosureSharedInputs(focus, rows)).toMatchObject([{ label: "Managed service", recipient: "SERVICE", inputs: [infra, platform] }]);
      expect(disclosurePaths(focus, rows)).toEqual([]);
    }
    expect(disclosureSharedInputs("OTHER", rows)).toEqual([]);
  });
  it("requires distinct providers and keeps ended or unrelated products out of the group", () => {
    expect(disclosureSharedInputs("SERVICE", [platform, { ...platform, id: "extra", product: "Support" }, other])).toEqual([]);
    expect(disclosureSharedInputs("SERVICE", [platform, infra, { ...infra, id: "closed", source_date: "2026-11-01", stage: "ended" }])).toEqual([]);
  });
  it("shows shared inputs only for a matched direction and sufficient depth in the assistant", () => {
    const rows = [platform, infra];
    const data = { direct: rows, paths: [], sharedInputs: disclosureSharedInputs("SERVICE", rows) };
    expect(disclosureEvidence("SERVICE", data, "supplier", "Software", 2)).toContain("Parallel inputs to SERVICE");
    expect(disclosureEvidence("SERVICE", data, "supplier", "Software", 1)).not.toContain("Parallel inputs");
    expect(disclosureEvidence("SERVICE", data, "customer", "", 2)).toBe("");
  });
});
