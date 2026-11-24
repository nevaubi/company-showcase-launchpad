// Machine-written summary and takeaways checked against real Motley Fool pages (earnings-H3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "./parse";
import { checkClaims, checkSummary, checkTakeaways, numbersIn } from "./insights";

const page = (f: string) => parseTranscript(readFileSync(path.resolve(__dirname, "__fixtures__", f), "utf8"));

describe("numbersIn", () => {
  it("treats bare counts as figures and normalises 76.0% to 76%", () => {
    expect(numbersIn("Services gross margin was 76.0%, up 40 basis points").map((n) => [n.unit, n.value])).toEqual([
      ["pct", 76],
      ["bp", 40],
    ]);
    expect(numbersIn("Over 2.5 billion devices and 650,000 net new accounts").map((n) => [n.unit, n.value])).toEqual([
      ["count", 2.5e9],
      ["count", 650000],
    ]);
    expect(numbersIn("$114.5 billion")[0]).toMatchObject({ unit: "usd", value: 114.5e9 });
  });
  it("skips years, quarter names and form names", () => {
    expect(numbersIn("In Q4 of fiscal 2026 the 10-K and FY26 were filed")).toEqual([]);
  });
});

describe("checkClaims on Apple Q4 2026", () => {
  const t = page("aapl-q4-2026.md");
  it("matches 76.0% to the 76% management said about services gross margin", () => {
    const [r] = checkClaims(t, [{ label: "Services Gross Margin", text: "76.0%, increasing 40 basis points sequentially." }]);
    expect(r.status).toBe("checked");
    expect(r.i).not.toBeNull();
  });
  it("checks bare counts: 2.5 billion devices and 1.5 billion paid subscriptions were said, 1.7 billion was not", () => {
    const [a, b, c] = checkClaims(t, [
      { label: "Active Installed Base", text: "Over 2.5 billion devices, reaching a new all-time high." },
      { label: "Paid Subscriptions", text: "Over 1.5 billion, growing double digits." },
      { label: "Paid Subscriptions", text: "Over 1.7 billion, growing double digits." },
    ]);
    expect(a.status).toBe("checked");
    expect(b.status).toBe("checked");
    expect(c.status).toBe("not-found");
  });
  it("requires the label's key word in the same management sentence as the figure", () => {
    // 12% was said about revenue, not about paid subscriptions.
    const [r] = checkClaims(t, [{ label: "Paid Subscriptions", text: "Up 12%." }]);
    expect(r.status).toBe("not-found");
  });
  it("keeps only checked takeaways and counts the rest", () => {
    const tk = t.digest!.takeaways;
    const r = checkTakeaways(t, tk);
    expect(r.kept.length + r.dropped).toBe(tk.length);
    expect(r.kept.some((k) => /Services Gross Margin/i.test(k.label))).toBe(true);
    expect(r.kept.every((k) => k.i != null)).toBe(true);
  });
  it("checks the summary sentence by sentence", () => {
    const s = checkSummary(t, `${t.digest!.summary} Revenue reached $999.9 billion.`);
    expect(s).not.toBeNull();
    expect(s!.text).not.toContain("999.9");
    expect(s!.removed).toBeGreaterThanOrEqual(1);
  });
});
