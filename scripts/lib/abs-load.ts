// One CIK's batch of planned filings for scripts/abs-ee.ts: read each from SEC, store it, or record on
// the filing why it was not stored. Kept apart from the script so the rules are tested with a fake
// source and a fake store (src/test/abs-load.test.ts). Rules: src/lib/abs/AGENTS.md.
import type { FilingPayload } from "../../src/lib/abs/filing";

/**
 * The status of an SEC answer that says "not now" rather than "not this filing": no answer at all
 * (`SecFetchError` status 0), 403, 429, 500 and above. The same rule as the scheduled job
 * (`secUnavailable` in src/lib/jobs/abs-ee.server.ts). Null for every other error.
 */
export function secUnavailable(error: unknown): number | null {
  const e = error as { name?: unknown; status?: unknown } | null;
  if (e?.name !== "SecFetchError" || typeof e.status !== "number" || !Number.isInteger(e.status)) return null;
  return e.status === 0 || e.status === 403 || e.status === 429 || e.status >= 500 ? e.status : null;
}

export type LoadTally = {
  stored: number;
  unchanged: number;
  skipped: number;
  failed: number;
  /** still to do after this run, in the run's range: the plan's rest plus what this run did not reach */
  left: number;
  /** SEC was throttling or down: the batch stopped at this filing, which was not marked */
  sec_unavailable?: { status: number; accession: string; error: string };
};

export type LoadIo = {
  read(accession: string): Promise<FilingPayload>;
  store(accession: string, payload: Exclude<FilingPayload, { skip: string }>): Promise<"stored" | "unchanged">;
  /** abs_mark_filing: `failed` counts an attempt, `skipped` does not */
  mark(accession: string, status: "skipped" | "failed", detail: string): Promise<void>;
  log(line: string): void;
  /** after a filing was stored or found unchanged, for the run's log */
  done?(accession: string, outcome: "stored" | "unchanged", payload: Exclude<FilingPayload, { skip: string }>): void;
};

/**
 * Works through `todo` in order. A filing that cannot be read is marked: `skipped` with the reader's
 * reason, or `failed` with the error, which counts an attempt (three, then it is given up). When SEC
 * throttles or is down, nothing is wrong with the filing: it is not marked, no attempt is counted, and
 * the batch stops there, so the caller can back off instead of spending the next filings' tries on the
 * same outage.
 */
export async function loadFilings(todo: readonly string[], left: number, io: LoadIo): Promise<LoadTally> {
  const t: LoadTally = { stored: 0, unchanged: 0, skipped: 0, failed: 0, left };
  for (let i = 0; i < todo.length; i++) {
    const accession = todo[i];
    try {
      const parsed = await io.read(accession);
      if (parsed.skip !== undefined) {
        await io.mark(accession, "skipped", parsed.skip);
        t.skipped++;
        io.log(`  ${accession} skipped: ${parsed.skip}`);
        continue;
      }
      const outcome = await io.store(accession, parsed);
      t[outcome]++;
      io.done?.(accession, outcome, parsed);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = secUnavailable(e);
      if (status !== null) {
        t.sec_unavailable = { status, accession, error: message };
        t.left += todo.length - i;
        io.log(`  ${accession} not read: SEC answered ${status || "nothing"}; batch stopped, no attempt counted`);
        break;
      }
      t.failed++;
      io.log(`  ${accession} FAILED: ${message}`);
      await io.mark(accession, "failed", message).catch(() => undefined);
    }
  }
  return t;
}
