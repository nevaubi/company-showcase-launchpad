import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import type { ReportContent, ReportKind } from "@/lib/reports/types";

const STALE_LOCK_MS = 4 * 60_000;
const DAILY_LIMIT = 40;

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
  content: ReportContent | null;
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
 * Return the stored report for a slot, generating it when missing or out of date. Shared reports
 * (default options) are written once per data version for everyone; customized ones belong to the
 * caller or their firm. Numbers come only from server-loaded data and pass source checks.
 */
export const requestReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }): Promise<ReportRow> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeOptions, variantKey } = await import("@/lib/reports/kinds");
    const { dataVersionOf } = await import("@/lib/reports/facts");
    const options = normalizeOptions(data.kind, data.options as never);
    const variant = variantKey(options);
    const userId = context.userId;

    if (data.scope === "shared" && variant !== "base") throw new Error("Customized reports are saved to you or your firm");
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

    const slot = supabaseAdmin.from("reports").select("*").eq("ticker", data.ticker).eq("kind", data.kind).eq("scope", data.scope).eq("variant", variant);
    const scoped = data.scope === "firm" ? slot.eq("firm_id", data.firmId!).is("user_id", null)
      : data.scope === "user" ? slot.eq("user_id", userId).is("firm_id", null)
      : slot.is("firm_id", null).is("user_id", null);
    const { data: existing } = await scoped.maybeSingle();

    const { loadReportInputs } = await import("@/lib/reports/inputs.server");
    const inputs = await loadReportInputs(data.ticker, coverage);
    const version = dataVersionOf(inputs.data, inputs.today);

    const fresh = existing?.status === "ready" && existing.content && existing.data_version === version;
    if (existing && fresh && !(data.force && data.scope !== "shared")) return existing as unknown as ReportRow;
    if (existing?.status === "generating" && existing.started_at && Date.now() - Date.parse(existing.started_at) < STALE_LOCK_MS) {
      return existing as unknown as ReportRow;
    }

    const since = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("requested_by", userId).gte("started_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) throw new Error(`You've generated ${DAILY_LIMIT} reports in the last day — try again tomorrow`);

    // Claim the slot (single flight across users and tabs).
    const now = new Date().toISOString();
    let rowId: string;
    if (existing) {
      const { data: claimed } = await supabaseAdmin.from("reports")
        .update({ status: "generating", started_at: now, requested_by: userId, error: null, updated_at: now })
        .eq("id", existing.id).eq("updated_at", existing.updated_at).select("id").maybeSingle();
      if (!claimed) {
        const { data: again } = await supabaseAdmin.from("reports").select("*").eq("id", existing.id).single();
        return again as unknown as ReportRow;
      }
      rowId = existing.id;
    } else {
      const { data: created, error } = await supabaseAdmin.from("reports").insert({
        ticker: data.ticker, kind: data.kind, scope: data.scope, variant, options: options as unknown as Json,
        firm_id: data.scope === "firm" ? data.firmId! : null, user_id: data.scope === "user" ? userId : null,
        status: "generating", started_at: now, requested_by: userId, data_version: version,
      }).select("id").single();
      if (error || !created) {
        const { data: again } = await scoped.maybeSingle();
        if (again) return again as unknown as ReportRow;
        throw new Error("Couldn't start the report");
      }
      rowId = created.id;
    }

    try {
      const { generateReportContent } = await import("@/lib/reports/generate.server");
      const content = await generateReportContent(data.kind, options, inputs, firmName);
      const { data: done } = await supabaseAdmin.from("reports").update({
        status: "ready", content: content as unknown as Json, data_version: content.dataVersion, title: content.title,
        options: options as unknown as Json, error: null, updated_at: new Date().toISOString(),
      }).eq("id", rowId).select("*").single();
      return done as unknown as ReportRow;
    } catch (e) {
      const message = (e as Error).message || "Report generation failed";
      const { data: failed } = await supabaseAdmin.from("reports").update({
        status: existing?.content ? "ready" : "failed", error: message, updated_at: new Date().toISOString(),
      }).eq("id", rowId).select("*").single();
      return failed as unknown as ReportRow;
    }
  });
