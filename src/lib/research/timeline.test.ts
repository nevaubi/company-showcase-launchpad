import { describe, expect, it } from "vitest";
import type { Step } from "./loop";
import { argSummary, buildTimeline } from "./timeline";

const tool = (name: string, extra: Partial<Step> = {}): Step => ({ kind: "tool", name, summary: "", status: "done", ...extra });

describe("buildTimeline", () => {
  it("keeps reasoning lines and groups repeated finished calls", () => {
    const items = buildTimeline([
      { kind: "think", name: "reasoning", summary: "Need the filings", status: "done" },
      tool("read_webpage", { batch: 1 }),
      tool("read_webpage", { batch: 2 }),
      tool("read_webpage", { batch: 3 }),
      tool("get_quotes", { batch: 4 }),
    ]);
    expect(items.map((i) => i.type)).toEqual(["think", "group", "single"]);
    expect(items[1].type === "group" && items[1].steps).toHaveLength(3);
  });

  it("shows mixed calls from one step side by side", () => {
    const items = buildTimeline([tool("get_financials", { batch: 1 }), tool("get_quotes", { batch: 1, status: "running" }), tool("highlight", { batch: 2 })]);
    expect(items.map((i) => i.type)).toEqual(["parallel", "single"]);
  });

  it("does not group running or failed calls", () => {
    const items = buildTimeline([tool("read_webpage", { status: "running" }), tool("read_webpage", { status: "error" })]);
    expect(items.map((i) => i.type)).toEqual(["single", "single"]);
  });
});

describe("argSummary", () => {
  it("summarizes common arguments", () => {
    expect(argSummary("read_webpage", { url: "https://www.sec.gov/x" })).toBe("sec.gov");
    expect(argSummary("highlight", { target: "Gaps", label: "Open gap at $182" })).toBe("Open gap at $182");
    expect(argSummary("browser_task", { tasks: [{ goal: "a" }, { goal: "b" }] })).toBe("2 goals");
    expect(argSummary("render_view", { spec: '{"type":"chart","title":"Revenue"}' })).toBe("Revenue");
    expect(argSummary("create_file", { name: "semis", format: "csv" })).toBe("semis.csv");
  });
});
