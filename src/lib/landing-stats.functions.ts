import { createServerFn } from "@tanstack/react-start";

export interface LandingStats { irFacts: number | null; irDocs: number | null; supplyLinks: number | null }

/** Public aggregate counts for the home page. Returns only row-count estimates, never row data. */
export const getLandingStats = createServerFn({ method: "GET" }).handler(async (): Promise<LandingStats> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const est = async (table: "ir_kpi_facts" | "ir_documents" | "supply_links") => {
    try {
      const { count, error } = await supabaseAdmin.from(table).select("*", { count: "estimated", head: true });
      return error ? null : count ?? null;
    } catch { return null; }
  };
  const [irFacts, irDocs, supplyLinks] = await Promise.all([est("ir_kpi_facts"), est("ir_documents"), est("supply_links")]);
  return { irFacts, irDocs, supplyLinks };
});
