// Scheduled ABS-EE refresh: one small unit per run, inside the run budget.
//
// A run first asks the store for the next listed filing of a watched CIK (`abs_claim_next`, which counts
// the attempt before any work). With a filing in hand it reads the header, the document list and the
// asset file from SEC and stores the filing in one call (`abs_store_filing`). With nothing waiting it
// lists the filings of one watched CIK, in rotation. A filing the run cannot finish in its few seconds
// is tried three times and then left for `bun scripts/abs-ee.ts`, which has no time limit; the others go on.
//
// A run reports failure only when the database or this code fails. A filing that cannot be read is
// recorded on the filing (`abs_filings.status`, `status_detail`) and the run itself is fine, so one bad
// filing never looks like a broken job. Rules: src/lib/abs/AGENTS.md.
import {
  headerUrl,
  indexUrl,
  listedFilings,
  submissionsUrl,
  type SubmissionsFile,
} from "@/lib/abs/edgar";
import { fileSink, countReplacements, filingPayload, planFiling } from "@/lib/abs/filing";
import { PARSER } from "@/lib/abs/metrics";
import { ABS_WATCH, type AbsWatch } from "@/lib/abs/watch";
import { createAbsReader, declaredEncoding } from "@/lib/abs/xml";
import { budgetCut } from "@/lib/jobs/slice";

/** job_state row holding the rotation position for listing. */
export const ABS_JOB = "abs-ee";
export const ABS_JOB_MAX_ATTEMPTS = 3;
/** An asset file larger than this is not fetched by a scheduled run (a commercial mortgage file is 0.3 to 1 MB). */
export const ABS_JOB_FILE_LIMIT = 2_500_000;
/** The store call is not started with less than this left: a run cut off by the platform never records its end. */
export const ABS_JOB_STORE_MS = 900;

export type AbsJobIo = {
  /** a function of migration 0067; throws on a database error */
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  /** the bytes of an SEC URL; throws once the run budget is spent */
  get(url: string): Promise<Uint8Array>;
  cursor(): Promise<number>;
  setCursor(n: number): Promise<void>;
  sha256(bytes: Uint8Array): Promise<string>;
  now(): string;
  /** ms left in the run budget */
  left(): number;
};

export type AbsJobResult = { ok: boolean; items: number; detail: Record<string, unknown> };

type Claimed = { accession: string; list_cik: number; attempt: number };

/** A database call that failed: the run's failure, never a filing's. */
class DbFailure extends Error {}

const text = (bytes: Uint8Array) => new TextDecoder(declaredEncoding(bytes)).decode(bytes);

/** What the database answers when the functions of migration 0067 do not exist. */
const NO_STORE =
  /Could not find the function public\.abs_claim_next|function public\.abs_claim_next\(.*\) does not exist|PGRST202/;

/** SEC's throttle and outage answers: nothing is wrong with the filing that was asked for. */
const secUnavailable = (status: unknown) =>
  status === 403 || status === 429 || (typeof status === "number" && status >= 500);

async function storeClaimed(io: AbsJobIo, c: Claimed): Promise<AbsJobResult> {
  const base = { accession: c.accession, cik: c.list_cik, attempt: c.attempt };
  const mark = (status: "skipped", detail: string) =>
    io.rpc("abs_mark_filing", { _accession: c.accession, _status: status, _detail: detail });
  try {
    const headerBytes = await io.get(headerUrl(c.list_cik, c.accession));
    const plan = planFiling(
      c.accession,
      text(headerBytes),
      await io.sha256(headerBytes),
      text(await io.get(indexUrl(c.list_cik, c.accession))),
    );
    if (plan.skip !== undefined) {
      await mark("skipped", plan.skip);
      return { ok: true, items: 0, detail: { ...base, skipped: plan.skip } };
    }
    if ((plan.file.listed_bytes ?? Infinity) > ABS_JOB_FILE_LIMIT) {
      // not a failure of the filing: it is set aside for the script, which reads files of any size
      const why = `asset file of ${plan.file.listed_bytes ?? "unknown"} bytes is over the scheduled run's limit; store it with scripts/abs-ee.ts load --retry-skipped`;
      await mark("skipped", why);
      return { ok: true, items: 0, detail: { ...base, left: why } };
    }
    const bytes = await io.get(plan.file.url);
    const collected = fileSink();
    const reader = createAbsReader((record) => collected.add(record, reader.shape().family));
    const xml = text(bytes);
    reader.write(xml);
    const payload = filingPayload(
      plan,
      reader.close(),
      { bytes: bytes.length, sha256: await io.sha256(bytes), retrievedAt: io.now() },
      collected,
      countReplacements(xml),
    );
    if (payload.skip !== undefined) {
      await mark("skipped", payload.skip);
      return { ok: true, items: 0, detail: { ...base, skipped: payload.skip } };
    }
    if (io.left() < ABS_JOB_STORE_MS)
      return {
        ok: true,
        items: 0,
        detail: {
          ...base,
          outcome: "cut",
          note: "read in time, but too little of the run left to store it",
        },
      };
    const done = await io.rpc<{ skip: boolean; current?: boolean }>("abs_store_filing", {
      _accession: c.accession,
      _parser: PARSER,
      _sha256: payload.sha256,
      _bytes: payload.bytes,
      _filing: payload.filing,
      _documents: payload.documents,
      _rows: payload.rows,
      _expect: payload.counts,
    });
    return {
      ok: true,
      items: done.skip ? 0 : 1,
      detail: {
        ...base,
        outcome: done.skip ? "unchanged" : "stored",
        period: payload.filing.period_end,
        records: payload.counts.records,
        bytes: payload.bytes,
      },
    };
  } catch (e) {
    if (e instanceof DbFailure) throw e;
    const message = (e as Error).message;
    // out of time: the attempt is already counted, the filing is tried again
    if (budgetCut(message))
      return {
        ok: true,
        items: 0,
        detail: { ...base, outcome: "cut", note: message.slice(0, 160) },
      };
    const status = (e as { status?: unknown }).status;
    if (secUnavailable(status)) {
      // SEC is throttling or down: give the attempt back, so an outage does not use up a filing's tries
      await io.rpc("abs_release_filing", {
        _accession: c.accession,
        _detail: `SEC answered ${status}; not counted as an attempt`,
      });
      return { ok: true, items: 0, detail: { ...base, outcome: "SEC unavailable", status } };
    }
    // the attempt was counted when the filing was claimed: only the reason is added
    await io.rpc("abs_fail_claimed", { _accession: c.accession, _detail: message });
    return {
      ok: true,
      items: 0,
      detail: { ...base, outcome: "filing failed", error: message.slice(0, 200) },
    };
  }
}

async function listNext(io: AbsJobIo, watch: readonly AbsWatch[]): Promise<AbsJobResult> {
  if (!watch.length) return { ok: true, items: 0, detail: { note: "nothing is watched" } };
  const at = (((await io.cursor()) % watch.length) + watch.length) % watch.length;
  const w = watch[at];
  try {
    const file = JSON.parse(text(await io.get(submissionsUrl(w.cik)))) as SubmissionsFile;
    const found = listedFilings(file, w.cik).filter((f) => !w.from || f.filed >= w.from);
    let listed = 0;
    for (let i = 0; i < found.length; i += 500)
      listed += (
        await io.rpc<{ listed: number }>("abs_register_filings", { _rows: found.slice(i, i + 500) })
      ).listed;
    await io.setCursor(at + 1);
    return {
      ok: true,
      items: listed,
      detail: { listing: w.cik, at, of: watch.length, on_edgar: found.length, new: listed },
    };
  } catch (e) {
    if (e instanceof DbFailure) throw e;
    const message = (e as Error).message;
    if (budgetCut(message))
      return {
        ok: true,
        items: 0,
        detail: { listing: w.cik, outcome: "cut", note: message.slice(0, 160) },
      };
    // SEC throttling or an outage: the same CIK is listed again next time
    if (secUnavailable((e as { status?: unknown }).status))
      return {
        ok: true,
        items: 0,
        detail: {
          listing: w.cik,
          outcome: "SEC unavailable",
          status: (e as { status?: unknown }).status,
        },
      };
    throw e;
  }
}

/** One run: store one waiting filing, or list one watched CIK when none waits. */
export async function runAbsEe(
  given: AbsJobIo,
  watch: readonly AbsWatch[] = ABS_WATCH,
): Promise<AbsJobResult> {
  const io: AbsJobIo = {
    ...given,
    rpc: (fn, args) =>
      given.rpc<never>(fn, args).catch((e: Error) => {
        throw new DbFailure(e.message);
      }),
    cursor: () =>
      given.cursor().catch((e: Error) => {
        throw new DbFailure(e.message);
      }),
    setCursor: (n) =>
      given.setCursor(n).catch((e: Error) => {
        throw new DbFailure(e.message);
      }),
  };
  let claimed: Claimed | null;
  try {
    claimed = await io.rpc<Claimed | null>("abs_claim_next", {
      _watch: watch.map((w) => ({ cik: w.cik, from: w.from ?? null })),
      _max_attempts: ABS_JOB_MAX_ATTEMPTS,
    });
  } catch (e) {
    // scheduled before migration 0067 is applied: there is no store yet, which is not a failure of the job
    if (NO_STORE.test((e as Error).message))
      return {
        ok: true,
        items: 0,
        detail: {
          note: "the abs_* store is not there yet (migration 0067 not applied); nothing done",
        },
      };
    throw e;
  }
  return claimed ? storeClaimed(io, claimed) : listNext(io, watch);
}

/** The run wired to the app's database and to SEC, with every request held to the run budget. */
export async function refreshAbsEe(budgetEnd: number): Promise<AbsJobResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { fetchSec } = await import("@/lib/sec.server");
  const call = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  return runAbsEe({
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await call(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as T;
    },
    async get(url) {
      const res = await fetchSec(url, {
        deadline: budgetEnd,
        timeoutMs: 3000,
        tries: 2,
        maxWaitMs: 400,
      });
      return new Uint8Array(await res.arrayBuffer());
    },
    async cursor() {
      const { data, error } = await supabaseAdmin
        .from("job_state")
        .select("cursor")
        .eq("job", ABS_JOB)
        .maybeSingle();
      if (error) throw new Error(`database: ${error.message}`);
      return data?.cursor ?? 0;
    },
    async setCursor(n) {
      const { error } = await supabaseAdmin
        .from("job_state")
        .upsert({ job: ABS_JOB, cursor: n, updated_at: new Date().toISOString() });
      if (error) throw new Error(`database: ${error.message}`);
    },
    async sha256(bytes) {
      const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
    now: () => new Date().toISOString(),
    left: () => budgetEnd - Date.now(),
  });
}
