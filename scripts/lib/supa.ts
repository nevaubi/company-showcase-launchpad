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
