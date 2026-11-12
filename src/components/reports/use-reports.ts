import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestReport, type ReportRow } from "@/lib/reports.functions";
import type { ReportContent, ReportKind, ReportOptions, ReportScope } from "@/lib/reports/types";

export type ReportMeta = Omit<ReportRow, "content"> & { options: Partial<ReportOptions>; started_at: string | null };
const META = "id, ticker, kind, scope, firm_id, user_id, variant, status, data_version, error, title, updated_at, options, started_at";

export function useReportList(ticker?: string) {
  return useQuery({
    queryKey: ["reports", ticker ?? "all"],
    queryFn: async () => {
      let q = supabase.from("reports").select(META).order("updated_at", { ascending: false }).limit(ticker ? 100 : 400);
      if (ticker) q = q.eq("ticker", ticker);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as ReportMeta[];
    },
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === "generating") ? 4000 : false),
  });
}

export function useReportContent(id: string | null | undefined, updatedAt?: string) {
  return useQuery({
    queryKey: ["report", id, updatedAt],
    enabled: !!id,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("reports").select("content").eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data?.content as unknown as ReportContent) ?? null;
    },
  });
}

export interface ReportRequest { ticker: string; kind: ReportKind; scope: ReportScope; firmId?: string | null; options?: Partial<ReportOptions>; force?: boolean }

export function useRequestReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: ReportRequest) => requestReport({ data: { ...r, firmId: r.firmId ?? null } }),
    onMutate: () => {
      // Let other views pick up the "generating" row quickly.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["reports"] }), 1500);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      if (row.status === "failed") toast.error(row.error ?? "The report couldn't be written");
      else if (row.status === "ready" && row.error) toast.error(`Refresh failed — showing the previous version. ${row.error}`);
    },
    onError: (e) => { qc.invalidateQueries({ queryKey: ["reports"] }); toast.error((e as Error).message); },
  });
}

export interface TemplateRow { id: string; firm_id: string | null; user_id: string | null; name: string; kind: ReportKind; options: Partial<ReportOptions>; created_by: string; created_at: string }

export function useTemplates(kind: ReportKind) {
  return useQuery({
    queryKey: ["report-templates", kind],
    queryFn: async () => {
      const { data, error } = await supabase.from("report_templates").select("*").eq("kind", kind).order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as TemplateRow[];
    },
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: { name: string; kind: ReportKind; options: ReportOptions; firmId: string | null; userId: string }) => {
      const { error } = await supabase.from("report_templates").insert({
        name: t.name, kind: t.kind, options: t.options as never, firm_id: t.firmId, user_id: t.firmId ? null : t.userId, created_by: t.userId,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-templates"] }); toast.success("Template saved"); },
    onError: (e) => toast.error((e as Error).message),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("report_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-templates"] }),
    onError: (e) => toast.error((e as Error).message),
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); toast.success("Version deleted"); },
    onError: (e) => toast.error((e as Error).message),
  });
}

/** Human summary of a customized variant's options. */
export function optionsSummary(o: Partial<ReportOptions> | null | undefined): string {
  if (!o) return "Standard";
  const parts: string[] = [];
  if (o.length && o.length !== "standard") parts.push(o.length === "deep" ? "In-depth" : "Brief");
  if (o.audience && o.audience !== "internal") parts.push({ pm: "for PM", ic: "for IC", client: "client-ready" }[o.audience] ?? "");
  if (o.stance && o.stance !== "balanced") parts.push(o.stance);
  if (o.sections?.length) parts.push(`${o.sections.length} sections`);
  if (o.focus) parts.push(`“${o.focus.slice(0, 40)}${o.focus.length > 40 ? "…" : ""}”`);
  return parts.filter(Boolean).join(" · ") || "Standard";
}
