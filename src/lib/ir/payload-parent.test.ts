import { describe, expect, it } from "vitest";
import type { IrSeries } from "./kpis";
import { bestParent } from "./payload";

const s = (k: string, docs: string[], extra: Partial<IrSeries> = {}) =>
  ({ key: k, breakdown: null, isTotal: false, cells: Object.fromEntries(docs.map((d, i) => [`2026-0${i + 3}-31`, { fact: { document_id: d } }])), annual: {}, ...extra }) as unknown as IrSeries;

describe("a part's parent among lines with the same name (review L1)", () => {
  it("prefers the line printed in the part's own document over a printed total elsewhere", () => {
    const kid = s("kid", ["doc-a"]);
    const elsewhere = s("total", ["doc-b"], { isTotal: true });
    const same = s("same", ["doc-a"]);
    expect(bestParent(kid, [elsewhere, same]).key).toBe("same");
  });
  it("matches breakdown names by their scope, not their exact wording", () => {
    const kid = s("kid", ["doc-a"], { breakdown: "Segment results" });
    const other = s("other", ["doc-a"], { breakdown: "Income statement", isTotal: true });
    const mine = s("mine", ["doc-c"], { breakdown: "Segment Results Summary" });
    expect(bestParent(kid, [other, mine]).key).toBe("mine");
  });
});
