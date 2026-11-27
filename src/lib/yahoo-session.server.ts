// A Yahoo Finance session (cookie + crumb) for the endpoints that need one. Server-only.
//
// The session belongs to no account: Yahoo hands a cookie to any visitor and a crumb to any cookie.
// It is kept by the caller (and may be stored server-side) so the page reader can present the same
// session when Yahoo refuses the collector's own address.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const YAHOO_UA = UA;

export interface YahooSession {
  cookie: string;
  crumb: string;
  /** epoch ms the session was opened */
  at: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open a session: the crumb endpoint throttles bursts, so the two hosts are tried in turn with a short wait. */
export async function openYahooSession(signal?: AbortSignal, tries = 4): Promise<YahooSession> {
  let status = 0;
  for (let i = 0; i < tries; i++) {
    signal?.throwIfAborted();
    const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", signal });
    await r.body?.cancel().catch(() => undefined);
    const raw = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : (r.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_]+=)/);
    const cookie = raw.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    const host = i % 2 ? "query1" : "query2";
    const c = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { headers: { "User-Agent": UA, cookie }, signal });
    const crumb = (await c.text()).trim();
    if (c.ok && cookie && crumb && !crumb.includes("<") && crumb.length < 64) return { cookie, crumb, at: Date.now() };
    status = c.status;
    if (i < tries - 1) await sleep(400 * (i + 1));
  }
  throw new YahooSessionError(status);
}

export class YahooSessionError extends Error {
  constructor(readonly status: number) {
    super(`Yahoo Finance gave no session (HTTP ${status})`);
    this.name = "YahooSessionError";
  }
}
