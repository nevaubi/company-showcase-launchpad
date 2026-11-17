import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { seedStarterWorkspace } from "./onboarding.functions";
import type { OnboardingRow } from "./core";

const KEY = ["onboarding"];

export function useOnboarding() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<(OnboardingRow & { user_id: string }) | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase.from("user_onboarding").select("*").eq("user_id", auth.user.id).maybeSingle();
      return (data as never) ?? { user_id: auth.user.id, seeded_at: null, tour_done_at: null, checklist: {}, dismissed: false };
    },
    staleTime: 60_000,
  });
  const patch = useCallback(async (p: Partial<OnboardingRow>) => {
    const cur = qc.getQueryData<OnboardingRow & { user_id: string }>(KEY);
    if (!cur) return;
    qc.setQueryData(KEY, { ...cur, ...p });
    await supabase.from("user_onboarding").upsert({ user_id: cur.user_id, ...p, updated_at: new Date().toISOString() } as never, { onConflict: "user_id" });
  }, [qc]);
  const tick = useCallback((id: string) => {
    const cur = qc.getQueryData<OnboardingRow>(KEY);
    if (!cur || cur.checklist?.[id]) return;
    void patch({ checklist: { ...(cur.checklist ?? {}), [id]: true } });
  }, [qc, patch]);
  return { data: q.data, patch, tick };
}

/** Runs the one-time starter workspace seed, then refreshes watchlist/office lists. */
export function useStarterSeed(row: OnboardingRow | null | undefined) {
  const seed = useServerFn(seedStarterWorkspace);
  const qc = useQueryClient();
  useEffect(() => {
    if (!row || row.seeded_at) return;
    seed().then((r) => { if (r.seeded) void qc.invalidateQueries(); }).catch(() => undefined);
  }, [row?.seeded_at, row === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const startTour = () => window.dispatchEvent(new CustomEvent("fu:tour"));
export const openShortcuts = () => window.dispatchEvent(new CustomEvent("fu:shortcuts"));
