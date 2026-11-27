// Coverage ledger reads for the admin Data status page. The ledger is written once a day by
// scripts/coverage.ts; the rules are pure in corpora.ts and the page's model in view.ts. A company's
// own rows are read in the browser under row-level security (read.ts), not here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CORPUS_IDS } from "./corpora";
import type { CorpusRow, MatrixPayload } from "./view";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Admins only");
}

/** Every company's state per corpus (one letter each) and 30 days of counts. */
export const getCoverageMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MatrixPayload> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("corpus_coverage_matrix");
    if (error) throw new Error(error.message);
    const p = (data ?? {}) as Partial<MatrixPayload>;
    return { checked: p.checked ?? null, corpora: p.corpora ?? [], rows: p.rows ?? {}, daily: p.daily ?? [] };
  });

/** Every company's row of one corpus: state, items, newest date and the sentence saying why. */
export const getCorpusCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ corpus: z.string().refine((c) => CORPUS_IDS.includes(c), "Unknown corpus") }).parse(d))
  .handler(async ({ data, context }): Promise<CorpusRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await supabaseAdmin.rpc("corpus_coverage_rows", { _corpus: data.corpus });
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as unknown as CorpusRow[];
  });
