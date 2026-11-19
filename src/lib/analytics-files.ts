// Analytics files refreshed by the Render worker (scripts/analytics-publish.ts) live in the private
// `datasets` bucket under `analytics/`; the bundled copy in public/data is only the fallback when
// storage has none (or the reader isn't signed in). Browser-safe.
import { supabase } from "@/integrations/supabase/client";

export const ANALYTICS_PREFIX = "analytics/";

/** Storage copy first, bundled `/data/<name>` second; null when neither exists. */
export async function analyticsFile<T>(name: string): Promise<T | null> {
  try {
    const { data } = await supabase.storage.from("datasets").download(`${ANALYTICS_PREFIX}${name}`);
    if (data) return JSON.parse(await data.text()) as T;
  } catch {
    /* fall back to the bundled copy */
  }
  const r = await fetch(`/data/${name}`).catch(() => null);
  if (!r?.ok) return null;
  try { return (await r.json()) as T; } catch { return null; }
}
