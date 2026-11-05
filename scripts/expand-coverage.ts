// Builds src/lib/coverage-extra.ts: coverage metadata for every company the partner Filed Under
// corpus tracks beyond the hand-curated list in src/lib/coverage.ts. Sources, all public:
//   - partner index.json (universe, sector, SIC, market cap) and companies/ir_sites tables (CIK,
//     display name, IR site), partner sectors.json (industry taxonomy and SIC rules)
//   - Wikidata by SEC CIK (P5531): founding year, official website, English Wikipedia article, logo
//   - Wikipedia intro (first sentence) for the one-line description; SEC facts when there is none
// Logos go to public/logos (Wikimedia Commons file first, partner PNG second) with sources.json.
// Rerun any time; never hand-edit the generated file.
//   bun scripts/expand-coverage.ts [--no-logos]
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { CURATED_COVERAGE as COVERAGE } from "@/lib/coverage";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const PARTNER = "https://apxfeteebnspwyajlxfh.supabase.co";
const PUBLIC = `${PARTNER}/storage/v1/object/public/public-data`;
const WUA = { "User-Agent": "FiledUnder/1.0 (research@filedunder.ai)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, headers: Record<string, string> = WUA): Promise<T> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      if (r.ok) return (await r.json()) as T;
      if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (/^\d{3} /.test((e as Error).message)) throw e;
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`gave up ${url}`);
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ---------- partner universe ----------
type IndexRow = { ticker: string; name: string; legal_name?: string; sector: string; sic?: string; exchange?: string; market_cap?: number | null; logo?: boolean; sp500?: boolean };
type CompanyRow = { ticker: string; cik: number; name: string; display_name: string | null; sic: string | null; sic_description: string | null; website: string | null; ir_url: string | null; address: { city?: string; stateOrCountry?: string } | null };
type Mapping = { sector: string; industry: string; sic: string[]; catch_all: boolean };
type Sectors = { mapping: Mapping[]; overrides: { tk: string; industry: string }[]; companies: { tk: string; sector: string; industry: string }[] };

const cfg = await getJson<{ supabaseUrl: string; publishableKey: string }>("https://filedunderai.vercel.app/api/client-config");
const rest = <T>(path: string) => getJson<T>(`${PARTNER}/rest/v1/${path}`, { apikey: cfg.publishableKey });

const index = (await getJson<{ companies: IndexRow[] }>(`${PUBLIC}/index.json`)).companies;
const sectors = await getJson<Sectors>(`${PUBLIC}/sectors.json`);
const curated = new Set(COVERAGE.map((c) => c.ticker));
const extra = index.filter((c) => !curated.has(c.ticker));
console.log(`partner universe ${index.length}; ${extra.length} beyond the curated ${curated.size}`);

const rows = new Map<string, CompanyRow>();
const sites = new Map<string, string>();
const all = index.map((c) => c.ticker);
for (let i = 0; i < all.length; i += 80) {
  const list = all.slice(i, i + 80).map((t) => `"${t}"`).join(",");
  for (const r of await rest<CompanyRow>(`companies?ticker=in.(${list})&select=ticker,cik,name,display_name,sic,sic_description,website,ir_url,address`)) rows.set(r.ticker, r);
  for (const r of await rest<{ ticker: string; ir_url: string | null }>(`ir_sites?ticker=in.(${list})&select=ticker,ir_url`)) if (r.ir_url) sites.set(r.ticker, r.ir_url);
}

// Industry: the partner's own assignment, else its SIC rules (same order: overrides, sector rule, sector catch-all).
const assigned = new Map(sectors.companies.map((c) => [c.tk, c.industry]));
const overrides = new Map(sectors.overrides.map((o) => [o.tk, o.industry]));
const inRule = (sic: string, rule: string) => {
  const [a, b] = rule.split("-");
  return b ? Number(sic) >= Number(a) && Number(sic) <= Number(b) : sic === a;
};
function industryOf(t: string, sector: string, sic: string | null): string {
  const hit = overrides.get(t) ?? assigned.get(t);
  if (hit) return hit;
  const s = sic ?? "";
  const rule = sectors.mapping.find((m) => m.sector === sector && !m.catch_all && m.sic.some((r) => inRule(s, r)));
  return rule?.industry ?? sectors.mapping.find((m) => m.sector === sector && m.catch_all)?.industry ?? sector;
}
// SEC SIC codes that pin a narrower industry the statements depend on (bank-style lines).
function refine(industry: string, sic: string | null): string {
  if (sic === "6211") return "Investment Banking & Brokerage";
  if (sic === "6141" || sic === "6153") return "Consumer Finance";
  return industry;
}

const ETF: Record<string, string> = {
  "Information Technology": "XLK", Financials: "XLF", Energy: "XLE", "Health Care": "XLV", "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP", Industrials: "XLI", Materials: "XLB", Utilities: "XLU", "Real Estate": "XLRE", "Communication Services": "XLC",
};

// ---------- Wikidata: by SEC CIK (P5531), else by ticker on NYSE/Nasdaq (P414 + P249) ----------
type WD = { label?: string; article?: string; inception?: string; websites: string[]; logo?: string };
type Binding = Record<string, { value: string }>;
const sparql = async (q: string) =>
  (await getJson<{ results: { bindings: Binding[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`)).results.bindings;
const FIELDS = `
  OPTIONAL { ?item rdfs:label ?label. FILTER(LANG(?label) = "en") }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P154 ?logo. }`;
function absorb(out: Map<string, WD>, key: string, b: Binding) {
  const w = out.get(key) ?? { websites: [] };
  if (b.label && !w.label) w.label = b.label.value;
  if (b.article && !w.article) w.article = decodeURIComponent(b.article.value.split("/wiki/")[1]);
  if (b.inception && (!w.inception || b.inception.value < w.inception)) w.inception = b.inception.value;
  if (b.website && !w.websites.includes(b.website.value)) w.websites.push(b.website.value);
  if (b.logo && !w.logo) w.logo = decodeURIComponent(b.logo.value.split("/").pop()!);
  out.set(key, w);
}
async function wikidataByCik(ciks: string[]): Promise<Map<string, WD>> {
  const out = new Map<string, WD>();
  for (let i = 0; i < ciks.length; i += 120) {
    const values = ciks.slice(i, i + 120).flatMap((c) => [`"${c.padStart(10, "0")}"`, `"${c}"`]).join(" ");
    for (const b of await sparql(`SELECT ?cik ?label ?article ?inception ?website ?logo WHERE { VALUES ?cik { ${values} } ?item wdt:P5531 ?cik. ${FIELDS} }`))
      absorb(out, String(Number(b.cik.value)), b);
    await sleep(1200);
  }
  return out;
}
async function wikidataByTicker(tickers: string[]): Promise<Map<string, WD>> {
  const out = new Map<string, WD>();
  for (let i = 0; i < tickers.length; i += 80) {
    const values = tickers.slice(i, i + 80).flatMap((t) => [`"${t}"`, `"${t.replace("-", ".")}"`]).join(" ");
    const q = `SELECT ?sym ?label ?article ?inception ?website ?logo WHERE { VALUES ?sym { ${values} }
      ?item p:P414 ?st. ?st ps:P414 ?ex; pq:P249 ?sym. VALUES ?ex { wd:Q13677 wd:Q82059 }
      FILTER NOT EXISTS { ?st pq:P582 ?ended. } ${FIELDS} }`;
    for (const b of await sparql(q)) absorb(out, b.sym.value.replace(".", "-"), b);
    await sleep(1200);
  }
  return out;
}

const LEGAL = /,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|SE|AG|L\.P\.|LP|LLC|Holdings? Inc\.?)$/i;
const SMALL = new Set(["and", "of", "the", "for", "in", "on", "de"]);
function cleanName(name: string): string {
  let n = name.trim();
  for (let i = 0; i < 3 && LEGAL.test(n); i++) n = n.replace(LEGAL, "").trim();
  if (n === n.toUpperCase() && /[A-Z]{4}/.test(n))
    n = n.toLowerCase().split(" ").map((w, i) => (i && SMALL.has(w) ? w : w.replace(/(^|[-/&.])([a-z])/g, (_, p, c) => p + c.toUpperCase()))).join(" ");
  return n.replace(/\s+/g, " ");
}
const tokens = (s: string) => cleanName(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 4);
/** The website whose domain carries a word of the company's name; the shortest otherwise. */
function pickWebsite(urls: string[], name: string): string | undefined {
  const tk = tokens(name);
  const score = (u: string) => {
    const host = u.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    return (tk.some((t) => host.includes(t)) ? 0 : 1000) + u.length;
  };
  return [...urls].sort((a, b) => score(a) - score(b))[0];
}
/** A Wikidata match by ticker is kept only if its label shares a word with the SEC name. */
const sameCompany = (label: string | undefined, secName: string) => !!label && tokens(label).some((t) => tokens(secName).includes(t));

/** The intro's opening sentences (≤300 chars), without parenthetical pronunciations and tickers. */
async function firstSentence(article: string): Promise<string | null> {
  const j = await getJson<{ query: { pages: Record<string, { extract?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&exintro=1&exsentences=3&redirects=1&titles=${encodeURIComponent(article)}`,
  );
  let text = (Object.values(j.query.pages)[0]?.extract ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) text = text.replace(/\s*\([^()]*\)/g, "");
  text = text.replace(/\s+([,.;])/g, "$1").trim();
  if (text.length < 40 || !/\b(is|was|are)\b/.test(text.slice(0, 200))) return null;
  const sentences = text.split(/(?<!\b(?:Inc|Corp|Co|Ltd|St|Jr|Sr|No|U\.S|Mr|Dr|vs))(?<=[.!?])\s+(?=[A-Z"“])/);
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > 300) break;
    out = out ? `${out} ${s}` : s;
  }
  return out.length > 420 ? `${out.slice(0, 417).replace(/\s+\S*$/, "")}…` : out;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Inc|Corp|Co|Ltd|Plc|Llc)\b/g, (m) => m);
const fallbackDescription = (r: CompanyRow, industry: string) => {
  const where = r.address?.city ? ` headquartered in ${titleCase(r.address.city)}, ${r.address.stateOrCountry ?? ""}`.replace(/, $/, "") : "";
  return `${cleanName(r.display_name ?? r.name)} is a U.S.-listed ${industry.toLowerCase()} company${where} (SEC SIC ${r.sic ?? "—"}: ${titleCase(r.sic_description ?? "")}).`;
};

const missing = extra.filter((c) => !rows.get(c.ticker)?.cik);
if (missing.length) console.warn(`no CIK for ${missing.map((m) => m.ticker).join(", ")} — skipped`);
const todo = extra.filter((c) => rows.get(c.ticker)?.cik);
const byCik = await wikidataByCik([...new Set(todo.map((c) => String(rows.get(c.ticker)!.cik)))]);
const unmatched = todo.filter((c) => !byCik.has(String(rows.get(c.ticker)!.cik))).map((c) => c.ticker);
const byTicker = await wikidataByTicker(unmatched);
// Keyed by CIK; ticker matches are accepted only when the label shares a word with the SEC name.
const wd = new Map(byCik);
let tickerHits = 0;
for (const t of unmatched) {
  const w = byTicker.get(t);
  const r = rows.get(t)!;
  if (w && sameCompany(w.label, r.name)) (wd.set(String(r.cik), w), tickerHits++);
}
// Last resort: the English Wikipedia article titled with the company's name, if it describes a company
// and names it; its Wikidata item then supplies the same fields.
const COMPANY_WORD = /\b(company|corporation|conglomerate|bank|bancorp|holding|firm|provider|manufacturer|maker|retailer|trust|REIT|operator|developer|producer|insurer|chain|business|utility|group|partnership|enterprise|supplier|distributor|carrier|airline|railroad|brand|platform)\b/i;
let titleHits = 0;
await pool(todo.filter((c) => !wd.has(String(rows.get(c.ticker)!.cik))), 3, async (c) => {
  const r = rows.get(c.ticker)!;
  const names = [...new Set([cleanName(r.display_name ?? r.name), cleanName(r.name), `${cleanName(r.name)} (company)`])];
  for (const name of names) {
    try {
      const j = await getJson<{ query: { pages: Record<string, { title: string; missing?: string; extract?: string; pageprops?: { wikibase_item?: string; disambiguation?: string } }> } }>(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro=1&explaintext=1&exsentences=2&redirects=1&titles=${encodeURIComponent(name)}`,
      );
      const p = Object.values(j.query.pages)[0];
      const intro = (p?.extract ?? "").slice(0, 400);
      if (!p || p.missing !== undefined || p.pageprops?.disambiguation !== undefined || !p.pageprops?.wikibase_item) continue;
      if (!COMPANY_WORD.test(intro) || !sameCompany(p.title, r.name)) continue;
      const item = p.pageprops.wikibase_item;
      const w: WD = { websites: [], article: p.title };
      for (const b of await sparql(`SELECT ?label ?inception ?website ?logo WHERE { BIND(wd:${item} AS ?item) ${FIELDS.replace(/OPTIONAL \{ \?article[^}]+\}/, "")} }`)) absorb(new Map([["x", w]]), "x", b);
      wd.set(String(r.cik), w);
      titleHits++;
      return;
    } catch {
      /* try the next spelling */
    }
  }
});
console.log(`wikidata: ${byCik.size} matched by CIK, ${tickerHits} by exchange ticker, ${titleHits} by Wikipedia title, ${todo.length - byCik.size - tickerHits - titleHits} unmatched`);

const described = await pool(todo, 4, async (c) => {
  const w = wd.get(String(rows.get(c.ticker)!.cik));
  if (!w?.article) return null;
  try {
    return await firstSentence(w.article);
  } catch {
    return null;
  }
});

// Peers: same industry group, nearest market cap; sector when the industry has too few.
const mcap = new Map(index.map((c) => [c.ticker, c.market_cap ?? 0]));
const groupOf = new Map(index.map((c) => [c.ticker, industryOf(c.ticker, c.sector, rows.get(c.ticker)?.sic ?? null)]));
const sectorOf = new Map(index.map((c) => [c.ticker, c.sector]));
function peers(t: string): string[] {
  const m = Math.log10(Math.max(mcap.get(t) ?? 1, 1));
  const near = (list: string[]) => list.filter((x) => x !== t).sort((a, b) => Math.abs(Math.log10(Math.max(mcap.get(a) ?? 1, 1)) - m) - Math.abs(Math.log10(Math.max(mcap.get(b) ?? 1, 1)) - m));
  const same = near(index.filter((c) => groupOf.get(c.ticker) === groupOf.get(t)).map((c) => c.ticker));
  const sec = near(index.filter((c) => sectorOf.get(c.ticker) === sectorOf.get(t) && !same.includes(c.ticker)).map((c) => c.ticker));
  return [...same, ...sec].slice(0, 4);
}

const extraOut = todo.map((c, i) => {
  const r = rows.get(c.ticker)!;
  const w: WD = wd.get(String(r.cik)) ?? { websites: [] };
  const group = groupOf.get(c.ticker)!;
  const industry = refine(group, r.sic);
  const display = r.display_name && r.display_name !== r.display_name.toUpperCase() ? r.display_name : (w.label ?? r.display_name ?? r.name);
  return {
    ticker: c.ticker,
    cik: String(r.cik),
    shortName: cleanName(display),
    sector: c.sector,
    industry,
    group,
    sectorEtf: ETF[c.sector] ?? "SPY",
    website: pickWebsite(w.websites, r.name) ?? (r.website || ""),
    ir: sites.get(c.ticker) ?? r.ir_url ?? "",
    founded: w.inception ? Number(w.inception.slice(0, 4)) : 0,
    description: described[i] ?? fallbackDescription(r, industry),
    peers: peers(c.ticker),
  };
});
const groups = Object.fromEntries(index.filter((c) => curated.has(c.ticker)).map((c) => [c.ticker, groupOf.get(c.ticker)!]));

writeFileSync(
  "src/lib/coverage-extra.ts",
  `// GENERATED by scripts/expand-coverage.ts from the partner Filed Under universe, SEC and Wikidata.
// Do not edit by hand; rerun the script.
import type { CoverageCompany } from "./coverage";

/** Partner industry taxonomy for the curated companies (used to group peers across both lists). */
export const CURATED_GROUPS: Record<string, string> = ${JSON.stringify(groups)};

export const EXTRA_COVERAGE: CoverageCompany[] = ${JSON.stringify(extraOut)};
`,
);
console.log(`wrote ${extraOut.length} companies (${extraOut.filter((_, i) => described[i]).length} with a Wikipedia description, ${extraOut.filter((x) => x.founded).length} with a founding year, ${extraOut.filter((x) => x.website).length} with a website, ${extraOut.filter((x) => x.ir).length} with an IR site)`);

// ---------- logos ----------
// Order: the Wikidata logo file (Commons), the Wikipedia article's lead logo, the partner corpus PNG,
// then the company website's own touch icon (>=120 px). Missing logos fall back to initials in the UI.
const pngSize = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 ? [(b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]] : null);
async function download(url: string, headers: Record<string, string> = WUA): Promise<Uint8Array | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: "follow" });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2500 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.length > 200 && buf.length < 600_000 ? buf : null;
    } catch {
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}
async function commonsLogo(file: string): Promise<{ buf: Uint8Array; ext: string; url: string } | null> {
  const info = await getJson<{ query: { pages: Record<string, { imageinfo?: { url: string; thumburl?: string; mime: string }[] }> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|mime&iiurlwidth=256&titles=${encodeURIComponent(`File:${file}`)}`,
  );
  const ii = Object.values(info.query.pages)[0]?.imageinfo?.[0];
  if (!ii) return null;
  const svg = ii.mime === "image/svg+xml";
  const buf = await download(svg ? ii.url : (ii.thumburl ?? ii.url));
  return buf ? { buf, ext: svg ? "svg" : ii.mime === "image/jpeg" ? "jpg" : "png", url: ii.url } : null;
}
async function siteIcon(site: string): Promise<{ buf: Uint8Array; ext: string; url: string } | null> {
  try {
    const res = await fetch(site, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300_000);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const cands = links
      .filter((l) => /rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(l))
      .map((l) => ({ href: l.match(/href=["']([^"']+)["']/i)?.[1], size: Number(l.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? (/apple-touch-icon/i.test(l) ? 180 : 0)), svg: /\.svg(\?|$)/i.test(l) || /image\/svg/i.test(l) }))
      .filter((c): c is { href: string; size: number; svg: boolean } => !!c.href)
      .sort((a, b) => Number(b.svg) - Number(a.svg) || b.size - a.size);
    for (const c of cands) {
      if (!c.svg && c.size < 120) continue;
      const url = new URL(c.href, res.url).toString();
      const buf = await download(url, { "User-Agent": "Mozilla/5.0" });
      if (!buf) continue;
      const isSvg = c.svg || new TextDecoder().decode(buf.slice(0, 200)).includes("<svg");
      const dims = pngSize(buf);
      if (!isSvg && !(dims && dims[0] >= 120)) continue;
      return { buf, ext: isSvg ? "svg" : "png", url };
    }
  } catch {
    /* site unreachable */
  }
  return null;
}

if (!args["no-logos"]) {
  const sourcesPath = "public/logos/sources.json";
  const sources = JSON.parse(readFileSync(sourcesPath, "utf8")) as Record<string, { file: string; source: string; url: string }>;
  const partnerHas = new Set(index.filter((c) => c.logo).map((c) => c.ticker));
  const tally: Record<string, number> = { kept: 0, commons: 0, partner: 0, website: 0, none: 0 };
  const save = (t: string, got: { buf: Uint8Array; ext: string; url: string }, source: string, kind: string) => {
    const name = `${t}.${got.ext}`;
    for (const ext of ["svg", "png", "jpg"]) if (ext !== got.ext && existsSync(`public/logos/${t}.${ext}`)) unlinkSync(`public/logos/${t}.${ext}`);
    writeFileSync(`public/logos/${name}`, got.buf);
    sources[t] = { file: name, source, url: got.url };
    tally[kind]++;
    flush();
  };
  // Written after every change so an interrupted run never leaves files and sources out of step.
  const flush = () => writeFileSync(sourcesPath, JSON.stringify(Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))), null, 1));
  await pool(extraOut, 2, async (c) => {
    const have = sources[c.ticker] && existsSync(`public/logos/${sources[c.ticker].file}`);
    const fromCommons = have && sources[c.ticker].url.includes("wikimedia.org");
    // --upgrade retries everything not already from Commons; --relogo redoes all.
    if (have && !args.relogo && !(args.upgrade && !fromCommons)) return void tally.kept++;
    const w = wd.get(c.cik);
    let file = w?.logo;
    if (!file && w?.article) {
      try {
        const pi = await getJson<{ query: { pages: Record<string, { pageimage?: string }> } }>(
          `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=name&redirects=1&titles=${encodeURIComponent(w.article)}`,
        );
        const name = Object.values(pi.query.pages)[0]?.pageimage;
        if (name && /logo|wordmark/i.test(name)) file = name.replace(/_/g, " ");
      } catch {
        /* no lead image */
      }
    }
    if (file) {
      const got = await commonsLogo(file).catch(() => null);
      if (got) return save(c.ticker, got, file, "commons");
    }
    if (partnerHas.has(c.ticker)) {
      const buf = await download(`${PUBLIC}/logos/${c.ticker}.png`);
      if (buf) return save(c.ticker, { buf, ext: "png", url: `${PUBLIC}/logos/${c.ticker}.png` }, "Filed Under partner corpus", "partner");
    }
    if (c.website) {
      const got = await siteIcon(c.website);
      if (got) return save(c.ticker, got, `${new URL(c.website).hostname} site icon`, "website");
    }
    if (have) return void tally.kept++;
    delete sources[c.ticker];
    flush();
    tally.none++;
  });
  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(sourcesPath, JSON.stringify(sorted, null, 1));
  console.log("logos", tally);
}
