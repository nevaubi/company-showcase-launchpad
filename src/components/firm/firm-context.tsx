import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { canAct, type FirmBranding, type FirmRole, type Rating } from "@/lib/firm/core";

export interface FirmSummary { id: string; name: string; branding: FirmBranding; created_at: string; role: FirmRole }
export interface FirmMember { firm_id: string; user_id: string; role: FirmRole; email: string | null; display_name: string | null; title: string | null; joined_at: string }
export interface CoverageRow {
  firm_id: string; ticker: string; analyst_id: string | null; rating: Rating; target_price: number | null; priority: number;
  restricted: boolean; restricted_reason: string | null; note: string | null; updated_at: string; updated_by: string | null; created_at: string;
}

interface FirmCtx {
  userId: string | null;
  firms: FirmSummary[];
  firm: FirmSummary | null;
  role: FirmRole | null;
  can: (min: FirmRole) => boolean;
  setActive: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<FirmCtx | null>(null);
const KEY = "fu:firm";

export function FirmProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => setActiveId(localStorage.getItem(KEY)), []);
  const q = useQuery({
    queryKey: ["firms"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { userId: null, firms: [] as FirmSummary[] };
      const { data, error } = await supabase
        .from("firm_members")
        .select("role, firm:firms(id, name, branding, created_at)")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      const firms = (data ?? [])
        .filter((r) => r.firm)
        .map((r) => ({ ...(r.firm as unknown as Omit<FirmSummary, "role">), role: r.role as FirmRole }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { userId: auth.user.id, firms };
    },
    staleTime: 60_000,
  });
  const firms = q.data?.firms ?? [];
  const firm = firms.find((f) => f.id === activeId) ?? firms[0] ?? null;
  const setActive = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setActiveId(id);
  }, []);
  const value = useMemo<FirmCtx>(() => ({
    userId: q.data?.userId ?? null,
    firms,
    firm,
    role: firm?.role ?? null,
    can: (min) => canAct(firm?.role, min),
    setActive,
    loading: q.isLoading,
  }), [q.data, firms, firm, setActive, q.isLoading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFirm(): FirmCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFirm must be used inside FirmProvider");
  return c;
}

export function useFirmMembers(firmId: string | null | undefined) {
  return useQuery({
    queryKey: ["firm-members", firmId],
    enabled: !!firmId,
    queryFn: async () => {
      const { data, error } = await supabase.from("firm_members").select("*").eq("firm_id", firmId!).order("joined_at");
      if (error) throw error;
      return data as FirmMember[];
    },
    staleTime: 60_000,
  });
}

export function memberName(m: Pick<FirmMember, "display_name" | "email"> | undefined | null): string {
  return m?.display_name || m?.email?.split("@")[0] || "Former member";
}

export function useFirmLogo(firmId: string | null | undefined) {
  return useQuery({
    queryKey: ["firm-logo", firmId],
    enabled: !!firmId,
    queryFn: async () => {
      const { data, error } = await supabase.from("firms").select("logo_data").eq("id", firmId!).maybeSingle();
      if (error) throw error;
      return data?.logo_data ?? null;
    },
    staleTime: 10 * 60_000,
  });
}

export function useCoverage(firmId: string | null | undefined) {
  return useQuery({
    queryKey: ["firm-coverage", firmId],
    enabled: !!firmId,
    queryFn: async () => {
      const { data, error } = await supabase.from("firm_coverage").select("*").eq("firm_id", firmId!).order("ticker");
      if (error) throw error;
      return data as CoverageRow[];
    },
    staleTime: 30_000,
  });
}

/** Insert or patch a coverage row; database triggers enforce restricted-list and analyst rules. */
export function useSaveCoverage(firmId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticker, patch, create }: { ticker: string; patch: Partial<CoverageRow>; create?: boolean }) => {
      if (!firmId) throw new Error("Choose a firm first");
      if (create) {
        const { error } = await supabase.from("firm_coverage").insert({ firm_id: firmId, ticker, ...patch });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("firm_coverage").update(patch).eq("firm_id", firmId).eq("ticker", ticker);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firm-coverage", firmId] });
      qc.invalidateQueries({ queryKey: ["firm-activity", firmId] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

export function useRemoveCoverage(firmId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticker: string) => {
      const { error } = await supabase.from("firm_coverage").delete().eq("firm_id", firmId!).eq("ticker", ticker);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firm-coverage", firmId] });
      qc.invalidateQueries({ queryKey: ["firm-activity", firmId] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

export function friendlyError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/row-level security|permission denied/i.test(m)) return "Your firm role doesn't allow that change.";
  if (/duplicate key/i.test(m)) return "That already exists.";
  return m;
}
