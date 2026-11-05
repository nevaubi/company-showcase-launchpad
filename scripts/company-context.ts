// Builds public/data/context/TICKER.json: readable description (Wikipedia), free-licensed photos
// (Wikimedia Commons), and executives + board from the latest 10-K and proxy (DEF 14A) with
// every person verified against the filing text. Headshots: Wikidata first, then the company's
// own leadership page. Rerun any time; a failed ticker keeps its previous file.
//   bun scripts/company-context.ts [--only=AAPL,MSFT] [--no-people] [--no-press]
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { structured } from "@/lib/ai.server";
import { firecrawlMap, firecrawlScrape } from "@/lib/web.server";
import {
  bestWindows,
  htmlToText,
  nameIn,
  numberIn,
  usableImage,
  photoFromMarkdown,
  type CompanyContext,
  type ContextImage,
  type Person,
} from "@/lib/company/context";
import { args, log, sleep } from "./lib/supa";

const UA = "FiledUnder Research research@filedunder.ai";
const WUA = { "User-Agent": "FiledUnder/1.0 (research@filedunder.ai)" };
const OUT = "public/data/context";
mkdirSync(OUT, { recursive: true });

const tickers = args.only ? args.only.toUpperCase().split(",") : COVERAGE.map((c) => c.ticker);

async function getJson<T>(url: string, headers: Record<string, string> = WUA): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers });
    if (r.ok) return (await r.json()) as T;
    if (r.status === 429 || r.status >= 500) {
      await sleep(1500 * (i + 1));
      continue;
    }
    throw new Error(`${r.status} ${url}`);
  }
  throw new Error(`gave up ${url}`);
}

// ---------- Wikidata: company item by SEC CIK ----------
type WD = { item: string; article?: string; employees?: number; employeesAsOf?: string; founders: string[]; hq?: string };
async function wikidataByCik(): Promise<Map<string, WD>> {
  const ciks = COVERAGE.map((c) => {
    const d = JSON.parse(readFileSync(`public/data/companies/${c.ticker}.json`, "utf8"));
    return [c.ticker, String(d.profile.cik)] as const;
  });
  const values = ciks.flatMap(([, c]) => [`"${c}"`, `"${String(Number(c))}"`]).join(" ");
  const q = `SELECT ?cik ?item ?article ?emp ?empDate ?founderLabel ?hqLabel WHERE {
    VALUES ?cik { ${values} } ?item wdt:P5531 ?cik.
    OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
    OPTIONAL { ?item p:P1128 ?es. ?es ps:P1128 ?emp. OPTIONAL { ?es pq:P585 ?empDate. } }
    OPTIONAL { ?item wdt:P112 ?founder. }
    OPTIONAL { ?item wdt:P159 ?hq. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const j = await getJson<{ results: { bindings: Record<string, { value: string }>[] } }>(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,
  );
  const byCik = new Map<string, WD & { _emp: [number, string][] }>();
  for (const b of j.results.bindings) {
    const cik = String(Number(b.cik.value));
    const w = byCik.get(cik) ?? { item: b.item.value.split("/").pop()!, founders: [], _emp: [] };
    if (b.article && !w.article) w.article = decodeURIComponent(b.article.value.split("/wiki/")[1]);
    if (b.emp) w._emp.push([Number(b.emp.value), b.empDate?.value?.slice(0, 10) ?? ""]);
    if (b.founderLabel && !/^Q\d+$/.test(b.founderLabel.value) && !w.founders.includes(b.founderLabel.value)) w.founders.push(b.founderLabel.value);
    if (b.hqLabel && !w.hq) w.hq = b.hqLabel.value;
    byCik.set(cik, w);
  }
  const out = new Map<string, WD>();
  for (const [t, cik] of ciks) {
    const w = byCik.get(String(Number(cik)));
    if (!w) continue;
    const latest = w._emp.sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
    out.set(t, { item: w.item, article: w.article, employees: latest?.[0], employeesAsOf: latest?.[1] || undefined, founders: w.founders.slice(0, 6), hq: w.hq });
  }
  return out;
}

// ---------- Wikipedia description + Commons images ----------
async function description(article: string) {
  const j = await getJson<{ query: { pages: Record<string, { title: string; extract?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(article)}`,
  );
  const page = Object.values(j.query.pages)[0];
  const paragraphs = (page?.extract ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 60);
  return paragraphs.length ? { paragraphs: paragraphs.slice(0, 6), title: page.title, source: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}` } : undefined;
}

type II = { url: string; thumburl?: string; thumbwidth?: number; thumbheight?: number; width: number; height: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> };
const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function commonsInfo(titles: string[], width = 1280): Promise<{ title: string; ii: II }[]> {
  if (!titles.length) return [];
  const j = await getJson<{ query?: { pages: Record<string, { title: string; imageinfo?: II[] }> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=${width}&titles=${encodeURIComponent(titles.join("|"))}`,
  );
  return Object.values(j.query?.pages ?? {}).flatMap((p) => (p.imageinfo?.[0] ? [{ title: p.title, ii: p.imageinfo[0] }] : []));
}

function toImage(title: string, ii: II): ContextImage {
  const m = ii.extmetadata ?? {};
  return {
    url: ii.thumburl ?? ii.url,
    width: ii.thumbwidth ?? ii.width,
    height: ii.thumbheight ?? ii.height,
    caption: strip(m.ImageDescription?.value).slice(0, 220) || title.replace(/^File:/, "").replace(/\.\w+$/, ""),
    credit: { kind: "wikimedia", page: ii.descriptionurl, author: strip(m.Artist?.value).slice(0, 80) || undefined, license: strip(m.LicenseShortName?.value) || undefined },
  };
}

async function images(article: string, company: string): Promise<ContextImage[]> {
  const j = await getJson<{ query?: { pages: Record<string, { images?: { title: string }[]; pageimage?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images|pageimages&imlimit=80&redirects=1&titles=${encodeURIComponent(article)}`,
  );
  const pages = Object.values(j.query?.pages ?? {});
  const lead = pages[0]?.pageimage ? `File:${pages[0].pageimage.replace(/_/g, " ")}` : null;
  const titles = pages.flatMap((p) => p.images ?? []).map((i) => i.title).filter((t) => /\.(jpe?g|png|webp)$/i.test(t));
  const found: ContextImage[] = [];
  for (let i = 0; i < titles.length; i += 25) {
    for (const { title, ii } of await commonsInfo(titles.slice(i, i + 25))) {
      const lic = strip(ii.extmetadata?.LicenseShortName?.value);
      if (!usableImage(title, ii.width, ii.height)) continue;
      if (/fair use|non-free/i.test(lic)) continue;
      const img = toImage(title, ii);
      found.push(Object.assign(img, { _t: title }));
    }
  }
  // Lead image first, then photos whose title or caption names the company, then the rest.
  const stem = company.toLowerCase().split(/\s+/)[0];
  const score = (x: ContextImage & { _t?: string }) =>
    (lead && x._t?.replace(/_/g, " ") === lead ? 0 : 2) - ((x._t ?? "").toLowerCase().includes(stem) || x.caption.toLowerCase().includes(stem) ? 1 : 0);
  return found
    .sort((a, b) => score(a) - score(b))
    .slice(0, 8)
    .map(({ _t, ...x }: ContextImage & { _t?: string }) => x);
}

// ---------- People from SEC filings ----------
const docUrl = (cik: string, accn: string, doc: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc}`;
async function secText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  return htmlToText(await r.text());
}

const PEOPLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["people"],
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "title", "age", "since", "joined", "chair", "independent", "committees", "payYear", "payTotal", "bio", "quote"],
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          age: { type: ["integer", "null"] },
          since: { type: ["integer", "null"], description: "Year the person took the current role (or joined the board for directors)" },
          joined: { type: ["integer", "null"], description: "Year they joined the company, if stated" },
          chair: { type: "boolean" },
          independent: { type: ["boolean", "null"] },
          committees: { type: "array", items: { type: "string" } },
          payYear: { type: ["integer", "null"] },
          payTotal: { type: ["number", "null"], description: "Total column of the Summary Compensation Table for the most recent year, in dollars, exactly as printed" },
          bio: { type: "string", description: "One or two sentence career summary using only facts in the text" },
          quote: { type: "string", description: "A short passage (8-30 words) copied verbatim from the text that names the person" },
        },
      },
    },
  },
} as const;

type Raw = { name: string; title: string; age: number | null; since: number | null; joined: number | null; chair: boolean; independent: boolean | null; committees: string[]; payYear: number | null; payTotal: number | null; bio: string; quote: string };

async function extract(kind: "executive" | "board", text: string, company: string): Promise<Raw[]> {
  const r = await structured<{ people: Raw[] }>({
    name: "people",
    effort: "medium",
    instructions:
      kind === "executive"
        ? `From this ${company} SEC filing text, list the current executive officers (the section listing executive officers, and the named executive officers in the Summary Compensation Table, including the CEO). Give each person's current title. Use only facts printed in the text; null when not stated. For pay, use the Summary Compensation Table if present: the Total for the most recent year. Do not list directors who are not officers. Never invent.`
        : `From this ${company} proxy statement text, list every current director / director nominee. Mark the board chair (chair=true; the CEO can also be chair), whether independent, committee memberships, the year they became a director ("since"), age. Use only facts printed in the text; null when not stated. Never invent.`,
    input: text,
    schema: PEOPLE_SCHEMA as unknown as Record<string, unknown>,
  });
  return r.people;
}

async function people(ticker: string, cik: string, filings: { accn: string; form: string; doc: string; filed: string }[], company: string): Promise<Person[]> {
  const tenk = filings.find((f) => f.form === "10-K");
  const proxy = filings.find((f) => f.form === "DEF 14A");
  const out: Person[] = [];
  const proxyText = proxy ? await secText(docUrl(cik, proxy.accn, proxy.doc)).catch(() => "") : "";
  const compWin = proxyText ? bestWindows(proxyText, /summary compensation table/i, 9000, /total|salary|\$/i, 1)[0] ?? "" : "";

  // Executives: the 10-K section, plus the proxy's compensation table for pay.
  if (tenk) {
    const t = await secText(docUrl(cik, tenk.accn, tenk.doc));
    const score = /\bage\b|joined|since|served as|prior to|vice president|chief/i;
    const wins = bestWindows(t, /executive officers/i, 7000, score, 2);
    // Many 10-Ks incorporate officers by reference to the proxy, so read its section too.
    const pw = proxyText ? bestWindows(proxyText, /executive officers/i, 8000, score, 2) : [];
    const execText = [...wins, ...pw].join("\n---\n");
    if (args.debug) log("exec window", execText.slice(0, 1500).replace(/\s+/g, " "));
    // Two passes: officers from the officer sections, pay (and any missing named officers) from the table.
    const [officers, paid] = await Promise.all([
      extract("executive", execText, company),
      compWin ? extract("executive", `=== SUMMARY COMPENSATION TABLE ===\n${compWin}`, company) : Promise.resolve([] as Raw[]),
    ]);
    const raw: Raw[] = [...officers];
    for (const p of paid) {
      const m = raw.find((r) => nameIn(r.name, p.name) || nameIn(p.name, r.name) || lastName(r.name) === lastName(p.name));
      if (m) {
        m.payTotal = p.payTotal;
        m.payYear = p.payYear;
      } else raw.push(p);
    }
    const src = { accn: tenk.accn, doc: tenk.doc, form: "10-K", filed: tenk.filed };
    const hay = execText + compWin;
    for (const r of raw) {
      if (!fullName(r.name) || !nameIn(r.name, hay)) continue;
      // The quote must be verbatim; fall back to a passage around the name.
      const quoteOk = hay.replace(/\s+/g, " ").toLowerCase().includes(r.quote.replace(/\s+/g, " ").toLowerCase());
      const pay = r.payTotal && r.payYear && numberIn(r.payTotal, compWin) && nameIn(r.name, compWin) ? { year: r.payYear, total: r.payTotal } : undefined;
      out.push({
        name: r.name,
        title: r.title,
        group: "executive",
        age: r.age && numberIn(r.age, hay) ? r.age : undefined,
        since: r.since ?? undefined,
        joined: r.joined ?? undefined,
        pay,
        bio: r.bio || undefined,
        quote: quoteOk ? r.quote : around(hay, r.name),
        source: pay && proxy ? { accn: proxy.accn, doc: proxy.doc, form: "DEF 14A", filed: proxy.filed } : src,
      });
    }
  }

  if (proxy && proxyText) {
    const wins = bestWindows(proxyText, /director since|director nominees|nominees for (election|director)|election of directors/i, 16000, /director since|\bage\b|independent/i, 2);
    const hay = wins.join("\n---\n");
    const raw = await extract("board", hay, company);
    for (const r of raw) {
      if (!fullName(r.name) || !nameIn(r.name, hay)) continue;
      const exec = out.find((p) => nameIn(r.name, p.name) || nameIn(p.name, r.name));
      if (exec && r.chair) exec.chair = true;
      const quoteOk = hay.replace(/\s+/g, " ").toLowerCase().includes(r.quote.replace(/\s+/g, " ").toLowerCase());
      out.push({
        name: r.name,
        title: r.chair ? "Chair of the Board" : r.title || "Director",
        group: "board",
        age: r.age && numberIn(r.age, hay) ? r.age : undefined,
        since: r.since ?? undefined,
        chair: r.chair || undefined,
        independent: r.independent ?? undefined,
        committees: r.committees.length ? r.committees : undefined,
        bio: r.bio || undefined,
        quote: quoteOk ? r.quote : around(hay, r.name),
        source: { accn: proxy.accn, doc: proxy.doc, form: "DEF 14A", filed: proxy.filed },
      });
    }
  }
  log(ticker, `people: ${out.filter((p) => p.group === "executive").length} execs, ${out.filter((p) => p.group === "board").length} directors`);
  return out;
}

const lastName = (n: string) => n.replace(/[.,]/g, " ").split(/\s+/).filter((x) => x.length > 1 && !/^(jr|sr|ii|iii|iv)$/i.test(x)).pop()?.toLowerCase();
const fullName = (n: string) => n.replace(/^(mr|ms|mrs|dr)\.?\s+/i, "").split(/\s+/).length >= 2 && !/^(mr|ms|mrs|dr)\.?\s/i.test(n);

function around(text: string, name: string) {
  const last = name.split(/\s+/).pop() ?? name;
  const i = text.toLowerCase().indexOf(last.toLowerCase());
  return i < 0 ? name : text.slice(Math.max(0, i - 60), i + 160).replace(/\s+/g, " ").trim();
}

// ---------- Headshots ----------
async function wikidataPhoto(name: string, company: string, companyItem?: string): Promise<Person["photo"]> {
  const s = await getJson<{ search: { id: string; description?: string }[] }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(name)}`,
  );
  const stem = company.toLowerCase().split(/\s+/)[0];
  for (const c of s.search) {
    const e = await getJson<{ entities: Record<string, { claims: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> }> }>(
      `https://www.wikidata.org/wiki/Special:EntityData/${c.id}.json`,
    );
    const claims = e.entities[c.id]?.claims ?? {};
    const ids = (p: string) => (claims[p] ?? []).map((x) => (x.mainsnak.datavalue?.value as { id?: string } | undefined)?.id);
    if (!ids("P31").includes("Q5")) continue;
    const linked = companyItem && [...ids("P108"), ...ids("P463"), ...ids("P1830"), ...ids("P488")].includes(companyItem);
    const described = (c.description ?? "").toLowerCase().includes(stem);
    // Also accept people whose position held (P39) qualifiers mention the company.
    const pos = JSON.stringify(claims["P39"] ?? []).includes(`"${companyItem}"`);
    if (!linked && !described && !pos) continue;
    const file = claims["P18"]?.[0]?.mainsnak.datavalue?.value as string | undefined;
    if (!file) return undefined;
    const [info] = await commonsInfo([`File:${file}`], 500);
    if (!info) return undefined;
    const img = toImage(info.title, info.ii);
    return { url: img.url, credit: img.credit };
  }
  return undefined;
}

async function pressPhotos(website: string, ps: Person[]) {
  const missing = ps.filter((p) => !p.photo);
  if (!missing.length || !website) return;
  let urls: string[] = [];
  try {
    urls = await firecrawlMap(website, { search: "leadership executive team board", limit: 40 });
  } catch (e) {
    log("map failed", (e as Error).message);
    return;
  }
  const pages = urls.filter((u) => /leadership|executive|management|our-team|board|officers|governance/i.test(u) && !/\.(pdf|jpg|png)$/i.test(u)).slice(0, 3);
  for (const page of pages) {
    try {
      const { markdown } = await firecrawlScrape(page);
      for (const p of missing) {
        if (p.photo) continue;
        const url = photoFromMarkdown(markdown, p.name, page);
        if (url) p.photo = { url, credit: { kind: "company", page } };
      }
    } catch (e) {
      log("scrape failed", page, (e as Error).message);
    }
  }
}

// ---------- main ----------
const wd = await wikidataByCik().catch((e) => {
  log("wikidata failed", (e as Error).message);
  return new Map<string, WD>();
});
let ok = 0;
for (const t of tickers) {
  try {
    const d = JSON.parse(readFileSync(`public/data/companies/${t}.json`, "utf8"));
    const prevPath = `${OUT}/${t}.json`;
    const prev: CompanyContext | null = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
    const w = wd.get(t);
    const name = coverageOf(t)?.shortName ?? d.profile.name;
    const ctx: CompanyContext = {
      ticker: t,
      generatedAt: new Date().toISOString(),
      description: w?.article ? await description(w.article).catch(() => prev?.description) : prev?.description,
      facts: { employees: w?.employees ? { value: w.employees, asOf: w.employeesAsOf } : prev?.facts.employees, founders: w?.founders.length ? w.founders : prev?.facts.founders, headquarters: w?.hq ?? prev?.facts.headquarters, wikidata: w?.item },
      images: w?.article ? await images(w.article, name).catch(() => prev?.images ?? []) : (prev?.images ?? []),
      people: prev?.people ?? [],
    };
    if (!args["no-people"]) {
      try {
        const ps = await people(t, d.profile.cik, d.filings, name);
        if (ps.length) {
          for (const p of ps) {
            p.photo = prev?.people.find((x) => x.name === p.name)?.photo;
            if (!p.photo) p.photo = await wikidataPhoto(p.name, name, w?.item).catch(() => undefined);
          }
          if (!args["no-press"]) await pressPhotos(d.profile.website, ps);
          // Executives who also sit on the board share one photo.
          for (const p of ps) if (!p.photo) p.photo = ps.find((x) => x !== p && x.photo && x.name === p.name)?.photo;
          ctx.people = ps;
        }
      } catch (e) {
        log(t, "people failed, keeping previous", (e as Error).message);
      }
    }
    writeFileSync(prevPath, JSON.stringify(ctx));
    ok++;
    log(t, `desc ${ctx.description?.paragraphs.length ?? 0}p, ${ctx.images.length} images, ${ctx.people.length} people, ${ctx.people.filter((p) => p.photo).length} photos`);
  } catch (e) {
    log(t, "FAILED", (e as Error).message);
  }
}
log(`done: ${ok}/${tickers.length}`);
