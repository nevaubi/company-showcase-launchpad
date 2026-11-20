// Weekly registrant drift check (worker loop): one download of SEC's ticker file, compared with every
// covered company's CIK (src/lib/jobs/registrant-drift.ts). Each drifting ticker gets a job_state row
// `registrant-drift:<TICKER>` naming both CIKs (the watchdog emails it); rows for tickers that no
// longer drift are deleted. A bad download changes nothing. Writes a `job_runs` row `registrant-drift`.
// Exit 0 = checked, 1 = the file could not be read (the loop retries after its backoff).
// Usage: bun scripts/registrant-drift.ts
import { COVERAGE } from "../src/lib/coverage";
import { DRIFT_PREFIX, driftRow, parseTickerFile, registrantDrift } from "../src/lib/jobs/registrant-drift";
import { fetchSec } from "../src/lib/sec.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

const started = new Date().toISOString();
const finish = async (ok: boolean, items: number, detail: Record<string, unknown>) => {
  await supabaseAdmin.from("job_runs").insert({ job: "registrant-drift", started_at: started, finished_at: new Date().toISOString(), ok, items, detail: detail as never });
  console.log(JSON.stringify(detail));
};
try {
  const file = parseTickerFile(await (await fetchSec("https://www.sec.gov/files/company_tickers.json", { timeoutMs: 30_000 })).json());
  if (!file) {
    await finish(false, 0, { error: "the ticker file was not the expected list (too short or wrong shape); nothing changed" });
    process.exit(1);
  }
  const { drift, unlisted } = registrantDrift(COVERAGE, file);
  const now = Date.now();
  if (drift.length) {
    const { error } = await supabaseAdmin.from("job_state").upsert(drift.map((d) => driftRow(d, now)));
    if (error) throw new Error(error.message);
  }
  const { data: rows, error: readError } = await supabaseAdmin.from("job_state").select("job").like("job", `${DRIFT_PREFIX}%`).limit(1000);
  if (readError) throw new Error(readError.message);
  const live = new Set(drift.map((d) => `${DRIFT_PREFIX}${d.ticker}`));
  const cleared = (rows ?? []).map((r) => r.job).filter((j) => !live.has(j));
  if (cleared.length) {
    const { error } = await supabaseAdmin.from("job_state").delete().in("job", cleared).like("job", `${DRIFT_PREFIX}%`);
    if (error) throw new Error(error.message);
  }
  await finish(true, drift.length, { checked: COVERAGE.length, listed: file.length, drift, cleared: cleared.length, unlisted: unlisted.slice(0, 50), unlistedCount: unlisted.length });
  process.exit(0);
} catch (e) {
  await finish(false, 0, { error: (e as Error).message.slice(0, 300) }).catch(() => undefined);
  process.exit(1);
}
