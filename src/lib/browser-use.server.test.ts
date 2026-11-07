import { describe, expect, it, vi } from "vitest";
import { BU_BASE, cancelRun, createRun, foldEvents, getRun, listRunFiles, taskText } from "./browser-use.server";

const KEY = "bu_test_key";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const EVENTS = [
  { id: 1, type: "run.created", data: {} },
  { id: 2, type: "browser.ready", data: { live_view_url: "https://live.browser-use.com?wss=x", browser_session_id: "bs-1" } },
  { id: 3, type: "core.event", data: { part: { type: "tool", tool: "javascript", callID: "c1", state: { input: { code: "page = await tabs.open('https://example.com')" }, status: "running" } }, timestamp: 10 } },
  { id: 4, type: "core.event", data: { part: { type: "tool", tool: "javascript", callID: "c1", state: { input: { code: "page = await tabs.open('https://example.com')" }, output: "[state] Example Domain | https://example.com/\nbody", status: "completed" } } } },
  { id: 5, type: "core.event", data: { part: { type: "text", text: "Example Domain" } } },
  { id: 6, type: "run.completed", data: {} },
];

describe("foldEvents", () => {
  it("collects live view, steps (merged by call id), page and text", () => {
    const f = foldEvents(EVENTS);
    expect(f.liveUrl).toContain("live.browser-use.com");
    expect(f.browserSessionId).toBe("bs-1");
    expect(f.steps).toHaveLength(1);
    expect(f.steps[0].status).toBe("completed");
    expect(f.steps[0].output).toContain("Example Domain");
    expect(f.currentUrl).toBe("https://example.com/");
    expect(f.pageTitle).toBe("Example Domain");
    expect(f.texts).toEqual(["Example Domain"]);
    expect(f.terminal).toBe("completed");
  });
});

describe("Browser Use client", () => {
  it("creates a run with the key header, a cost cap and the fast model", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({ id: "run-1", status: "queued", sessionId: "s", workspaceId: "w" }));
    const r = await createRun({ goal: "Find the top story", startUrl: "https://news.ycombinator.com", screenshot: true }, f, KEY);
    expect(r.id).toBe("run-1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${BU_BASE}/runs`);
    expect((init!.headers as Record<string, string>)["X-Browser-Use-API-Key"]).toBe(KEY);
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe("bu-fast");
    expect(body.maxCostUsd).toBe(1);
    expect(body.task).toMatch(/^Start at https:\/\/news\.ycombinator\.com\./);
    expect(body.task).toMatch(/screenshot\.png/);
  });

  it("thorough mode leaves the model to the API default and caps cost at $5", async () => {
    const f = vi.fn(async () => json({ id: "r", status: "queued", sessionId: "s", workspaceId: "w" }));
    await createRun({ goal: "Long research task", mode: "thorough", maxCostUsd: 50 }, f, KEY);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBeUndefined();
    expect(body.maxCostUsd).toBe(5);
  });

  it("fails clearly without a key and on auth errors", async () => {
    await expect(createRun({ goal: "x" }, vi.fn(), null)).rejects.toThrow(/not configured/);
    const f = vi.fn(async () => json({ detail: "Invalid API key" }, 401));
    await expect(createRun({ goal: "abcd" }, f, KEY)).rejects.toThrow(/rejected the API key: Invalid API key/);
  });

  it("reads a run with paged events", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/runs/run-1")) return json({ id: "run-1", task: "t", title: "T", status: "completed", result: "Example Domain", error: null, sessionId: "s", workspaceId: "w", totalCostUsd: "0.001" });
      if (url.includes("/events") && !url.includes("after=")) return json({ events: EVENTS.slice(0, 3), nextAfter: 3, hasMore: true });
      return json({ events: EVENTS.slice(3), nextAfter: null, hasMore: false });
    });
    const r = await getRun("run-1", f, KEY);
    expect(r.done).toBe(true);
    expect(r.result).toBe("Example Domain");
    expect(r.liveUrl).toContain("live.browser-use.com");
    expect(r.steps).toHaveLength(1);
    expect(f.mock.calls.some(([u]) => String(u).includes("after=3"))).toBe(true);
  });

  it("lists workspace files and browser downloads", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("/workspaces/")
        ? json({ files: [{ path: "outputs/screenshot.png", size: 1200, url: "https://s3/a" }] })
        : json({ files: [{ path: "report.pdf", size: 9000, url: "https://s3/b" }] }),
    );
    const files = await listRunFiles({ workspaceId: "w", browserSessionId: "bs-1" }, f, KEY);
    expect(files.map((x) => [x.name, x.source])).toEqual([
      ["screenshot.png", "workspace"],
      ["report.pdf", "download"],
    ]);
    expect(String(f.mock.calls[0][0])).toContain("includeUrls=true");
  });

  it("cancels a run", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    await cancelRun("run-1", f, KEY);
    expect(f.mock.calls[0][0]).toBe(`${BU_BASE}/runs/run-1/cancel`);
    expect(f.mock.calls[0][1]?.method).toBe("POST");
  });

  it("task text asks for a summary with URLs", () => {
    expect(taskText({ goal: "Do it" })).toMatch(/including the URLs/);
  });
});
