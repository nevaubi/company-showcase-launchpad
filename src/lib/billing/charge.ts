import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsageKind } from "./plans";

/** Count one use against the caller's plan (atomic, in the database) or refuse with a clear message. */
export async function chargeUsage(supabase: SupabaseClient<any>, kind: UsageKind): Promise<void> {
  const { data, error } = await supabase.rpc("consume_usage", { _kind: kind });
  if (error) throw new Error("Couldn't check your plan limits — try again.");
  const r = data as { ok: boolean; reason?: string; tier?: string; limit?: number };
  if (r.ok) return;
  if (r.tier === "expired") throw new Error("Your free trial has ended. Subscribe on the Billing page to keep using AI tools.");
  const what = kind === "agent" ? "assistant questions for today" : "custom AI reports for this month";
  throw new Error(`You've used all ${r.limit ?? 0} ${what} on your plan. Upgrade on the Billing page for more.`);
}
