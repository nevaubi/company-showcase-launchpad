// Investor-relations document collector. Downloads and stores (never just links) every
// earnings release, presentation, supplement and data file a company publishes:
//  1. EX-99 exhibits attached to 8-K filings on EDGAR (Items 2.02 results and 7.01 Reg FD)
//  2. Files hosted on the company's IR site, discovered with Firecrawl map
// Each file is kept byte-for-byte in the private `ir-documents` bucket with a sha256.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CoverageCompany } from "@/lib/coverage";
import { classifyIrDocument, irFileExt, IR_FILE_RE } from "@/lib/ir/classify";
import { archiveUrl, fetchSec } from "@/lib/sec.server";

const BUCKET = "ir-documents";
const MAX_BYTES = 45 * 1024 * 1024;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Candidate {
  url: string;
  source: "sec-exhibit" | "ir-site";
  accn?: string;
  exhibit?: string;
  description?: string;
  filed?: string;
  period?: string;
  sec?: boolean;
}

async function store(c: CoverageCompany, k: Candidate): Promise<{ stored: boolean; reason?: string; bytes?: number }> {
  const res = k.sec ? await fetchSec(k.url) : await fetch(k.url, { headers: { "User-Agent": BROWSER_UA, Accept: "*/*" }, redirect: "follow" });
  if (!res.ok) return { stored: false, reason: `HTTP ${res.status}` };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return { stored: false, reason: "too large" };
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  if (!k.sec && /text\/html/.test(contentType) && !/\.html?$/i.test(k.url)) return { stored: false, reason: "not a file" };
  const ext = irFileExt(k.url, contentType);
  const hash = await sha256(buf);
  const path = `${c.ticker}/${k.accn ?? "site"}/${hash.slice(0, 12)}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, new Uint8Array(buf), { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const name = decodeURIComponent(k.url.split("/").pop() ?? "");
  const { kind, title } = classifyIrDocument({ exhibit: k.exhibit, description: k.description, name, ext });
  const { error: e2 } = await supabaseAdmin.from("ir_documents").upsert(
    {
      ticker: c.ticker,
      source: k.source,
      source_url: k.url,
      accn: k.accn ?? null,
      exhibit: k.exhibit ?? null,
      kind,
      title,
      period: k.period ?? null,
      filed: k.filed ?? null,
      content_type: contentType,
      ext,
      bytes: buf.byteLength,
      sha256: hash,
      path,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "source_url" },
  );
  if (e2) throw new Error(e2.message);
  return { stored: true, bytes: buf.byteLength };
}

interface Submissions {
  filings: { recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; reportDate: string[]; items: string[] } };
}

/** EX-99.x exhibits (and attached spreadsheets/PDFs) from results and Reg FD 8-Ks. */
export async function secExhibitCandidates(c: CoverageCompany, sinceDays = 3 * 365): Promise<Candidate[]> {
  const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`)).json()) as Submissions;
  const r = sub.filings.recent;
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const out: Candidate[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== "8-K" || r.filingDate[i] < since || !/2\.02|7\.01/.test(r.items[i] ?? "")) continue;
    out.push({ url: r.accessionNumber[i], source: "sec-exhibit", accn: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] || undefined });
  }
  return out;
}

/** Expand one 8-K into its exhibit files using the filing index table (type + description columns). */
export async function exhibitsOf(c: CoverageCompany, f: Candidate): Promise<Candidate[]> {
  const idx = await (await fetchSec(archiveUrl(c.cik, f.accn!, `${f.accn}-index.htm`))).text();
  const out: Candidate[] = [];
  for (const row of idx.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const href = row[1].match(/href="([^"]+)"/)?.[1];
    if (!href || cells.length < 4) continue;
    const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    const description = strip(cells[1]);
    const type = strip(cells[3]);
    const name = href.split("/").pop()!;
    const isExhibit = /^EX-99/i.test(type);
    const isDataFile = /\.(xlsx?|pdf|pptx?|docx?|jpe?g|png|gif)$/i.test(name) && !/^R\d+\.htm/i.test(name);
    if (!isExhibit && !isDataFile) continue;
    out.push({ ...f, url: archiveUrl(c.cik, f.accn!, name), exhibit: type || undefined, description: description || undefined, sec: true });
  }
  return out;
}

/** Downloadable files linked from the IR site (pdf, xlsx, pptx, docx…). */
export async function irSiteCandidates(c: CoverageCompany): Promise<Candidate[]> {
  const { firecrawlLinks, firecrawlMap } = await import("@/lib/web.server");
  const pages = await firecrawlMap(c.ir, { limit: 400 });
  const PAGE_RE = /(financial|quarter|results|earnings|events|presentation|report|filings|supplement|fact|kpi|metrics|investor-day)/i;
  const picked = [c.ir, ...pages.filter((p) => PAGE_RE.test(p) && !IR_FILE_RE.test(p.split("?")[0]))].slice(0, 6);
  const links = new Set<string>(pages.filter((l) => IR_FILE_RE.test(l.split("?")[0])));
  for (const page of picked) {
    try {
      for (const l of await firecrawlLinks(page)) if (IR_FILE_RE.test(l.split("?")[0].split("#")[0])) links.add(l);
    } catch {
      /* page unavailable; keep going */
    }
  }
  return [...links].map((url) => ({ url, source: "ir-site" as const }));
}

/** Store up to `max` not-yet-stored files for a company. */
export async function collectIr(c: CoverageCompany, mode: "sec" | "site", max = 8) {
  const { data: have } = await supabaseAdmin.from("ir_documents").select("source_url, accn").eq("ticker", c.ticker).limit(5000);
  const known = new Set((have ?? []).map((d) => d.source_url));
  const doneAccn = new Set((have ?? []).map((d) => d.accn).filter(Boolean));
  let todo: Candidate[] = [];
  if (mode === "sec") {
    // Whole filings only, so a filing is either fully stored or untouched (lets us skip stored accessions).
    const filings = (await secExhibitCandidates(c)).filter((f) => !doneAccn.has(f.accn!));
    for (const f of filings) {
      if (todo.length >= max) break;
      todo.push(...(await exhibitsOf(c, f)).filter((k) => !known.has(k.url)));
    }
  } else todo = (await irSiteCandidates(c)).filter((k) => !known.has(k.url)).slice(0, max);
  const results: { url: string; stored: boolean; reason?: string }[] = [];
  for (const k of todo) {
    try {
      results.push({ url: k.url, ...(await store(c, k)) });
    } catch (e) {
      results.push({ url: k.url, stored: false, reason: (e as Error).message });
    }
  }
  return { ticker: c.ticker, mode, stored: results.filter((r) => r.stored).length, results };
}

/** Signed URL / bytes for a stored document. */
export async function readIrDocument(id: string) {
  const { data: row } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!row?.path) return null;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(row.path);
  if (error || !data) return null;
  return { row, bytes: await data.arrayBuffer() };
}
