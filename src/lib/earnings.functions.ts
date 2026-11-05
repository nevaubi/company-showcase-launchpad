import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coverageOf } from "@/lib/coverage";
import { vetPromises, type CallText, type RawPromise, type TrackedPromise } from "@/lib/earnings/promises";

/**
 * Management promise tracker: reads the last few earnings calls, extracts forward-looking
 * commitments and grades each against later calls. Only promises whose quotes are verbatim
 * in the cited call survive (`vetPromises`), and a grade needs a verbatim later-call quote.
 */
export const getPromises = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8) }).parse(d))
  .handler(async ({ data }): Promise<{ promises: TrackedPromise[]; calls: { url: string; date: string; quarter: string | null }[]; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { promises: [], calls: [], error: "Not a covered company" };
    const { listCalls, loadTranscript } = await import("@/lib/transcripts.server");
    const list = await listCalls(co);
    const refs = list.calls.slice(0, 5);
    if (!refs.length) return { promises: [], calls: [], error: list.error ?? "No earnings calls found" };
    const { cached, structured } = await import("@/lib/ai.server");
    return cached(
      `promises:v1:${co.ticker}:${refs[0].date}`,
      30 * 86400_000,
      async () => {
        const loaded = await Promise.all(refs.map((r) => loadTranscript(co, r.url).catch(() => ({ transcript: null }))));
        const calls: CallText[] = loaded
          .map((l, i) => (l.transcript ? { url: refs[i].url, date: refs[i].date!, quarter: refs[i].quarter ?? null, text: l.transcript.turns.filter((t) => t.kind === "management").map((t) => t.text).join("\n") } : null))
          .filter((c): c is CallText => !!c)
          .sort((a, b) => a.date.localeCompare(b.date));
        if (calls.length < 2) return { promises: [], calls, error: "Need at least two readable calls" };
        const res = await structured<{ promises: RawPromise[] }>({
          name: "promises",
          effort: "medium",
          instructions:
            "You track whether management keeps its word. From the earnings-call management remarks below (oldest first, each headed by its call date), list concrete forward-looking commitments: numeric guidance, margin/growth targets, product or plant launch dates, capex/buyback/dividend plans, cost programs, debt targets. Skip vague aspirations. 'quote' MUST be copied character-for-character from that call (one or two sentences). Then grade each against LATER calls only: kept / missed / partial, with 'outcomeQuote' copied character-for-character from the later call and its outcomeCallDate; if no later call settles it, status 'pending' with outcomeQuote and outcomeCallDate null. summary: one plain sentence of what was promised. note: one short sentence explaining the grade. deadline: the stated timeframe or null. 8-20 promises, prefer ones that are gradable.",
          input: calls.map((c) => `=== CALL ${c.date} (${c.quarter ?? ""}) ===\n${c.text.slice(0, 40_000)}`).join("\n\n"),
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["promises"],
            properties: {
              promises: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["quote", "callDate", "category", "summary", "deadline", "status", "outcomeQuote", "outcomeCallDate", "note"],
                  properties: {
                    quote: { type: "string" },
                    callDate: { type: "string" },
                    category: { type: "string", enum: ["guidance", "margin", "growth", "product", "capital", "cost", "balance sheet", "other"] },
                    summary: { type: "string" },
                    deadline: { type: ["string", "null"] },
                    status: { type: "string", enum: ["kept", "missed", "partial", "pending"] },
                    outcomeQuote: { type: ["string", "null"] },
                    outcomeCallDate: { type: ["string", "null"] },
                    note: { type: "string" },
                  },
                },
              },
            },
          },
        });
        return { promises: vetPromises(res.promises ?? [], calls), calls: calls.map(({ url, date, quarter }) => ({ url, date, quarter })) };
      },
      (r) => r.promises.length > 0,
    );
  });

/** Earnings preview (next print) and recap (latest print); may only cite browser-assembled fact ids. */
export const getEarningsNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ticker: z.string().min(1).max(8),
        key: z.string().max(80),
        facts: z.array(z.object({ id: z.string().max(12), area: z.string().max(30), text: z.string().max(700) })).max(160),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const co = coverageOf(data.ticker);
    if (!co) throw new Error("Not a covered company");
    const { cached, structured } = await import("@/lib/ai.server");
    const bullet = { type: "object", additionalProperties: false, required: ["text", "factIds"], properties: { text: { type: "string" }, factIds: { type: "array", items: { type: "string" } } } };
    return cached(`earnings-notes:v1:${co.ticker}:${data.key}`, 24 * 3600_000, () =>
      structured<{ recap: { headline: string; changed: { text: string; factIds: string[] }[] }; preview: { headline: string; watch: { text: string; factIds: string[] }[]; risks: { text: string; factIds: string[] }[] } }>({
        name: "earnings_notes",
        effort: "medium",
        instructions: `You are a sell-side analyst covering ${co.shortName} (${co.ticker}). Using ONLY the numbered facts (SEC-reported quarterly numbers, earnings releases, historical price reactions, tracked management promises, insider trades, trade setups), write: (1) RECAP of the latest reported quarter — what changed versus the prior quarter and a year ago, and which promises were kept or missed; (2) PREVIEW of the next print — the 3-6 things to watch and 2-4 risks, grounded in trends and open promises. Every bullet cites the fact ids it uses; never state a number that isn't in a cited fact. No price targets, no hype.`,
        input: data.facts.map((f) => `[${f.id}] (${f.area}) ${f.text}`).join("\n"),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["recap", "preview"],
          properties: {
            recap: { type: "object", additionalProperties: false, required: ["headline", "changed"], properties: { headline: { type: "string" }, changed: { type: "array", items: bullet } } },
            preview: { type: "object", additionalProperties: false, required: ["headline", "watch", "risks"], properties: { headline: { type: "string" }, watch: { type: "array", items: bullet }, risks: { type: "array", items: bullet } } },
          },
        },
      }),
    );
  });
