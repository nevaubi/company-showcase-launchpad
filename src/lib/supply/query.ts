import { supabase } from "@/integrations/supabase/client";
import type { RiskLink } from "./core";

export const supplyLinksQuery = {
  queryKey: ["supply_links"],
  queryFn: async () => {
    const out: RiskLink[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("supply_links").select("*").range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as unknown as RiskLink[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  },
  staleTime: 10 * 60_000,
};
