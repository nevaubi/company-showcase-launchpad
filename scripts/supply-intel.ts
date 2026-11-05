// Supply-chain "alt data": contract terms (EX-10 exhibits), earnings-call statements, management
// actions, customer concentration, facility locations and region/policy factors (tariffs, export
// controls, laws, local politics). Every signal carries a verbatim quote re-checked against its
// source (filing, exhibit, transcript or web article); unverified signals are dropped.
//   IR_AI_PROVIDER=openai bun scripts/supply-intel.ts [--only=AAPL] [--concurrency=6] [--skip=news,calls]
import { readFile } from "node:fs/promises";
import { args, log, sb } from "./lib/supa";
import { IR_MODELS, openaiStructured } from "../src/lib/openai.server";
import { quoteInText } from "../src/lib/supply/core";
import { tavilySearch, firecrawlScrape } from "../src/lib/web.server";
import { parseTranscript, transcriptMatches, transcriptRef } from "../src/lib/transcripts/parse";

const UA = "FiledUnder Research research@filedunder.ai";
interface Co { ticker: string; name: string; cik: string }
type Filing = { accn: string; form: string; filed: string; doc: string; items?: string };
const universe = JSON.parse(await readFile("public/data/universe.json", "utf8")) as { companies: Co[] };
const only = args.only?.toUpperCase().split(",");
const skip = new Set((args.skip ?? "").split(","));
const KINDS = ["contract", "call", "mgmt_action", "concentration", "facility", "policy"] as const;
const ALT: Record<string, string[]> = { GOOGL: ["GOOG"], "BRK-B": ["BRK"], META: ["FB"] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sec(url: string) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) return r;
    if (r.status !== 429 && r.status < 500) return null;
    await sleep(1500 * (i + 1));
  }
  return null;
}
function htmlToText(html: string) {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8212;|&mdash;/g, "—").replace(/&#\d+;|&\w+;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function pick(text: string, re: RegExp, cap: number) {
  let out = "";
  for (const p of text.split("\n")) {
    if (p.length < 50 || !re.test(p)) continue;
    if (out.length + p.length > cap) break;
    out += p + "\n";
  }
  return out;
}

const ITEM = {
  type: "object", additionalProperties: false,
  required: ["kind", "src", "title", "detail", "quote", "counterparty", "country", "amount_usd", "pct", "period", "impact", "speaker"],
  properties: {
    kind: { type: "string", enum: KINDS },
    src: { type: "integer", description: "number of the source block the quote comes from" },
    title: { type: "string", description: "≤ 10 words, specific headline" },
    detail: { type: "string", description: "≤ 35 words: what it means for the supply chain / revenue base, only from the text" },
    quote: { type: "string", description: "10–50 consecutive words copied exactly from that source" },
    counterparty: { type: "string", description: "named counterparty, empty if none" },
    country: { type: "string", description: "single country or region the item is tied to, empty if none" },
    amount_usd: { type: ["number", "null"], description: "stated dollar figure in full USD" },
    pct: { type: ["number", "null"], description: "stated percentage (e.g. share of revenue)" },
    period: { type: "string", description: "fiscal period or contract term stated, e.g. FY2025, 2024–2029; empty if none" },
    impact: { type: "string", enum: ["risk", "positive", "neutral"] },
    speaker: { type: "string", description: "for calls: speaker name and role; else empty" },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: ITEM } } };
type Item = { kind: string; src: number; title: string; detail: string; quote: string; counterparty: string; country: string; amount_usd: number | null; pct: number | null; period: string; impact: string; speaker: string };
type Src = { text: string; meta: Record<string, unknown> };

const RULES = `Rules: only facts stated in the sources — never general knowledge. quote must be copied character-for-character from the numbered source (no ellipses, no edits) and must support the item. Numbers only when stated. Skip boilerplate that names no specific country, counterparty, facility, figure or action. Be specific and complete; prefer material items.
kind: contract = terms of a named agreement (counterparty, duration, value, minimum purchase/take-or-pay, exclusivity, prepayment, termination); call = a management statement on an earnings call about customers, suppliers, capacity, inventory, pricing, tariffs or regions; mgmt_action = a concrete action taken or planned (new plant, reshoring, dual-sourcing, capacity expansion, long-term supply deal, exit of a region, inventory build); concentration = a named or unnamed customer/supplier share of revenue or purchases with its period; facility = a named site/location of manufacturing, data centers, R&D, distribution (country = where); policy = a tariff, export control, sanction, law, regulation, government action or local political/conflict factor tied to a country.`;

async function extract(co: Co, label: string, srcs: Src[], focus: string): Promise<Item[]> {
  if (!srcs.length) return [];
  const input = `Company: ${co.name} (${co.ticker}). ${focus}\n\n` + srcs.map((s, i) => `=== SOURCE ${i + 1} ===\n${s.text}`).join("\n\n");
  const { data, usage } = await openaiStructured<{ items: Item[] }>({
    model: IR_MODELS.reason, name: "supply_signals", effort: "medium", schema: SCHEMA,
    instructions: `You extract supply-chain and revenue-base intelligence for an equity analyst. ${RULES}`,
    input,
  });
  const ok = data.items.filter((it) => srcs[it.src - 1] && quoteInText(it.quote, srcs[it.src - 1].text));
  log(co.ticker, label, `${ok.length}/${data.items.length} verified`, `${usage.input_tokens}in/${usage.output_tokens}out`);
  return ok;
}

function rows(co: Co, items: Item[], srcs: Src[], source_kind: string) {
  const seen = new Set<string>();
  return items
    .filter((it) => { const k = it.quote.slice(0, 80); return !seen.has(k) && !!seen.add(k); })
    .map((it) => ({
      ticker: co.ticker, kind: it.kind, title: it.title.trim(), detail: it.detail.trim() || null, quote: it.quote,
      counterparty: it.counterparty.trim() || null, country: it.country.trim() || null, amount_usd: it.amount_usd, pct: it.pct,
      period: it.period.trim() || null, impact: it.impact, speaker: it.speaker.trim() || null, source_kind,
      ...srcs[it.src - 1].meta,
    }));
}

async function save(co: Co, source_kind: string, r: Record<string, unknown>[]) {
  if (args.dry) return console.log(source_kind, r.slice(0, 3));
  await sb.from("supply_signals").delete().eq("ticker", co.ticker).eq("source_kind", source_kind);
  if (r.length) {
    const { error } = await sb.from("supply_signals").insert(r);
    if (error) log(co.ticker, "insert", error.message);
  }
}

const docUrl = (co: Co, accn: string, doc: string) => `https://www.sec.gov/Archives/edgar/data/${Number(co.cik)}/${accn.replace(/-/g, "")}/${doc}`;

/** Latest 10-K: concentration, facilities, management actions and region/policy factors. */
async function fromTenK(co: Co, filings: Filing[]) {
  const k = filings.filter((f) => f.form === "10-K").sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (!k) return;
  const res = await sec(docUrl(co, k.accn, k.doc));
  if (!res) throw new Error("10-K fetch failed");
  const text = htmlToText(await res.text());
  const re = /% of (our )?(total |net |consolidated )?(revenue|sales|purchases)|customer|sole source|single source|propert|facilit|manufactur|plant|data center|located in|headquarter|tariff|export control|sanction|regulat|government|political|election|conflict|war\b|geopolit|China|Taiwan|India|Mexico|Israel|Russia|Ukraine|Europe|reshor|onshor|expan|capacity|diversif|relocat|prepay|long-term (supply|purchase)|inventory/i;
  const parts = [pick(text, re, 60_000), pick(text, re, 120_000).slice(60_000)].filter((p) => p.length > 500);
  const meta = { accn: k.accn, doc: k.doc, form: k.form, filed: k.filed, url: docUrl(co, k.accn, k.doc) };
  const srcs = parts.map((t) => ({ text: t, meta }));
  const items = (await Promise.all(srcs.map((s, i) => extract(co, `10-K part ${i + 1}`, [s], "Sources are 10-K excerpts. Extract concentration, facility, mgmt_action and policy items (not contract or call). Aim for 15–40 items.")))).flatMap((x, i) => x.map((it) => ({ ...it, src: i + 1 })));
  await save(co, "filing", rows(co, items, srcs, "filing"));
}

/** EX-10 material agreements from recent 8-K (item 1.01), 10-K and 10-Q filings. */
async function fromContracts(co: Co, filings: Filing[]) {
  const since = new Date(Date.now() - 4 * 365 * 86400_000).toISOString().slice(0, 10);
  const cand = filings.filter((f) => f.filed >= since && ((f.form === "8-K" && /1\.01/.test(f.items ?? "")) || f.form === "10-K" || f.form === "10-Q"))
    .sort((a, b) => b.filed.localeCompare(a.filed)).slice(0, 24);
  const BORING = /credit agreement|indenture|employment|compensation|severance|stock (option|unit|award)|incentive|retention|offer letter|indemnif|note purchase|underwriting|separation|consulting agreement|deferred|bonus|change in control|aircraft time sharing|restricted/i;
  const GOOD = /supply|purchase|manufactur|foundry|wafer|license|collaborat|master services|services agreement|distribution|development agreement|capacity|offtake|take-or-pay|joint venture|alliance/i;
  const srcs: Src[] = [];
  for (const f of cand) {
    if (srcs.length >= 5) break;
    const idx = await sec(`https://www.sec.gov/Archives/edgar/data/${Number(co.cik)}/${f.accn.replace(/-/g, "")}/index.json`);
    if (!idx) continue;
    const j = (await idx.json()) as { directory?: { item?: { name: string }[] } };
    for (const it of j.directory?.item ?? []) {
      if (srcs.length >= 5 || !/ex-?10/i.test(it.name) || !/\.(htm|html|txt)$/i.test(it.name)) continue;
      const r = await sec(docUrl(co, f.accn, it.name));
      if (!r) continue;
      const text = htmlToText(await r.text());
      const head = text.slice(0, 4000);
      if (BORING.test(head) || !GOOD.test(head)) continue;
      srcs.push({ text: text.slice(0, 45_000), meta: { accn: f.accn, doc: it.name, form: `${f.form} EX-10`, filed: f.filed, url: docUrl(co, f.accn, it.name) } });
    }
  }
  const items = await extract(co, `contracts(${srcs.length})`, srcs, "Sources are material agreements filed as SEC exhibits. Extract kind=contract items: parties, term, value, volumes/minimums, pricing mechanics, exclusivity, prepayments, termination rights. Many exhibits redact figures ([***]) — say so in detail instead of guessing.");
  await save(co, "exhibit", rows(co, items.map((i) => ({ ...i, kind: "contract" })), srcs, "exhibit"));
}

/** Two latest earnings calls (fool.com transcripts). */
async function fromCalls(co: Co, short: string) {
  const res = await Promise.allSettled([
    tavilySearch(`${short} ${co.ticker} earnings call transcript`, { topic: "news", days: 200, maxResults: 12, domains: ["fool.com"] }),
    tavilySearch(`${short} ${co.ticker} earnings call transcript`, { maxResults: 12, domains: ["fool.com"] }),
  ]);
  const urls = new Map<string, string>();
  for (const s of res) if (s.status === "fulfilled") for (const r of s.value.results) {
    const u = r.url.replace(/\/$/, "");
    if (!transcriptMatches(u, co.ticker, short, ALT[co.ticker] ?? [])) continue;
    const ref = transcriptRef(u);
    if (ref.date) urls.set(ref.quarter ?? ref.date, u);
  }
  const latest = [...urls.values()].sort((a, b) => (transcriptRef(b).date ?? "").localeCompare(transcriptRef(a).date ?? "")).slice(0, 2);
  const srcs: Src[] = [];
  for (const u of latest) {
    try {
      const page = await firecrawlScrape(u);
      const p = parseTranscript(page.markdown);
      if (p.turns.length < 5) continue;
      const ref = transcriptRef(u);
      const text = p.turns.map((t) => `${t.speaker}${t.role ? ` (${t.role})` : ""}: ${t.text}`).join("\n").slice(0, 90_000);
      srcs.push({ text, meta: { form: `Call ${ref.quarter ?? ""}`.trim(), filed: ref.date, url: u } });
    } catch (e) { log(co.ticker, "transcript", (e as Error).message.slice(0, 80)); }
  }
  const items = await extract(co, `calls(${srcs.length})`, srcs, "Sources are earnings-call transcripts. Extract kind=call items (and mgmt_action when management announces a concrete action). Fill speaker. Focus: customers, demand by customer/region, suppliers, capacity, lead times, inventory, pricing, tariffs, export controls, sourcing shifts.");
  await save(co, "transcript", rows(co, items, srcs, "transcript"));
}

/** Recent news on tariffs/laws/local politics for the company's key countries. */
async function fromNews(co: Co, short: string) {
  const { data } = await sb.from("supply_signals").select("country").eq("ticker", co.ticker).not("country", "is", null);
  const { data: l } = await sb.from("supply_links").select("regions").eq("ticker", co.ticker).eq("is_current", true);
  const freq = new Map<string, number>();
  for (const c of [...(data ?? []).map((d) => d.country as string), ...(l ?? []).flatMap((x) => (x.regions as string[] | null) ?? [])]) freq.set(c, (freq.get(c) ?? 0) + 1);
  const top = [...freq].sort((a, b) => b[1] - a[1]).map((x) => x[0]).filter((c) => !/^(united states|us|u\.s\.|global|worldwide)$/i.test(c)).slice(0, 3);
  const qs = [`${short} tariffs export controls supply chain`, ...top.map((c) => `${short} ${c} regulation OR tariff OR government OR election OR plant`)];
  const found = await Promise.allSettled(qs.map((q) => tavilySearch(q, { topic: "news", days: 120, maxResults: 5 })));
  const seen = new Set<string>();
  const srcs: Src[] = [];
  for (const f of found) if (f.status === "fulfilled") for (const r of f.value.results) {
    if (seen.has(r.url) || r.content.length < 200) continue;
    seen.add(r.url);
    srcs.push({ text: `${r.title}\n${r.content}`, meta: { form: "News", filed: r.publishedAt ? new Date(r.publishedAt).toISOString().slice(0, 10) : null, url: r.url, doc: r.title.slice(0, 200) } });
  }
  const items = await extract(co, `news(${srcs.length})`, srcs.slice(0, 16), `Sources are recent news snippets. Extract only items that concern ${short} specifically: kind=policy (tariffs, export controls, laws, government action, local politics/conflict in a country it operates or sources in) or mgmt_action. Ignore items about other companies.`);
  await save(co, "web", rows(co, items, srcs.slice(0, 16), "web"));
}

const { COVERAGE } = await import("../src/lib/coverage");
const shortOf = Object.fromEntries(COVERAGE.map((c) => [c.ticker, c.shortName]));

async function run(co: Co) {
  const d = JSON.parse(await readFile(`public/data/companies/${co.ticker}.json`, "utf8")) as { filings: Filing[] };
  const short = shortOf[co.ticker] ?? co.name;
  const stages: [string, () => Promise<void>][] = [
    ["filing", () => fromTenK(co, d.filings)],
    ["contracts", () => fromContracts(co, d.filings)],
    ["calls", () => fromCalls(co, short)],
    ["news", () => fromNews(co, short)],
  ];
  for (const [name, fn] of stages) {
    if (skip.has(name)) continue;
    try { await fn(); } catch (e) { log(co.ticker, name, "failed — kept existing", (e as Error).message.slice(0, 160)); }
  }
  log(co.ticker, "done");
}

const queue = universe.companies.filter((c) => !only || only.includes(c.ticker));
await Promise.all(Array.from({ length: Number(args.concurrency ?? 6) }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) await run(c);
}));
log("all done");
