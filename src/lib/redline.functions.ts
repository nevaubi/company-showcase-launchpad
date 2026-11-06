import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RedlineSummary } from "@/lib/redline/summary";

const accn = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);

/**
 * Cited "what changed" brief for a stored filing comparison. Written once per comparison and shared;
 * bullets survive only if their quote is verbatim in the cited change.
 */
export const summarizeRedline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ fromAccn: accn, toAccn: accn }).parse(d))
  .handler(async ({ data, context }): Promise<RedlineSummary> => {
    const { REDLINE_VERSION } = await import("@/lib/redline/core");
    const { data: row, error } = await context.supabase.from("filing_redlines").select("id, ticker, payload, summary")
      .eq("from_accn", data.fromAccn).eq("to_accn", data.toAccn).eq("version", REDLINE_VERSION).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This comparison isn't stored yet, so it can't be summarised");
    if (row.summary) return row.summary as unknown as RedlineSummary;

    const { summaryPrompt, summaryCandidates, vetSummary, SUMMARY_SCHEMA } = await import("@/lib/redline/summary");
    const { coverageOf } = await import("@/lib/coverage");
    const r = row.payload as unknown as import("@/lib/redline/core").Redline;
    if (!summaryCandidates(r).length) {
      return { headline: "No substantive wording changes beyond updated figures and dates.", bullets: [], model: "none", createdAt: new Date().toISOString(), dropped: 0 };
    }
    const { structured, MODEL } = await import("@/lib/ai.server");
    const p = summaryPrompt(r, coverageOf(row.ticker)?.shortName ?? row.ticker);
    const out = await structured<{ headline: string; bullets: { text: string; changeIds: string[]; quote: string }[] }>({
      name: "filing_changes", instructions: p.instructions, input: p.input, schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>, effort: "low",
    });
    const v = vetSummary(out, r);
    const summary: RedlineSummary = { headline: v.headline, bullets: v.bullets, model: MODEL, createdAt: new Date().toISOString(), dropped: v.dropped };
    if (v.bullets.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // First writer wins, so concurrent viewers all end up seeing the same brief.
      const { data: wrote } = await supabaseAdmin.from("filing_redlines").update({ summary: summary as never }).eq("id", row.id).is("summary", null).select("id");
      if (!wrote?.length) {
        const { data: again } = await supabaseAdmin.from("filing_redlines").select("summary").eq("id", row.id).maybeSingle();
        if (again?.summary) return again.summary as unknown as RedlineSummary;
      }
    }
    return summary;
  });
