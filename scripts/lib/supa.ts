// Service-role database client for local pipeline scripts (never bundled into the app).
import { createClient } from "@supabase/supabase-js";

export const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** Page through a query 1,000 rows at a time (the API caps each response). */
export async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** `--key=value` → { key: "value" }; bare flags (`--dry`, `--resume`) → { key: "true" }. */
export const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
) as Record<string, string | undefined>;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

/**
 * Database back-pressure shared by the pipeline scripts. Each process probes a tiny query at most
 * every 10 s; while it takes longer than `BUSY_MS` the scripts wait instead of piling on, so the app
 * itself stays responsive while bulk reading runs.
 */
const BUSY_MS = Number(process.env.DB_BUSY_MS ?? 1500);
let latency = 0;
let lastProbe = 0;
let probing: Promise<void> | null = null;
async function probe() {
  const t0 = Date.now();
  await sb.from("job_state").select("job").limit(1);
  latency = Date.now() - t0;
  lastProbe = Date.now();
}
export const dbLatency = () => latency;
export async function dbGate(label = "job") {
  for (let waited = 0; ; waited += 10_000) {
    if (Date.now() - lastProbe > 10_000) {
      probing ??= probe().finally(() => (probing = null));
      await probing;
    }
    if (latency < BUSY_MS) {
      if (waited) log(`database responsive again (${latency}ms) — ${label} resuming`);
      return;
    }
    if (!waited) log(`database busy (${latency}ms) — ${label} waiting`);
    await sleep(10_000);
  }
}
