// Public, read-only share links for a chart or an assistant view. The shared copy is a snapshot stored in the
// owner's `documents` row of kind "shared_view"; the public page reads it through a server function that only
// returns rows of that kind marked public. Revoking deletes the row.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { currentUserId } from "@/lib/workspace";
import type { ViewSpec } from "@/lib/research/view-spec";

export const SHARE_KIND = "shared_view";
/** SVG snapshots above this size are refused (documents rows are JSON). */
export const MAX_SVG_BYTES = 900_000;

export interface SharedContent {
  version: 1;
  public: true;
  kind: "svg" | "view";
  title: string;
  subtitle?: string;
  source?: string;
  ticker?: string;
  svg?: string;
  width?: number;
  height?: number;
  view?: ViewSpec;
  created: string;
}

export function shareUrl(id: string, origin = typeof window !== "undefined" ? window.location.origin : "") {
  return `${origin}/share/${id}`;
}

export async function createShare(c: Omit<SharedContent, "version" | "public" | "created">): Promise<{ id: string; url: string }> {
  if (c.kind === "svg" && (!c.svg || c.svg.length > MAX_SVG_BYTES)) throw new Error("This chart is too large to share as a link; export it as PNG or SVG instead.");
  if (c.kind === "view" && !c.view) throw new Error("Nothing to share");
  const userId = await currentUserId();
  const content: SharedContent = { ...c, version: 1, public: true, created: new Date().toISOString() };
  const { data, error } = await supabase
    .from("documents")
    .insert({ user_id: userId, kind: SHARE_KIND, title: c.title.slice(0, 200) || "Shared chart", ticker: c.ticker ?? null, content: content as unknown as Json })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, url: shareUrl(data.id) };
}

export async function revokeShare(id: string) {
  const { error } = await supabase.from("documents").delete().eq("id", id).eq("kind", SHARE_KIND);
  if (error) throw error;
}

export async function myShares() {
  const { data, error } = await supabase.from("documents").select("id, title, ticker, created_at").eq("kind", SHARE_KIND).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
