// Public alt-data collectors shared by `scripts/alt-data.ts` (bulk) and the scheduled `alt-data` job.
// Every row keeps a link back to the exact public record it came from. Pure fetch, no Node APIs.
import { CAPITAL, ITEMS } from "@/lib/alt/sec-forms";
import { appliesTo, type AltRegistryEntry } from "@/lib/alt/registry";
import { ALT_NAMES, awardTie, CONTRACTS_RULE, ignoredFilter, nameCore, pickParents, REFRESH_DATASET, tickerKeys, type ParentFamily, type RefreshMeta, type UsaRecipient } from "@/lib/alt/contracts";
import { CONTRACT_ALIASES } from "@/lib/alt/contract-aliases";
import { calendarYearPeriod, fiscalYearPeriod } from "@/lib/alt/periods";
import { FDIC_ZERO_IS_MISSING } from "@/lib/alt/bank";
import { cpscFirmName, cpscRole, firmCheck } from "@/lib/alt/firms";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Per-request timeout and retries; the scheduled job lowers both to fit its run budget. */
export const altFetch = { timeoutMs: 45_000, tries: 4, /** Only the latest periods (scheduled refresh; the script backfills history). */ recent: false };
const UA = "FiledUnder Research research@filedunder.ai";
export interface Co { ticker: string; name: string; cik: string; sector: string; industry: string; /** Registry names (src/lib/alt/registry.ts). */ reg?: AltRegistryEntry }
export type Row = { uid: string; ticker: string; dataset: string; kind: "event" | "series"; date: string | null; title: string; value?: number | null; unit?: string | null; meta?: Record<string, unknown>; source: string; source_url?: string | null };


// Names as they appear in each public registry (defaults to a cleaned SEC name); hand-checked list in src/lib/alt/contracts.ts.
const NAME = ALT_NAMES;
const WIKI: Record<string, string> = { AAPL: "Apple_Inc.", MSFT: "Microsoft", NVDA: "Nvidia", AMZN: "Amazon_(company)", GOOGL: "Alphabet_Inc.", TSLA: "Tesla,_Inc.", META: "Meta_Platforms", AVGO: "Broadcom", AMD: "AMD", ORCL: "Oracle_Corporation", JPM: "JPMorgan_Chase", BAC: "Bank_of_America", GS: "Goldman_Sachs", V: "Visa_Inc.", MA: "Mastercard", LLY: "Eli_Lilly_and_Company", UNH: "UnitedHealth_Group", JNJ: "Johnson_%26_Johnson", MRK: "Merck_%26_Co.", WMT: "Walmart", COST: "Costco", XOM: "ExxonMobil", CVX: "Chevron_Corporation", CAT: "Caterpillar_Inc.", HD: "The_Home_Depot", CRM: "Salesforce", ADBE: "Adobe_Inc.", NOW: "ServiceNow", CSCO: "Cisco", IBM: "IBM", INTC: "Intel", QCOM: "Qualcomm", TXN: "Texas_Instruments", MU: "Micron_Technology", NFLX: "Netflix", DIS: "The_Walt_Disney_Company", CMCSA: "Comcast", T: "AT%26T", VZ: "Verizon", LOW: "Lowe%27s", MCD: "McDonald%27s", SBUX: "Starbucks", NKE: "Nike,_Inc.", BKNG: "Booking_Holdings", PG: "Procter_%26_Gamble", KO: "The_Coca-Cola_Company", PEP: "PepsiCo", PM: "Philip_Morris_International", WFC: "Wells_Fargo", C: "Citigroup", MS: "Morgan_Stanley", SCHW: "Charles_Schwab_Corporation", AXP: "American_Express", SPGI: "S%26P_Global", ABBV: "AbbVie", PFE: "Pfizer", AMGN: "Amgen", TMO: "Thermo_Fisher_Scientific", ABT: "Abbott_Laboratories", ISRG: "Intuitive_Surgical", GE: "GE_Aerospace", RTX: "RTX_Corporation", BA: "Boeing", LMT: "Lockheed_Martin", HON: "Honeywell", DE: "John_Deere", UNP: "Union_Pacific_Railroad", UPS: "United_Parcel_Service", COP: "ConocoPhillips", SLB: "SLB_(company)", LIN: "Linde_plc", FCX: "Freeport-McMoRan", NEE: "NextEra_Energy", DUK: "Duke_Energy", SO: "Southern_Company", PLD: "Prologis", AMT: "American_Tower", EQIX: "Equinix" };
// FDIC certificate of each company's main insured bank.
const FDIC: Record<string, number> = { JPM: 628, BAC: 3510, WFC: 3511, C: 7213, GS: 33124, MS: 32992, SCHW: 57450, AXP: 27471 };
// CFPB complaint-database company names.
const CFPB: Record<string, string> = { JPM: "JPMORGAN CHASE & CO.", BAC: "BANK OF AMERICA, NATIONAL ASSOCIATION", WFC: "WELLS FARGO & COMPANY", C: "CITIBANK, N.A.", GS: "GOLDMAN SACHS BANK USA", MS: "Morgan Stanley", SCHW: "Charles Schwab Corporation, The", AXP: "AMERICAN EXPRESS COMPANY", V: "VISA, INC.", MA: "MASTERCARD INTERNATIONAL INCORPORATED", AMZN: "Amazon.com, Inc.", AAPL: "Apple Inc.", T: "AT&T Inc.", VZ: "Verizon Communications Inc.", CMCSA: "Comcast Corporation" };
const VEHICLE: Record<string, string> = { TSLA: "TESLA", CAT: "CATERPILLAR", DE: "DEERE", HON: "HONEYWELL", GE: "GENERAL ELECTRIC" };

const nm = (c: Co) => NAME[c.ticker] ?? c.name.replace(/\s*\/\w+\/?$/, "").replace(/,?\s+(INC|CORP|CO|LTD|PLC)\.?$/i, "");
/** Name for full-text searches: a one-word short name ("Target") is too ambiguous, so use the legal name. */
const searchName = (c: Co) => (NAME[c.ticker] || nm(c).includes(" ") || !c.reg?.legal ? nm(c) : c.reg.legal);
/** Whether a firm a registry names is this company (src/lib/alt/firms.ts): searches match phrases and prefixes, so every result is checked. */
const isFirm = (c: Co) => firmCheck(c.ticker, tickerKeys(c.ticker, c.name, c.reg?.legal));

async function get(url: string, init: RequestInit = {}, json = true): Promise<any> {
  for (let i = 0; i < altFetch.tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(altFetch.timeoutMs) });
      if (r.ok) return json ? await r.json() : await r.text();
      if (r.status === 404) return null;
      if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url.slice(0, 120)}`);
    } catch (e) { if (i === altFetch.tries - 1) throw e; }
    await sleep(1500 * (i + 1));
  }
  return null;
}
const isoRaw = (s: string | undefined | null) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s ? s.slice(0, 10) : null);
// Registries sometimes carry typo'd years (e.g. "0012-11-30"); drop impossible dates rather than misplace the record.
const iso = (s: string | undefined | null) => { const d = isoRaw(s); return d && /^(19|20)\d\d-\d\d-\d\d$/.test(d) ? d : null; };
const cik10 = (c: Co) => c.cik.padStart(10, "0");
const edgarUrl = (c: Co, accn: string, doc?: string) => `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${accn.replace(/-/g, "")}/${doc ?? `${accn}-index.htm`}`;

// ───────── SEC: 13D/13G holders & activists ─────────
async function ownership(c: Co): Promise<Row[]> {
  const out: Row[] = [];
  const forms = "SC 13D,SC 13D/A,SC 13G,SC 13G/A,SCHEDULE 13D,SCHEDULE 13D/A,SCHEDULE 13G,SCHEDULE 13G/A";
  for (let from = 0; from < 2000; from += 100) {
    const j = await get(`https://efts.sec.gov/LATEST/search-index?q=%22%22&forms=${encodeURIComponent(forms)}&ciks=${cik10(c)}&from=${from}`);
    const hits = j?.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) {
      const s = h._source; const accn = h._id.split(":")[0];
      if (s.ciks?.[0] !== cik10(c)) continue; // company is the filer (holding someone else), not the subject
      const filers = (s.display_names as string[]).filter((d) => !d.includes(cik10(c))).map((d) => d.replace(/\s*\(CIK.*$/, "").replace(/\s*\([A-Z.-]+\)\s*$/, "").trim());
      const form = String(s.form ?? s.file_type);
      const activist = /13D/.test(form);
      out.push({ uid: `own:${c.ticker}:${accn}`, ticker: c.ticker, dataset: "ownership", kind: "event", date: s.file_date, title: `${filers[0] ?? "Holder"} filed ${form}`, meta: { form, filers, activist, amendment: /\/A$/.test(form) }, source: "SEC EDGAR", source_url: edgarUrl(c, accn) });
    }
    if (hits.length < 100) break;
    await sleep(150);
  }
  return out;
}

// ───────── SEC: 8-K corporate events ─────────

async function events(c: Co): Promise<Row[]> {
  const head = await get(`https://data.sec.gov/submissions/CIK${cik10(c)}.json`);
  if (!head) return [];
  const blocks = [head.filings.recent];
  for (const f of head.filings.files ?? []) { const b = await get(`https://data.sec.gov/submissions/${f.name}`); if (b) blocks.push(b); await sleep(120); }
  const out: Row[] = [];
  for (const b of blocks) for (let i = 0; i < b.accessionNumber.length; i++) {
    if (!/^8-K/.test(b.form[i])) continue;
    for (const it of String(b.items[i] ?? "").split(",")) {
      const m = ITEMS[it.trim()]; if (!m) continue;
      out.push({ uid: `8k:${c.ticker}:${b.accessionNumber[i]}:${it.trim()}`, ticker: c.ticker, dataset: "events", kind: "event", date: b.filingDate[i], title: m[1], meta: { item: it.trim(), category: m[0], form: b.form[i] }, source: "SEC EDGAR 8-K", source_url: edgarUrl(c, b.accessionNumber[i], b.primaryDocument[i] || undefined) });
    }
  }
  return out;
}

// ───────── USAspending: federal contract awards ─────────
// Parents are recipients that are the company by whole name or a hand-checked alias
// (src/lib/alt/contracts.ts, contract-aliases.ts), never a prefix look-alike ("ROGERS, WICKER,
// RYKMAN AND SPEDALE LLC" is not Rogers Corporation). Every award and transaction is kept only when
// its recipient is the company or a child the source lists under one of those parents, and a
// response that says it ignored the company filter is dropped: `spending_by_award` ignores
// `recipient_id` and returned the government-wide top awards. Yearly totals are written only when
// every parent's call answered and no year exceeds what one company can be paid; a completed
// collection writes a refresh record (REFRESH_DATASET) the repair relies on.
const post = (url: string, body: unknown) => get(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** No company is obligated more than this in one fiscal year (Lockheed Martin, the largest, is about $70B). */
export const MAX_COMPANY_FY_USD = 120e9;

/** Keywords for the recipient search: the hand-checked or short name, and the legal name's core (RTX is "RTX CORPORATION", not "RAYTHEON"). */
export function contractKeywords(c: Co): string[] {
  const up = (x: string) => x.toUpperCase().replace(/[’']/g, "'").trim();
  const out = [up(nm(c))];
  const legal = c.reg?.legal ? up(nameCore(c.reg.legal)) : "";
  if (legal.length >= 2 && !out.includes(legal)) out.push(legal);
  return out;
}

async function contracts(c: Co): Promise<Row[]> {
  const keys = tickerKeys(c.ticker, c.name, c.reg?.legal);
  const found: UsaRecipient[] = [];
  for (const kw of [...contractKeywords(c), ...(CONTRACT_ALIASES[c.ticker] ?? []).flatMap((a) => a.ueis ?? [])]) {
    const list = await post("https://api.usaspending.gov/api/v2/recipient/", { keyword: kw, limit: 100, award_type: "contracts" });
    // a search that did not answer leaves the stored rows as they are
    if (!list) throw new Error(`USAspending recipient search did not answer for ${kw}`);
    found.push(...((list.results ?? []) as UsaRecipient[]));
  }
  const parents = pickParents(found, keys);
  const families: ParentFamily[] = [];
  for (const p of parents) {
    const code = p.uei ?? p.duns;
    const kids = code ? await get(`https://api.usaspending.gov/api/v2/recipient/children/${encodeURIComponent(code)}/?year=all`) : [];
    if (!Array.isArray(kids)) throw new Error(`USAspending children list did not answer for ${p.name}`);
    families.push({ parent: p, children: kids });
  }
  const out: Row[] = [];
  const fy = new Map<number, number>();
  let complete = true;
  let totalsOk = true;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const asOf = now.toISOString();
  const tieMeta = (r: { recipient_id?: string | null; "Recipient UEI"?: string | null }, t: NonNullable<ReturnType<typeof awardTie>>, f: ParentFamily) => ({ tie: t.tie, parent: (t.parent ?? f.parent).name, parent_id: (t.parent ?? f.parent).id, parent_uei: (t.parent ?? f.parent).uei ?? null, recipient_id: r.recipient_id ?? null, recipient_uei: r["Recipient UEI"] ?? null, as_of: asOf });
  for (const f of families) {
    const rec = f.parent;
    const filters = { recipient_id: rec.id, award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: "2007-10-01", end_date: today }] };
    const t = await post("https://api.usaspending.gov/api/v2/search/spending_over_time/", { group: "fiscal_year", filters });
    const years = t && !ignoredFilter(t.messages, "recipient_id") ? ((t.results ?? []) as { aggregated_amount?: number; time_period: { fiscal_year: string | number } }[]) : null;
    if (!years || years.some((r) => Math.abs(r.aggregated_amount ?? 0) > MAX_COMPANY_FY_USD)) totalsOk = false;
    else for (const r of years) if (r.aggregated_amount) fy.set(Number(r.time_period.fiscal_year), (fy.get(Number(r.time_period.fiscal_year)) ?? 0) + r.aggregated_amount);
    if (!years) complete = false;
    // Largest awards of the last five years to the parent's family (the award search filters by UEI text, not recipient id).
    if (rec.uei) {
      const recent = { recipient_search_text: [rec.uei], award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: `${now.getUTCFullYear() - 5}-01-01`, end_date: today }] };
      const a = await post("https://api.usaspending.gov/api/v2/search/spending_by_award/", { filters: recent, fields: ["Award ID", "Recipient Name", "Recipient UEI", "recipient_id", "Award Amount", "Awarding Agency", "Awarding Sub Agency", "Start Date", "End Date", "Description", "generated_internal_id"], limit: 40, sort: "Award Amount", order: "desc" });
      if (!a) complete = false;
      if (a && !ignoredFilter(a.messages, "recipient_search_text")) for (const r of a.results ?? []) {
        const tie = awardTie({ recipient: r["Recipient Name"], recipientId: r.recipient_id, uei: r["Recipient UEI"] }, families, keys);
        if (!tie) continue;
        out.push({ uid: `usa:${c.ticker}:${r.generated_internal_id}`, ticker: c.ticker, dataset: "contracts", kind: "event", date: iso(r["Start Date"]), title: `${r["Awarding Agency"]}: ${(r.Description ?? "Contract award").slice(0, 140)}`, value: r["Award Amount"], unit: "USD", meta: { award_id: r["Award ID"], recipient: r["Recipient Name"], agency: r["Awarding Agency"], sub_agency: r["Awarding Sub Agency"], end: r["End Date"], ...tieMeta(r, tie, f) }, source: "USAspending.gov", source_url: `https://www.usaspending.gov/award/${r.generated_internal_id}` });
      }
    }
    // Newest obligations (new awards, task orders, modifications ≥ $1M) in the last 18 months, so the
    // feed reflects what was actually awarded recently, not just the biggest historic contracts.
    const since = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10);
    for (let page = 1; page <= 3; page++) {
      const tx = await post("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", { filters: { ...filters, time_period: [{ start_date: since, end_date: today }] }, fields: ["Award ID", "Mod", "Recipient Name", "Recipient UEI", "recipient_id", "Action Date", "Transaction Amount", "Awarding Agency", "Awarding Sub Agency", "Transaction Description", "generated_internal_id", "internal_id"], limit: 100, page, sort: "Action Date", order: "desc" });
      if (!tx) complete = false;
      if (!tx || ignoredFilter(tx.messages, "recipient_id")) break;
      for (const r of tx.results ?? []) {
        if (!(r["Transaction Amount"] >= 1e6)) continue;
        const tie = awardTie({ recipient: r["Recipient Name"], recipientId: r.recipient_id, uei: r["Recipient UEI"] }, families, keys);
        if (!tie) continue;
        const mod = String(r.Mod ?? "0");
        out.push({ uid: `usatx:${c.ticker}:${r.internal_id}`, ticker: c.ticker, dataset: "contracts", kind: "event", date: iso(r["Action Date"]), title: `${r["Awarding Sub Agency"] ?? r["Awarding Agency"]}: ${(r["Transaction Description"] ?? "Contract action").slice(0, 140)}`, value: r["Transaction Amount"], unit: "USD", meta: { award_id: r["Award ID"], mod, action: mod === "0" ? "new award" : "modification", recipient: r["Recipient Name"], agency: r["Awarding Agency"], sub_agency: r["Awarding Sub Agency"], ...tieMeta(r, tie, f) }, source: "USAspending.gov", source_url: `https://www.usaspending.gov/award/${r.generated_internal_id}` });
      }
      if (!tx.page_metadata?.hasNext) break;
    }
  }
  // Totals summed over the parents are whole only when every parent answered: a missing parent would
  // write a partial year over a complete stored one.
  if (totalsOk) for (const [y, v] of fy) {
    const p = fiscalYearPeriod(y, now);
    out.push({ uid: `usa:${c.ticker}:fy${y}`, ticker: c.ticker, dataset: "contracts", kind: "series", date: p.date, title: "Federal contract obligations", value: v, unit: "USD", meta: { fiscal_year: y, ytd: p.ytd, period_start: p.period_start, period_end: p.period_end, as_of: asOf, recipients: parents.map((r) => r.name), recipient_ueis: parents.map((r) => r.uei ?? null) }, source: "USAspending.gov", source_url: `https://www.usaspending.gov/recipient/${parents[0].id}/latest` });
  }
  if (complete) out.push(refreshRow(c.ticker, families, asOf));
  return out;
}

/** The refresh record of one completed collection (src/lib/alt/contracts.ts `RefreshMeta`). */
export function refreshRow(ticker: string, families: ParentFamily[], asOf: string): Row {
  const family = [...new Set(families.flatMap((f) => [f.parent.name, ...f.children.map((k) => k.name ?? "")]).filter(Boolean))].slice(0, 2000);
  const meta: RefreshMeta = { refresh: true, rule: CONTRACTS_RULE, as_of: asOf, parents: families.map((f) => ({ name: f.parent.name, id: f.parent.id, uei: f.parent.uei ?? null })), family };
  const first = families[0]?.parent;
  return { uid: `usarun:${ticker}`, ticker, dataset: REFRESH_DATASET, kind: "event", date: null, title: "Federal contracts collection", value: families.length, unit: "parents", meta: meta as unknown as Record<string, unknown>, source: "USAspending.gov", source_url: first ? `https://www.usaspending.gov/recipient/${first.id}/latest` : "https://www.usaspending.gov/search" };
}

// ───────── Federal Register: rules, proposed rules, notices naming the company ─────────
async function regulatory(c: Co): Promise<Row[]> {
  const term = encodeURIComponent(`"${searchName(c)}"`);
  const out: Row[] = [];
  const y = await get(`https://www.federalregister.gov/api/v1/documents/facets/yearly?conditions%5Bterm%5D=${term}`);
  const now = new Date();
  for (const [k, v] of Object.entries<any>(y ?? {})) {
    const year = Number(k.slice(0, 4));
    const p = calendarYearPeriod(year, now);
    out.push({ uid: `fr:${c.ticker}:y${year}`, ticker: c.ticker, dataset: "regulatory", kind: "series", date: p.date, title: "Federal Register documents naming the company", value: v.count, unit: "docs", meta: { year, ytd: p.ytd, period_start: p.period_start, period_end: p.period_end, as_of: now.toISOString() }, source: "Federal Register", source_url: `https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=${term}` });
  }
  for (const type of ["RULE", "PRORULE", "NOTICE"]) {
    const j = await get(`https://www.federalregister.gov/api/v1/documents.json?per_page=40&order=newest&conditions%5Bterm%5D=${term}&conditions%5Btype%5D%5B%5D=${type}&fields%5B%5D=title&fields%5B%5D=publication_date&fields%5B%5D=html_url&fields%5B%5D=document_number&fields%5B%5D=agencies&fields%5B%5D=type&fields%5B%5D=abstract`);
    for (const d of j?.results ?? []) out.push({ uid: `fr:${c.ticker}:${d.document_number}`, ticker: c.ticker, dataset: "regulatory", kind: "event", date: d.publication_date, title: d.title.slice(0, 300), meta: { type: d.type, agencies: (d.agencies ?? []).map((a: any) => a.name).filter(Boolean), abstract: d.abstract?.slice(0, 600) }, source: "Federal Register", source_url: d.html_url });
  }
  return out;
}

// ───────── openFDA: drug & device recalls, drug approvals ─────────
async function fda(c: Co): Promise<Row[]> {
  if (!appliesTo("fda", c, c.reg)) return [];
  const firm = encodeURIComponent(`"${nm(c)}"`);
  const out: Row[] = [];
  const ours = isFirm(c);
  for (const [kind, path] of [["drug recall", "drug/enforcement"], ["device recall", "device/recall"], ["food recall", "food/enforcement"]] as const) {
    for (let skip = 0; skip < 3000; skip += 1000) {
      // a phrase search: "Coca-Cola" also returns independent bottlers, "Target" returns Boston Scientific Target
      const j = await get(`https://api.fda.gov/${path}.json?search=recalling_firm:${firm}&limit=1000&skip=${skip}`).catch(() => null);
      const rs = j?.results ?? [];
      for (const r of rs) {
        if (!ours(r.recalling_firm)) continue;
        const id = r.recall_number ?? r.res_event_number ?? r.cfres_id;
        out.push({ uid: `fda:${c.ticker}:${path}:${id}`, ticker: c.ticker, dataset: "fda", kind: "event", date: iso(r.recall_initiation_date ?? r.event_date_initiated ?? r.report_date), title: `${kind}: ${(r.product_description ?? r.product_description ?? "").slice(0, 160)}`, meta: { kind, class: r.classification ?? r.root_cause_description, reason: (r.reason_for_recall ?? r.reason_for_recall ?? "").slice(0, 400), status: r.status ?? r.recall_status, firm: r.recalling_firm, quantity: r.product_quantity }, source: "openFDA", source_url: path === "device/recall" && r.cfres_id ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=${r.cfres_id}` : `https://api.fda.gov/${path}.json?search=recall_number:${id}` });
      }
      if (rs.length < 1000) break;
    }
  }
  const sponsor = encodeURIComponent(`"${nm(c).toUpperCase()}"`);
  const d = await get(`https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:${sponsor}&limit=500`).catch(() => null);
  for (const app of d?.results ?? []) for (const s of app.submissions ?? []) {
    if (!ours(app.sponsor_name)) continue;
    if (s.submission_status !== "AP" || !["ORIG", "SUPPL"].includes(s.submission_type) || (s.submission_type === "SUPPL" && s.submission_class_code !== "EFFICACY")) continue;
    const brand = app.products?.[0]?.brand_name ?? app.openfda?.brand_name?.[0] ?? app.application_number;
    out.push({ uid: `fda:${c.ticker}:${app.application_number}:${s.submission_type}${s.submission_number}`, ticker: c.ticker, dataset: "fda", kind: "event", date: iso(s.submission_status_date), title: `${s.submission_type === "ORIG" ? "New approval" : "New indication"}: ${brand}`, meta: { kind: "approval", application: app.application_number, priority: s.review_priority, sponsor: app.sponsor_name }, source: "openFDA Drugs@FDA", source_url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${app.application_number.replace(/\D/g, "")}` });
  }
  return out;
}

// ───────── NHTSA vehicle/equipment recalls ─────────
async function recalls(c: Co): Promise<Row[]> {
  const m = VEHICLE[c.ticker] ?? c.reg?.maker; if (!m) return [];
  const j = await get(`https://data.transportation.gov/resource/6axg-epim.json?$where=${encodeURIComponent(`upper(manufacturer) like '%${m}%'`)}&$limit=5000&$order=report_received_date DESC`);
  // `like '%ITT%'` also returns "Pitts Enterprises" and "LITTELFUSE INC.": keep the company's own campaigns
  const ours = isFirm(c);
  return (j ?? []).filter((r: { manufacturer?: string }) => ours(r.manufacturer)).map((r: any) => ({ uid: `nhtsa:${c.ticker}:${r.nhtsa_id}`, ticker: c.ticker, dataset: "recalls", kind: "event" as const, date: iso(r.report_received_date), title: r.subject ?? r.component ?? "Recall", value: r.potentially_affected ? Number(r.potentially_affected) : null, unit: "units", meta: { manufacturer: r.manufacturer, component: r.component, type: r.recall_type, summary: r.defect_summary?.slice(0, 500), consequence: r.consequence_summary?.slice(0, 300) }, source: "NHTSA", source_url: r.recall_link?.url ?? `https://www.nhtsa.gov/recalls?nhtsaId=${r.nhtsa_id}` }));
}

// ───────── CFPB consumer complaints (yearly counts + product mix) ─────────
async function complaints(c: Co): Promise<Row[]> {
  const co = CFPB[c.ticker] ?? c.reg?.cfpb; if (!co) return [];
  const base = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?company=${encodeURIComponent(co)}&size=0`;
  const out: Row[] = [];
  const now = new Date().getFullYear();
  // The scheduled refresh counts this year only, without the (slow) product breakdown; the job keeps
  // the stored breakdown, and the script refreshes it.
  for (let y = altFetch.recent ? now : 2012; y <= now; y++) {
    const j = await get(`${base}&date_received_min=${y}-01-01&date_received_max=${y}-12-31${altFetch.recent ? "&no_aggs=true" : ""}`);
    const n = j?.hits?.total?.value; if (!n) continue;
    const products = j.aggregations ? (j.aggregations.product?.product?.buckets ?? []).slice(0, 6).map((b: any) => ({ product: b.key, n: b.doc_count })) : undefined;
    const p = calendarYearPeriod(y, new Date());
    out.push({ uid: `cfpb:${c.ticker}:${y}`, ticker: c.ticker, dataset: "complaints", kind: "series", date: p.date, title: "CFPB consumer complaints", value: n, unit: "complaints", meta: { year: y, products, ytd: p.ytd, period_start: p.period_start, period_end: p.period_end, as_of: new Date().toISOString() }, source: "CFPB Consumer Complaint Database", source_url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(co)}&date_received_min=${y}-01-01&date_received_max=${y}-12-31` });
    await sleep(200);
  }
  return out;
}

// ───────── FDIC call reports for the main bank subsidiary ─────────
const FDIC_FIELDS: Record<string, [string, string]> = { ASSET: ["Total assets", "USD_K"], DEP: ["Total deposits", "USD_K"], DEPUNINA: ["Uninsured deposits (est.)", "USD_K"], LNLSNET: ["Net loans & leases", "USD_K"], NETINC: ["Net income (YTD)", "USD_K"], NIMY: ["Net interest margin", "%"], ROA: ["Return on assets", "%"], NTLNLSR: ["Net charge-off rate", "%"], RBCT1CER: ["CET1 ratio", "%"], NCLNLSR: ["Noncurrent loans / loans", "%"] };
async function bank(c: Co): Promise<Row[]> {
  const cert = FDIC[c.ticker] ?? c.reg?.fdic; if (!cert) return [];
  const j = await get(`https://api.fdic.gov/banks/financials?filters=CERT:${cert}&fields=REPDTE,${Object.keys(FDIC_FIELDS).join(",")}&sort_by=REPDTE&sort_order=DESC&limit=200`);
  const out: Row[] = [];
  for (const { data: d } of j?.data ?? []) for (const [f, [label, unit]] of Object.entries(FDIC_FIELDS)) {
    if (d[f] == null || (d[f] === 0 && FDIC_ZERO_IS_MISSING.has(f))) continue;
    out.push({ uid: `fdic:${c.ticker}:${f}:${d.REPDTE}`, ticker: c.ticker, dataset: "bank", kind: "series", date: iso(d.REPDTE), title: label, value: unit === "USD_K" ? d[f] * 1000 : d[f], unit: unit === "USD_K" ? "USD" : unit, meta: { field: f, cert }, source: "FDIC call reports", source_url: `https://banks.data.fdic.gov/bankfind-suite/bankfind/details/${cert}` });
  }
  return out;
}

// ───────── Wikipedia pageviews (public-attention proxy) ─────────
async function attention(c: Co): Promise<Row[]> {
  const a = WIKI[c.ticker] ?? c.reg?.wiki; if (!a) return [];
  const end = new Date(); const e = `${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, "0")}0100`;
  const j = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${a}/monthly/2015070100/${e}`);
  // the API also returns the month in progress (a few days of views) — keep finished months only
  return (j?.items ?? []).filter((r: any) => r.timestamp.slice(0, 6) < e.slice(0, 6)).map((r: any) => ({ uid: `wiki:${c.ticker}:${r.timestamp.slice(0, 6)}`, ticker: c.ticker, dataset: "attention", kind: "series" as const, date: `${r.timestamp.slice(0, 4)}-${r.timestamp.slice(4, 6)}-01`, title: "Wikipedia pageviews", value: r.views, unit: "views", meta: { article: decodeURIComponent(a) }, source: "Wikimedia pageviews", source_url: `https://pageviews.wmcloud.org/?pages=${a}&range=all-time` }));
}

// ───────── SEC: capital-markets activity (shelf registrations, takedowns, tender offers, buyback/exchange) ─────────

async function capital(c: Co): Promise<Row[]> {
  const head = await get(`https://data.sec.gov/submissions/CIK${cik10(c)}.json`);
  if (!head) return [];
  // Older submission files too, so heavy filers have a real multi-year baseline.
  const blocks = [head.filings.recent];
  for (const f of head.filings.files ?? []) { const x = await get(`https://data.sec.gov/submissions/${f.name}`); if (x) blocks.push(x); await sleep(120); }
  const out: Row[] = [];
  const allForms = blocks.flatMap((b) => b.form as string[]);
  const routineNotes = new Set(["424B2", "424B3"].filter((x) => allForms.filter((f) => f === x).length > 100));
  for (const b of blocks) {
  for (let i = 0; i < b.accessionNumber.length; i++) {
    if (routineNotes.has(b.form[i])) continue;
    const hit = CAPITAL.find(([re]) => re.test(b.form[i])); if (!hit) continue;
    out.push({ uid: `cap:${c.ticker}:${b.accessionNumber[i]}`, ticker: c.ticker, dataset: "capital", kind: "event", date: b.filingDate[i], title: hit[2], meta: { form: b.form[i], category: hit[1], description: b.primaryDocDescription?.[i] || null }, source: "SEC EDGAR", source_url: edgarUrl(c, b.accessionNumber[i], b.primaryDocument[i] || undefined) });
  }
  }
  return out;
}

// ───────── ClinicalTrials.gov: trials the company sponsors (healthcare only) ─────────
async function trials(c: Co): Promise<Row[]> {
  if (!appliesTo("trials", c, c.reg)) return [];
  const name = nm(c); const ours = isFirm(c);
  const out: Row[] = []; let token = "";
  for (let p = 0; p < 5; p++) {
    const j = await get(`https://clinicaltrials.gov/api/v2/studies?query.lead=${encodeURIComponent(name)}&sort=LastUpdatePostDate:desc&pageSize=200&fields=NCTId,BriefTitle,OverallStatus,Phase,LastUpdatePostDate,StartDate,PrimaryCompletionDate,LeadSponsorName,Condition,EnrollmentCount${token ? `&pageToken=${token}` : ""}`).catch(() => null);
    for (const st of j?.studies ?? []) {
      const ps = st.protocolSection; const sponsor = ps.sponsorCollaboratorsModule?.leadSponsor?.name ?? "";
      if (!ours(sponsor)) continue; // lead sponsor must be the company itself ("Merck KGaA" is not Merck & Co.)
      const id = ps.identificationModule.nctId; const s = ps.statusModule;
      out.push({ uid: `ct:${c.ticker}:${id}`, ticker: c.ticker, dataset: "trials", kind: "event", date: iso(s.lastUpdatePostDateStruct?.date), title: ps.identificationModule.briefTitle.slice(0, 240), value: ps.designModule?.enrollmentInfo?.count ?? null, unit: "patients", meta: { nct: id, status: s.overallStatus, phase: (ps.designModule?.phases ?? []).join("/"), start: s.startDateStruct?.date, primary_completion: s.primaryCompletionDateStruct?.date, conditions: (ps.conditionsModule?.conditions ?? []).slice(0, 4), sponsor }, source: "ClinicalTrials.gov", source_url: `https://clinicaltrials.gov/study/${id}` });
    }
    token = j?.nextPageToken; if (!token) break;
  }
  return out;
}

// ───────── CPSC consumer-product recalls naming the company ─────────
async function consumer(c: Co): Promise<Row[]> {
  const name = searchName(c); const ours = isFirm(c);
  const j = await get(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallTitle=${encodeURIComponent(name)}`).catch(() => null);
  const out: Row[] = [];
  for (const r of j ?? []) {
    // the title search is a word match: "Caterpillar Pull Toys" and "Red Apple Fireworks" are not the company's
    const role = cpscRole(r, ours, nm(c));
    if (!role) continue;
    const firms = [...(r.Manufacturers ?? []), ...(r.Importers ?? []), ...(r.Distributors ?? [])].map((x: any) => cpscFirmName(x.Name ?? "")).filter(Boolean).slice(0, 6);
    const units = Number(String(r.Products?.[0]?.NumberOfUnits ?? "").replace(/[^\d]/g, "")) || null;
    out.push({ uid: `cpsc:${c.ticker}:${r.RecallNumber}`, ticker: c.ticker, dataset: "consumer", kind: "event", date: iso(r.RecallDate), title: r.Title?.slice(0, 240) ?? "Recall", value: units, unit: "units", meta: { role, firms, product: r.Products?.[0]?.Name, hazard: r.Hazards?.[0]?.Name?.slice(0, 400), remedy: r.Remedies?.[0]?.Name?.slice(0, 300) }, source: "CPSC", source_url: r.URL });
  }
  return out;
}

export const ADAPTERS: Record<string, (c: Co) => Promise<Row[]>> = { ownership, events, contracts, regulatory, fda, recalls, complaints, bank, attention, capital, trials, consumer };

export const ALT_SETS = Object.keys(ADAPTERS);
/** Hand-checked registry names; the generated registry fills in every other company. */
export function staticRegistry(ticker: string): AltRegistryEntry {
  const e: AltRegistryEntry = {};
  if (WIKI[ticker]) e.wiki = WIKI[ticker];
  if (FDIC[ticker]) e.fdic = FDIC[ticker];
  if (CFPB[ticker]) e.cfpb = CFPB[ticker];
  if (VEHICLE[ticker]) e.maker = VEHICLE[ticker];
  return e;
}
export function altRowsForDb(rows: Row[]) {
  return [...new Map(rows.map((r) => [r.uid, r])).values()].map((r) => ({ ...r, meta: r.meta ?? {} }));
}
