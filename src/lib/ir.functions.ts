import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const tickerSchema = z.string().regex(/^[A-Z.]{1,6}$/);

/** Stored IR documents and the segment/KPI facts extracted from them. */
export const getIrData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const [docs, facts] = await Promise.all([
      context.supabase
        .from("ir_documents")
        .select("id, source, source_url, accn, exhibit, kind, title, period, filed, ext, bytes, extract_status, extract_facts")
        .eq("ticker", data.ticker)
        .order("filed", { ascending: false, nullsFirst: false })
        .limit(2000),
      context.supabase
        .from("ir_kpi_facts")
        .select("category, metric, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator")
        .eq("ticker", data.ticker)
        .limit(20000),
    ]);
    if (docs.error) throw new Error(docs.error.message);
    if (facts.error) throw new Error(facts.error.message);
    return { documents: docs.data ?? [], facts: facts.data ?? [] };
  });

/** Short-lived download link for a stored IR file. */
export const getIrDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("ir_documents").select("path, title, ext").eq("id", data.id).maybeSingle();
    if (!row?.path) throw new Error("Document not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const name = `${row.title.replace(/[^\w .-]+/g, "").slice(0, 80) || "document"}.${row.ext ?? "bin"}`;
    const { data: signed, error } = await supabaseAdmin.storage.from("ir-documents").createSignedUrl(row.path, 600, { download: name });
    if (error || !signed) throw new Error(error?.message ?? "Couldn't create link");
    return { url: signed.signedUrl };
  });

/** Read one waiting release for this company (runs when someone opens the IR tab). */
export const extractNextIr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data }) => {
    const { extractIrDocument, nextToExtract } = await import("@/lib/ir/extract.server");
    const next = await nextToExtract(data.ticker);
    if (!next) return { done: true, facts: 0 };
    try {
      const r = await extractIrDocument(next.id);
      return { done: false, facts: r.facts };
    } catch (e) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("ir_documents").update({ extracted_at: new Date().toISOString(), extract_status: `error: ${(e as Error).message.slice(0, 200)}` }).eq("id", next.id);
      return { done: false, facts: 0, error: (e as Error).message };
    }
  });
