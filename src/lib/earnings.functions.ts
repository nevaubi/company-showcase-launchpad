import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { coverageOf } from "@/lib/coverage";
import { type TrackedPromise } from "@/lib/earnings/promises";

/**
 * Management promise tracker: reads the last few earnings calls, extracts forward-looking
 * commitments and grades each against later calls. Only promises whose quotes are verbatim
 * in the cited call survive (`vetPromises`), and a grade needs a verbatim later-call quote.
 */
export const getPromises = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8) }).parse(d))
  .handler(async ({ data }): Promise<{ promises: TrackedPromise[]; calls: { url: string; date: string; quarter: string | null }[]; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { promises: [], calls: [], error: "Not a covered company" };
    const { storedPromises } = await import("./earnings/promises.server");
    return storedPromises(co);
  });

/** Earnings preview (next print) and recap (latest print); may only cite browser-assembled fact ids. */
export const getEarningsNotes = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
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
