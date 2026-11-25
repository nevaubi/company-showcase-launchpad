// Polite, bounded HTTP for the mapping script: one request at a time per host, a fixed gap between requests, a
// deadline per request and a few retries on 429 and 5xx. SEC asks for about two requests a second at most.
export const USER_AGENT = "FiledUnder Research research@filedunder.ai";

const last = new Map<string, number>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Minimum gap between two requests to the same host, in milliseconds. */
const GAP: Record<string, number> = { "www.sec.gov": 550, "data.sec.gov": 550, "api.fdic.gov": 1000 };

export async function politeGet(url: string, opts: { json?: boolean; timeoutMs?: number; tries?: number } = {}): Promise<unknown> {
  const host = new URL(url).host;
  const tries = opts.tries ?? 3;
  for (let i = 0; i < tries; i++) {
    const wait = (last.get(host) ?? 0) + (GAP[host] ?? 500) - Date.now();
    if (wait > 0) await sleep(wait);
    last.set(host, Date.now());
    try {
      const r = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: opts.json === false ? "text/html" : "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
      if (r.ok) return opts.json === false ? await r.text() : await r.json();
      if (r.status === 404) return null;
      if (r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status} for ${url}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`no answer from ${host} after ${tries} tries`);
}
