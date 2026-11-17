// Builds the alt-data registry for every covered company (src/lib/alt/registry.ts): Wikipedia
// article (Wikidata, matched by SEC CIK), FDIC bank certificate (banks/financials, matched by
// holding-company name), CFPB complaint-database name (financials, telecom, consumer retail),
// NHTSA manufacturer (vehicles and machinery) and the legal name for full-text searches.
//   bun scripts/alt-registry.ts [--only=JPM,HOOD]
import { COVERAGE } from "@/lib/coverage";
import { staticRegistry } from "@/lib/alt/collect.server";
import { bankCore, dedupeRegistry, legalName, pickCfpb, pickFdic, pickFdicFuzzy, REGISTRY_PATH, wikiTitle, type AltRegistry } from "@/lib/alt/registry";
import { args, log, sb, sleep } from "./lib/supa";

const UA = "FiledUnder Research research@filedunder.ai";
async function json(url: string, init: RequestInit = {}): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (r?.ok) return r.json();
    if (r && r.status === 404) return null;
    await sleep(1500 * (i + 1));
  }
  return null;
}

const { data: uni } = await sb.storage.from("datasets").download("universe.json");
const u = JSON.parse(await uni!.text()) as { companies?: { ticker: string; cik: string; name: string }[] } | { ticker: string; cik: string; name: string }[];
const secName = new Map((Array.isArray(u) ? u : (u.companies ?? [])).map((c) => [c.ticker, c.name]));
const only = args.only?.toUpperCase().split(",");
const cos = COVERAGE.filter((c) => !only || only.includes(c.ticker));

const prev = await sb.storage.from("datasets").download(REGISTRY_PATH).then(async ({ data }) => (data ? (JSON.parse(await data.text()) as AltRegistry) : {})).catch(() => ({}) as AltRegistry);
const reg: AltRegistry = { ...prev };

// Wikipedia via Wikidata's Central Index Key property (one query for every company).
const q = "SELECT ?cik ?article WHERE { ?item wdt:P5531 ?cik . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }";
const wd = await json(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}`, { headers: { Accept: "application/sparql-results+json" } });
const wiki = new Map<string, string>();
for (const b of wd?.results?.bindings ?? []) {
  const t = wikiTitle(b.article.value);
  if (t) wiki.set(String(Number(b.cik.value)), t);
}
log(`wikidata: ${wiki.size} companies with a CIK and an English article`);

const FIN = /bank|financ|capital markets|brokerage|consumer finance|insurance|payment/i;
const CFPB_SECTORS = /Financials|Communication Services/;
const CFPB_INDUSTRY = /retail|telecom|cable|wireless|auto|hotels|restaurants|homebuild|household durables/i;
const MAKERS = /automobile|vehicle|machinery|recreational|household durables|leisure|aerospace/i;

let n = 0;
for (const c of cos) {
  const e = { ...(reg[c.ticker] ?? {}), ...staticRegistry(c.ticker) };
  const sec = secName.get(c.ticker) ?? c.shortName;
  e.legal = legalName(sec);
  const w = wiki.get(String(Number(c.cik)));
  if (!e.wiki && w) e.wiki = w;
  if (!e.fdic && FIN.test(c.industry)) {
    const j = await json(`https://api.fdic.gov/banks/institutions?filters=${encodeURIComponent(`NAMEHCR:"${sec.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim()}" AND ACTIVE:1`)}&fields=CERT,NAME,ASSET,NAMEHCR&sort_by=ASSET&sort_order=DESC&limit=20`);
    let cert = pickFdic((j?.data ?? []).map((d: any) => d.data), sec);
    // FDIC abbreviates holding names ("U S BCORP", "PNC FINL SERVICES GROUP"): fall back to a fuzzy
    // search on the bank's and the holding company's names, accepted only on the same core name.
    if (!cert && bankCore(sec)) {
      const rows: any[] = [];
      for (const field of ["NAMEHCR", "NAME"]) {
        const f = await json(`https://api.fdic.gov/banks/institutions?search=${encodeURIComponent(`${field}:${bankCore(sec)}`)}&filters=ACTIVE:1&fields=CERT,NAME,ASSET,NAMEHCR&sort_by=ASSET&sort_order=DESC&limit=50`);
        rows.push(...(f?.data ?? []).map((d: any) => d.data));
        await sleep(150);
      }
      cert = pickFdicFuzzy(rows, sec);
    }
    if (cert) e.fdic = cert;
    await sleep(150);
  }
  if (!e.cfpb && (CFPB_SECTORS.test(c.sector) || CFPB_INDUSTRY.test(c.industry))) {
    const j = await json(`https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?search_term=${encodeURIComponent(c.shortName)}&field=company&size=0`);
    const name = pickCfpb(j?.aggregations?.company?.company?.buckets ?? [], c.shortName);
    if (name) e.cfpb = name;
    await sleep(250);
  }
  if (!e.maker && MAKERS.test(c.industry)) {
    const m = c.shortName.toUpperCase().replace(/'/g, "''");
    const j = await json(`https://data.transportation.gov/resource/6axg-epim.json?$select=count(*)%20as%20n&$where=${encodeURIComponent(`upper(manufacturer) like '${m}%'`)}`);
    if (Number(j?.[0]?.n ?? 0) > 0) e.maker = c.shortName.toUpperCase();
    await sleep(150);
  }
  reg[c.ticker] = e;
  if (++n % 100 === 0) log(`${n}/${cos.length}`);
}
const cik = new Map(COVERAGE.map((c) => [c.ticker, c.cik]));
const clean = dedupeRegistry(reg, (t) => cik.get(t));
const counts = { wiki: 0, fdic: 0, cfpb: 0, maker: 0 };
for (const e of Object.values(clean)) for (const k of Object.keys(counts) as (keyof typeof counts)[]) if (e[k]) counts[k]++;
log(`registry: ${Object.keys(reg).length} companies · ${JSON.stringify(counts)}`);
const { error } = await sb.storage.from("datasets").upload(REGISTRY_PATH, JSON.stringify(clean), { upsert: true, contentType: "application/json" });
if (error) throw error;
log("saved");
