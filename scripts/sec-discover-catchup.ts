// One catch-up pass of market-wide discovery: every covered filing in EDGAR's daily indexes for the
// last N days (default 7) plus today's current feeds, resolving every missing company.
// Usage: bun scripts/sec-discover-catchup.ts [days]
import { feedUrl, FEED_TYPES, masterUrl, nextDay, parseCurrentAtom, parseMasterIndex, type DiscoveredFiling } from "../src/lib/jobs/sec-discover";
import { missingFilings, resolve } from "../src/lib/jobs/sec-discover.server";
import { fetchSec } from "../src/lib/sec.server";

const days = Number(process.argv[2] ?? 7);
const all: DiscoveredFiling[] = [];
const today = new Date().toISOString().slice(0, 10);
for (let d = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); d < today; d = nextDay(d)) {
  const r = await fetch(masterUrl(d), { headers: { "User-Agent": "FiledUnder Research research@filedunder.ai" } });
  if (r.ok) { const rows = parseMasterIndex(await r.text()); all.push(...rows); console.log(d, rows.length, "filings listed"); }
  else console.log(d, "no index", r.status);
  await new Promise((x) => setTimeout(x, 200));
}
for (const t of FEED_TYPES) { all.push(...parseCurrentAtom(await (await fetchSec(feedUrl(t))).text())); await new Promise((x) => setTimeout(x, 200)); }
const { covered, missing } = await missingFilings(all);
const before = new Set(missing.map((m) => m.accn));
console.log(JSON.stringify({ covered: new Set(covered.map((c) => c.accn)).size, missingBefore: before.size, companies: new Set(missing.map((m) => m.ticker)).size, byForm: missing.reduce((a, m) => ({ ...a, [m.form]: (a[m.form] ?? 0) + 1 }), {} as Record<string, number>) }));
const r = await resolve(missing, () => true, 100000);
const after = await missingFilings(all);
console.log(JSON.stringify({ resolvedCompanies: r.resolved.length, filingsStored: r.filings, earningsEvents: r.earnings, missingAfter: new Set(after.missing.map((m) => m.accn)).size, stillMissing: after.missing.slice(0, 15).map((m) => `${m.ticker} ${m.form} ${m.accn} ${m.filed}`), errors: r.errors.slice(0, 10) }));
