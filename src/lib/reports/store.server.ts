// One code path for writing a report slot, used by the authenticated server function and by the
// bounded background pre-writer (scripts/reports-pregen.ts). Single flight per slot, append-only run
// log for spend limits, and a failed refresh keeps the previous version readable.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { dataVersionOf } from "./facts";
import { normalizeOptions, variantKey } from "./kinds";
import type { ReportInputs, ReportKind, ReportOptions, ReportScope } from "./types";

export const STALE_LOCK_MS = 4 * 60_000;
/** Per-user generations in 24 h: standard (shared) versions and customized ones. */
export const LIMITS = { shared: 60, custom: 25 } as const;
/** All generations across the app in 24 h — a spend ceiling. */
export const GLOBAL_DAILY_LIMIT = 800;

export interface ReportMetaRow {
  id: string; ticker: string; kind: ReportKind; scope: ReportScope; firm_id: string | null; user_id: string | null;
  variant: string; status: "generating" | "ready" | "failed"; data_version: string; error: string | null;
  title: string | null; updated_at: string; started_at: string | null; options: Partial<ReportOptions>;
}
const META = "id, ticker, kind, scope, firm_id, user_id, variant, status, data_version, error, title, updated_at, started_at, options";

export interface EnsureArgs {
  ticker: string;
  kind: ReportKind;
  scope: ReportScope;
  firmId: string | null;
  firmName: string | null;
  /** Requesting user (null for the background pre-writer). */
  userId: string | null;
  options?: Partial<ReportOptions>;
  force?: boolean;
  coverage: ReportInputs["coverage"];
  source: "app" | "pregen";
}

export class ReportLimitError extends Error {}

type Admin = SupabaseClient<Database>;

function slot(admin: Admin, a: EnsureArgs, variant: string) {
  const q = admin.from("reports").select(META).eq("ticker", a.ticker).eq("kind", a.kind).eq("scope", a.scope).eq("variant", variant);
  if (a.scope === "firm") return q.eq("firm_id", a.firmId!).is("user_id", null);
  if (a.scope === "user") return q.eq("user_id", a.userId!).is("firm_id", null);
  return q.is("firm_id", null).is("user_id", null);
}

async function checkLimits(admin: Admin, a: EnsureArgs, custom: boolean) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count: all } = await admin.from("report_runs").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((all ?? 0) >= GLOBAL_DAILY_LIMIT) throw new ReportLimitError("The report desk has hit today's writing limit — existing reports stay available; new ones resume tomorrow");
  if (!a.userId) return;
  const q = admin.from("report_runs").select("id", { count: "exact", head: true }).eq("user_id", a.userId).gte("created_at", since);
  const { count } = await (custom ? q.neq("scope", "shared") : q.eq("scope", "shared"));
  const cap = custom ? LIMITS.custom : LIMITS.shared;
  if ((count ?? 0) >= cap) throw new ReportLimitError(`You've written ${cap} ${custom ? "custom" : "standard"} reports in the last day — try again tomorrow`);
}

/**
 * Return the slot's report, (re)writing it when missing, out of date, or forced (custom only).
 * Loads trusted inputs server-side; the slow AI step runs only after the slot is claimed.
 */
export async function ensureReport(admin: Admin, a: EnsureArgs, loadInputs: () => Promise<ReportInputs>): Promise<ReportMetaRow> {
  const options = normalizeOptions(a.kind, a.options);
  const variant = variantKey(options);
  if (a.scope === "shared" && variant !== "base") throw new Error("Customized reports are saved to you or your firm");
  const { data: existing } = await slot(admin, a, variant).maybeSingle();
  const ex = existing as unknown as ReportMetaRow | null;
  if (ex?.status === "generating" && ex.started_at && Date.now() - Date.parse(ex.started_at) < STALE_LOCK_MS) return ex;

  const inputs = await loadInputs();
  const version = dataVersionOf(inputs.data, inputs.today);
  const custom = a.scope !== "shared";
  if (ex?.status === "ready" && ex.data_version === version && !(a.force && custom)) return ex;

  await checkLimits(admin, a, custom);

  // Claim the slot: optimistic update on updated_at, or insert guarded by the unique slot index.
  const now = new Date().toISOString();
  let rowId: string;
  if (ex) {
    const { data: claimed } = await admin.from("reports")
      .update({ status: "generating", started_at: now, requested_by: a.userId, error: null, updated_at: now })
      .eq("id", ex.id).eq("updated_at", ex.updated_at).select("id").maybeSingle();
    if (!claimed) {
      const { data: again } = await admin.from("reports").select(META).eq("id", ex.id).single();
      return again as unknown as ReportMetaRow;
    }
    rowId = ex.id;
  } else {
    const { data: created, error } = await admin.from("reports").insert({
      ticker: a.ticker, kind: a.kind, scope: a.scope, variant, options: options as unknown as Json,
      firm_id: a.scope === "firm" ? a.firmId : null, user_id: a.scope === "user" ? a.userId : null,
      status: "generating", started_at: now, requested_by: a.userId, data_version: version,
    }).select("id").single();
    if (error || !created) {
      const { data: again } = await slot(admin, a, variant).maybeSingle();
      if (again) return again as unknown as ReportMetaRow;
      throw new Error("Couldn't start the report");
    }
    rowId = created.id;
  }

  const t0 = Date.now();
  const { data: run } = await admin.from("report_runs")
    .insert({ report_id: rowId, user_id: a.userId, ticker: a.ticker, kind: a.kind, scope: a.scope, source: a.source })
    .select("id").single();
  try {
    const { generateReportContent } = await import("./generate.server");
    const content = await generateReportContent(a.kind, options, inputs, a.firmName);
    const { data: done } = await admin.from("reports").update({
      status: "ready", content: content as unknown as Json, data_version: content.dataVersion, title: content.title,
      options: options as unknown as Json, error: null, updated_at: new Date().toISOString(),
    }).eq("id", rowId).select(META).single();
    if (run) await admin.from("report_runs").update({ status: "ready", ms: Date.now() - t0 }).eq("id", run.id);
    return done as unknown as ReportMetaRow;
  } catch (e) {
    const message = (e as Error).message || "Report generation failed";
    const { data: failed } = await admin.from("reports").update({
      status: ex?.status === "ready" || ex?.title ? "ready" : "failed", error: message, updated_at: new Date().toISOString(),
    }).eq("id", rowId).select(META).single();
    if (run) await admin.from("report_runs").update({ status: "failed", ms: Date.now() - t0, error: message.slice(0, 500) }).eq("id", run.id);
    return failed as unknown as ReportMetaRow;
  }
}
