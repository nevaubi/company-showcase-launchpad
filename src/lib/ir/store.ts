import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";
import type { IrDocRow } from "@/lib/ir.functions";

/**
 * The Filed Under pipeline's IR document store (about 162k releases, decks, supplements and transcripts collected
 * from EDGAR exhibits and company IR sites). The index is ir/{T}.json; originals and extracted text are served as
 * short-lived signed URLs (irstore/<object path>) so large files download straight from storage.
 */
export interface StoreDoc {
  id: string;
  ticker: string;
  url: string;
  title: string | null;
  doc_type: string | null;
  fiscal_label: string | null;
  period_end: string | null;
  published: string | null;
  ext: string | null;
  bytes: number | null;
  storage_path: string | null;
  text_path: string | null;
  pages: number | null;
  fetched_at: string | null;
  extraction?: { status?: string } | null;
}

export interface StoreIndex {
  ticker: string;
  generated: string;
  documents: StoreDoc[];
}

export const storeIndexQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["ir-store", ticker],
    queryFn: () => partnerFile<StoreIndex>(`ir/${ticker}.json`),
    staleTime: 30 * 60_000,
    retry: false,
  });

const KIND: Record<string, string> = {
  release: "press-release",
  presentation: "presentation",
  supplement: "supplement",
  transcript: "transcript",
  annual_report: "annual-report",
  remarks: "report",
  other: "other",
};

export const STORE_PREFIX = "store:";

/** Library row for a store document (id prefixed so it never collides with the app's own rows). */
export function storeRow(d: StoreDoc): IrDocRow {
  return {
    id: `${STORE_PREFIX}${d.id}`,
    source: "store",
    source_url: d.url,
    accn: /\/(\d{18})\//.exec(d.url)?.[1]?.replace(/^(\d{10})(\d{2})(\d{6})$/, "$1-$2-$3") ?? null,
    exhibit: null,
    kind: KIND[d.doc_type ?? "other"] ?? "other",
    title: (d.title ?? "")
      .split("||")[0]
      .replace(/, opens in new window/gi, "")
      .trim(),
    period: d.period_end,
    filed: d.published ?? d.fetched_at?.slice(0, 10) ?? null,
    ext: (d.ext ?? "").replace(/^\./, "") || null,
    bytes: d.bytes,
    extract_status: d.text_path ? "text" : null,
    extract_facts: null,
    pages: d.pages,
    viewable: false,
  };
}

/** Store rows not already in the app's library (same source URL). */
export function mergeStore(app: IrDocRow[], store: StoreDoc[]): IrDocRow[] {
  const seen = new Set(app.map((d) => d.source_url).filter(Boolean));
  return store.filter((d) => d.storage_path && !seen.has(d.url)).map(storeRow);
}

export async function storeUrl(objectPath: string): Promise<string> {
  const { url } = await partnerFile<{ url: string }>(`irstore/${objectPath}`);
  return url;
}

/** Extracted page texts of one stored document. */
export async function storeText(d: Pick<StoreDoc, "text_path">): Promise<string[]> {
  if (!d.text_path) throw new Error("This document has no extracted text yet");
  const res = await fetch(await storeUrl(d.text_path), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Text unavailable (${res.status})`);
  const j = (await res.json()) as { pages?: unknown[] };
  return (j.pages ?? []).map((p) => (typeof p === "string" ? p : JSON.stringify(p)));
}

/** Passages around each match of a phrase (case-insensitive), with page numbers. */
export function passages(pages: string[], query: string, radius = 600, max = 8) {
  const q = query.trim().toLowerCase();
  const out: { page: number; text: string }[] = [];
  if (!q) return out;
  for (let i = 0; i < pages.length && out.length < max; i++) {
    const low = pages[i].toLowerCase();
    let at = low.indexOf(q);
    while (at >= 0 && out.length < max) {
      out.push({
        page: i + 1,
        text: pages[i].slice(Math.max(0, at - radius), at + q.length + radius),
      });
      at = low.indexOf(q, at + q.length + radius);
    }
  }
  return out;
}
