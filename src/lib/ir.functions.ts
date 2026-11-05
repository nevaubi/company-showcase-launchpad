import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { IrPayload } from "@/lib/ir/payload";

const tickerSchema = z.string().regex(/^[A-Z.]{1,6}$/);
const DOC_COLUMNS = "id, source, source_url, accn, exhibit, kind, title, period, filed, ext, bytes, extract_status, extract_facts, rendition_path, pages";
const EXTRACTABLE = ["press-release", "supplement", "presentation", "data", "other"];
const rebuilding = new Map<string, Promise<IrPayload | null>>();

/** Precomputed segment/KPI series plus the company's stored IR document library. */
export const getIrData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data, context }) => {
    // The document list and the precomputed breakdowns load in parallel.
    // Slide images (thousands per bank) load on demand in the library; only their count comes here.
    const loadDocs = async () => {
      const docs: Record<string, unknown>[] = [];
      for (let from = 0; from < 20_000; from += 1000) {
        const { data: page, error } = await context.supabase
          .from("ir_documents")
          .select(DOC_COLUMNS)
          .eq("ticker", data.ticker)
          .neq("kind", "image")
          .order("filed", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        docs.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
      return docs;
    };
    const loadSeries = async () => {
      const { data: series, error } = await context.supabase.from("ir_company_series").select("payload, payload_path, built_at").eq("ticker", data.ticker).maybeSingle();
      if (error) throw new Error(error.message);
      let payload = (series?.payload ?? null) as IrPayload | null;
      if (series?.payload_path) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: file, error: dl } = await supabaseAdmin.storage.from("ir-documents").download(series.payload_path);
        if (dl || !file) throw new Error(dl?.message ?? "Couldn't load breakdowns");
        payload = JSON.parse(await file.text()) as IrPayload;
      }
      return { series, payload };
    };
    const t0 = Date.now();
    const countImages = async () => {
      const { count } = await context.supabase.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", data.ticker).eq("kind", "image");
      return count ?? 0;
    };
    // The partner corpus is the primary IR source; this site's own extractions are the fallback.
    const loadExternal = async () => {
      try {
        const { loadExternalPayload } = await import("@/lib/ir/external.server");
        return await loadExternalPayload(data.ticker);
      } catch (e) {
        console.warn(`[ir] partner corpus failed for ${data.ticker}: ${(e as Error).message}`);
        return null;
      }
    };
    const [docs, loaded, images, external] = await Promise.all([loadDocs(), loadSeries(), countImages(), loadExternal()]);
    let { series, payload } = loaded;
    if (external && external.series.length) {
      const documents = docs.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) }));
      const bytes = new TextEncoder().encode(JSON.stringify({ payload: external, builtAt: external.builtAt, documents, images, pending: 0, source: "partner" }));
      return { gz: new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")) as ReadableStream<Uint8Array> };
    }
    // Facts exist but no breakdowns are stored (first read, or a rebuild that never ran): build them
    // now rather than showing an empty page.
    const readFacts = docs.reduce((n, d) => n + (Number(d.extract_facts) || 0), 0);
    if (!payload && readFacts > 0) {
      // Concurrent first views of the same company share one rebuild instead of each starting their own.
      let job = rebuilding.get(data.ticker);
      if (!job) {
        const { rebuildCompany } = await import("@/lib/ir/rebuild.server");
        job = rebuildCompany(data.ticker).finally(() => rebuilding.delete(data.ticker));
        rebuilding.set(data.ticker, job);
      }
      payload = await job;
      series = payload ? { payload: null, payload_path: `series/${data.ticker}.json`, built_at: payload.builtAt } : series;
    }
    console.log(`[ir] ${data.ticker} docs=${docs.length}+${images}img facts=${readFacts} row=${series ? "yes" : "no"} payload=${payload ? payload.series.length : "none"} ${Date.now() - t0}ms`);
    const documents = docs.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) })) as unknown as IrDocRow[];
    const pending = documents.filter((d) => !d.extract_status && EXTRACTABLE.includes(d.kind) && d.viewable).length;
    // Bank-sized payloads (thousands of series) exceed the RPC serializer's pending-output limit
    // when sent as objects, so ship one JSON string and parse it on the client.
    // Bank payloads outgrow the RPC serializer's 32 MB cap even as one string, so stream gzipped
    // bytes (raw streams bypass that cap) and decompress in the browser.
    const bytes = new TextEncoder().encode(JSON.stringify({ payload, builtAt: series?.built_at ?? null, documents, images, pending }));
    const gz = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")) as ReadableStream<Uint8Array>;
    return { gz };
  });

/** A company's stored slide/chart images for the library (paged; they can number in the thousands). */
export const getIrImages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; from < 20_000; from += 1000) {
      const { data: page, error } = await context.supabase
        .from("ir_documents")
        .select(DOC_COLUMNS)
        .eq("ticker", data.ticker)
        .eq("kind", "image")
        .order("filed", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    return out.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) })) as unknown as IrDocRow[];
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

/** HTML of a stored IR document (or its rendition, for PDFs, spreadsheets and slide images) for the source viewer. */
export const getIrHtml = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.union([z.string().uuid(), z.string().regex(/^x:[A-Za-z0-9_-]{1,64}$/)]) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id.startsWith("x:")) {
      const { loadExternalDoc } = await import("@/lib/ir/external.server");
      const doc = await loadExternalDoc(data.id.slice(2));
      if (!doc) throw new Error("Document not found");
      const isSec = /^https:\/\/www\.sec\.gov\//.test(doc.url);
      const res = isSec ? await (await import("@/lib/sec.server")).fetchSec(doc.url) : await fetch(doc.url, { signal: AbortSignal.timeout(20_000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/html|text\/plain/.test(type)) throw new Error("This document has no in-app copy; open the original");
      return { html: await res.text(), contentType: "text/html", sourceUrl: doc.url, rendition: false, title: doc.title };
    }
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
