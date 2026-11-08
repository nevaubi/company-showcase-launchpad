// Portfolios are stored per user in the `documents` table (kind "portfolio"), the same row-level-secured store
// the docs and sheets use, so no new table or migration is needed.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { currentUserId } from "@/lib/workspace";
import type { Holding } from "./parse";

export const PORTFOLIO_KIND = "portfolio";

export interface PortfolioContent {
  version: 1;
  holdings: Holding[];
  /** free-text note on where the holdings came from */
  source?: string;
}

export interface Portfolio {
  id: string;
  title: string;
  updated_at: string;
  content: PortfolioContent;
}

function asContent(raw: unknown): PortfolioContent {
  const c = (raw ?? {}) as Partial<PortfolioContent>;
  const holdings = Array.isArray(c.holdings)
    ? c.holdings
        .filter((h): h is Holding => !!h && typeof (h as Holding).ticker === "string")
        .map((h) => ({ ticker: h.ticker, shares: h.shares ?? null, weight: h.weight ?? null, cost: h.cost ?? null }))
    : [];
  return { version: 1, holdings, source: typeof c.source === "string" ? c.source : undefined };
}

export const portfoliosQuery = {
  queryKey: ["portfolios"],
  queryFn: async (): Promise<Portfolio[]> => {
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, updated_at, content")
      .eq("kind", PORTFOLIO_KIND)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((d) => ({ id: d.id, title: d.title, updated_at: d.updated_at, content: asContent(d.content) }));
  },
  staleTime: 60_000,
};

export const usePortfolios = () => useQuery(portfoliosQuery);

export function useSavePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id?: string; title: string; content: PortfolioContent }) => {
      const content = p.content as unknown as Json;
      if (p.id) {
        const { error } = await supabase
          .from("documents")
          .update({ title: p.title, content, updated_at: new Date().toISOString() })
          .eq("id", p.id);
        if (error) throw error;
        return p.id;
      }
      const userId = await currentUserId();
      const { data, error } = await supabase
        .from("documents")
        .insert({ user_id: userId, kind: PORTFOLIO_KIND, title: p.title, content })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolios"] }),
    onError: (e) => toast.error((e as Error).message),
  });
}

export function useDeletePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("documents").delete().eq("id", id).eq("kind", PORTFOLIO_KIND);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolios"] }),
    onError: (e) => toast.error((e as Error).message),
  });
}
