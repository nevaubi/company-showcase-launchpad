// Public alt-data collectors shared by `scripts/alt-data.ts` (bulk) and the scheduled `alt-data` job.
// Every row keeps a link back to the exact public record it came from. Pure fetch, no Node APIs.
import { CAPITAL, ITEMS } from "@/lib/alt/sec-forms";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Per-request timeout and retries; the scheduled job lowers both to fit its run budget. */
export const altFetch = { timeoutMs: 45_000, tries: 4 };
const UA = "FiledUnder Research research@filedunder.ai";
export interface Co { ticker: string; name: string; cik: string; sector: string; industry: string }
export type Row = { uid: string; ticker: string; dataset: string; kind: "event" | "series"; date: string | null; title: string; value?: number | null; unit?: string | null; meta?: Record<string, unknown>; source: string; source_url?: string | null };


// Names as they appear in each public registry (defaults to a cleaned SEC name).
const NAME: Record<string, string> = { AAPL: "Apple", MSFT: "Microsoft", NVDA: "NVIDIA", AMZN: "Amazon", GOOGL: "Google", META: "Meta Platforms", AVGO: "Broadcom", AMD: "Advanced Micro Devices", JPM: "JPMorgan Chase", BAC: "Bank of America", GS: "Goldman Sachs", V: "Visa", MA: "Mastercard", LLY: "Eli Lilly", UNH: "UnitedHealth", JNJ: "Johnson & Johnson", MRK: "Merck", WMT: "Walmart", COST: "Costco", XOM: "Exxon Mobil", CVX: "Chevron", CAT: "Caterpillar", HD: "Home Depot", CRM: "Salesforce", NOW: "ServiceNow", CSCO: "Cisco", IBM: "International Business Machines", INTC: "Intel", QCOM: "Qualcomm", TXN: "Texas Instruments", MU: "Micron Technology", NFLX: "Netflix", DIS: "Walt Disney", CMCSA: "Comcast", T: "AT&T", VZ: "Verizon", LOW: "Lowe's", MCD: "McDonald's", SBUX: "Starbucks", NKE: "Nike", BKNG: "Booking Holdings", PG: "Procter & Gamble", KO: "Coca-Cola", PEP: "PepsiCo", PM: "Philip Morris", WFC: "Wells Fargo", C: "Citigroup", MS: "Morgan Stanley", SCHW: "Charles Schwab", AXP: "American Express", SPGI: "S&P Global", ABBV: "AbbVie", PFE: "Pfizer", AMGN: "Amgen", TMO: "Thermo Fisher", ABT: "Abbott Laboratories", ISRG: "Intuitive Surgical", GE: "General Electric", RTX: "Raytheon", BA: "Boeing", LMT: "Lockheed Martin", HON: "Honeywell", DE: "Deere", UNP: "Union Pacific", UPS: "United Parcel Service", COP: "ConocoPhillips", SLB: "Schlumberger", LIN: "Linde", FCX: "Freeport-McMoRan", NEE: "NextEra Energy", DUK: "Duke Energy", SO: "Southern Company", PLD: "Prologis", AMT: "American Tower", EQIX: "Equinix", TSLA: "Tesla", ORCL: "Oracle", ADBE: "Adobe" };
const WIKI: Record<string, string> = { AAPL: "Apple_Inc.", MSFT: "Microsoft", NVDA: "Nvidia", AMZN: "Amazon_(company)", GOOGL: "Alphabet_Inc.", TSLA: "Tesla,_Inc.", META: "Meta_Platforms", AVGO: "Broadcom", AMD: "AMD", ORCL: "Oracle_Corporation", JPM: "JPMorgan_Chase", BAC: "Bank_of_America", GS: "Goldman_Sachs", V: "Visa_Inc.", MA: "Mastercard", LLY: "Eli_Lilly_and_Company", UNH: "UnitedHealth_Group", JNJ: "Johnson_%26_Johnson", MRK: "Merck_%26_Co.", WMT: "Walmart", COST: "Costco", XOM: "ExxonMobil", CVX: "Chevron_Corporation", CAT: "Caterpillar_Inc.", HD: "The_Home_Depot", CRM: "Salesforce", ADBE: "Adobe_Inc.", NOW: "ServiceNow", CSCO: "Cisco", IBM: "IBM", INTC: "Intel", QCOM: "Qualcomm", TXN: "Texas_Instruments", MU: "Micron_Technology", NFLX: "Netflix", DIS: "The_Walt_Disney_Company", CMCSA: "Comcast", T: "AT%26T", VZ: "Verizon", LOW: "Lowe%27s", MCD: "McDonald%27s", SBUX: "Starbucks", NKE: "Nike,_Inc.", BKNG: "Booking_Holdings", PG: "Procter_%26_Gamble", KO: "The_Coca-Cola_Company", PEP: "PepsiCo", PM: "Philip_Morris_International", WFC: "Wells_Fargo", C: "Citigroup", MS: "Morgan_Stanley", SCHW: "Charles_Schwab_Corporation", AXP: "American_Express", SPGI: "S%26P_Global", ABBV: "AbbVie", PFE: "Pfizer", AMGN: "Amgen", TMO: "Thermo_Fisher_Scientific", ABT: "Abbott_Laboratories", ISRG: "Intuitive_Surgical", GE: "GE_Aerospace", RTX: "RTX_Corporation", BA: "Boeing", LMT: "Lockheed_Martin", HON: "Honeywell", DE: "John_Deere", UNP: "Union_Pacific_Railroad", UPS: "United_Parcel_Service", COP: "ConocoPhillips", SLB: "SLB_(company)", LIN: "Linde_plc", FCX: "Freeport-McMoRan", NEE: "NextEra_Energy", DUK: "Duke_Energy", SO: "Southern_Company", PLD: "Prologis", AMT: "American_Tower", EQIX: "Equinix" };
// FDIC certificate of each company's main insured bank.
const FDIC: Record<string, number> = { JPM: 628, BAC: 3510, WFC: 3511, C: 7213, GS: 33124, MS: 32992, SCHW: 57450, AXP: 27471 };
// CFPB complaint-database company names.
const CFPB: Record<string, string> = { JPM: "JPMORGAN CHASE & CO.", BAC: "BANK OF AMERICA, NATIONAL ASSOCIATION", WFC: "WELLS FARGO & COMPANY", C: "CITIBANK, N.A.", GS: "GOLDMAN SACHS BANK USA", MS: "Morgan Stanley", SCHW: "Charles Schwab Corporation, The", AXP: "AMERICAN EXPRESS COMPANY", V: "VISA, INC.", MA: "MASTERCARD INTERNATIONAL INCORPORATED", AMZN: "Amazon.com, Inc.", AAPL: "Apple Inc.", T: "AT&T Inc.", VZ: "Verizon Communications Inc.", CMCSA: "Comcast Corporation" };
const VEHICLE: Record<string, string> = { TSLA: "TESLA", CAT: "CATERPILLAR", DE: "DEERE", HON: "HONEYWELL", GE: "GENERAL ELECTRIC" };

const nm = (c: Co) => NAME[c.ticker] ?? c.name.replace(/\s*\/\w+\/?$/, "").replace(/,?\s+(INC|CORP|CO|LTD|PLC)\.?$/i, "");

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
// Recipients are resolved to parent-level ids whose name starts with the company name, so
// substring look-alikes ("COSTCONTROL", "PASSPORT VISA") never leak in.
const post = (url: string, body: unknown) => get(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function contracts(c: Co): Promise<Row[]> {
  const name = nm(c).toUpperCase().replace(/[’']/g, "'");
  const re = new RegExp(`^(THE )?${name.replace(/[.*+?^${}()|[\]\\&]/g, (m) => (m === "&" ? "(&|AND)" : `\\${m}`))}\\b`, "i");
  const list = await post("https://api.usaspending.gov/api/v2/recipient/", { keyword: name, limit: 100, award_type: "contracts" });
  const ids = (list?.results ?? []).filter((r: any) => r.recipient_level === "P" && re.test(r.name) && r.amount > 0).sort((a: any, b: any) => b.amount - a.amount).slice(0, 4);
  if (!ids.length) return [];
  const out: Row[] = [];
  const fy = new Map<number, number>();
  const today = new Date().toISOString().slice(0, 10);
  for (const rec of ids) {
    const filters = { recipient_id: rec.id, award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: "2007-10-01", end_date: today }] };
    const t = await post("https://api.usaspending.gov/api/v2/search/spending_over_time/", { group: "fiscal_year", filters });
    for (const r of t?.results ?? []) if (r.aggregated_amount) fy.set(Number(r.time_period.fiscal_year), (fy.get(Number(r.time_period.fiscal_year)) ?? 0) + r.aggregated_amount);
    const recent = { ...filters, time_period: [{ start_date: `${new Date().getFullYear() - 5}-01-01`, end_date: today }] };
    const a = await post("https://api.usaspending.gov/api/v2/search/spending_by_award/", { filters: recent, fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Awarding Sub Agency", "Start Date", "End Date", "Description", "generated_internal_id"], limit: 40, sort: "Award Amount", order: "desc" });
    // Newest obligations (new awards, task orders, modifications ≥ $1M) in the last 18 months, so the
    // feed reflects what was actually awarded recently — not just the biggest historic contracts.
    const since = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10);
    for (let page = 1; page <= 3; page++) {
      const tx = await post("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", { filters: { ...filters, time_period: [{ start_date: since, end_date: today }] }, fields: ["Award ID", "Mod", "Recipient Name", "Action Date", "Transaction Amount", "Awarding Agency", "Awarding Sub Agency", "Transaction Description", "generated_internal_id", "internal_id"], limit: 100, page, sort: "Action Date", order: "desc" });
      const res = tx?.results ?? [];
      for (const r of res) {
        if (!(r["Transaction Amount"] >= 1e6)) continue;
        const mod = String(r.Mod ?? "0");
        out.push({ uid: `usatx:${c.ticker}:${r.internal_id}`, ticker: c.ticker, dataset: "contracts", kind: "event", date: iso(r["Action Date"]), title: `${r["Awarding Sub Agency"] ?? r["Awarding Agency"]}: ${(r["Transaction Description"] ?? "Contract action").slice(0, 140)}`, value: r["Transaction Amount"], unit: "USD", meta: { award_id: r["Award ID"], mod, action: mod === "0" ? "new award" : "modification", recipient: r["Recipient Name"], agency: r["Awarding Agency"], sub_agency: r["Awarding Sub Agency"] }, source: "USAspending.gov", source_url: `https://www.usaspending.gov/award/${r.generated_internal_id}` });
      }
      if (!tx?.page_metadata?.hasNext) break;
    }
    for (const r of a?.results ?? []) out.push({ uid: `usa:${c.ticker}:${r.generated_internal_id}`, ticker: c.ticker, dataset: "contracts", kind: "event", date: r["Start Date"], title: `${r["Awarding Agency"]}: ${(r.Description ?? "Contract award").slice(0, 140)}`, value: r["Award Amount"], unit: "USD", meta: { award_id: r["Award ID"], recipient: r["Recipient Name"], agency: r["Awarding Agency"], sub_agency: r["Awarding Sub Agency"], end: r["End Date"] }, source: "USAspending.gov", source_url: `https://www.usaspending.gov/award/${r.generated_internal_id}` });
  }
  const curFy = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  for (const [y, v] of fy) out.push({ uid: `usa:${c.ticker}:fy${y}`, ticker: c.ticker, dataset: "contracts", kind: "series", date: `${y}-09-30`, title: "Federal contract obligations", value: v, unit: "USD", meta: { fiscal_year: y, ytd: y >= curFy, recipients: ids.map((r: any) => r.name) }, source: "USAspending.gov", source_url: `https://www.usaspending.gov/recipient/${ids[0].id}/latest` });
  return out;
}

// ───────── Federal Register: rules, proposed rules, notices naming the company ─────────
async function regulatory(c: Co): Promise<Row[]> {
  const term = encodeURIComponent(`"${nm(c)}"`);
  const out: Row[] = [];
  const y = await get(`https://www.federalregister.gov/api/v1/documents/facets/yearly?conditions%5Bterm%5D=${term}`);
  for (const [k, v] of Object.entries<any>(y ?? {})) out.push({ uid: `fr:${c.ticker}:y${k.slice(0, 4)}`, ticker: c.ticker, dataset: "regulatory", kind: "series", date: `${k.slice(0, 4)}-12-31`, title: "Federal Register documents naming the company", value: v.count, unit: "docs", source: "Federal Register", source_url: `https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=${term}` });
  for (const type of ["RULE", "PRORULE", "NOTICE"]) {
    const j = await get(`https://www.federalregister.gov/api/v1/documents.json?per_page=40&order=newest&conditions%5Bterm%5D=${term}&conditions%5Btype%5D%5B%5D=${type}&fields%5B%5D=title&fields%5B%5D=publication_date&fields%5B%5D=html_url&fields%5B%5D=document_number&fields%5B%5D=agencies&fields%5B%5D=type&fields%5B%5D=abstract`);
    for (const d of j?.results ?? []) out.push({ uid: `fr:${c.ticker}:${d.document_number}`, ticker: c.ticker, dataset: "regulatory", kind: "event", date: d.publication_date, title: d.title.slice(0, 300), meta: { type: d.type, agencies: (d.agencies ?? []).map((a: any) => a.name).filter(Boolean), abstract: d.abstract?.slice(0, 600) }, source: "Federal Register", source_url: d.html_url });
  }
  return out;
}

// ───────── openFDA: drug & device recalls, drug approvals ─────────
async function fda(c: Co): Promise<Row[]> {
  if (!/Health|Pharma|Bio|Life Sci/i.test(c.sector + c.industry) && !["PG", "KO", "PEP", "PM", "HON", "GE"].includes(c.ticker)) return [];
  const firm = encodeURIComponent(`"${nm(c)}"`);
  const out: Row[] = [];
  for (const [kind, path] of [["drug recall", "drug/enforcement"], ["device recall", "device/recall"], ["food recall", "food/enforcement"]] as const) {
    const field = path === "device/recall" ? "recalling_firm" : "recalling_firm";
    for (let skip = 0; skip < 3000; skip += 1000) {
      const j = await get(`https://api.fda.gov/${path}.json?search=${field}:${firm}&limit=1000&skip=${skip}`).catch(() => null);
      const rs = j?.results ?? [];
      for (const r of rs) {
        const id = r.recall_number ?? r.res_event_number ?? r.cfres_id;
        out.push({ uid: `fda:${c.ticker}:${path}:${id}`, ticker: c.ticker, dataset: "fda", kind: "event", date: iso(r.recall_initiation_date ?? r.event_date_initiated ?? r.report_date), title: `${kind}: ${(r.product_description ?? r.product_description ?? "").slice(0, 160)}`, meta: { kind, class: r.classification ?? r.root_cause_description, reason: (r.reason_for_recall ?? r.reason_for_recall ?? "").slice(0, 400), status: r.status ?? r.recall_status, firm: r.recalling_firm, quantity: r.product_quantity }, source: "openFDA", source_url: path === "device/recall" && r.cfres_id ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=${r.cfres_id}` : `https://api.fda.gov/${path}.json?search=recall_number:${id}` });
      }
      if (rs.length < 1000) break;
    }
  }
  const sponsor = encodeURIComponent(`"${nm(c).toUpperCase()}"`);
  const d = await get(`https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:${sponsor}&limit=500`).catch(() => null);
  for (const app of d?.results ?? []) for (const s of app.submissions ?? []) {
    if (s.submission_status !== "AP" || !["ORIG", "SUPPL"].includes(s.submission_type) || (s.submission_type === "SUPPL" && s.submission_class_code !== "EFFICACY")) continue;
    const brand = app.products?.[0]?.brand_name ?? app.openfda?.brand_name?.[0] ?? app.application_number;
    out.push({ uid: `fda:${c.ticker}:${app.application_number}:${s.submission_type}${s.submission_number}`, ticker: c.ticker, dataset: "fda", kind: "event", date: iso(s.submission_status_date), title: `${s.submission_type === "ORIG" ? "New approval" : "New indication"}: ${brand}`, meta: { kind: "approval", application: app.application_number, priority: s.review_priority, sponsor: app.sponsor_name }, source: "openFDA Drugs@FDA", source_url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${app.application_number.replace(/\D/g, "")}` });
  }
  return out;
}

// ───────── NHTSA vehicle/equipment recalls ─────────
async function recalls(c: Co): Promise<Row[]> {
  const m = VEHICLE[c.ticker]; if (!m) return [];
  const j = await get(`https://data.transportation.gov/resource/6axg-epim.json?$where=${encodeURIComponent(`upper(manufacturer) like '%${m}%'`)}&$limit=5000&$order=report_received_date DESC`);
  return (j ?? []).map((r: any) => ({ uid: `nhtsa:${c.ticker}:${r.nhtsa_id}`, ticker: c.ticker, dataset: "recalls", kind: "event" as const, date: iso(r.report_received_date), title: r.subject ?? r.component ?? "Recall", value: r.potentially_affected ? Number(r.potentially_affected) : null, unit: "units", meta: { component: r.component, type: r.recall_type, summary: r.defect_summary?.slice(0, 500), consequence: r.consequence_summary?.slice(0, 300) }, source: "NHTSA", source_url: r.recall_link?.url ?? `https://www.nhtsa.gov/recalls?nhtsaId=${r.nhtsa_id}` }));
}

// ───────── CFPB consumer complaints (yearly counts + product mix) ─────────
async function complaints(c: Co): Promise<Row[]> {
  const co = CFPB[c.ticker]; if (!co) return [];
  const base = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?company=${encodeURIComponent(co)}&size=0`;
  const out: Row[] = [];
  const now = new Date().getFullYear();
  for (let y = 2012; y <= now; y++) {
    const j = await get(`${base}&date_received_min=${y}-01-01&date_received_max=${y}-12-31`);
    const n = j?.hits?.total?.value; if (!n) continue;
    const products = (j.aggregations?.product?.product?.buckets ?? []).slice(0, 6).map((b: any) => ({ product: b.key, n: b.doc_count }));
    out.push({ uid: `cfpb:${c.ticker}:${y}`, ticker: c.ticker, dataset: "complaints", kind: "series", date: `${y}-12-31`, title: "CFPB consumer complaints", value: n, unit: "complaints", meta: { year: y, products, ytd: y === now }, source: "CFPB Consumer Complaint Database", source_url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(co)}&date_received_min=${y}-01-01&date_received_max=${y}-12-31` });
    await sleep(200);
  }
  return out;
}

// ───────── FDIC call reports for the main bank subsidiary ─────────
const FDIC_FIELDS: Record<string, [string, string]> = { ASSET: ["Total assets", "USD_K"], DEP: ["Total deposits", "USD_K"], DEPUNINA: ["Uninsured deposits (est.)", "USD_K"], LNLSNET: ["Net loans & leases", "USD_K"], NETINC: ["Net income (YTD)", "USD_K"], NIMY: ["Net interest margin", "%"], ROA: ["Return on assets", "%"], NTLNLSR: ["Net charge-off rate", "%"], RBCT1CER: ["CET1 ratio", "%"], NCLNLSR: ["Noncurrent loans / loans", "%"] };
async function bank(c: Co): Promise<Row[]> {
  const cert = FDIC[c.ticker]; if (!cert) return [];
  const j = await get(`https://api.fdic.gov/banks/financials?filters=CERT:${cert}&fields=REPDTE,${Object.keys(FDIC_FIELDS).join(",")}&sort_by=REPDTE&sort_order=DESC&limit=200`);
  const out: Row[] = [];
  for (const { data: d } of j?.data ?? []) for (const [f, [label, unit]] of Object.entries(FDIC_FIELDS)) {
    if (d[f] == null) continue;
    out.push({ uid: `fdic:${c.ticker}:${f}:${d.REPDTE}`, ticker: c.ticker, dataset: "bank", kind: "series", date: iso(d.REPDTE), title: label, value: unit === "USD_K" ? d[f] * 1000 : d[f], unit: unit === "USD_K" ? "USD" : unit, meta: { field: f, cert }, source: "FDIC call reports", source_url: `https://banks.data.fdic.gov/bankfind-suite/bankfind/details/${cert}` });
  }
  return out;
}

// ───────── Wikipedia pageviews (public-attention proxy) ─────────
async function attention(c: Co): Promise<Row[]> {
  const a = WIKI[c.ticker]; if (!a) return [];
  const end = new Date(); const e = `${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, "0")}0100`;
  const j = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${a}/monthly/2015070100/${e}`);
  return (j?.items ?? []).map((r: any) => ({ uid: `wiki:${c.ticker}:${r.timestamp.slice(0, 6)}`, ticker: c.ticker, dataset: "attention", kind: "series" as const, date: `${r.timestamp.slice(0, 4)}-${r.timestamp.slice(4, 6)}-01`, title: "Wikipedia pageviews", value: r.views, unit: "views", meta: { article: decodeURIComponent(a) }, source: "Wikimedia pageviews", source_url: `https://pageviews.wmcloud.org/?pages=${a}&range=all-time` }));
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
  if (!/health|pharma|biotech|medical|life sci|drug/i.test(`${c.sector} ${c.industry}`)) return [];
  const name = nm(c); const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const out: Row[] = []; let token = "";
  for (let p = 0; p < 5; p++) {
    const j = await get(`https://clinicaltrials.gov/api/v2/studies?query.lead=${encodeURIComponent(name)}&sort=LastUpdatePostDate:desc&pageSize=200&fields=NCTId,BriefTitle,OverallStatus,Phase,LastUpdatePostDate,StartDate,PrimaryCompletionDate,LeadSponsorName,Condition,EnrollmentCount${token ? `&pageToken=${token}` : ""}`).catch(() => null);
    for (const st of j?.studies ?? []) {
      const ps = st.protocolSection; const sponsor = ps.sponsorCollaboratorsModule?.leadSponsor?.name ?? "";
      if (!re.test(sponsor)) continue; // lead sponsor must be the company itself
      const id = ps.identificationModule.nctId; const s = ps.statusModule;
      out.push({ uid: `ct:${c.ticker}:${id}`, ticker: c.ticker, dataset: "trials", kind: "event", date: iso(s.lastUpdatePostDateStruct?.date), title: ps.identificationModule.briefTitle.slice(0, 240), value: ps.designModule?.enrollmentInfo?.count ?? null, unit: "patients", meta: { nct: id, status: s.overallStatus, phase: (ps.designModule?.phases ?? []).join("/"), start: s.startDateStruct?.date, primary_completion: s.primaryCompletionDateStruct?.date, conditions: (ps.conditionsModule?.conditions ?? []).slice(0, 4), sponsor }, source: "ClinicalTrials.gov", source_url: `https://clinicaltrials.gov/study/${id}` });
    }
    token = j?.nextPageToken; if (!token) break;
  }
  return out;
}

// ───────── CPSC consumer-product recalls naming the company ─────────
async function consumer(c: Co): Promise<Row[]> {
  const name = nm(c); const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const j = await get(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallTitle=${encodeURIComponent(name)}`).catch(() => null);
  const out: Row[] = [];
  for (const r of j ?? []) {
    const who = [...(r.Manufacturers ?? []), ...(r.Importers ?? [])].map((x: any) => x.Name).join(" | ");
    if (!re.test(r.Title ?? "") && !re.test(who)) continue;
    const units = Number(String(r.Products?.[0]?.NumberOfUnits ?? "").replace(/[^\d]/g, "")) || null;
    out.push({ uid: `cpsc:${c.ticker}:${r.RecallNumber}`, ticker: c.ticker, dataset: "consumer", kind: "event", date: iso(r.RecallDate), title: r.Title?.slice(0, 240) ?? "Recall", value: units, unit: "units", meta: { role: re.test(String(r.Title ?? "").split(/\b(Recall|Recalls|Recalled|Reannounces)\b/)[0]) || re.test(who) ? "maker" : "retailer", product: r.Products?.[0]?.Name, hazard: r.Hazards?.[0]?.Name?.slice(0, 400), remedy: r.Remedies?.[0]?.Name?.slice(0, 300) }, source: "CPSC", source_url: r.URL });
  }
  return out;
}

export const ADAPTERS: Record<string, (c: Co) => Promise<Row[]>> = { ownership, events, contracts, regulatory, fda, recalls, complaints, bank, attention, capital, trials, consumer };

export const ALT_SETS = Object.keys(ADAPTERS);
export function altRowsForDb(rows: Row[]) {
  return [...new Map(rows.map((r) => [r.uid, r])).values()].map((r) => ({ ...r, meta: r.meta ?? {} }));
}
