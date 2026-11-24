// Speaker roles on real Motley Fool pages (fetched 23 Nov 2026, stored as fetched in __fixtures__).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "./parse";
import { exchanges } from "./insights";

const page = (f: string) => parseTranscript(readFileSync(path.resolve(__dirname, "__fixtures__", f), "utf8"));
const maxAnalystShare = (t: ReturnType<typeof parseTranscript>) =>
  Math.max(0, ...t.speakers.filter((s) => s.kind === "analyst").map((s) => s.words / t.words));

describe("speaker roles (earnings-C2)", () => {
  it("NVIDIA Q2 FY27: the chief executive, listed as Jensen Huang and speaking as Jen-Hsun Huang, is management", () => {
    const t = page("nvda-q2-2027.md");
    expect(t.speakers.find((s) => s.name === "Jen-Hsun Huang")?.kind).toBe("management");
    expect(t.speakers.find((s) => s.name === "Toshiya Hari")?.kind).toBe("management");
    expect(maxAnalystShare(t)).toBeLessThan(0.1);
    const ex = exchanges(t, [], (s) => s.slice(0, 40));
    expect(ex.every((e) => e.answerWords > 0)).toBe(true);
    expect(ex.some((e) => e.analyst === "Jen-Hsun Huang")).toBe(false);
  });
  it("Apple Q4 2026: a questioner introduced as Krish Sankar who speaks as Sreekrishnan Sankarnarayanan is the TD Cowen analyst", () => {
    const sp = page("aapl-q4-2026.md").speakers.find((s) => s.name === "Sreekrishnan Sankarnarayanan");
    expect(sp?.kind).toBe("analyst");
    expect(sp?.firm).toBe("TD Cowen");
  });
  it("Apple Q2 2026 (no Q&A heading): the first questioner, introduced by the operator, opens the Q&A as an analyst", () => {
    const t = page("aapl-q2-2026.md");
    expect(t.speakers.find((s) => s.name === "Erik Woodring")?.kind).toBe("analyst");
    expect(t.qaStart).toBe(5);
  });
  it("a speaker nothing identifies is unidentified, not an analyst", () => {
    const md = "## CALL PARTICIPANTS\n\n- Chief Executive Officer - Jane Doe\n\n## Full Conference Call Transcript\n\n**Operator:** Welcome.\n\n**Jane Doe:** Thanks. Revenue grew.\n\n## Questions & Answers\n\n**Operator:** Our first question is from Sam Lee of Acme Securities.\n\n**Sam Lee:** How is demand?\n\n**Jane Doe:** Strong.\n\n**Operator:** That concludes the call.\n\n**Pat Smith:** Goodbye everyone.";
    const t = parseTranscript(md);
    expect(t.speakers.find((s) => s.name === "Pat Smith")?.kind).toBe("unidentified");
    expect(t.speakers.find((s) => s.name === "Sam Lee")?.kind).toBe("analyst");
  });
  it("JPMorgan Q3 2026 and Apple Q4 2026 keep their verified exchange counts (12 and 10)", () => {
    for (const [f, n] of [["jpm-q3-2026.md", 12], ["aapl-q4-2026.md", 10]] as const) {
      const t = page(f);
      expect(exchanges(t, [], (s) => s).length).toBe(n);
      expect(maxAnalystShare(t)).toBeLessThan(0.1);
    }
  });
});
