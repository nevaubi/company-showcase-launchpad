// CMS Medicare drug spending (Part D pharmacy drugs, Part B physician-administered drugs) turned
// into per-company series: total gross Medicare spending on the company's drugs per year, plus
// the largest drugs. Pure: callers fetch the CMS files and (for Part B) the drug owners.
import type { Row } from "./collect.server";

export const CMS = {
  partD: { annual: "7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b", quarterly: "4ff7c618-4e40-483a-b390-c8a58c94fa15", page: "https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-part-d-spending-by-drug" },
  partB: { annual: "76a714ad-3a2c-43ac-b76d-9dadf8f7d890", quarterly: "bf6a5b3b-31ee-4abb-b1ad-2607a1e7510a", page: "https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-part-b-spending-by-drug" },
} as const;
export type Part = keyof typeof CMS;

/** The exact CMS records for one drug (JSON, every year/quarter). */
export const drugUrl = (part: Part, quarterly: boolean, brand: string) =>
  `https://data.cms.gov/data-api/v1/dataset/${quarterly ? CMS[part].quarterly : CMS[part].annual}/data?filter%5BBrnd_Name%5D=${encodeURIComponent(brand)}`;

/**
 * Manufacturer / labeler names → ticker. CMS truncates Part D manufacturer names to 15 characters
 * ("Merck Sharp & D", "Incyte Corporat"), so rules match prefixes; Part B owners come from FDA
 * labeler names. Subsidiaries and acquired makers map to the current parent.
 */
export const MAKER_RULES: [RegExp, string][] = [
  [/^(bms\b|bristol|e\.?\s?r\.?\s?squibb|celgene|receptos|myokardia|karuna|mirati|turning point)/, "BMY"],
  [/^(eli lilly|lilly\b|loxo|dermira)/, "LLY"],
  [/^(abbvie|allergan|pharmacyclics|cerevel|immunogen)/, "ABBV"],
  [/^(janssen|actelion|johnson|intra-?cellular|xian-janssen)/, "JNJ"],
  [/^(pfizer|seagen|hospira|wyeth|parke-?davis|g\.?\s?d\.?\s?searle|arena pharm|global blood|biohaven pharmaceutical holding)/, "PFE"],
  [/^(merck sharp|merck & co|msd\b|acceleron|prometheus bio)/, "MRK"],
  [/^organon/, "OGN"],
  [/^(gilead|kite pharma|immunomedics|asegua)/, "GILD"],
  [/^(amgen|horizon ther|horizon pharma|chemocentryx|onyx pharm)/, "AMGN"],
  [/^(mylan|viatris|greenstone)/, "VTRS"],
  [/^amneal/, "AMRX"],
  [/^neurocrine/, "NBIX"],
  [/^incyte/, "INCY"],
  [/^exelixis/, "EXEL"],
  [/^united therap/, "UTHR"],
  [/^vertex/, "VRTX"],
  [/^jazz/, "JAZZ"],
  [/^biogen/, "BIIB"],
  [/^regeneron/, "REGN"],
  [/^alkermes/, "ALKS"],
  [/^supernus/, "SUPN"],
  [/^ionis/, "IONS"],
  [/^corcept/, "CORT"],
  [/^axsome/, "AXSM"],
  [/^harmony bio/, "HRMY"],
  [/^cordavis/, "CVS"], // CVS Health's biosimilar co-labeler
  [/^(embecta|bd diabetes)/, "EMBC"], // BD's diabetes unit, spun off as Embecta in 2022
];

/** Co-labeled "former/current" names whose parts resolve to different covered companies. */
const SLASH_OWNER: Record<string, string> = { "celgene/amgen": "AMGN", "biohaven/pfizer": "PFE", "jazz/axsome": "AXSM", "janssen/vanda": "VNDA" };
/** Distributors and repackagers label other makers' drugs; spending on those isn't theirs. */
const NOT_MAKERS = new Set(["MCK", "CAH", "HSIC", "COR", "OMI"]);

export interface CoveredCo {
  ticker: string;
  name: string;
  sector?: string;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|corp|corporation|co|llc|ltd|plc|lp|us|usa|the)\b/g, " ").replace(/\s+/g, " ").trim();

/** Ticker for a manufacturer/labeler name, or null. Explicit rules first, then a unique health-care name match. */
export function makerTicker(label: string, covered: CoveredCo[]): string | null {
  const l = label.toLowerCase().trim().replace(/\*+$/, "");
  if (!l || l === "overall") return null;
  const have = new Set(covered.map((c) => c.ticker));
  if (l.includes("/")) {
    if (SLASH_OWNER[l]) return have.has(SLASH_OWNER[l]) ? SLASH_OWNER[l] : null;
    const hits = new Set(l.split("/").map((p) => makerTicker(p, covered)).filter(Boolean));
    return hits.size === 1 ? [...hits][0]! : null;
  }
  const t = oneMaker(l, covered, have);
  return t && !NOT_MAKERS.has(t) ? t : null;
}

function oneMaker(l: string, covered: CoveredCo[], have: Set<string>): string | null {
  for (const [re, t] of MAKER_RULES) if (re.test(l)) return have.has(t) ? t : null;
  const n = norm(l);
  if (n.length < 6) return null;
  const hits = covered.filter((c) => {
    if (c.sector && c.sector !== "Health Care") return false;
    const cn = norm(c.name);
    return cn.length >= 6 && (cn.startsWith(n) || n.startsWith(`${cn} `) || n === cn);
  });
  const tickers = new Set(hits.map((h) => h.ticker)); // a company can be listed under several names
  return tickers.size === 1 ? hits[0].ticker : null;
}

export interface CmsRecord {
  [k: string]: string | undefined;
}

/** One reading: a drug's spending in a year (or year-to-date). */
export interface DrugYear {
  part: Part;
  ticker: string;
  /** Display name: CMS spellings merged ("Stelara (J3357)", "STELARA*" → "Stelara"). */
  brand: string;
  /** CMS's own brand string, used to link the exact record. */
  raw: string;
  generic: string;
  maker: string;
  year: number;
  /** Quarters covered when not a full year (e.g. 1 for "2026 (Q1)"). */
  quarters: number | null;
  spend: number;
  claims: number | null;
  benes: number | null;
  /** Which CMS file the reading came from (the record link points there). */
  file: "annual" | "quarterly";
}

/** "Stelara (J3357)" / "BOTOX COSMETIC*" / "Comirnaty *" → "Stelara" / "Botox Cosmetic" / "Comirnaty". */
export function displayBrand(raw: string): string {
  const b = raw.replace(/\([^)]*\)/g, " ").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  if (b && b === b.toUpperCase() && /[A-Z]{3}/.test(b)) return b.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return b;
}

const num = (v: string | undefined) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "2025 (Q1-Q4)" → full 2025; "2026 (Q1)" → 2026 through Q1. */
export function parseYear(label: string): { year: number; quarters: number | null } | null {
  const m = /^(\d{4})(?:\s*\(Q1(?:-Q(\d))?\))?$/.exec(label.trim());
  if (!m) return null;
  const q = m[2] ? Number(m[2]) : label.includes("(Q1)") ? 1 : null;
  return { year: Number(m[1]), quarters: q === 4 ? null : q };
}

/**
 * Readings from CMS records. Annual files carry `Tot_Spndng_YYYY` columns; quarterly files one
 * `Year` per row. Part D rows name the manufacturer (the "Overall" roll-up is skipped); Part B rows
 * don't, so `owner(brand)` supplies the company.
 */
export function drugYears(part: Part, file: "annual" | "quarterly", records: CmsRecord[], resolve: (maker: string) => string | null, owner?: (brand: string) => { ticker: string; maker: string } | null): DrugYear[] {
  const out: DrugYear[] = [];
  for (const r of records) {
    const raw = (r.Brnd_Name ?? "").trim();
    const brand = displayBrand(raw);
    if (!brand) continue;
    let ticker: string | null = null, maker = "";
    if (part === "partD") {
      maker = (r.Mftr_Name ?? "").trim();
      if (!maker || maker === "Overall") continue;
      ticker = resolve(maker);
    } else {
      const o = owner?.(raw);
      ticker = o?.ticker ?? null;
      maker = o?.maker ?? "";
    }
    if (!ticker) continue;
    const base = { part, ticker, brand, raw, generic: (r.Gnrc_Name ?? "").trim(), maker, file };
    if (r.Year) {
      const y = parseYear(r.Year);
      const spend = num(r.Tot_Spndng);
      if (y && spend != null && spend > 0) out.push({ ...base, ...y, spend, claims: num(r.Tot_Clms), benes: num(r.Tot_Benes) });
      continue;
    }
    for (const k of Object.keys(r)) {
      const m = /^Tot_Spndng_(\d{4})$/.exec(k);
      if (!m) continue;
      const spend = num(r[k]);
      if (spend == null || spend <= 0) continue;
      out.push({ ...base, year: Number(m[1]), quarters: null, spend, claims: num(r[`Tot_Clms_${m[1]}`]), benes: num(r[`Tot_Benes_${m[1]}`]) });
    }
  }
  return out;
}

const PART_LABEL: Record<Part, string> = { partD: "Part D", partB: "Part B" };
const periodDate = (year: number, quarters: number | null) => (quarters ? `${year}-${String(quarters * 3).padStart(2, "0")}-${quarters === 1 || quarters === 4 ? "31" : "30"}` : `${year}-12-31`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Per-company rows: total Medicare spending on its drugs per part and period (with the top drugs
 * in meta), and a series for each of its `topN` largest drugs. Duplicate readings for the same drug
 * and period (annual and quarterly files can both carry a year) keep the annual file's figure.
 */
export function medicareRows(readings: DrugYear[], topN = 6): Row[] {
  // de-duplicate (part, ticker, brand, maker, year, quarters)
  const seen = new Map<string, DrugYear>();
  for (const r of [...readings].sort((a, b) => (a.file === b.file ? 0 : a.file === "annual" ? -1 : 1))) {
    const k = [r.part, r.ticker, r.raw, r.maker, r.year, r.quarters ?? "fy"].join("|");
    if (!seen.has(k)) seen.set(k, r);
  }
  const uniq = [...seen.values()];
  const out: Row[] = [];
  const groups = new Map<string, DrugYear[]>();
  for (const r of uniq) {
    const k = `${r.part}|${r.ticker}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  for (const [k, rs] of groups) {
    const [part, ticker] = k.split("|") as [Part, string];
    const label = PART_LABEL[part];
    // brand totals across makers (a drug can have several labelers within one company)
    const periods = new Map<string, DrugYear[]>();
    for (const r of rs) {
      const pk = `${r.year}|${r.quarters ?? ""}`;
      (periods.get(pk) ?? periods.set(pk, []).get(pk)!).push(r);
    }
    for (const [pk, ps] of periods) {
      const [y, q] = pk.split("|");
      const year = Number(y), quarters = q ? Number(q) : null;
      const byBrand = new Map<string, { brand: string; generic: string; spend: number }>();
      for (const p of ps) {
        const b = byBrand.get(p.brand) ?? { brand: p.brand, generic: p.generic, spend: 0 };
        b.spend += p.spend;
        byBrand.set(p.brand, b);
      }
      const brands = [...byBrand.values()].sort((a, b) => b.spend - a.spend);
      out.push({
        uid: `cms:${part}:${ticker}:${year}${quarters ? `q${quarters}` : ""}`,
        ticker,
        dataset: "medicare",
        kind: "series",
        date: periodDate(year, quarters),
        title: `Medicare ${label} spending`,
        value: Math.round(brands.reduce((s, b) => s + b.spend, 0)),
        unit: "USD",
        meta: { part, year, ytd: quarters != null, quarters, drugs: brands.length, top: brands.slice(0, 8).map((b) => ({ brand: b.brand, generic: b.generic, spend: Math.round(b.spend) })) },
        source: `CMS Medicare ${label} Spending by Drug`,
        source_url: CMS[part].page,
      });
    }
    // largest drugs by their latest full-year spending
    const latestFull = Math.max(...rs.filter((r) => r.quarters == null).map((r) => r.year));
    const rank = new Map<string, number>();
    for (const r of rs) if (r.year === latestFull && r.quarters == null) rank.set(r.brand, (rank.get(r.brand) ?? 0) + r.spend);
    const top = [...rank.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([b]) => b);
    for (const brand of top) {
      const per = new Map<string, DrugYear & { total: number; top: number }>();
      for (const r of rs) {
        if (r.brand !== brand) continue;
        const pk = `${r.year}|${r.quarters ?? ""}`;
        const cur = per.get(pk);
        if (cur) {
          cur.total += r.spend;
          cur.claims = cur.claims == null && r.claims == null ? null : (cur.claims ?? 0) + (r.claims ?? 0);
          cur.benes = null; // beneficiaries can't be added across codes/makers without double counting
          if (r.spend > cur.top) Object.assign(cur, { raw: r.raw, file: r.file, maker: r.maker, top: r.spend });
        } else per.set(pk, { ...r, total: r.spend, top: r.spend });
      }
      for (const r of per.values()) {
        out.push({
          uid: `cms:${part}:${ticker}:${slug(brand)}:${r.year}${r.quarters ? `q${r.quarters}` : ""}`,
          ticker,
          dataset: "medicare",
          kind: "series",
          date: periodDate(r.year, r.quarters),
          title: `${label} · ${brand}`,
          value: Math.round(r.total),
          unit: "USD",
          meta: { part, drug: brand, generic: r.generic, maker: r.maker, year: r.year, ytd: r.quarters != null, quarters: r.quarters, claims: r.claims, benes: r.benes },
          source: `CMS Medicare ${label} Spending by Drug`,
          source_url: drugUrl(part, r.file === "quarterly", r.raw),
        });
      }
    }
  }
  return out;
}
