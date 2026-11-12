import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/voice.functions", () => ({ speak: vi.fn(), transcribe: vi.fn() }));
import { plainForSpeech } from "./voice";

describe("plainForSpeech", () => {
  it("strips markdown, links, tables and code so only sentences are read", () => {
    const md = "## Answer\n**Revenue** rose to $4.3B ([10-Q Jul 2026](filing:NKE:0001 \"rose to\")).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- Margin fell [here](pin:2)\n```chart\n{\"x\":1}\n```";
    expect(plainForSpeech(md)).toBe("Answer Revenue rose to $4.3B (10-Q Jul 2026). Margin fell here");
  });

  it("cuts a long answer at a sentence and says the rest is on screen", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = plainForSpeech(long, 200);
    expect(out.length).toBeLessThan(240);
    expect(out.endsWith("is here. The rest is on screen.")).toBe(true);
  });
});
