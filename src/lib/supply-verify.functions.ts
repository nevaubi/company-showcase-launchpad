import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface VerifyEvidence { id: string; quote: string; url: string; title: string; publishedAt?: string; stance: "supports" | "contradicts" | "context" }
export interface VerifyResult {
  verdict: "confirmed" | "partly" | "unconfirmed" | "contradicted";
  summary: string;
  facts: { text: string; evidenceIds: string[] }[];
  evidence: VerifyEvidence[];
  searched: number;
  read: number;
  error?: string;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "summary", "facts", "stances"],
  properties: {
    verdict: { type: "string", enum: ["confirmed", "partly", "unconfirmed", "contradicted"] },
    summary: { type: "string" },
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "evidenceIds"], properties: { text: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } } },
    stances: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "stance"], properties: { id: { type: "string" }, stance: { type: "string", enum: ["supports", "contradicts", "context", "irrelevant"] } } } },
  },
};

/**
 * Cross-checks one filing link against the open web: several searches, reads the top pages, keeps only
 * sentences that verbatim name both companies, then the model grades them. Cached 14 days per link.
 */
export const verifySupplyLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VerifyResult & { cachedAt?: string }> => {
    const empty = (error: string): VerifyResult => ({ verdict: "unconfirmed", summary: "", facts: [], evidence: [], searched: 0, read: 0, error });
    const { data: l } = await context.supabase.from("supply_links").select("*").eq("id", data.id).maybeSingle();
    if (!l) return empty("Link not found");
    const { coverageOf } = await import("@/lib/coverage");
    const filer = coverageOf(l.ticker);
    const filerName = filer?.shortName ?? l.ticker;
    const { cached, structured } = await import("@/lib/ai.server");
    return cached(`supply-verify:v1:${l.id}`, 14 * 86400_000, async () => {
      const { tavilySearch, firecrawlScrape } = await import("@/lib/web.server");
      const { nameVariants, cooccurringSentences } = await import("@/lib/supply/analytics");
      const A = nameVariants(filerName, l.ticker), B = nameVariants(l.counterparty, l.counterparty_ticker);
      const queries = [
        `"${filerName}" "${l.counterparty}" ${l.relation === "customer" ? "customer contract" : l.relation === "supplier" ? "supplier agreement" : l.relation}`,
        `${filerName} ${l.counterparty} ${l.product ?? l.detail}`.slice(0, 180),
        `${filerName} ${l.counterparty} 2026`,
      ];
      const seen = new Map<string, { title: string; url: string; content: string; publishedAt?: string }>();
      let searched = 0;
      await Promise.all(queries.map(async (q, i) => {
        try {
          const r = await tavilySearch(q, { topic: i === 2 ? "news" : "general", maxResults: 6, depth: "advanced", ...(i === 2 ? { days: 365 } : {}) });
          searched += r.results.length;
          for (const x of r.results) if (!seen.has(x.url) && !/sec\.gov/.test(x.url)) seen.set(x.url, x);
        } catch { /* one failed search shouldn't sink the check */ }
      }));
      if (!seen.size) return empty("Web search returned nothing");
      const pages = [...seen.values()];
      // read the top pages in full; fall back to search snippets for the rest
      const top = pages.slice(0, 5);
      const withTimeout = <T,>(pr: Promise<T>, ms: number) => Promise.race([pr, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
      const full = await Promise.all(top.map(async (p) => { try { return (await withTimeout(firecrawlScrape(p.url), 15_000)).markdown; } catch { return p.content; } }));
      const ev: VerifyEvidence[] = [];
      pages.forEach((p, i) => {
        const text = i < top.length ? full[i] : p.content;
        for (const q of cooccurringSentences(text, A, B, 3)) if (ev.length < 24) ev.push({ id: `e${ev.length + 1}`, quote: q, url: p.url, title: p.title, publishedAt: p.publishedAt, stance: "context" });
      });
      if (!ev.length) return { ...empty(""), error: undefined, summary: `No public page found that names both ${filerName} and ${l.counterparty} in the same sentence.`, searched, read: top.length };
      try {
        const out = await structured<{ verdict: VerifyResult["verdict"]; summary: string; facts: VerifyResult["facts"]; stances: { id: string; stance: string }[] }>({
          name: "supply_verify", effort: "medium", schema: SCHEMA,
          instructions: `You verify a supply-chain link stated in an SEC filing against web sentences. Filing claim: ${filerName} (${l.ticker}) names ${l.counterparty} as its ${l.relation}${l.product ? ` for ${l.product}` : ""}${l.share_pct != null ? `, ${l.share_pct}%` : ""}. Filing quote: "${l.quote}".
Use ONLY the numbered evidence sentences. stances: classify every id. verdict: confirmed if independent sources state the same relationship, partly if related but different scope, contradicted if sources say it ended/moved, else unconfirmed.
summary: 1–2 sentences. facts: 2–6 new, concrete details (volumes, dates, deal terms, programmes, timing) each ≤ 30 words with the evidenceIds it rests on. No outside knowledge.`,
          input: ev.map((e) => `${e.id} [${e.title}${e.publishedAt ? `, ${e.publishedAt.slice(0, 10)}` : ""}] ${e.quote}`).join("\n"),
        });
        const st = new Map(out.stances.map((s) => [s.id, s.stance]));
        const evidence = ev.map((e) => ({ ...e, stance: (st.get(e.id) ?? "context") as VerifyEvidence["stance"] | "irrelevant" })).filter((e) => e.stance !== "irrelevant") as VerifyEvidence[];
        const ids = new Set(evidence.map((e) => e.id));
        const facts = out.facts.map((f) => ({ ...f, evidenceIds: f.evidenceIds.filter((i) => ids.has(i)) })).filter((f) => f.evidenceIds.length);
        return { verdict: evidence.length ? out.verdict : "unconfirmed", summary: out.summary, facts, evidence, searched, read: top.length };
      } catch (e) {
        return empty((e as Error).message);
      }
    }, (r) => !r.error);
  });
