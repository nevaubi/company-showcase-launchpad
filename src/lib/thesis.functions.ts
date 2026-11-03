import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ThesisReview {
  verdict: "intact" | "weakening" | "broken" | "strengthening";
  summary: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  watch: string[];
}

/** AI review of a saved thesis against the latest reported fundamentals and price. */
export const reviewThesis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        thesisId: z.string().uuid(),
        price: z.number().positive().nullable(),
        fundamentals: z.string().max(6000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ThesisReview & { reviewedAt: string }> => {
    const { data: thesis, error } = await context.supabase.from("theses").select("*, thesis_updates(kind, body, created_at)").eq("id", data.thesisId).single();
    if (error || !thesis) throw new Error("Thesis not found");
    const { structured } = await import("@/lib/ai.server");
    const updates = ((thesis.thesis_updates ?? []) as { kind: string; body: string; created_at: string }[])
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .map((u) => `- ${u.created_at.slice(0, 10)} [${u.kind}] ${u.body}`)
      .join("\n");
    const out = await structured<ThesisReview>({
      name: "thesis_review",
      effort: "medium",
      instructions:
        "You are a skeptical portfolio manager reviewing an analyst's investment thesis. Judge it only against the reported fundamentals and price data provided — quote specific figures and periods. Be direct about what the data supports and contradicts. Each bullet under 30 words.",
      input: `Ticker: ${thesis.ticker}\nStance: ${thesis.stance} (conviction ${thesis.conviction}/5)\nTitle: ${thesis.title}\nEntry: ${thesis.entry_price ?? "n/a"} · Target: ${thesis.target_price ?? "n/a"} · Horizon: ${thesis.horizon ?? "n/a"} · Opened ${thesis.created_at.slice(0, 10)}\nCurrent price: ${data.price ?? "n/a"}\n\nThesis:\n${thesis.summary}\n\nCatalysts: ${thesis.catalysts.join("; ")}\nRisks: ${thesis.risks.join("; ")}\n\nAnalyst log:\n${updates || "(none)"}\n\nLatest reported fundamentals (from SEC filings):\n${data.fundamentals}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["verdict", "summary", "evidenceFor", "evidenceAgainst", "watch"],
        properties: {
          verdict: { type: "string", enum: ["intact", "weakening", "broken", "strengthening"] },
          summary: { type: "string" },
          evidenceFor: { type: "array", items: { type: "string" } },
          evidenceAgainst: { type: "array", items: { type: "string" } },
          watch: { type: "array", items: { type: "string" } },
        },
      },
    });
    return { ...out, reviewedAt: new Date().toISOString() };
  });
