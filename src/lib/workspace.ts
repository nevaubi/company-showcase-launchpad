import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type AppPath =
  | "/app"
  | "/app/companies"
  | "/app/screener"
  | "/app/kpis"
  | "/app/compare"
  | "/app/filings"
  | "/app/situations"
  | "/app/markets"
  | "/app/calendars"
  | "/app/sectors"
  | "/app/alt-data"
  | "/app/hedge-funds"
  | "/app/supply-chain"
  | "/app/ideas"
  | "/app/macro"
  | "/app/theses"
  | "/app/research"
  | "/app/docs"
  | "/app/reports"
  | "/app/firm"
  | "/app/status";

export async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("You're signed out. Sign in again to continue.");
  return data.user.id;
}

export function useProfile() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
      return { user: auth.user, profile: data };
    },
    staleTime: 5 * 60_000,
  });
}

export function useWatchlist() {
  return useQuery({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const { data, error } = await supabase.from("watchlist").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useToggleFollow() {
  const qc = useQueryClient();
  const watch = useWatchlist();
  const followed = new Set((watch.data ?? []).map((w) => w.ticker));
  const m = useMutation({
    mutationFn: async (ticker: string) => {
      const userId = await currentUserId();
      if (followed.has(ticker)) {
        const { error } = await supabase.from("watchlist").delete().eq("ticker", ticker).eq("user_id", userId);
        if (error) throw error;
        return { ticker, followed: false };
      }
      const { error } = await supabase.from("watchlist").insert({ ticker, user_id: userId });
      if (error) throw error;
      return { ticker, followed: true };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      toast.success(r.followed ? `Following ${r.ticker}` : `Unfollowed ${r.ticker}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return { toggle: m.mutate, pending: m.isPending, isFollowed: (t: string) => followed.has(t) };
}
