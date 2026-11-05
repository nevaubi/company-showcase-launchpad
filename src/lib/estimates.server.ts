// Consensus estimates + analyst actions from the market-data provider's quoteSummary endpoint.
// It needs a session cookie + crumb; both are fetched per worker and retried once if rejected.
import { normalizeEstimates, type Estimates } from "@/lib/estimates/core";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MODULES = "earningsTrend,recommendationTrend,upgradeDowngradeHistory,financialData,earningsHistory,calendarEvents";
let session: { cookie: string; crumb: string } | null = null;

let pending: Promise<{ cookie: string; crumb: string }> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cookie + crumb; the crumb endpoint throttles bursts, so alternate hosts with a short backoff. */
async function getSession() {
  if (session) return session;
  pending ??= (async () => {
    let status = 0;
    for (let i = 0; i < 4; i++) {
      const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
      const raw = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : (r.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_]+=)/);
      const cookie = raw.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
      if (!cookie) console.warn("estimates: provider set no cookie", r.status);
      const host = i % 2 ? "query1" : "query2";
      const c = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { headers: { "User-Agent": UA, cookie } });
      const crumb = (await c.text()).trim();
      if (c.ok && crumb && !crumb.includes("<")) return (session = { cookie, crumb });
      status = c.status;
      await sleep(400 * (i + 1));
    }
    throw new Error(`Estimates provider session failed (${status})`);
  })().finally(() => { pending = null; });
  return pending;
}

export async function fetchEstimates(ticker: string): Promise<Estimates> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession();
    for (const host of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
      const res = await fetch(`${host}/v10/finance/quoteSummary/${encodeURIComponent(ticker.replace(".", "-"))}?modules=${MODULES}&crumb=${encodeURIComponent(s.crumb)}`, {
        headers: { "User-Agent": UA, cookie: s.cookie, Accept: "application/json" },
      });
      if (res.ok) {
        const j = (await res.json()) as { quoteSummary?: { result?: Record<string, unknown>[] } };
        const q = j.quoteSummary?.result?.[0];
        if (!q) throw new Error(`No estimates for ${ticker}`);
        return normalizeEstimates(ticker, q, new Date().toISOString());
      }
      if (res.status === 401 || res.status === 403) { session = null; break; }
      if (res.status !== 429 && res.status < 500) throw new Error(`Estimates provider responded ${res.status}`);
    }
  }
  throw new Error("Estimates provider unavailable");
}
