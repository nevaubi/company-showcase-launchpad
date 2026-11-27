// Investor-relations document collector. Downloads and stores (never just links) every
// earnings release, presentation, supplement and data file a company publishes:
//  1. EX-99 exhibits attached to 8-K filings on EDGAR (Items 2.02 results and 7.01 Reg FD)
//  2. Files hosted on the company's IR site, discovered with Firecrawl map
// Each file is kept byte-for-byte in the private `ir-documents` bucket with a sha256.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { companyCiks, type CoverageCompany } from "@/lib/coverage";
import { classifyIrDocument, irFileExt, IR_FILE_RE, leadingText } from "@/lib/ir/classify";
import { isIrFileAllowed } from "@/lib/ir/source-guard";
import { judgeHit, networkFolder } from "@/lib/jobs/ir-site-match";
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

/** `duplicate`: the id of the document of this ticker that already holds the same bytes (nothing stored). */
type StoreResult = { stored: boolean; reason?: string; bytes?: number; duplicate?: string };

async function store(c: CoverageCompany, k: Candidate): Promise<StoreResult> {
  const res = k.sec ? await fetchSec(k.url) : await fetch(k.url, { headers: { "User-Agent": BROWSER_UA, Accept: "*/*" }, redirect: "follow" });
  if (!res.ok) return { stored: false, reason: `HTTP ${res.status}` };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return { stored: false, reason: "too large" };
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  if (!k.sec && /text\/html/.test(contentType) && !/\.html?$/i.test(k.url)) return { stored: false, reason: "not a file" };
  const ext = irFileExt(k.url, contentType);
  const hash = await sha256(buf);
  // The same file under another address (an exhibit filed twice, a site copy of an exhibit, a logo
  // repeated every quarter) is stored once per ticker.
  const { data: same, error: sameError } = await supabaseAdmin.from("ir_documents").select("id").eq("ticker", c.ticker).eq("sha256", hash).limit(1);
  if (sameError) throw new Error(sameError.message);
  if (same?.length) return { stored: false, reason: "same file already stored", duplicate: same[0].id as string };
  const path = `${c.ticker}/${k.accn ?? "site"}/${hash.slice(0, 12)}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, new Uint8Array(buf), { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const name = decodeURIComponent(k.url.split("/").pop() ?? "");
  // An exhibit's own first lines name it when its file name and SEC description do not ("c-ex99d2.htm",
  // "EX-99.2": Citigroup's Quarterly Financial Data Supplement).
  const heading = /^html?$/.test(ext) ? leadingText(new TextDecoder().decode(buf.slice(0, 400_000))) : undefined;
  const { kind, title } = classifyIrDocument({ exhibit: k.exhibit, description: k.description, name, ext, heading });
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

/** Addresses per lookup of held files: about 110 characters each keeps the request line near 5 KB. */
export const HELD_CHUNK = 40;

/** Held rows of a filing's files (partner copies carry no exhibit number, some no accession). */
interface HeldFile {
  source_url: string;
  accn: string | null;
  exhibit: string | null;
  source?: string | null;
}

/**
 * Gives a held copy of a listed exhibit the exhibit number (and accession) the filing index shows,
 * where the stored row has none. Returns the number of rows completed.
 */
async function completeHeld(c: CoverageCompany, files: Candidate[], held: Map<string, HeldFile>): Promise<number> {
  let n = 0;
  for (const k of files) {
    const h = held.get(k.url);
    if (!h || h.exhibit || !k.exhibit) continue;
    const patch: { exhibit: string; accn?: string } = { exhibit: k.exhibit };
    if (!h.accn && k.accn) patch.accn = k.accn;
    const { error } = await supabaseAdmin.from("ir_documents").update(patch).eq("ticker", c.ticker).eq("source_url", k.url).is("exhibit", null);
    if (error) throw new Error(error.message);
    h.exhibit = k.exhibit;
    if (patch.accn) h.accn = patch.accn;
    n++;
  }
  return n;
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
  const { reviewedCompanyDetails } = await import("@/lib/company/issuer-directory.server");
  const details = await reviewedCompanyDetails(c.ticker, c.cik);
  const irSite = details.ir || "";
  const website = details.website || irSite;
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
  // Tavily finds decks and supplements hosted on CDNs the IR pages only link via scripts. A hit is taken
  // only on evidence (ir-site-match.ts): the company's own host, the content-network folder its stored
  // files already use, or its distinctive name or ticker as whole words.
  try {
    const { tavilySearch } = await import("@/lib/web.server");
    const ownHosts = [irSite, website].map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    }).filter(Boolean);
    const knownFolders = new Set<string>();
    const { data: stored } = await supabaseAdmin
      .from("ir_documents")
      .select("source_url")
      .eq("ticker", c.ticker)
      .or("source_url.ilike.%q4cdn.com/%,source_url.ilike.%gcs-web.com/%")
      .limit(1000);
    for (const d of stored ?? []) {
      const f = networkFolder(d.source_url);
      if (f && isIrFileAllowed(c.ticker, d.source_url)) knownFolders.add(f);
    }
    const evidence = { ticker: c.ticker, shortName: c.shortName, ownHosts, knownFolders: [...knownFolders] };
    for (const q of [`${c.shortName} investor presentation earnings slides pdf`, `${c.shortName} financial supplement quarterly data xlsx`]) {
      const r = await tavilySearch(q, { maxResults: 10, depth: "basic" });
      for (const x of r.results) {
        const u = x.url.split("#")[0];
        if (IR_FILE_RE.test(u.split("?")[0]) && judgeHit({ url: u, title: x.title ?? "" }, evidence).own) links.add(u);
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
  const have: HeldFile[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin.from("ir_documents").select("source_url, accn, exhibit, source").eq("ticker", c.ticker).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    have.push(...((data ?? []) as HeldFile[]));
    if (!data || data.length < 1000) break;
  }
  const held = new Map(have.map((d) => [d.source_url, d]));
  const known = new Set(held.keys());
  let todo: Candidate[] = [];
  /** Files of each filing this pass lists, to write its scan row once all are held. */
  const byFiling = new Map<string, Candidate[]>();
  if (mode === "sec") {
    // A filing is skipped only when this collector stored it (its own rows, or a done/empty scan row).
    // Rows copied from the partner corpus do not count: they carry no exhibit numbers and no page
    // images, so the filing is still listed, its images stored and its exhibit numbers filled in.
    const { data: scans, error: scanError } = await supabaseAdmin.from("ir_release_scan").select("accn, status").eq("ticker", c.ticker).limit(5000);
    if (scanError) throw new Error(scanError.message);
    const doneAccn = new Set([
      ...have.filter((d) => d.accn && d.source === "sec-exhibit").map((d) => d.accn!),
      ...(scans ?? []).filter((r) => r.status === "done" || r.status === "empty").map((r) => r.accn as string),
    ]);
    const filings = (await secExhibitCandidates(c, opts.since)).filter((f) => !doneAccn.has(f.accn!));
    for (const f of filings) {
      if (todo.length >= max) break;
      try {
        const listed = await exhibitsOf(c, f);
        await completeHeld(c, listed, held);
        const files = listed.filter((k) => !known.has(k.url));
        byFiling.set(f.accn!, listed);
        todo.push(...files);
        opts.onFiling?.(f.accn!, files.length);
      } catch {
        /* index unavailable; retried on the next pass */
      }
    }
  } else todo = (await irSiteCandidates(c)).filter((k) => !known.has(k.url)).slice(0, max);
  // A file the reviewed list shows to be another company's is never stored (source-guard.ts).
  todo = todo.filter((k) => isIrFileAllowed(c.ticker, k.url));
  const results: ({ url: string } & StoreResult)[] = [];
  for (const k of todo) {
    try {
      results.push({ url: k.url, ...(await store(c, k)) });
    } catch (e) {
      results.push({ url: k.url, stored: false, reason: (e as Error).message });
    }
  }
  // A filing whose listed files are all held now (stored, or the same bytes already held) is done.
  const handled = new Set([...known, ...results.filter((r) => r.stored || r.duplicate).map((r) => r.url)]);
  for (const [accn, listed] of byFiling) {
    if (!listed.every((k) => handled.has(k.url) || !isIrFileAllowed(c.ticker, k.url))) continue;
    const { error } = await supabaseAdmin.from("ir_release_scan").upsert({ accn, ticker: c.ticker, files: listed.length, stored: listed.filter((k) => handled.has(k.url)).length, status: listed.length ? "done" : "empty", scanned_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
  return { ticker: c.ticker, mode, stored: results.filter((r) => r.stored).length, duplicates: results.filter((r) => r.duplicate).length, results };
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
  // Held by address, whatever their accession: partner copies of a filing may carry none.
  const held = new Map<string, HeldFile>();
  for (let i = 0; i < all.length; i += HELD_CHUNK) {
    const { data: known, error: knownError } = await supabaseAdmin.from("ir_documents").select("source_url, accn, exhibit").eq("ticker", c.ticker).in("source_url", all.slice(i, i + HELD_CHUNK).map((k) => k.url));
    if (knownError) throw new Error(knownError.message);
    for (const d of (known ?? []) as HeldFile[]) held.set(d.source_url, d);
  }
  const done = new Set(held.keys());
  await completeHeld(c, all, held);
  const files = all.filter((k) => !done.has(k.url));
  const results: ({ url: string } & StoreResult)[] = [];
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
  // A file whose bytes the ticker already holds counts as collected.
  const successes = results.filter(r => r.stored || r.duplicate).length;
  const left = files.length - successes;
  const failures = results.filter(r => !r.stored && !r.duplicate);
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
