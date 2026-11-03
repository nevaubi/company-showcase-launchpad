import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { archiveUrl, fetchSec, searchEdgarFullText, type FullTextHit } from "@/lib/sec.server";

const cikSchema = z.string().regex(/^\d{1,10}$/);
const accnSchema = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
const docSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.\-/]+$/)
  .refine((d) => !d.includes(".."), "invalid document path");

const MAX_BYTES = 20 * 1024 * 1024;

export const getFilingDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ cik: cikSchema, accn: accnSchema, doc: docSchema }).parse(d))
  .handler(async ({ data }) => {
    const url = archiveUrl(data.cik, data.accn, data.doc);
    const res = await fetchSec(url);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("This document is too large to render inline. Open it on SEC.gov.");
    const contentType = res.headers.get("content-type") ?? "text/html";
    const text = await res.text();
    return { url, contentType, html: text, bytes: text.length };
  });

export interface FilingDocumentEntry {
  name: string;
  type: string;
  description: string;
  size: string;
}

export const getFilingIndex = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ cik: cikSchema, accn: accnSchema }).parse(d))
  .handler(async ({ data }) => {
    const url = archiveUrl(data.cik, data.accn, `${data.accn}-index.htm`);
    const html = await (await fetchSec(url)).text();
    const docs: FilingDocumentEntry[] = [];
    const table = html.match(/<table[^>]*class="tableFile"[^>]*summary="Document Format Files"[\s\S]*?<\/table>/i)?.[0] ?? "";
    for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
      if (cells.length < 4) continue;
      const href = cells[2].match(/href="([^"]+)"/)?.[1];
      if (!href) continue;
      const name = href.split("/").pop()!.replace(/^ix\?doc=.*\//, "");
      docs.push({
        name,
        description: cells[1].replace(/<[^>]+>/g, "").trim(),
        type: cells[3].replace(/<[^>]+>/g, "").trim(),
        size: (cells[4] ?? "").replace(/<[^>]+>/g, "").trim(),
      });
    }
    return { url, documents: docs };
  });

export const searchFilings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        q: z.string().min(2).max(200),
        ciks: z.array(cikSchema).max(10).optional(),
        forms: z.array(z.string().max(12)).max(10).optional(),
        startdt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        enddt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ total: number; hits: FullTextHit[] }> => searchEdgarFullText(data));
