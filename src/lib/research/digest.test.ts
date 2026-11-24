import { describe, expect, it, vi } from "vitest";

// The dossier's computed digest reads partner files; here only the 30-day brief and the pipeline's model-written
// quant read exist, so the test shows which of the two reaches the assistant.
const files: Record<string, unknown> = {
  "brief/TEST.json": { sentences: [{ text: "Revenue rose 12% on a year earlier in the quarter filed on 3 Nov 2026." }] },
  "quant/read/TEST.json": { sentences: [{ text: "Momentum is strong and the setup favours further gains." }] },
};
vi.mock("@/lib/data", () => ({
  partnerFile: async (p: string) => {
    if (!(p in files)) throw new Error("404");
    return files[p];
  },
  pricesQuery: (symbol: string) => ({ queryKey: ["prices", symbol], queryFn: async () => ({ bars: [] }) }),
  companyQuery: (t: string) => ({ queryKey: ["company", t], queryFn: async () => { throw new Error("404"); } }),
  usePrices: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/sec.functions", () => ({ getFilingDocument: async () => { throw new Error("SEC refused"); } }));

import { computedDigest } from "./intel";

const qc = { fetchQuery: async (o: { queryFn: () => unknown }) => o.queryFn() } as never;

describe("get_company_dossier computed digest", () => {
  it("keeps the brief and leaves out the untested quant read, pointing at get_quant_profile instead", async () => {
    const text = (await computedDigest(qc, "TEST")).join("\n");
    expect(text).toContain("BRIEF: Revenue rose 12%");
    expect(text).not.toContain("QUANT");
    expect(text).not.toContain("Momentum is strong");
    expect(text).toContain("get_quant_profile for the Technicals page's tested verdict");
  });
  it("is empty when only the quant read exists", async () => {
    const brief = files["brief/TEST.json"];
    delete files["brief/TEST.json"];
    try {
      expect(await computedDigest(qc, "TEST")).toEqual([]);
    } finally {
      files["brief/TEST.json"] = brief;
    }
  });
});
