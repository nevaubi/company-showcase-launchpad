// Server-only helpers for SEC EDGAR. SEC requires a descriptive User-Agent and
// does not send CORS headers, so every request goes through here.
import { retryDelayMs } from "@/lib/jobs/failure";

export const SEC_UA = "FiledUnder Research research@filedunder.ai";

export const archiveUrl = (cik: string, accn: string, doc = "") =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${doc}`;

export interface SecFetchOpts {
  /** per-try timeout (default 8 s) */
  timeoutMs?: number;
  /** epoch ms the caller must be done by (an HTTP job passes its run budget); no try or wait runs past it */
  deadline?: number;
  /** tries in total (default 3) */
  tries?: number;
  /** longest single wait between tries (default 2 s; scripts may wait longer) */
  maxWaitMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

/** An SEC answer that was not OK; `status` 0 means no answer (timeout or network). */
export class SecFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SecFetchError";
  }
}

/** `Retry-After` in ms: delta seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header) return null;
  const v = header.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/**
 * GET an SEC URL with the required User-Agent. Each try has a timeout. 429 and 403 (SEC's throttle
 * answers) wait for `Retry-After` when given, otherwise a jittered rate backoff; 5xx and network
 * errors wait a jittered transient backoff. No wait or try runs past `deadline`, so a scheduled job
 * keeps inside its budget. Throws `SecFetchError` with the last status.
 */
export async function fetchSec(url: string, opts: SecFetchOpts = {}): Promise<Response> {
  if (!/^https:\/\/(www\.sec\.gov|data\.sec\.gov|efts\.sec\.gov)\//.test(url)) throw new Error("Only SEC URLs are allowed");
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = Math.max(1, opts.tries ?? 3);
  const left = () => (opts.deadline == null ? Infinity : opts.deadline - Date.now());
  let last = 0;
  let note = "";
  for (let attempt = 0; attempt < tries; attempt++) {
    if (left() <= 0) {
      note = " (run budget spent)";
      break;
    }
    const timeout = Math.max(250, Math.min(opts.timeoutMs ?? 8000, left()));
    let res: Response | null = null;
    let wait: number | null;
    try {
      res = await doFetch(url, { headers: { "User-Agent": SEC_UA, Accept: "*/*" }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      last = 0;
      note = ` (${(e as Error).name === "TimeoutError" || /abort|timeout/i.test((e as Error).message) ? `no answer in ${timeout} ms` : (e as Error).message.slice(0, 80)})`;
    }
    if (res?.ok) return res;
    if (res) {
      last = res.status;
      note = "";
      res.body?.cancel().catch(() => undefined);
      if (res.status === 404) break;
    }
    if (attempt === tries - 1) break;
    if (res && (res.status === 429 || res.status === 403)) wait = retryAfterMs(res.headers.get("retry-after")) ?? retryDelayMs("rate", attempt, opts.rand);
    else wait = retryDelayMs("transient", attempt, opts.rand);
    const waitMs = Math.min(wait ?? 0, opts.maxWaitMs ?? 2000);
    // Waiting would run past the caller's budget: stop now and let the next run retry.
    if (waitMs >= left()) {
      note = `${note} (run budget spent)`;
      break;
    }
    await sleep(waitMs);
  }
  throw new SecFetchError(`SEC EDGAR responded ${last || "with an error"}${note} for ${url}`, last);
}

export interface FullTextHit {
  accn: string;
  doc: string;
  form: string;
  filed: string;
  period?: string;
  company: string;
  cik: string;
  description?: string;
  url: string;
}

export async function searchEdgarFullText(p: {
  q: string;
  ciks?: string[];
  forms?: string[];
  startdt?: string;
  enddt?: string;
}): Promise<{ total: number; hits: FullTextHit[] }> {
  const params = new URLSearchParams({ q: p.q });
  if (p.ciks?.length) params.set("ciks", p.ciks.map((c) => c.padStart(10, "0")).join(","));
  if (p.forms?.length) params.set("forms", p.forms.join(","));
  if (p.startdt || p.enddt) {
    params.set("dateRange", "custom");
    if (p.startdt) params.set("startdt", p.startdt);
    if (p.enddt) params.set("enddt", p.enddt);
  }
  const res = await fetchSec(`https://efts.sec.gov/LATEST/search-index?${params}`);
  const j = (await res.json()) as {
    hits?: {
      total?: { value: number };
      hits?: {
        _id: string;
        _source: {
          ciks: string[];
          display_names: string[];
          form: string;
          file_date: string;
          period_ending?: string;
          adsh: string;
          file_description?: string;
          root_forms?: string[];
        };
      }[];
    };
  };
  const hits = (j.hits?.hits ?? []).slice(0, 25).map((h) => {
    const [accn, doc] = h._id.split(":");
    const cik = h._source.ciks[0] ?? "";
    return {
      accn,
      doc,
      form: h._source.form,
      filed: h._source.file_date,
      period: h._source.period_ending,
      company: (h._source.display_names[0] ?? "").replace(/\s*\(CIK \d+\)/, ""),
      cik,
      description: h._source.file_description,
      url: archiveUrl(cik, accn, doc),
    };
  });
  return { total: j.hits?.total?.value ?? hits.length, hits };
}
