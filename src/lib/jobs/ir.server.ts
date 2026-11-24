// Investor-relations document collector. Downloads and stores (never just links) every
// earnings release, presentation, supplement and data file a company publishes:
//  1. EX-99 exhibits attached to 8-K filings on EDGAR (Items 2.02 results and 7.01 Reg FD)
//  2. Files hosted on the company's IR site, discovered with Firecrawl map
// Each file is kept byte-for-byte in the private `ir-documents` bucket with a sha256.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { companyCiks, type CoverageCompany } from "@/lib/coverage";
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
  /** CIK whose index lists the filing (archive URLs resolve only under it) */
  cik?: string;
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
  // Every CIK of the company (a former registrant's index keeps its own releases).
  const pages: { cik: string; r: FilingColumns }[] = [];
  for (const k of companyCiks(c)) {
    const sub = (await (await fetchSec(`https://data.sec.gov/submissions/CIK${k.padStart(10, "0")}.json`)).json()) as Submissions;
    pages.push({ cik: k, r: sub.filings.recent });
    for (const f of sub.filings.files ?? []) {
      if (f.filingTo < since) continue;
      pages.push({ cik: k, r: (await (await fetchSec(`https://data.sec.gov/submissions/${f.name}`)).json()) as FilingColumns });
    }
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const { cik, r } of pages) {
    for (let i = 0; i < r.form.length; i++) {
      if (!/^8-K(\/A)?$/.test(r.form[i]) || r.filingDate[i] < since || !/2\.02|7\.01/.test(r.items?.[i] ?? "")) continue;
      if (seen.has(r.accessionNumber[i])) continue;
      seen.add(r.accessionNumber[i]);
      out.push({ url: r.accessionNumber[i], source: "sec-exhibit", accn: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] || undefined, cik });
    }
  }
  return out.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""));
}

/** Expand one 8-K into its exhibit files using the filing index table (type + description columns). */
export async function exhibitsOf(c: CoverageCompany, f: Candidate): Promise<Candidate[]> {
  if (!f.accn) throw new Error("Exhibit discovery requires an accession");
  const cik = f.cik ?? c.cik;
  const idx = await (await fetchSec(archiveUrl(cik, f.accn, `${f.accn}-index.htm`))).text();
  const out: Candidate[] = [];
  for (const row of idx.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const href = row[1].match(/href="([^"]+)"/)?.[1];
    if (!href || cells.length < 4) continue;
    const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    const description = strip(cells[1]);
    const type = strip(cells[3]);
    const name = href.split("/").pop();
    if (!name) continue;
    const isExhibit = /^EX-99/i.test(type);
    const isDataFile = /\.(xlsx?|pdf|pptx?|docx?|jpe?g|png|gif)$/i.test(name) && !/^R\d+\.htm/i.test(name);
    if (!isExhibit && !isDataFile) continue;
    out.push({ ...f, url: archiveUrl(cik, f.accn, name), exhibit: type || undefined, description: description || undefined, sec: true });
  }
  return out;
}

/** Downloadable files linked from the IR site (pdf, xlsx, pptx, docx…). */
export async function irSiteCandidates(c: CoverageCompany): Promise<Candidate[]> {
  const { firecrawlLinks, firecrawlMap } = await import("@/lib/web.server");
  const { coverageDetails } = await import("@/lib/coverage-details.server");
  const details = coverageDetails(c.ticker);
  const irSite = c.ir || details.ir || "";
  const website = c.website || details.website || irSite;
  if (!irSite) return [];
  const pages = await firecrawlMap(irSite, { limit: 400 });
  const PAGE_RE = /(financial|quarter|results|earnings|events|presentation|report|filings|supplement|fact|kpi|metrics|investor-day)/i;
  const picked = [irSite, ...pages.filter((p) => PAGE_RE.test(p) && !IR_FILE_RE.test(p.split("?")[0]))].slice(0, 6);
  const links = new Set<string>(pages.filter((l) => IR_FILE_RE.test(l.split("?")[0])));
  for (const page of picked) {
    try {
      for (const l of await firecrawlLinks(page)) if (IR_FILE_RE.test(l.split("?")[0].split("#")[0])) links.add(l);
    } catch (e) {
      // Out of credits must stop the run (callers pause on it); any other page error is skipped.
      if (/\b402\b/.test((e as Error).message)) throw e;
    }
  }
  // Tavily finds decks and supplements hosted on CDNs the IR pages only link via scripts.
  try {
    const { tavilySearch } = await import("@/lib/web.server");
    const host = new URL(irSite).hostname.replace(/^www\./, "");
    const site = new URL(website).hostname.replace(/^www\./, "");
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
/** Failed attempts on one release: three, at least six hours apart, then the filing is left alone. */
export const RELEASE_RETRY_LIMIT = 3;
export const RELEASE_RETRY_WAIT_MS = 6 * 3600000;

/**
 * Whether a release is still to be collected. `scan` is its `ir_release_scan` row, `tries` its
 * `ir-release-retry:<accession>` row in `job_state`. Back-off and giving up are decided from
 * `job_state` alone, because the scan table's status column accepts only done, partial and empty:
 * a failed attempt that tried to store any other status was rejected by the database, left no scan
 * row, and the same filing was picked again on every run.
 */
export function releaseDue(
  scan: { status: string } | undefined,
  tries: { attempts: number; at: string | null } | undefined,
  now: number,
): boolean {
  if (scan && scan.status !== "partial" && scan.status !== "retry") return false; // done, empty, or given up
  if (!tries || tries.attempts <= 0) return true;
  if (tries.attempts >= RELEASE_RETRY_LIMIT) return false;
  const last = tries.at ? Date.parse(tries.at) : NaN;
  return !Number.isFinite(last) || now - last >= RELEASE_RETRY_WAIT_MS;
}

/**
 * Store the exhibits of the newest earnings (Item 2.02) or Reg FD (7.01) 8-K that isn't fully
 * stored yet. Files are stored a few at a time while `more()` allows; `ir_release_scan` records
 * each filing as done, partial (cut short by the budget — resumed first next run) or empty (no
 * exhibits), so one exhibit-less filing never blocks the queue. A failed attempt is counted in
 * `job_state` (`ir-release-retry:<accession>`, with the error text) and writes nothing to the scan
 * table; `releaseDue` reads that count, so a filing whose download keeps failing is retried twice
 * more, six hours apart, and then stops holding up the filings behind it.
 */
export async function collectRecentRelease(companies: CoverageCompany[], more: () => boolean = () => true) {
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const { data: recent, error } = await supabaseAdmin
    .from("sec_filings")
    .select("accn, ticker, cik, filed, report, items, form")
    .like("form", "8-K%")
    .gte("filed", since)
    .or("items.like.%2.02%,items.like.%7.01%")
    .order("filed", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const wanted = (recent ?? []).filter((f) => /2\.02|7\.01/.test(f.items ?? "") && companies.some((c) => c.ticker === f.ticker));
  if (!wanted.length) return null;
  const accns = wanted.map((f) => f.accn);
  const [{ data: scans, error: scanError }, { data: retries, error: retryError }] = await Promise.all([
    supabaseAdmin.from("ir_release_scan").select("accn, status, scanned_at").in("accn", accns),
    supabaseAdmin.from("job_state").select("job, cursor, updated_at").in("job", accns.map(a => `ir-release-retry:${a}`)),
  ]);
  if (scanError || retryError) throw new Error(scanError?.message ?? retryError?.message);
  const scan = new Map((scans ?? []).map(r => [r.accn, r]));
  const tries = new Map((retries ?? []).map(r => [r.job, { attempts: Number(r.cursor) || 0, at: (r.updated_at as string | null) ?? null }]));
  const attempts = new Map([...tries].map(([job, t]) => [job, t.attempts]));
  const now = Date.now();
  // A stored exhibit is not proof that every file was collected, so a filing without a scan row is due.
  const next = wanted.find(f => releaseDue(scan.get(f.accn), tries.get(`ir-release-retry:${f.accn}`), now));
  if (!next) return null;
  const c = companies.find((x) => x.ticker === next.ticker);
  if (!c) return null;
  const { data: known, error: knownError } = await supabaseAdmin.from("ir_documents").select("source_url").eq("accn", next.accn);
  if (knownError) throw new Error(knownError.message);
  const done = new Set((known ?? []).map((d) => d.source_url));
  const retryKey = `ir-release-retry:${next.accn}`;
  /** Counts the failed attempt in `job_state`; the scan table is left as it was (see `releaseDue`). */
  async function recordFailure(message: string) {
    const attempt = (attempts.get(retryKey) ?? 0) + 1;
    const status = attempt >= RELEASE_RETRY_LIMIT ? "error" : "retry";
    const { error } = await supabaseAdmin.from("job_state").upsert({ job: retryKey, cursor: attempt, paused_reason: message.slice(0, 500), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return status;
  }
  let all: Candidate[];
  try {
    // The filing's own CIK (sec_filings records the index that listed it).
    all = await exhibitsOf(c, { url: next.accn, source: "sec-exhibit", accn: next.accn, filed: next.filed, period: next.report ?? undefined, cik: next.cik || undefined });
  } catch (e) {
    const reason = (e as Error).message;
    const status = await recordFailure(`index: ${reason}`);
    return { ticker: c.ticker, accn: next.accn, mode: "recent", status, stored: 0, left: 0, results: [{ url: next.accn, stored: false, reason }] };
  }
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
  const successes = results.filter(r => r.stored).length;
  const left = files.length - successes;
  const failures = results.filter(r => !r.stored);
  const status = failures.length
    ? await recordFailure(failures.map(r => `${r.url}: ${r.reason}`).join("; "))
    : all.length === 0 ? "empty" : left > 0 ? "partial" : "done";
  if (!failures.length) {
    const { error: scanWriteError } = await supabaseAdmin.from("ir_release_scan").upsert({ accn: next.accn, ticker: c.ticker, files: all.length, stored: done.size + successes, status, scanned_at: new Date().toISOString() });
    if (scanWriteError) throw new Error(scanWriteError.message);
  }
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
