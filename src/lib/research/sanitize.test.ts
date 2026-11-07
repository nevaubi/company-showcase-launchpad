import { describe, expect, it } from "vitest";
import { sanitizeAnswer, wantsCode } from "./sanitize";

// Leak shapes seen from tool-calling models: pasted specs, tool-call echoes, raw tool output, traces.
const SPEC_FENCE = `Here is the revenue picture.

\`\`\`json
{"type":"chart","chart":"line","title":"NVDA revenue","x":"period","series":["NVDA"],"data":[{"period":"FY24","NVDA":60.9e9},{"period":"FY25","NVDA":130.5e9}]}
\`\`\`

Growth more than doubled.`;

const TOOL_ECHO = `I'll build the dashboard now.
{"name": "render_view", "arguments": {"spec": "{\\"type\\":\\"kpis\\",\\"items\\":[]}", "why": "show kpis"}}
functions.render_view({"spec":"{}","why":"x"})
<tool_call>{"name":"create_file","arguments":{}}</tool_call>
The dashboard is in the canvas.`;

const BARE_TABLE = `Peer multiples:
[{"ticker":"NVDA","pe":48.2,"ev_sales":25.1},{"ticker":"AMD","pe":30.4,"ev_sales":8.2},{"ticker":"INTC","pe":null,"ev_sales":2.1}]
NVDA trades at a premium.`;

const SERIES_FENCE = "```\n" + JSON.stringify([
  { year: "2022", revenue: 27e9 }, { year: "2023", revenue: 27e9 }, { year: "2024", revenue: 61e9 }, { year: "2025", revenue: 130e9 },
]) + "\n```";

const JS_TRACE = `I hit an error:
TypeError: Cannot read properties of undefined (reading 'map')
    at runTool (https://app.example/assets/execute-abc.js:12:345)
    at async Promise.all (index 0)
    at async runAgent (https://app.example/assets/loop-def.js:3:99)
Retrying with another source gave the answer below.`;

const PY_TRACE = `Traceback (most recent call last):
  File "/tmp/x.py", line 3, in <module>
    main()
ValueError: bad input
The model result is $12.4B.`;

const CODE = "Model:\n```python\nimport numpy as np\nprint(np.mean([1,2]))\n```\nResult: 1.5";

describe("sanitizeAnswer", () => {
  it("moves a pasted view spec to the canvas and references it by title", () => {
    const r = sanitizeAnswer(SPEC_FENCE);
    expect(r.views).toHaveLength(1);
    expect(r.views[0].title).toBe("NVDA revenue");
    expect(r.markdown).toContain("_Shown in the canvas: NVDA revenue._");
    expect(r.markdown).not.toMatch(/"series"/);
    expect(r.markdown).toContain("Growth more than doubled.");
  });

  it("drops tool-call echoes in JSON, call syntax and tags", () => {
    const r = sanitizeAnswer(TOOL_ECHO);
    expect(r.markdown).not.toMatch(/render_view|create_file|arguments|tool_call/);
    expect(r.markdown).toContain("I'll build the dashboard now.");
    expect(r.markdown).toContain("The dashboard is in the canvas.");
  });

  it("turns a bare JSON array of records into a Markdown table", () => {
    const r = sanitizeAnswer(BARE_TABLE);
    expect(r.markdown).toContain("| ticker | pe | ev_sales |");
    expect(r.markdown).toContain("| NVDA | 48.2 | 25.1 |");
    expect(r.markdown).toContain("| INTC | — | 2.1 |");
    expect(r.markdown).not.toContain('{"ticker"');
  });

  it("turns a labelled numeric series into a chart block", () => {
    const r = sanitizeAnswer(SERIES_FENCE);
    expect(r.markdown).toMatch(/^```chart\n/);
    const spec = JSON.parse(r.markdown.replace(/^```chart\n|\n```$/g, ""));
    expect(spec).toMatchObject({ type: "line", x: "year", series: ["revenue"] });
  });

  it("hides other JSON behind a data disclosure", () => {
    const r = sanitizeAnswer('Raw:\n{"status":"ok","nested":{"a":[1,{"b":2}]},"note":"something long enough"}');
    expect(r.markdown).toMatch(/```data\n/);
  });

  it("removes JS and Python stack traces but keeps the prose", () => {
    const js = sanitizeAnswer(JS_TRACE).markdown;
    expect(js).not.toMatch(/TypeError|at runTool|execute-abc/);
    expect(js).toContain("Retrying with another source");
    const py = sanitizeAnswer(PY_TRACE).markdown;
    expect(py).not.toMatch(/Traceback|ValueError|File "/);
    expect(py).toContain("The model result is $12.4B.");
  });

  it("hides code unless the user asked for code", () => {
    expect(sanitizeAnswer(CODE).markdown).toMatch(/```hidden-code\n/);
    expect(sanitizeAnswer(CODE, { allowCode: true }).markdown).toMatch(/```python\n/);
    expect(wantsCode("write me a python script for this")).toBe(true);
    expect(wantsCode("how did NVDA do last quarter?")).toBe(false);
  });

  it("leaves normal prose, links, citations, chart blocks and tables alone", () => {
    const md = [
      "NVDA grew **94%** [10-Q Jul 2026](filing:NVDA:0001045810-26-000075 \"driven by the ramp\").",
      "[A long markdown link title that is over thirty chars](https://example.com) and [1] notes.",
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
      '```chart\n{"type":"bar","data":[{"x":"a","y":1}]}\n```',
    ].join("\n\n");
    const r = sanitizeAnswer(md);
    expect(r.markdown).toBe(md);
    expect(r.changed).toBe(0);
  });
});
