import { describe, expect, it } from "vitest";
import { accnFromSecUrl, datesInText, inferFiled } from "@/lib/ir/doc-meta";
import { duplicateOf, figureSet } from "@/lib/ir/dedupe";

describe("filing date inference", () => {
  it("prefers the partner's publish date, then the 8-K date in the title", () => {
    expect(inferFiled({ published: "2026-10-27", title: "8-K 2026-10-20 x.htm" })).toEqual({ filed: "2026-10-27", basis: "published" });
    expect(inferFiled({ title: "8-K 2024-05-01 cvs_ex99x1q1-24.htm (Items 2.02,9.01)" })).toEqual({ filed: "2024-05-01", basis: "sec-title" });
  });
  it("uses a printed date only shortly after the reported period", () => {
    const text = "Founded March 3, 1996. DETROIT, July 23, 2024 — GM reported second-quarter results.";
    expect(inferFiled({ text, periodEnd: "2024-06-30", today: "2026-11-13" })).toEqual({ filed: "2024-07-23", basis: "document-date" });
    expect(inferFiled({ text, periodEnd: "2023-06-30", today: "2026-11-13" })).toEqual({ filed: null, basis: null });
    expect(inferFiled({ text, today: "2026-11-13" })).toEqual({ filed: null, basis: null });
  });
  it("reads US, day-first and ISO dates", () => {
    expect(datesInText("Aug. 5, 2026; 5 August 2026; 2026-08-05; February 30, 2026")).toEqual(["2026-08-05", "2026-08-05", "2026-08-05"]);
  });
  it("derives the accession from an SEC archive URL", () => {
    expect(accnFromSecUrl("https://www.sec.gov/Archives/edgar/data/64803/000006480326000107/cvs.htm")).toBe("0000064803-26-000107");
    expect(accnFromSecUrl("https://investor.gm.com/static-files/x")).toBeNull();
  });
});

describe("duplicate copies", () => {
  const sec = { id: "sec", figures: figureSet(Array.from({ length: 60 }, (_, i) => `${(i + 1) * 1013}`).join(" ")) };
  it("skips a copy whose figures are all in the SEC exhibit", () => {
    const pdf = figureSet(Array.from({ length: 50 }, (_, i) => `$ ${((i + 1) * 1013).toLocaleString("en-US")}`).join(" "));
    expect(duplicateOf(pdf, [sec])?.id).toBe("sec");
  });
  it("keeps a copy with its own figures", () => {
    const deck = figureSet(Array.from({ length: 50 }, (_, i) => `${(i + 1) * 997}`).join(" "));
    expect(duplicateOf(deck, [sec])).toBeNull();
  });
});
