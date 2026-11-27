// Fetch one stock's whole option chain from Yahoo Finance. Server-only.
//
// Two routes to the same response:
//   direct  the collector asks Yahoo itself
//   reader  the page reader (Firecrawl) asks Yahoo with the same session, when Yahoo refuses the
//           collector's address. One reader credit per stock; the caller keeps the budget.
// Nothing here decides what to store: the result goes to `yahooChain` and `summarizeChain`.
import { YAHOO_UA, type YahooSession } from "@/lib/yahoo-session.server";
import { YAHOO_HOSTS, yahooOptionsPath, type YahooOptionsResult } from "./yahoo";

export type ChainFetch =
  /** Yahoo answered; `result` is null when it lists nothing under the symbol */
  | { kind: "read"; result: YahooOptionsResult | null; bytes: number }
  /** Yahoo refused this address (HTTP 403, 429 or 999) */
  | { kind: "blocked"; status: number }
  /** the session is no longer accepted: open a new one */
  | { kind: "session" }
  | { kind: "error"; message: string };

interface Envelope {
  optionChain?: { result?: YahooOptionsResult[] | null; error?: { code?: string; description?: string } | null };
  finance?: { error?: { code?: string; description?: string } | null };
}

/** Read the body of a Yahoo options response, whichever route carried it. */
export function parseChainBody(text: string): ChainFetch {
  let j: Envelope;
  try {
    j = JSON.parse(text) as Envelope;
  } catch {
    return { kind: "error", message: `not JSON (${text.slice(0, 60).replace(/\s+/g, " ")})` };
  }
  const err = j.optionChain?.error ?? j.finance?.error;
  if (err) {
    const what = `${err.code ?? ""} ${err.description ?? ""}`.trim();
    if (/crumb|cookie|unauthorized/i.test(what)) return { kind: "session" };
    if (/not found|no data/i.test(what)) return { kind: "read", result: null, bytes: text.length };
    return { kind: "error", message: what.slice(0, 120) || "Yahoo error" };
  }
  if (!j.optionChain) return { kind: "error", message: "no option chain in the response" };
  return { kind: "read", result: j.optionChain.result?.[0] ?? null, bytes: text.length };
}

const refused = (status: number) => status === 403 || status === 429 || status === 999;

/** Ask Yahoo directly. A refusal on one host is tried on the other before it counts. */
export async function fetchYahooChain(ticker: string, session: YahooSession, signal?: AbortSignal): Promise<ChainFetch> {
  let last: ChainFetch = { kind: "error", message: "no host answered" };
  for (const host of YAHOO_HOSTS) {
    let res: Response;
    try {
      res = await fetch(`${host}${yahooOptionsPath(ticker, session.crumb)}`, { headers: { "User-Agent": YAHOO_UA, cookie: session.cookie, Accept: "application/json" }, signal });
    } catch (e) {
      last = { kind: "error", message: (e as Error).message.slice(0, 120) };
      continue;
    }
    if (res.ok) return parseChainBody(await res.text());
    const body = await res.text().catch(() => "");
    if (res.status === 401) return { kind: "session" };
    if (res.status === 404) return { kind: "read", result: null, bytes: body.length };
    if (refused(res.status)) {
      last = { kind: "blocked", status: res.status };
      continue;
    }
    // Yahoo wraps some refusals of a session in a 4xx with its error envelope
    const parsed = body.startsWith("{") ? parseChainBody(body) : null;
    if (parsed && parsed.kind !== "error") return parsed;
    last = { kind: "error", message: `HTTP ${res.status}` };
    if (res.status < 500) break;
  }
  return last;
}

/** Page-reader requests made by this process for option chains (one credit each). */
export const readerUsage = { calls: 0 };

/**
 * Ask Yahoo through the page reader, presenting the same session. `FIRECRAWL_API_KEY` may be a
 * direct key or a gateway connection key (then `LOVABLE_API_KEY` is needed too).
 */
export async function readerYahooChain(ticker: string, session: YahooSession, env: Record<string, string | undefined>, signal?: AbortSignal): Promise<ChainFetch> {
  const key = env["FIRECRAWL_API_KEY"];
  if (!key) return { kind: "error", message: "page reader is not configured" };
  const gateway = key.startsWith("lovc_");
  const endpoint = gateway ? "https://connector-gateway.lovable.dev/firecrawl/v2/scrape" : "https://api.firecrawl.dev/v2/scrape";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gateway) {
    headers["Authorization"] = `Bearer ${env["LOVABLE_API_KEY"] ?? ""}`;
    headers["X-Connection-Api-Key"] = key;
  } else headers["Authorization"] = `Bearer ${key}`;
  readerUsage.calls++;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ url: `${YAHOO_HOSTS[0]}${yahooOptionsPath(ticker, session.crumb)}`, formats: ["rawHtml"], headers: { Cookie: session.cookie, "User-Agent": YAHOO_UA }, timeout: 30000 }),
    });
  } catch (e) {
    return { kind: "error", message: `page reader: ${(e as Error).message.slice(0, 100)}` };
  }
  const text = await res.text();
  if (!res.ok) {
    console.error(`Page reader failed [${res.status}]: ${text.slice(0, 300)}`);
    // out of credit or over the reader's own rate limit: the reader route is closed, not this stock
    if (res.status === 402 || res.status === 429) return { kind: "blocked", status: res.status };
    return { kind: "error", message: `page reader HTTP ${res.status}` };
  }
  let j: { data?: { rawHtml?: string; metadata?: { statusCode?: number } } };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    return { kind: "error", message: "page reader: not JSON" };
  }
  const status = j.data?.metadata?.statusCode ?? 200;
  if (status === 401) return { kind: "session" };
  if (refused(status)) return { kind: "blocked", status };
  const raw = j.data?.rawHtml ?? "";
  // a browser-rendered JSON body arrives wrapped in <pre>
  const at = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (at < 0 || end <= at) return { kind: "error", message: `page reader: no chain in the page (HTTP ${status})` };
  return parseChainBody(raw.slice(at, end + 1));
}
