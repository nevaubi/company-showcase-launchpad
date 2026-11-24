import { describe, expect, it } from "vitest";
import { logoUrl } from "@/components/app/company-logo";
import { logoKey } from "./logo-key";

describe("a name without a ticker never borrows a covered company's logo", () => {
  it("uncovered names get a key no bundled ticker matches", () => {
    for (const name of ["OpenAI Group PBC", "TeamViewer", "Playtika"]) {
      const k = logoKey({ ticker: null, name });
      expect(k, name).not.toBe(name.slice(0, 4).toUpperCase());
      expect(logoUrl(k), name).toBeUndefined();
    }
    expect(logoKey({ ticker: null, name: "OpenAI Group PBC" })).toBe("OPEN ");
  });
  it("a covered company keeps its ticker", () => {
    expect(logoKey({ ticker: "NVDA", name: "NVIDIA" })).toBe("NVDA");
  });
});
