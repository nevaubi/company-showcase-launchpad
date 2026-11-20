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
import { guarded, OpenAIError, openaiDirectStructured, type Effort, type InputPart, type Usage } from "@/lib/openai.server";

/** Default second reader: the small-model tier has ten times the allowance. */
export const LANE_MODEL = process.env["IR_OPENAI_LANE_MODEL"] || "gpt-5.4-mini";

let offUntil = 0;
let offReason = "";
export const laneEnabled = () => !!process.env["OPENAI_API_KEY"] && process.env["IR_OPENAI_LANE"] !== "0" && Date.now() >= offUntil;
export const laneStatus = () => (laneEnabled() ? `on (${LANE_MODEL})` : offReason || (process.env["OPENAI_API_KEY"] ? "off" : "no key"));

export async function laneStructured<T>(opts: { model?: string; name: string; instructions: string; input: string | InputPart[]; schema: Record<string, unknown>; maxOutputTokens?: number; effort?: Effort; /** pass ordinary call errors to the caller; null then only means "no free allowance" */ rethrow?: boolean }): Promise<{ data: T; usage: Usage; model: string } | null> {
  if (!laneEnabled()) return null;
  const model = opts.model ?? LANE_MODEL;
  const tier = tierOf(model);
  if (!tier) throw new Error(`${model} is not in the free OpenAI allowance`);
  const day = allowanceDay();
  const maxOut = opts.maxOutputTokens ?? 16_000;
  // Images: a high-detail page costs at most a few thousand tokens; reserve generously.
  const inChars = typeof opts.input === "string" ? opts.input.length : opts.input.reduce((n, p) => n + (p.type === "input_text" ? p.text.length : 6_000 * 3.2), 0);
  const est = estimateTokens(opts.instructions.length + inChars, maxOut);
  const settle = (actual: number) => supabaseAdmin.rpc("openai_allowance_settle", { _day: day, _tier: tier, _delta: actual - est }).then(undefined, () => undefined);
  let reserved = false;
  try {
    // The tier's circuit (provider:openai-free-<tier>) holds every lane caller back once the day's
    // allowance is spent, until 00:05 UTC, instead of each call asking the ledger again.
    return await guarded(tier === "large" ? "openai-free-large" : "openai-free-mini", async () => {
      const { data: ok, error } = await supabaseAdmin.rpc("openai_allowance_take", { _day: day, _tier: tier, _tokens: est, _cap: Math.floor(FREE_TIERS[tier].cap * FREE_SAFETY) });
      if (error) throw new OpenAIError(`allowance ledger unavailable: ${error.message}`, "transient", 0);
      if (!ok) throw new OpenAIError(`free allowance spent (${tier}, est ${est} tokens)`, "quota", 0);
      reserved = true;
      const r = await openaiDirectStructured<T>({ model, name: opts.name, instructions: opts.instructions, input: opts.input, schema: opts.schema, maxOutputTokens: maxOut, effort: /^(o\d|gpt-5)/.test(model) ? (opts.effort ?? "low") : undefined });
      await settle(usedTokens(r.usage));
      return r;
    });
  } catch (e) {
    const err = e as OpenAIError;
    if (!reserved) {
      if (process.env["IR_LANE_DEBUG"]) console.warn(`[lane] no allowance: ${err.message}`);
      return null;
    }
    if (process.env["IR_LANE_DEBUG"]) console.warn(`[lane] ${opts.name} ${model}: ${err.kind ?? ""} ${err.message?.slice(0, 200)}`);
    await settle(err.usage ? usedTokens(err.usage) : 0);
    // A bad or empty key, or a spent balance: rest the lane for an hour instead of failing every call.
    if (err instanceof OpenAIError && (err.kind === "auth" || err.kind === "quota")) {
      offUntil = Date.now() + 3_600_000;
      offReason = `paused: ${err.kind}`;
      return null;
    }
    if (opts.rethrow) throw err;
    return null;
  }
}

/**
 * The owner's paid OpenAI key once the free allowance is spent (IR_OPENAI_PAID=1, owner Nov 19).
 * Same model, no Lovable AI credits; tokens are logged per day in the same ledger as `paid_mini` /
 * `paid_large` so the worker page shows what went on the paid key. No cap by owner choice.
 */
export const paidFallback = () => process.env["IR_OPENAI_PAID"] === "1" && !!process.env["OPENAI_API_KEY"];
export async function paidStructured<T>(opts: { model: string; name: string; instructions: string; input: string | InputPart[]; schema: Record<string, unknown>; maxOutputTokens?: number; effort?: Effort }): Promise<{ data: T; usage: Usage; model: string }> {
  const tier = `paid_${tierOf(opts.model) ?? "large"}`;
  const day = allowanceDay();
  const maxOut = opts.maxOutputTokens ?? 16_000;
  const r = await guarded("openai-paid", () => openaiDirectStructured<T>({ model: opts.model, name: opts.name, instructions: opts.instructions, input: opts.input, schema: opts.schema, maxOutputTokens: maxOut, effort: /^(o\d|gpt-5)/.test(opts.model) ? (opts.effort ?? "low") : undefined }));
  const used = usedTokens(r.usage);
  // Ledger only (cap = unlimited); a failed write never fails the read.
  await supabaseAdmin.rpc("openai_allowance_take", { _day: day, _tier: tier, _tokens: used, _cap: Number.MAX_SAFE_INTEGER }).then(undefined, () => undefined);
  return r;
}

/** Share (0–1) of today's usable allowance a tier has used. */
export async function laneUsed(tier: "large" | "mini" = "mini") {
  const { data } = await supabaseAdmin.from("openai_allowance").select("tokens").eq("day", allowanceDay()).eq("tier", tier).maybeSingle();
  return (data?.tokens ?? 0) / (FREE_TIERS[tier].cap * FREE_SAFETY);
}

