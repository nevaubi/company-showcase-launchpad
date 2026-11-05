import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coverageOf } from "@/lib/coverage";

export interface SupplyNote {
  headline: string;
  points: { kind: "dependency" | "concentration" | "geography" | "change" | "opportunity"; text: string; linkIds: string[] }[];
  watch: string[];
  error?: string;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["headline", "points", "watch"],
  properties: {
    headline: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["kind", "text", "linkIds"],
        properties: {
          kind: { type: "string", enum: ["dependency", "concentration", "geography", "change", "opportunity"] },
          text: { type: "string" },
          linkIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    watch: { type: "array", items: { type: "string" } },
  },
};

/** Cited analyst note on one company's supply chain; every point references the link ids it rests on. */
export const getSupplyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().regex(/^[A-Z.-]{1,8}$/) }).parse(d))
  .handler(async ({ data, context }): Promise<SupplyNote & { cachedAt?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { headline: "", points: [], watch: [], error: "Not a covered company" };
    const { data: rows, error } = await context.supabase
      .from("supply_links")
      .select("id,ticker,counterparty,counterparty_ticker,relation,detail,share_pct,amount_usd,single_source,regions,risk,product,filed,form,is_current")
      .or(`ticker.eq.${co.ticker},counterparty_ticker.eq.${co.ticker}`)
      .limit(600);
    if (error || !rows?.length) return { headline: "", points: [], watch: [], error: error?.message ?? "No links yet" };
    const latest = rows.reduce((m, r) => (r.filed > m ? r.filed : m), "");
    const { cached, structured } = await import("@/lib/ai.server");
    return cached(`supply-note:v2:${co.ticker}:${latest}:${rows.length}`, 30 * 86400_000, async () => {
      const lines = rows.map((r) =>
        [r.id, r.is_current ? "now" : `prior ${r.form} ${r.filed}`, r.ticker === co.ticker ? `${co.ticker} names` : `${r.ticker} names ${co.ticker} as its`,
          r.ticker === co.ticker ? `${r.relation}: ${r.counterparty}` : r.relation, r.detail, r.product ?? "",
          r.share_pct != null ? `${r.share_pct}%` : "", r.amount_usd ? `$${r.amount_usd}` : "", r.single_source ? "SINGLE-SOURCE" : "",
          (r.regions ?? []).join("/"), r.risk ?? ""].filter(Boolean).join(" | "));
      try {
        const out = await structured<SupplyNote>({
          name: "supply_note", effort: "medium", schema: SCHEMA,
          instructions: `You are a sell-side supply-chain analyst. Using ONLY the filing-derived links given (id | timing | who states it | relation | detail ...), write a sharp note on ${co.shortName} (${co.ticker}).
headline: one sentence, the single most important supply-chain fact.
points: 4–7 insights covering key dependencies, customer concentration, geographic exposure, what changed vs prior filings, and second-order opportunities (e.g. who benefits). Each ≤ 40 words, concrete numbers when given, and linkIds = the ids it rests on (at least one). No claims without an id. Never write ids in the text.
watch: 2–4 short things to monitor next. Never use outside knowledge.`,
          input: lines.join("\n").slice(0, 60_000),
        });
        const strip = (t: string) => t.replace(/\s*\[?\(?\b[0-9a-f]{8}-[0-9a-f-]{27}\b\)?\]?/gi, "").trim();
        out.headline = strip(out.headline);
        out.points = out.points.map((p) => ({ ...p, text: strip(p.text) }));
        const ids = new Set(rows.map((r) => r.id));
        out.points = out.points.map((p) => ({ ...p, linkIds: p.linkIds.filter((i) => ids.has(i)) })).filter((p) => p.linkIds.length);
        return out;
      } catch (e) {
        return { headline: "", points: [], watch: [], error: (e as Error).message };
      }
    }, (r) => !r.error && r.points.length > 0);
  });
