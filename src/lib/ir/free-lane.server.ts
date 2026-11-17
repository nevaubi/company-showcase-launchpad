/**
 * Third-opinion lane on OpenRouter's free models through the existing OpenRouter connection. Public IR
 * documents only (free providers may log prompts). Each request is counted in `free_model_usage`
 * first (daily cap, shared by every worker), then sent to the first model that isn't resting; returns
 * null when the budget is spent or every model failed, so callers drop the dispute instead of guessing.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canSpend, FREE_DAILY_CAP, FREE_MODELS, pickModel, recordResult, type ModelHealth } from "@/lib/ir/free-lane";
import { openRouterStructured, OpenAIError } from "@/lib/openai.server";

let health: ModelHealth = {};
let recent: number[] = [];
let offUntil = 0;
const day = () => new Date().toISOString().slice(0, 10);

export const freeEnabled = () => !!process.env["UDC_OPENROUTER_API_KEY"] && process.env["IR_FREE_LANE"] !== "0" && Date.now() >= offUntil;

export async function freeStructured<T>(opts: { name: string; instructions: string; input: string; schema: Record<string, unknown>; maxOutputTokens?: number }, confirmed: (data: T) => number): Promise<T | null> {
  if (!freeEnabled()) return null;
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60_000);
  if (!canSpend(0, recent, now)) return null; // per-minute, this process
  const model = pickModel(FREE_MODELS, health, now);
  if (!model) return null;
  const { data: ok } = await supabaseAdmin.rpc("free_model_take", { _day: day(), _cap: FREE_DAILY_CAP });
  if (!ok) return null;
  recent.push(now);
  try {
    const r = await openRouterStructured<T>({ model, ...opts });
    health = recordResult(health, model, true, Date.now());
    await supabaseAdmin.rpc("free_model_note", { _day: day(), _ok: true, _confirms: confirmed(r.data) });
    return r.data;
  } catch (e) {
    health = recordResult(health, model, false, Date.now());
    await supabaseAdmin.rpc("free_model_note", { _day: day(), _ok: false, _confirms: 0 });
    // Too many requests or no connection: rest the whole lane; never replay right away.
    if (e instanceof OpenAIError && (e.status === 429 || e.kind === "auth")) offUntil = Date.now() + (e.status === 429 ? 300_000 : 3_600_000);
    return null;
  }
}
