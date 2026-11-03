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

interface FilingColumns {
  accessionNumber: string[];
  form: string[];
  filingDate: string[];
  reportDate: string[];
  items: string[];
}
interface Submissions {
  filings: { recent: FilingColumns; files?: { name: string; filingFrom: string; filingTo: string }[] };
}

/**
 * EX-99.x exhibits (and attached spreadsheets/PDFs) from results (Item 2.02) and Reg FD (Item 7.01)
 * 8-Ks filed on or after `since`, newest first. Older history lives in the paginated submissions
 * files, which are read only when `since` reaches back past the "recent" window.
 */
export async function secExhibitCandidates(c: CoverageCompany, since = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10)): Promise<Candidate[]> {
  const cik = c.cik.padStart(10, "0");
  const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${cik}.json`)).json()) as Submissions;
  const pages: FilingColumns[] = [sub.filings.recent];
  for (const f of sub.filings.files ?? []) {
    if (f.filingTo < since) continue;
    pages.push((await (await fetchSec(`https://data.sec.gov/submissions/${f.name}`)).json()) as FilingColumns);
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const r of pages) {
    for (let i = 0; i < r.form.length; i++) {
      if (!/^8-K(\/A)?$/.test(r.form[i]) || r.filingDate[i] < since || !/2\.02|7\.01/.test(r.items?.[i] ?? "")) continue;
      if (seen.has(r.accessionNumber[i])) continue;
      seen.add(r.accessionNumber[i]);
      out.push({ url: r.accessionNumber[i], source: "sec-exhibit", accn: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] || undefined });
    }
  }
  return out.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""));
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
  // Tavily finds decks and supplements hosted on CDNs the IR pages only link via scripts.
  try {
    const { tavilySearch } = await import("@/lib/web.server");
    const host = new URL(c.ir).hostname.replace(/^www\./, "");
    const site = new URL(c.website).hostname.replace(/^www\./, "");
    for (const q of [`${c.shortName} investor presentation earnings slides pdf`, `${c.shortName} financial supplement quarterly data xlsx`]) {
      const r = await tavilySearch(q, { maxResults: 10, depth: "basic" });
      for (const x of r.results) {
        const u = x.url.split("#")[0];
        const h = new URL(u).hostname;
        const cdn = /q4cdn\.com|gcs-web\.com/.test(h);
        const named = `${x.title} ${u}`.toLowerCase();
        const mentions = named.includes(c.ticker.toLowerCase()) || named.includes(c.shortName.toLowerCase().split(/[ .']/)[0]);
        const own = h.endsWith(host) || h.endsWith(site) || (cdn && mentions);
        if (own && IR_FILE_RE.test(u.split("?")[0])) links.add(u);
      }
    }
  } catch {
    /* search optional */
  }
  return [...links].map((url) => ({ url, source: "ir-site" as const }));
}

/** Store up to `max` not-yet-stored files for a company (`since` bounds the SEC history). */
export async function collectIr(c: CoverageCompany, mode: "sec" | "site", max = 8, opts: { since?: string; onFiling?: (accn: string, files: number) => void } = {}) {
  // Banks have thousands of stored files; page past the 1,000-row response cap.
  const have: { source_url: string; accn: string | null }[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin.from("ir_documents").select("source_url, accn").eq("ticker", c.ticker).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    have.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const known = new Set(have.map((d) => d.source_url));
  const doneAccn = new Set(have.map((d) => d.accn).filter(Boolean));
  let todo: Candidate[] = [];
  if (mode === "sec") {
    // Whole filings only, so a filing is either fully stored or untouched (lets us skip stored accessions).
    const filings = (await secExhibitCandidates(c, opts.since)).filter((f) => !doneAccn.has(f.accn!));
    for (const f of filings) {
      if (todo.length >= max) break;
      try {
        const files = (await exhibitsOf(c, f)).filter((k) => !known.has(k.url));
        todo.push(...files);
        opts.onFiling?.(f.accn!, files.length);
      } catch {
        /* index unavailable; retried on the next pass */
      }
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

/**
 * Newest earnings / Reg FD 8-K (seen by the SEC filings scan in the last three weeks) whose
 * exhibits aren't stored yet: store up to `max` of its files. Keeps scheduled runs to a few seconds.
 */
/**
 * Store the exhibits of the newest earnings (Item 2.02) or Reg FD (7.01) 8-K that isn't fully
 * stored yet. Files are stored a few at a time while `more()` allows; `ir_release_scan` records
 * each filing as done, partial (cut short by the budget — resumed first next run) or empty (no
 * exhibits), so one exhibit-less filing never blocks the queue.
 */
export async function collectRecentRelease(companies: CoverageCompany[], more: () => boolean = () => true) {
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const { data: recent, error } = await supabaseAdmin
    .from("sec_filings")
    .select("accn, ticker, filed, report, items, form")
    .like("form", "8-K%")
    .gte("filed", since)
    .order("filed", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  const wanted = (recent ?? []).filter((f) => /2\.02|7\.01/.test(f.items ?? "") && companies.some((c) => c.ticker === f.ticker));
  if (!wanted.length) return null;
  const accns = wanted.map((f) => f.accn);
  const [{ data: scans }, { data: stored }] = await Promise.all([
    supabaseAdmin.from("ir_release_scan").select("accn, status").in("accn", accns),
    // Images outnumber documents ~10:1; checking documents only keeps this under the row cap.
    supabaseAdmin.from("ir_documents").select("accn").in("accn", accns).neq("kind", "image").limit(1000),
  ]);
  const scan = new Map((scans ?? []).map((r) => [r.accn, r.status]));
  const have = new Set((stored ?? []).map((d) => d.accn));
  const next = wanted.find((f) => scan.get(f.accn) === "partial") ?? wanted.find((f) => !scan.has(f.accn) && !have.has(f.accn));
  if (!next) return null;
  const c = companies.find((x) => x.ticker === next.ticker)!;
  const { data: known } = await supabaseAdmin.from("ir_documents").select("source_url").eq("accn", next.accn);
  const done = new Set((known ?? []).map((d) => d.source_url));
  const all = await exhibitsOf(c, { url: next.accn, source: "sec-exhibit", accn: next.accn, filed: next.filed, period: next.report ?? undefined });
  const files = all.filter((k) => !done.has(k.url));
  const results: { url: string; stored: boolean; reason?: string }[] = [];
  let i = 0;
  // Three at a time: each store is an SEC download, a storage upload and a row insert.
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (i < files.length && more()) {
        const k = files[i++];
        try {
          results.push({ url: k.url, ...(await store(c, k)) });
        } catch (e) {
          results.push({ url: k.url, stored: false, reason: (e as Error).message });
        }
      }
    }),
  );
  const left = files.length - results.length;
  const status = all.length === 0 ? "empty" : left > 0 ? "partial" : "done";
  await supabaseAdmin.from("ir_release_scan").upsert({ accn: next.accn, ticker: c.ticker, files: all.length, stored: done.size + results.filter((r) => r.stored).length, status, scanned_at: new Date().toISOString() });
  return { ticker: c.ticker, accn: next.accn, mode: "recent", status, stored: results.filter((r) => r.stored).length, left, results: results.slice(0, 6) };
}

/** Signed URL / bytes for a stored document. */
export async function readIrDocument(id: string) {
  const { data: row } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!row?.path) return null;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(row.path);
  if (error || !data) return null;
  return { row, bytes: await data.arrayBuffer() };
}
