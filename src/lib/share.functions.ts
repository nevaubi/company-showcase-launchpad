import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Public read of one shared chart or view: only `documents` rows of kind "shared_view" marked public. */
export const getSharedView = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("documents")
      .select("id, title, kind, content, created_at")
      .eq("id", data.id)
      .eq("kind", "shared_view")
      .maybeSingle();
    if (error || !row) return null;
    const c = (row.content ?? {}) as Record<string, unknown>;
    if (c.public !== true) return null;
    const kind = c.kind === "view" ? "view" : "svg";
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
    return {
      id: row.id,
      created: str(c.created, 40) ?? row.created_at,
      kind,
      title: str(c.title, 200) ?? row.title,
      subtitle: str(c.subtitle, 400),
      source: str(c.source, 400),
      ticker: str(c.ticker, 12),
      svg: kind === "svg" ? str(c.svg, 900_000) : undefined,
      width: typeof c.width === "number" ? c.width : undefined,
      height: typeof c.height === "number" ? c.height : undefined,
      // Serialized as a JSON string: the view spec is validated again on the page (parseViewSpec).
      viewJson: kind === "view" && c.view !== undefined ? JSON.stringify(c.view).slice(0, 900_000) : undefined,
    };
  });
