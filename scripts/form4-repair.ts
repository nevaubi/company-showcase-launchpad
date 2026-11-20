// Form 4 repair pass (worker loop, every 30 minutes): parses every Form 4 already in `sec_filings`
// that has no `insider_trades` rows and no `form4-seen:` receipt, one filing day at a time, newest day
// first, 150 ms between SEC requests, at most --max filings and --max-minutes per run. The cursor
// (job_state `form4-repair`) holds a day until nothing is left on it; per-filing failures are
// receipted and given up after 3 tries. Writes a `job_runs` row `form4-repair`.
// Exit 0 = done, 2 = stopped (SEC refused requests; the cursor held), 1 = error.
// Usage: bun scripts/form4-repair.ts [--max=400] [--max-days=30] [--max-minutes=20] [--floor-days=400]
import { repairForm4 } from "../src/lib/jobs/form4.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const deadline = Date.now() + arg("max-minutes", 20) * 60_000;
const floor = new Date(Date.now() - arg("floor-days", 400) * 86_400_000).toISOString().slice(0, 10);
const started = new Date().toISOString();
const { data: run } = await supabaseAdmin.from("job_runs").insert({ job: "form4-repair", started_at: started }).select("id").single();
let code = 0;
try {
  const r = await repairForm4(supabaseAdmin, { deadline, floor, maxFetch: arg("max", 400), maxDays: arg("max-days", 30), log: (m) => console.log(m) });
  console.log(JSON.stringify(r));
  code = r.stop ? 2 : 0;
  if (run) await supabaseAdmin.from("job_runs").update({ finished_at: new Date().toISOString(), ok: !r.stop, items: r.stored + r.empty, detail: r as never }).eq("id", run.id);
} catch (e) {
  code = 1;
  console.error(e);
  if (run) await supabaseAdmin.from("job_runs").update({ finished_at: new Date().toISOString(), ok: false, items: 0, detail: { error: (e as Error).message.slice(0, 300) } }).eq("id", run.id);
}
process.exit(code);
