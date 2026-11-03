import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { IrPayload } from "@/lib/ir/payload";

const tickerSchema = z.string().regex(/^[A-Z.]{1,6}$/);
const DOC_COLUMNS = "id, source, source_url, accn, exhibit, kind, title, period, filed, ext, bytes, extract_status, extract_facts, rendition_path, pages";
const EXTRACTABLE = ["press-release", "supplement", "presentation", "data", "other"];

/** Precomputed segment/KPI series plus the company's stored IR document library. */
export const getIrData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const docs: Record<string, unknown>[] = [];
    for (let from = 0; from < 6000; from += 1000) {
      const { data: page, error } = await context.supabase
        .from("ir_documents")
        .select(DOC_COLUMNS)
        .eq("ticker", data.ticker)
        .order("filed", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      docs.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    const { data: series, error } = await context.supabase.from("ir_company_series").select("payload, built_at").eq("ticker", data.ticker).maybeSingle();
    if (error) throw new Error(error.message);
    const documents = docs.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) })) as unknown as IrDocRow[];
    const pending = documents.filter((d) => !d.extract_status && EXTRACTABLE.includes(d.kind) && d.viewable).length;
    return { payload: (series?.payload ?? null) as IrPayload | null, builtAt: series?.built_at ?? null, documents, pending };
  });

export interface IrDocRow {
  id: string;
  source: string;
  source_url: string;
  accn: string | null;
  exhibit: string | null;
  kind: string;
  title: string;
  period: string | null;
  filed: string | null;
  ext: string | null;
  bytes: number | null;
  extract_status: string | null;
  extract_facts: number | null;
  pages: number | null;
  viewable: boolean;
}

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

/**
 * Read up to two newly stored releases for one company and refresh its series. Started by the
 * user ("Read new releases"), never by a page view; each call is bounded.
 */
export const readPendingIr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: state } = await supabaseAdmin.from("job_state").select("paused_reason").eq("job", "ir-extract-runner").maybeSingle();
    if (state?.paused_reason) throw new Error(`Document reading is paused: ${state.paused_reason}`);
    const { extractIrDocument, nextToExtract } = await import("@/lib/ir/extract.server");
    const { OpenAIError } = await import("@/lib/openai.server");
    let read = 0;
    let facts = 0;
    for (let i = 0; i < 2; i++) {
      const next = await nextToExtract({ ticker: data.ticker });
      if (!next) break;
      try {
        const r = await extractIrDocument(next.id, { concurrency: 3 });
        read++;
        facts += r.facts;
      } catch (e) {
        const err = e as Error;
        const transient = err instanceof OpenAIError && (err.kind === "rate" || err.kind === "transient");
        await supabaseAdmin
          .from("ir_documents")
          .update(transient ? { extract_status: null } : { extract_status: `error: ${err.message.slice(0, 200)}`, extracted_at: new Date().toISOString() })
          .eq("id", next.id);
        if (err instanceof OpenAIError && (err.kind === "auth" || err.kind === "quota")) {
          await supabaseAdmin.from("job_state").upsert({ job: "ir-extract-runner", cursor: 0, paused_reason: err.message.slice(0, 200), updated_at: new Date().toISOString() });
        }
        throw new Error(transient ? "The AI service is busy — try again in a minute." : `Couldn't read a document: ${err.message.slice(0, 160)}`);
      }
    }
    if (read) {
      const { rebuildCompany } = await import("@/lib/ir/rebuild.server");
      await rebuildCompany(data.ticker);
    }
    return { read, facts };
  });

/** HTML of a stored IR document (or its rendition, for PDFs, spreadsheets and slide images) for the source viewer. */
export const getIrHtml = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("ir_documents").select("path, rendition_path, source_url, ext, title").eq("id", data.id).maybeSingle();
    const path = row?.rendition_path || (row?.ext?.startsWith("htm") ? row.path : null);
    if (!row || !path) throw new Error("No viewable copy of this document");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(path);
    if (error || !file) throw new Error(error?.message ?? "Download failed");
    let html = await file.text();
    // Page images are stored privately; swap placeholders for short-lived signed links.
    const assets = [...new Set([...html.matchAll(/ASSET:([\w./-]+)/g)].map((m) => m[1]))];
    if (assets.length) {
      const { data: signed } = await supabaseAdmin.storage.from("ir-documents").createSignedUrls(assets, 3600);
      const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      html = html.replace(/ASSET:([\w./-]+)/g, (m, p: string) => urls.get(p) ?? m);
    }
    return { html, contentType: "text/html", sourceUrl: row.source_url, rendition: !!row.rendition_path, title: row.title };
  });
