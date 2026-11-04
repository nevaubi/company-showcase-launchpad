// Browser code interpreter for the assistant: runs model-written JavaScript in a throwaway
// Web Worker with network access removed, a hard timeout, and only the data we pass in.
export interface SandboxResult {
  ok: boolean;
  logs: string[];
  result: string;
  error?: string;
  ms: number;
}

const WORKER_SRC = `
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined;
self.importScripts = () => { throw new Error("imports are disabled"); };
self.onmessage = async (e) => {
  const logs = [];
  const fmt = (v) => typeof v === "string" ? v : (() => { try { return JSON.stringify(v, null, 1); } catch { return String(v); } })();
  const console = { log: (...a) => logs.push(a.map(fmt).join(" ")), table: (v) => logs.push(fmt(v)), error: (...a) => logs.push("ERROR " + a.map(fmt).join(" ")), warn: (...a) => logs.push("WARN " + a.map(fmt).join(" ")) };
  const stats = {
    mean: (xs) => xs.reduce((s, x) => s + x, 0) / xs.length,
    sum: (xs) => xs.reduce((s, x) => s + x, 0),
    median: (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    stdev: (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); },
    cagr: (a, b, years) => Math.pow(b / a, 1 / years) - 1,
    corr: (a, b) => { const n = Math.min(a.length, b.length); const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n, mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); },
  };
  try {
    const fn = new Function("data", "console", "stats", '"use strict";\\nreturn (async () => {\\n' + e.data.code + '\\n})();');
    const r = await fn(e.data.data, console, stats);
    self.postMessage({ ok: true, logs, result: r === undefined ? "" : fmt(r) });
  } catch (err) {
    self.postMessage({ ok: false, logs, result: "", error: String(err && err.stack || err) });
  }
};`;

export function runSandbox(code: string, data: unknown, timeoutMs = 8000): Promise<SandboxResult> {
  const t0 = performance.now();
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
  const w = new Worker(url);
  return new Promise((resolve) => {
    const done = (r: Omit<SandboxResult, "ms">) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      resolve({ ...r, ms: Math.round(performance.now() - t0) });
    };
    const timer = setTimeout(() => done({ ok: false, logs: [], result: "", error: `Timed out after ${timeoutMs / 1000}s` }), timeoutMs);
    w.onmessage = (e) => done(e.data);
    w.onerror = (e) => done({ ok: false, logs: [], result: "", error: e.message });
    w.postMessage({ code, data });
  });
}
