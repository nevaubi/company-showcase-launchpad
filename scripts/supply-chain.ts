// Reads each covered company's latest 10-K and extracts named customers, suppliers, partners and
// competitors. Every link must carry a verbatim quote that is re-checked against the filing text;
// links whose quote is not found are dropped. Usage:
//   IR_AI_PROVIDER=openai bun scripts/supply-chain.ts [--only=AAPL,NVDA] [--concurrency=6] [--years=3] [--dry]
// Reads the latest 10-K + newer 10-Q (current links) and prior 10-Ks (history, is_current=false).
import { readFile } from "node:fs/promises";
import { args, log, sb } from "./lib/supa";
import { IR_MODELS, openaiStructured } from "../src/lib/openai.server";
import { normText, quoteInText, RELATIONS } from "../src/lib/supply/core";

const UA = "FiledUnder Research research@filedunder.ai";
interface Co { ticker: string; name: string; cik: string }
const universe = JSON.parse(await readFile("public/data/universe.json", "utf8")) as { companies: Co[] };
const covered = universe.companies;
const only = args.only?.toUpperCase().split(",");

function htmlToText(html: string) {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#\d+;|&\w+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const KEY = /customer|supplier|vendor|manufactur|foundr|depend|concentrat|% of (our )?(total |net )?(revenue|sales)|partner|alliance|collaborat|licens|compet|distribut|sole source|single source|contract with/i;

function relevant(text: string, cap = 90_000) {
  const paras = text.split("\n").filter((p) => p.length > 60);
  const keep = new Set<number>();
  paras.forEach((p, i) => KEY.test(p) && /[A-Z][a-z]+/.test(p) && keep.add(i));
  let out = "";
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length + paras[i].length > cap) break;
    out += paras[i] + "\n";
  }
  return out;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["links"],
  properties: {
    links: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["counterparty", "counterparty_ticker", "domain", "relation", "detail", "share_pct", "amount_usd", "single_source", "regions", "risk", "quote"],
        properties: {
          counterparty: { type: "string" },
          counterparty_ticker: { type: "string", description: "US listing ticker if public, else empty" },
          domain: { type: "string", description: "company website domain, e.g. tsmc.com; empty if unsure" },
          relation: { type: "string", enum: RELATIONS },
          detail: { type: "string", description: "≤ 20 words: what flows between them" },
          share_pct: { type: ["number", "null"], description: "% of the filer's revenue (customers) or purchases, only if stated" },
          amount_usd: { type: ["number", "null"], description: "Dollar amount tied to this counterparty (revenue, purchase commitment, contract value) in full USD, only if stated" },
          single_source: { type: "boolean", description: "true only if the text says sole, single or limited source / depends on this counterparty" },
          regions: { type: "array", items: { type: "string" }, description: "Countries/regions the text ties to this link (e.g. Taiwan, China); empty if none" },
          risk: { type: "string", description: "≤ 15 words: the dependency or concentration risk stated, empty if none" },
          quote: { type: "string", description: "8–40 consecutive words copied exactly from the text" },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You read excerpts of a company's 10-K or 10-Q and list the specific, NAMED organisations it does business with.
relation = what the counterparty is to the filer: customer (buys from the filer), supplier (sells to / manufactures for the filer), partner (alliance, JV, licensing, co-development, distribution), competitor (named as a competitor).
Rules:
- Only organisations named in the text. Never infer from general knowledge. Skip "a customer", "certain suppliers".
- quote must be copied character-for-character from the text and must mention the counterparty or its role. No ellipses.
- share_pct only when the text states a percentage for that counterparty; amount_usd only when a dollar figure is stated for it (convert "$2.1 billion" to 2100000000).
- single_source only when the text says sole/single/limited source or a stated dependency. regions: geographies the text ties to the link. risk: the stated dependency/concentration risk in a few words.
- counterparty_ticker: the primary US ticker if the company is publicly listed (e.g. TSM for TSMC, MSFT for Microsoft); empty for private companies, governments, agencies.
- Prefer the most important links: concentration disclosures, sole-source suppliers, major partners. Up to 60 links. One row per counterparty+relation.`;

type Filing = { accn: string; form: string; filed: string; doc: string };
/** Current set = latest 10-K + any newer 10-Q; history = the two prior 10-Ks (for "what changed"). */
async function filingsFor(t: string) {
  const d = JSON.parse(await readFile(`public/data/companies/${t}.json`, "utf8")) as { filings: Filing[] };
  const ks = d.filings.filter((f) => f.form === "10-K").sort((a, b) => b.filed.localeCompare(a.filed));
  if (!ks.length) return [];
  const q = d.filings.filter((f) => f.form === "10-Q" && f.filed > ks[0].filed).sort((a, b) => b.filed.localeCompare(a.filed))[0];
  const years = Number(args.years ?? 3);
  return [
    { f: ks[0], current: true },
    ...(q ? [{ f: q, current: true }] : []),
    ...ks.slice(1, years).map((f) => ({ f, current: false })),
  ];
}

async function run(co: Co) {
  const set = await filingsFor(co.ticker);
  if (!set.length) return log(co.ticker, "no 10-K");
  const all: Record<string, unknown>[] = [];
  for (const { f, current } of set) {
    try { all.push(...(await readFiling(co, f, current))); } catch (e) { log(co.ticker, f.form, f.filed, "failed", (e as Error).message.slice(0, 150)); }
  }
  if (args.dry) return console.log(all.slice(0, 5));
  if (!all.length) return;
  await sb.from("supply_links").delete().eq("ticker", co.ticker);
  for (let i = 0; i < all.length; i += 200) {
    const { error } = await sb.from("supply_links").insert(all.slice(i, i + 200));
    if (error) log(co.ticker, "insert failed", error.message);
  }
}

async function readFiling(co: Co, f: Filing, current: boolean) {
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(co.cik)}/${f.accn.replace(/-/g, "")}/${f.doc}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return log(co.ticker, "SEC", res.status);
  const text = htmlToText(await res.text());
  const excerpt = relevant(text);
  const tickers = covered.map((c) => `${c.ticker}=${c.name}`).join(", ");
  const { data, usage } = await openaiStructured<{ links: { counterparty: string; counterparty_ticker: string; domain: string; relation: string; detail: string; share_pct: number | null; amount_usd: number | null; single_source: boolean; regions: string[]; risk: string; quote: string }[] }>({
    model: IR_MODELS.reason, name: "supply_links", instructions: INSTRUCTIONS, effort: "medium", schema: SCHEMA,
    input: `Filer: ${co.name} (${co.ticker}). Known tickers: ${tickers}\n\n${f.form} excerpts:\n${excerpt}`,
  });
  const seen = new Set<string>();
  const rows = data.links
    .filter((l) => quoteInText(l.quote, text))
    .map((l) => ({
      ticker: co.ticker,
      counterparty: l.counterparty.trim(),
      counterparty_ticker: l.counterparty_ticker.trim().toUpperCase() || null,
      counterparty_domain: l.domain.trim().toLowerCase().replace(/^https?:\/\/|^www\.|\/.*$/g, "") || null,
      relation: l.relation, detail: l.detail, share_pct: l.share_pct, quote: l.quote,
      amount_usd: l.amount_usd, single_source: !!l.single_source, regions: (l.regions ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 6), risk: l.risk?.trim() || null,
      accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, is_current: current,
    }))
    .filter((r) => r.counterparty_ticker !== co.ticker)
    .filter((r) => { const k = `${r.relation}:${r.counterparty_ticker ?? normText(r.counterparty)}`; return !seen.has(k) && !!seen.add(k); });
  log(co.ticker, f.form, f.filed, `${rows.length}/${data.links.length} links verified`, `${usage.input_tokens}in/${usage.output_tokens}out`);
  return rows;
}

const queue = covered.filter((c) => !only || only.includes(c.ticker));
const conc = Number(args.concurrency ?? 6);
await Promise.all(Array.from({ length: conc }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) {
    try { await run(c); } catch (e) { log(c.ticker, "failed", (e as Error).message.slice(0, 200)); }
  }
}));
log("done");
