import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RedlineSummary } from "@/lib/redline/summary";

const accn = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
const doc = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.\-/]+$/)
  .refine((d) => !d.includes(".."), "invalid document path");
const ref = z.object({
  accn,
  doc,
  form: z.string().max(12),
  filed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  report: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

async function filingHtml(cik: string, accnNo: string, docName: string): Promise<string> {
  const { cacheFilingDocument, readCachedFiling } = await import("@/lib/jobs/jobs.server");
  try {
    const cached = await readCachedFiling(accnNo, docName);
    if (cached) return cached.html;
  } catch (e) {
    console.warn("filing cache read failed", (e as Error).message);
  }
  const { archiveUrl, fetchSec } = await import("@/lib/sec.server");
  const res = await fetchSec(archiveUrl(cik, accnNo, docName));
  const contentType = res.headers.get("content-type") ?? "text/html";
  const text = await res.text();
  try {
    await cacheFilingDocument(cik, accnNo, docName, text, contentType);
  } catch (e) {
    console.warn("filing cache write failed", (e as Error).message);
  }
  return text;
}

/**
 * Builds a filing comparison on the server when it was not precomputed, stores it in filing_redlines (so every
 * later viewer reads it instantly) and returns it. The browser never downloads or diffs the two filings.
 */
export const computeRedline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ticker: z.string().regex(/^[A-Z0-9.-]{1,12}$/),
        cik: z.string().regex(/^\d{1,10}$/),
        form: z.enum(["10-K", "10-Q"]),
        from: ref,
        to: ref,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { REDLINE_VERSION, buildRedline, compactRedline } = await import("@/lib/redline/core");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("filing_redlines")
      .select("payload, summary")
      .eq("from_accn", data.from.accn)
      .eq("to_accn", data.to.accn)
      .eq("version", REDLINE_VERSION)
      .maybeSingle();
    if (row)
      return {
        redline: row.payload as unknown as import("@/lib/redline/core").Redline,
        summary: (row.summary as unknown as RedlineSummary) ?? null,
        stored: true,
      };
    const [oldHtml, newHtml] = await Promise.all([
      filingHtml(data.cik, data.from.accn, data.from.doc),
      filingHtml(data.cik, data.to.accn, data.to.doc),
    ]);
    const fromRef = { ...data.from, report: data.from.report ?? undefined };
    const toRef = { ...data.to, report: data.to.report ?? undefined };
    const r = compactRedline(
      buildRedline({
        ticker: data.ticker,
        form: data.form,
        from: fromRef,
        to: toRef,
        oldHtml,
        newHtml,
      }),
    );
    if (r.sections.some((s) => s.found === "both")) {
      const high = r.changes.filter((c) => c.level === "high").length;
      const medium = r.changes.filter((c) => c.level === "medium").length;
      const { error } = await supabaseAdmin.from("filing_redlines").upsert(
        {
          ticker: data.ticker,
          form: data.form,
          from_accn: data.from.accn,
          to_accn: data.to.accn,
          to_filed: data.to.filed,
          version: REDLINE_VERSION,
          stats: r.sections as never,
          high,
          medium,
          payload: r as never,
          summary: null,
        },
        { onConflict: "from_accn,to_accn,version" },
      );
      if (error) console.warn("redline store failed", error.message);
    }
    return { redline: r, summary: null, stored: false };
  });

/**
 * Cited "what changed" brief for a stored filing comparison. Written once per comparison and shared;
 * bullets survive only if their quote is verbatim in the cited change.
 */
export const summarizeRedline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ fromAccn: accn, toAccn: accn }).parse(d))
  .handler(async ({ data, context }): Promise<RedlineSummary> => {
    const { REDLINE_VERSION } = await import("@/lib/redline/core");
    const { data: row, error } = await context.supabase
      .from("filing_redlines")
      .select("id, ticker, payload, summary")
      .eq("from_accn", data.fromAccn)
      .eq("to_accn", data.toAccn)
      .eq("version", REDLINE_VERSION)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This comparison isn't stored yet, so it can't be summarised");
    if (row.summary) return row.summary as unknown as RedlineSummary;

    const { summaryPrompt, summaryCandidates, vetSummary, SUMMARY_SCHEMA } =
      await import("@/lib/redline/summary");
    const { coverageOf } = await import("@/lib/coverage");
    const r = row.payload as unknown as import("@/lib/redline/core").Redline;
    if (!summaryCandidates(r).length) {
      return {
        headline: "No substantive wording changes beyond updated figures and dates.",
        bullets: [],
        model: "none",
        createdAt: new Date().toISOString(),
        dropped: 0,
      };
    }
    const { structured, MODEL } = await import("@/lib/ai.server");
    const p = summaryPrompt(r, coverageOf(row.ticker)?.shortName ?? row.ticker);
    const out = await structured<{
      headline: string;
      bullets: { text: string; changeIds: string[]; quote: string }[];
    }>({
      name: "filing_changes",
      instructions: p.instructions,
      input: p.input,
      schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
    });
    const v = vetSummary(out, r);
    const summary: RedlineSummary = {
      headline: v.headline,
      bullets: v.bullets,
      model: MODEL,
      createdAt: new Date().toISOString(),
      dropped: v.dropped,
    };
    if (v.bullets.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // First writer wins, so concurrent viewers all end up seeing the same brief.
      const { data: wrote } = await supabaseAdmin
        .from("filing_redlines")
        .update({ summary: summary as never })
        .eq("id", row.id)
        .is("summary", null)
        .select("id");
      if (!wrote?.length) {
        const { data: again } = await supabaseAdmin
          .from("filing_redlines")
          .select("summary")
          .eq("id", row.id)
          .maybeSingle();
        if (again?.summary) return again.summary as unknown as RedlineSummary;
      }
    }
    return summary;
  });
