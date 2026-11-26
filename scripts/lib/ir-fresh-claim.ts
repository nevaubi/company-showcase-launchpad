/**
 * Claim for `ir-extract.ts --ids=...` / `--since=YYYY-MM-DD` (the fresh lane, scripts/lib/ir-fresh.ts):
 * the same selection and claim as `nextToExtract` (src/lib/ir/extract.server.ts: unread, readable as
 * HTML, extractable kind, at most 90 pages, newest filed first, claimed by setting "working"), limited
 * to the given document ids and/or files filed on or after a date. What the reader writes is unchanged.
 */
import { EXTRACTABLE_KINDS } from "@/lib/ir/extract.server";
import { sb } from "./supa";
import type { ExtractScope } from "./ir-fresh";

export async function nextToExtractWithin(s: ExtractScope) {
  let q = sb
    .from("ir_documents")
    .select("id, ticker, title, filed")
    .is("extracted_at", null)
    .is("extract_status", null)
    .or("ext.in.(htm,html),rendition_path.like.%html")
    .in("kind", EXTRACTABLE_KINDS)
    .or("pages.is.null,pages.lte.90")
    .order("filed", { ascending: false, nullsFirst: false })
    .limit(12);
  if (s.ticker) q = s.ticker.includes(",") ? q.in("ticker", s.ticker.split(",")) : q.eq("ticker", s.ticker);
  if (s.ids?.length) q = q.in("id", s.ids);
  if (s.since) q = q.gte("filed", s.since);
  const { data } = await q;
  for (const d of data ?? []) {
    const { data: claimed } = await sb.from("ir_documents").update({ extract_status: "working" }).eq("id", d.id).is("extract_status", null).select("id");
    if (claimed?.length) return d;
  }
  return null;
}
