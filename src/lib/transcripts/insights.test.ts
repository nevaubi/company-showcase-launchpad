import { describe, expect, it } from "vitest";
import { gist } from "./analyze";
import { callFigures, callTone, checkTakeaways, exchanges, figuresIn, firmTicker, sentencesOf, termCount, topicShift } from "./insights";
import type { ParsedTranscript, TranscriptTurn } from "./parse";

const turn = (i: number, speaker: string, kind: TranscriptTurn["kind"], section: TranscriptTurn["section"], text: string): TranscriptTurn => ({
  i,
  speaker,
  kind,
  section,
  text,
  words: (text.match(/\S+/g) ?? []).length,
});
const call = (turns: TranscriptTurn[]): ParsedTranscript => ({
  turns,
  words: turns.reduce((s, x) => s + x.words, 0),
  qaStart: turns.findIndex((x) => x.section === "qa"),
  speakers: [
    { name: "Kevan Parekh", role: "CFO", firm: null, kind: "management", turns: 1, words: 0 },
    { name: "Erik Woodring", role: "Analyst", firm: "Morgan Stanley", kind: "analyst", turns: 1, words: 0 },
  ],
});

const cur = call([
  turn(0, "Kevan Parekh", "management", "prepared", "Our revenue of $114.5 billion was up 12% year-over-year, a September quarter record. Thank you all for joining. Services revenue was $31.6 billion, up 10%. We expect gross margin to be between 47% and 48%. Memory costs remain a headwind and supply is constrained."),
  turn(1, "Operator", "operator", "qa", "Our first question is from Erik Woodring of Morgan Stanley."),
  turn(2, "Erik Woodring", "analyst", "qa", "Thanks for taking my question. How should we think about memory costs and gross margin into next year?"),
  turn(3, "Kevan Parekh", "management", "qa", "Memory costs are rising and we see pressure on gross margin, but we remain confident in strong demand. Memory pricing may stay elevated."),
]);
const prev = call([
  turn(0, "Kevan Parekh", "management", "prepared", "Our revenue of $109.4 billion was up 16% year-over-year. Tariff refunds helped gross margin. Tariff costs and tariff refunds were discussed. Tariff impacts were favorable. We saw tariff refunds again. Services were strong."),
  turn(1, "Erik Woodring", "analyst", "qa", "Can you talk about tariff refunds and their timing?"),
]);

describe("sentences and figures", () => {
  it("splits sentences without breaking decimals", () => {
    expect(sentencesOf("Revenue was $1.5 billion. Margin was 47.9%. Thanks.")).toEqual(["Revenue was $1.5 billion.", "Margin was 47.9%.", "Thanks."]);
  });
  it("reads money, percentages and basis points", () => {
    expect(figuresIn("Revenue of $114.5 billion, up 12% and 40 basis points of margin")).toEqual(["$114.5 billion", "12%", "40 basis points"]);
  });
});

describe("callFigures", () => {
  it("keeps verbatim management sentences that state a figure about a metric, in the order said", () => {
    const f = callFigures(cur, 5);
    expect(f.map((x) => x.sentence)).toEqual([
      "Our revenue of $114.5 billion was up 12% year-over-year, a September quarter record.",
      "Services revenue was $31.6 billion, up 10%.",
      "We expect gross margin to be between 47% and 48%.",
    ]);
    expect(f[0]).toMatchObject({ i: 0, topic: "Revenue", figures: ["$114.5 billion", "12%"] });
  });
});

describe("topicShift", () => {
  it("counts whole-word mentions outside the operator", () => {
    expect(termCount(cur, "memory")).toBe(4);
    expect(termCount(prev, "memory")).toBe(0);
  });
  it("marks topics new, and a top topic of the previous call as dropped", () => {
    // keyTerms needs a word five times (a phrase four); repeat the calls to cross that floor.
    const big = (t: ParsedTranscript, k: number): ParsedTranscript => {
      const turns = Array.from({ length: k }, (_, r) => t.turns.map((x) => ({ ...x, i: x.i + r * 10 }))).flat();
      return { ...t, turns, words: turns.reduce((s, x) => s + x.words, 0) };
    };
    const shift = topicShift(big(cur, 3), big(prev, 3), 12);
    const memory = shift.find((r) => r.term === "memory costs");
    expect(memory?.trend).toBe("new");
    expect(memory?.count).toBe(9); // three "memory costs" per copy
    expect(memory?.prevCount).toBe(0);
    // per 10,000 words: 9 mentions in 3 × cur.words
    expect(memory?.rate).toBeCloseTo((9 / (3 * cur.words)) * 10_000, 6);
    const tariff = shift.find((r) => r.term.startsWith("tariff"));
    expect(tariff?.trend).toBe("dropped");
  });
});

describe("callTone", () => {
  it("counts the word list in management's words by section", () => {
    const t = callTone(cur);
    // prepared: "record" +1; "headwind", "constrained" −2
    expect(t.prepared.positive).toBe(1);
    expect(t.prepared.negative).toBe(2);
    expect(t.prepared.net).toBeNull(); // fewer than ten scored words
    // Q&A answer: "confident", "strong" +2; "pressure" −1; hedging "may"
    expect(t.qa.positive).toBe(2);
    expect(t.qa.negative).toBe(1);
    expect(t.qa.hedge).toBe(1);
  });
});

describe("exchanges", () => {
  it("groups an analyst's question with management's answer and tags the call's topics", () => {
    const [e] = exchanges(cur, ["memory", "gross margin", "services"], gist);
    // "memory" 3 times and "gross margin" twice in the exchange; "services" not at all.
    expect(e).toMatchObject({ i: 2, analyst: "Erik Woodring", firm: "Morgan Stanley", answeredBy: ["Kevan Parekh"] });
    expect(e.topics).toEqual(["memory", "gross margin"]);
    expect(e.gist).toBe("How should we think about memory costs and gross margin into next year?");
    expect(e.answerWords).toBe(cur.turns[3].words);
  });
});

describe("checkTakeaways", () => {
  it("keeps a takeaway only when its figures were said on the call", () => {
    const r = checkTakeaways(cur, [
      { label: "Revenue", text: "$114.5 billion, representing 12% growth." },
      { label: "Diluted EPS", text: "$2.10, rising 14%." },
      { label: "Supply", text: "Constrained through the holidays." },
    ]);
    expect(r.kept.map((k) => k.label)).toEqual(["Revenue", "Supply"]);
    expect(r.kept[0].i).toBe(0);
    expect(r.dropped).toBe(1);
  });
});

describe("firmTicker", () => {
  const covered = (t: string) => ["GS", "MS", "JPM", "BAC"].includes(t);
  it("links covered brokers and nothing else", () => {
    expect(firmTicker("Morgan Stanley", covered)).toBe("MS");
    expect(firmTicker("BofA Securities", covered)).toBe("BAC");
    expect(firmTicker("J.P. Morgan", covered)).toBe("JPM");
    expect(firmTicker("Evercore ISI", covered)).toBeNull();
    expect(firmTicker("Autonomous Research", covered)).toBeNull();
  });
});

describe("gist", () => {
  it("skips a short preamble to reach the question", () => {
    expect(gist("Hey, good morning. I guess maybe 1 question. Just. Over the last couple of months, how do you think about agentic AI risk?")).toBe(
      "Over the last couple of months, how do you think about agentic AI risk?",
    );
  });
});
