import { requireAppAccess, requireFeature } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { IrPayload } from "@/lib/ir/payload";
import { oversizeOf } from "@/lib/ir/payload-view";
import { guardedDocIds, withoutGuardedCells, withoutGuardedDocs } from "@/lib/ir/source-guard";
import type { StoreRef } from "@/lib/ir/store";

const tickerSchema = z.string().regex(/^[A-Z.]{1,6}$/);
const DOC_COLUMNS = "id, source, source_url, accn, exhibit, kind, title, period, filed, ext, bytes, extract_status, extract_facts, rendition_path, pages";
const EXTRACTABLE = ["press-release", "supplement", "presentation", "data", "other"];
const rebuilding = new Map<string, Promise<IrPayload | null>>();

/** Precomputed segment/KPI series plus the company's stored IR document library. */
/**
 * Gzip the whole payload first, then hand the framework a plain chunked stream. Passing the
 * CompressionStream itself stalled bank-sized responses (≈1.7 MB compressed) before any byte
 * was sent; fully compressed bytes in 64 KB chunks stream reliably.
 */
async function gzipStream(bytes: Uint8Array<ArrayBuffer>): Promise<ReadableStream<Uint8Array>> {
  const gz = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= gz.length) return controller.close();
      // slice, not subarray: each chunk needs its own buffer (the serializer encodes a view's whole buffer).
      controller.enqueue(gz.slice(at, at + 65536));
      at += 65536;
    },
  });
}

export const getIrData = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
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
      const { data: series, error } = await context.supabase.from("ir_company_series").select("payload, payload_path, payload_bytes, built_at").eq("ticker", data.ticker).maybeSingle();
      if (error) throw new Error(error.message);
      let payload = (series?.payload ?? null) as IrPayload | null;
      // A stored payload beyond what a page can load (a bank with thousands of read files before its
      // bounded rebuild) is not fetched: the page says so and lists the documents.
      const oversizeBytes = oversizeOf(series?.payload_bytes);
      // A separately materialized filing view can coexist with an older full storage object.
      if (series?.payload_path && payload?.preview?.archivePath === series.payload_path && payload.ticker === data.ticker)
        return { series, payload, oversizeBytes: 0 };
      if (oversizeBytes) return { series, payload: null, oversizeBytes };
      if (series?.payload_path) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: file, error: dl } = await supabaseAdmin.storage.from("ir-documents").download(series.payload_path);
        if (dl || !file) throw new Error(dl?.message ?? "Couldn't load breakdowns");
        payload = JSON.parse(await file.text()) as IrPayload;
      }
      return { series, payload, oversizeBytes: 0 };
    };
    const t0 = Date.now();
    const countImages = async () => {
      const { count } = await context.supabase.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", data.ticker).eq("kind", "image");
      return count ?? 0;
    };
    // Two IR sources: the partner corpus and this site's own deep builds. The page shows whichever
    // covers more series (a company built here in depth beats a thin partner payload, and vice versa).
    const loadExternal = async (minimumSeries: number) => {
      try {
        const { loadExternalPayload } = await import("@/lib/ir/external.server");
        return await loadExternalPayload(data.ticker, minimumSeries);
      } catch (e) {
        console.warn(`[ir] partner corpus failed for ${data.ticker}: ${(e as Error).message}`);
        return null;
      }
    };
    const [allDocs, loaded, images] = await Promise.all([loadDocs(), loadSeries(), countImages()]);
    let { series, payload } = loaded;
    const { oversizeBytes } = loaded;
    // Files the reviewed list shows to be another company's are not listed, and figures read from
    // them are dropped from payloads built before the guard existed (source-guard.ts).
    const refused = guardedDocIds(data.ticker, allDocs as { id: string; source_url: string | null }[]);
    const docs = refused.size ? allDocs.filter((d) => !refused.has(String(d.id))) : allDocs;
    if (payload && refused.size) payload = withoutGuardedCells(payload, refused);
    const external = payload?.preview ? null : await loadExternal(payload?.series.length ?? 0);
    if (external && external.series.length && external.series.length >= (payload?.series.length ?? 0)) {
      const documents = docs.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) }));
      const bytes = new TextEncoder().encode(JSON.stringify({ payload: external, builtAt: external.builtAt, documents, images, pending: 0, source: "partner" }));
      return { gz: await gzipStream(bytes) };
    }
    // Facts exist but no breakdowns are stored (first read, or a rebuild that never ran): build them
    // now rather than showing an empty page.
    const readFacts = docs.reduce((n, d) => n + (Number(d.extract_facts) || 0), 0);
    if (!payload && readFacts > 0 && !oversizeBytes) {
      // Concurrent first views of the same company share one rebuild instead of each starting their own.
      let job = rebuilding.get(data.ticker);
      if (!job) {
        const { rebuildCompany } = await import("@/lib/ir/rebuild.server");
        job = rebuildCompany(data.ticker).finally(() => rebuilding.delete(data.ticker));
        rebuilding.set(data.ticker, job);
      }
      payload = await job;
      series = payload ? { payload: null, payload_path: `series/${data.ticker}.json`, payload_bytes: null, built_at: payload.builtAt } : series;
    }
    console.log(`[ir] ${data.ticker} docs=${docs.length}+${images}img facts=${readFacts} row=${series ? "yes" : "no"} payload=${payload ? payload.series.length : "none"} ${Date.now() - t0}ms`);
    const documents = docs.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) })) as unknown as IrDocRow[];
    const pending = documents.filter((d) => !d.extract_status && EXTRACTABLE.includes(d.kind) && d.viewable).length;
    // Bank-sized payloads (thousands of series) exceed the RPC serializer's pending-output limit
    // when sent as objects, so ship one JSON string and parse it on the client.
    // Bank payloads outgrow the RPC serializer's 32 MB cap even as one string, so stream gzipped
    // bytes (raw streams bypass that cap) and decompress in the browser.
    const bytes = new TextEncoder().encode(JSON.stringify({ payload, builtAt: payload?.builtAt ?? series?.built_at ?? null, documents, images, pending, oversizeBytes }));
    return { gz: await gzipStream(bytes) };
  });

/** Download the separately stored history without loading it into the interactive grid. */
export const getIrHistoryDownload = createServerFn({ method: "POST" })
  .middleware([requireFeature("exports")])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("ir_company_series")
      .select("archive:stats->preview->>archivePath").eq("ticker", data.ticker).maybeSingle();
    const path = row?.archive;
    const legacy = `series/${data.ticker}.json`;
    const prefix = `series/${data.ticker}/`;
    if (error || typeof path !== "string" || !(path === legacy || (path.startsWith(prefix) && /^[a-f0-9-]+\.json\.gz$/.test(path.slice(prefix.length)))))
      throw new Error("No historical archive is available");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const suffix = path.endsWith(".gz") ? ".json.gz" : ".json";
    const { data: signed, error: signError } = await supabaseAdmin.storage.from("ir-documents")
      .createSignedUrl(path, 300, { download: `${data.ticker}-financial-history${suffix}` });
    if (signError || !signed) throw new Error("Could not open the historical archive");
    return signed.signedUrl;
  });

/** A company's stored slide/chart images for the library (paged; they can number in the thousands). */
export const getIrImages = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
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
    const kept = withoutGuardedDocs(data.ticker, out as { source_url?: string | null }[]) as typeof out;
    return kept.map(({ rendition_path, ...d }) => ({ ...d, viewable: !!rendition_path || /^html?$/.test(String(d.ext ?? "")) })) as unknown as IrDocRow[];
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
  .middleware([requireAppAccess])
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
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ id: z.union([z.string().uuid(), z.string().regex(/^x:[A-Za-z0-9_-]{1,64}$/)]) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id.startsWith("x:")) {
      const { loadExternalDoc } = await import("@/lib/ir/external.server");
      const doc = await loadExternalDoc(data.id.slice(2));
      if (!doc) throw new Error("Document not found");
      const ext = (doc.ext ?? "").toLowerCase();
      const htmlFile = /^\.html?$/.test(ext);
      const base = { contentType: "text/html", sourceUrl: doc.url, title: doc.title };
      // A stored PDF, deck or workbook is shown from its page text in the document store. The browser reads that
      // text with the user's own access (irstore/…), so nothing large passes through this function.
      if (doc.text_path && !htmlFile) {
        const store: StoreRef = { text: doc.text_path, original: doc.storage_path ?? null, ext };
        return { ...base, html: "", rendition: true, store };
      }
      try {
        const isSec = /^https:\/\/www\.sec\.gov\//.test(doc.url);
        const res = isSec ? await (await import("@/lib/sec.server")).fetchSec(doc.url) : await fetch(doc.url, { signal: AbortSignal.timeout(20_000) });
        const type = res.headers.get("content-type") ?? "";
        if (res.ok && /html|text\/plain/.test(type)) return { ...base, html: await res.text(), rendition: false };
      } catch {
        // the stored copy below stands in
      }
      // The page no longer answers, or refuses this server: the stored HTML original stands in for it.
      if (doc.storage_path && htmlFile) {
        const store: StoreRef = { original: doc.storage_path, ext };
        return { ...base, html: "", rendition: false, store };
      }
      throw new Error("This document has no in-app copy; open the original");
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
