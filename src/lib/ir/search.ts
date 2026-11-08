import { supabase } from "@/integrations/supabase/client";

/** Full-text search over the Filed Under IR document store (pipeline /api/app-docsearch, Postgres FTS). */
const PARTNER_DATA_URL =
  (import.meta.env.VITE_PARTNER_DATA_URL as string | undefined) ??
  "https://filedunderai.vercel.app/api/app-data";
const SEARCH_URL =
  PARTNER_DATA_URL && PARTNER_DATA_URL !== "off"
    ? PARTNER_DATA_URL.replace(/app-data$/, "app-docsearch")
    : null;

export interface DocHit {
  doc_id: string;
  ticker: string;
  doc_type: string | null;
  title: string | null;
  url: string | null;
  published: string | null;
  period_end: string | null;
  fiscal_label: string | null;
  page: number | null;
  kind: "text" | "table";
  /** matched words are wrapped in « » */
  snippet: string;
  rank: number;
}

export interface DocSearchArgs {
  q: string;
  tickers?: string[];
  types?: string[];
  since?: string;
  limit?: number;
}

export async function searchDocuments(a: DocSearchArgs): Promise<DocHit[]> {
  if (!SEARCH_URL) throw new Error("Document search is turned off");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to search documents");
  const p = new URLSearchParams({ q: a.q });
  if (a.tickers?.length) p.set("tickers", a.tickers.join(","));
  if (a.types?.length) p.set("types", a.types.join(","));
  if (a.since) p.set("since", a.since);
  if (a.limit) p.set("limit", String(a.limit));
  const res = await fetch(`${SEARCH_URL}?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  const out = (await res.json().catch(() => ({}))) as { results?: DocHit[]; error?: string };
  if (!res.ok) throw new Error(out.error ?? `Search returned ${res.status}`);
  return out.results ?? [];
}

/** Snippet split into plain and highlighted parts. */
export function snippetParts(s: string): { text: string; hit: boolean }[] {
  return s
    .split(/(«[^»]*»)/)
    .filter(Boolean)
    .map((p) =>
      p.startsWith("«") ? { text: p.slice(1, -1), hit: true } : { text: p, hit: false },
    );
}
