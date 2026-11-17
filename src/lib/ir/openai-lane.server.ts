/**
 * Second-opinion lane on the owner's OpenAI key, kept inside the free daily allowance for traffic
 * shared with OpenAI (src/lib/ir/openai-allowance.ts). Each call reserves its estimated tokens in
 * the `openai_allowance` ledger first (atomic, shared by every worker process) and settles the real
 * count after. When the allowance is spent, the key is missing or out of credit, the lane returns
 * null and the caller carries on with its built-in reader alone — the lane never stops a run.
 * Public investor-relations documents only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { allowanceDay, estimateTokens, FREE_SAFETY, FREE_TIERS, tierOf, usedTokens } from "@/lib/ir/openai-allowance";
import { OpenAIError, openaiDirectStructured, type Usage } from "@/lib/openai.server";

/** Default second reader: the small-model tier has ten times the allowance. */
export const LANE_MODEL = process.env["IR_OPENAI_LANE_MODEL"] || "gpt-5.4-mini";

let offUntil = 0;
let offReason = "";
export const laneEnabled = () => !!process.env["OPENAI_API_KEY"] && process.env["IR_OPENAI_LANE"] !== "0" && Date.now() >= offUntil;
export const laneStatus = () => (laneEnabled() ? `on (${LANE_MODEL})` : offReason || (process.env["OPENAI_API_KEY"] ? "off" : "no key"));

export async function laneStructured<T>(opts: { model?: string; name: string; instructions: string; input: string; schema: Record<string, unknown>; maxOutputTokens?: number }): Promise<{ data: T; usage: Usage; model: string } | null> {
  if (!laneEnabled()) return null;
  const model = opts.model ?? LANE_MODEL;
  const tier = tierOf(model);
  if (!tier) throw new Error(`${model} is not in the free OpenAI allowance`);
  const day = allowanceDay();
  const maxOut = opts.maxOutputTokens ?? 16_000;
  const est = estimateTokens(opts.instructions.length + opts.input.length, maxOut);
  const { data: ok, error } = await supabaseAdmin.rpc("openai_allowance_take", { _day: day, _tier: tier, _tokens: est, _cap: Math.floor(FREE_TIERS[tier].cap * FREE_SAFETY) });
  if (error || !ok) return null;
  const settle = (actual: number) => supabaseAdmin.rpc("openai_allowance_settle", { _day: day, _tier: tier, _delta: actual - est }).then(undefined, () => undefined);
  try {
    const r = await openaiDirectStructured<T>({ model, name: opts.name, instructions: opts.instructions, input: opts.input, schema: opts.schema, maxOutputTokens: maxOut, effort: /^(o\d|gpt-5)/.test(model) ? "low" : undefined });
    await settle(usedTokens(r.usage));
    return r;
  } catch (e) {
    const err = e as OpenAIError;
    await settle(err.usage ? usedTokens(err.usage) : 0);
    // A bad or empty key, or a spent balance: rest the lane for an hour instead of failing every call.
    if (err instanceof OpenAIError && (err.kind === "auth" || err.kind === "quota")) {
      offUntil = Date.now() + 3_600_000;
      offReason = `paused: ${err.kind}`;
    }
    return null;
  }
}
