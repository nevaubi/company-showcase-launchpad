import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { reportToDocx } from "./report-docx";
import type { ReportContent } from "../reports/types";

const content: ReportContent = {
  version: 1, kind: "memo", name: "JPMorgan Chase", ticker: "JPM", title: "Funding mix", subtitle: "Peer comparison",
  asOf: "2026-09-30", priceAsOf: null, dataVersion: "", generatedAt: "2026-11-01", model: "",
  options: { length: "brief", audience: "ic", stance: "balanced", focus: "", sections: [] },
  sections: [{ id: "s", title: "Funding", paragraphs: [], bullets: [], tables: ["balance"], charts: ["mix"] }],
  qa: { claims: 0, citedClaims: 0, numbers: 0, verifiedNumbers: 0, removed: [] },
  facts: [
    { id: "peer", area: "balance", text: "Peer deposits", ref: { kind: "sec", tk: "BAC", label: "Deposits", src:
      { accn: "0000070858-26-000548", end: "2026-09-30", value: 1, concept: "us-gaap:Deposits" } } },
    { id: "combined", area: "peers", text: "Peer set", ref: { kind: "composite", label: "Median", formula: "Median", members: ["peer"] } },
  ],
  tables: [{ id: "balance", title: "Balance sheet", columns: ["Quarter end"], rows: [{ label: "Deposits", cells: [
    { text: "1", ref: { kind: "composite", label: "Peer group", formula: "Median", members: ["combined"] } }] }] }],
  charts: [{ id: "mix", type: "hbar", title: "Deposit comparison", unit: "usd", rows: [{ label: "Peer", v: 1, f: "combined" }], note: "Period-end balances only." }],
};
const brand = { branding: null, firmName: "Test research", logo: null, preparedBy: null };
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJzoAAAAASUVORK5CYII=", "base64"));

describe("report Word download", () => {
  it("retains the chart, its methodology, the table and its underlying peer filing even without narrative citations", async () => {
    const blob = await reportToDocx(content, brand, new Map([["mix", { png, w: 200, h: 100 }]]));
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("Period-end balances only.");
    expect(xml).toContain("Source documents and datasets");
    expect(xml).toMatch(/Quarter end[\s\S]+?Deposits[\s\S]+?<w:t[^>]*>D1<\/w:t>/);
    expect(Object.keys(zip.files).some((path) => /^word\/media\/.+\.png$/.test(path))).toBe(true);
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("text");
    expect(rels).toContain('Target="https://www.sec.gov/Archives/edgar/data/70858/000007085826000548/0000070858-26-000548-index.htm"');
  });
  it("identifies a missing chart before producing an incomplete document", async () => {
    await expect(reportToDocx(content, brand)).rejects.toThrow("Could not capture Deposit comparison");
  });
  it("continues to export saved reports that predate charts", async () => {
    const old = { ...content, charts: undefined, sections: content.sections.map((s) => ({ ...s, charts: undefined })) };
    expect((await reportToDocx(old, brand)).size).toBeGreaterThan(1000);
  });
});
