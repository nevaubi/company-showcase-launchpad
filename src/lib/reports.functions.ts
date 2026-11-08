import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ReportKind, ReportOptions } from "@/lib/reports/types";

/** A report slot without its (large) content; the browser reads content directly under RLS. */
export interface ReportRow {
  id: string;
  ticker: string;
  kind: ReportKind;
  scope: "shared" | "firm" | "user";
  firm_id: string | null;
  user_id: string | null;
  variant: string;
  status: "generating" | "ready" | "failed";
  data_version: string;
  error: string | null;
  title: string | null;
  updated_at: string;
  started_at: string | null;
  options: Partial<ReportOptions>;
}

const input = z.object({
  ticker: z.string().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/),
  kind: z.enum(["primer", "preview", "recap", "memo"]),
  scope: z.enum(["shared", "firm", "user"]),
  firmId: z.string().uuid().nullable().optional(),
  options: z.object({
    length: z.string().optional(), audience: z.string().optional(), stance: z.string().optional(),
    sections: z.array(z.string().max(30)).max(12).optional(), focus: z.string().max(400).optional(),
  }).partial().optional(),
  force: z.boolean().optional(),
});

/**
 * Return the stored report for a slot, writing it when missing or out of date. Standard reports
 * (default options) are written once per data version for everyone; customized ones belong to the
 * caller or their firm. Numbers come only from server-loaded data and pass source checks.
 */
export const requestReport = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }): Promise<ReportRow> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureReport } = await import("@/lib/reports/store.server");
    const { loadReportInputs } = await import("@/lib/reports/inputs.server");
    const { coverageOf } = await import("@/lib/coverage");
    if (!coverageOf(data.ticker)) throw new Error("That company isn't covered");
    const userId = context.userId;
    // Shared standard reports are the library (free to read); custom or forced rebuilds use AI credits.
    if (data.scope !== "shared" || data.force) {
      const { chargeUsage } = await import("@/lib/billing/charge");
      await chargeUsage(context.supabase, "report");
    }

    let firmName: string | null = null;
    let coverage = null as import("@/lib/reports/types").ReportInputs["coverage"];
    if (data.scope === "firm") {
      if (!data.firmId) throw new Error("Choose a firm");
      const { data: ok } = await context.supabase.rpc("has_firm_role", { _firm: data.firmId, _user: userId, _min: "analyst" });
      if (!ok) throw new Error("Only firm analysts and admins can create firm reports");
      const [{ data: firm }, { data: cov }] = await Promise.all([
        context.supabase.from("firms").select("name").eq("id", data.firmId).maybeSingle(),
        context.supabase.from("firm_coverage").select("rating, target_price, analyst_id, updated_at").eq("firm_id", data.firmId).eq("ticker", data.ticker).maybeSingle(),
      ]);
      firmName = firm?.name ?? null;
      if (cov && firmName) {
        const { RATING_LABEL } = await import("@/lib/firm/core");
        const { data: analyst } = cov.analyst_id
          ? await context.supabase.from("firm_members").select("display_name, email").eq("firm_id", data.firmId).eq("user_id", cov.analyst_id).maybeSingle()
          : { data: null };
        coverage = { firm: firmName, rating: RATING_LABEL[cov.rating as keyof typeof RATING_LABEL] ?? cov.rating, target: cov.target_price, analyst: analyst ? analyst.display_name || analyst.email : null, updatedAt: cov.updated_at };
      }
    }

    return ensureReport(supabaseAdmin, {
      ticker: data.ticker, kind: data.kind, scope: data.scope, firmId: data.scope === "firm" ? data.firmId! : null, firmName,
      userId, options: data.options as Partial<ReportOptions> | undefined, force: data.force, coverage, source: "app",
    }, () => loadReportInputs(data.ticker, coverage));
  });
