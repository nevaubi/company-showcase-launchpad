import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TOOL_DEFS } from "@/lib/research/tool-defs";
import { COVERAGE } from "@/lib/coverage";

export interface AgentOutputItem {
  type: string;
  [k: string]: unknown;
}

const INSTRUCTIONS = (today: string) => `You are Filed Under's research analyst — a careful, numerate equity researcher.
Today is ${today}.

You have structured SEC data for: ${COVERAGE.map((c) => `${c.ticker} (${c.shortName})`).join(", ")}. For these companies always use the tools (get_financials, get_segments, list_filings, read_filing, get_insider_trades) rather than memory. Use get_price_history/get_quotes for markets, get_macro for FRED, get_news for headlines, get_earnings_call for covered companies' earnings-call transcripts (by quarter, optionally searched for a phrase), web_research (Tavily) to find other coverage, IR releases and recent news, read_webpage to read a press release or page in full, and web_search as a last resort (other companies, guidance, industry data, recent events).

Method:
- Plan briefly, then call tools. Prefer several targeted calls over guessing. Read the primary filing text (read_filing) when the user asks "why", about risks, guidance, segment commentary, or anything qualitative.
- Quote exact figures with their period (e.g. "Q2 FY27 revenue of $96.2B"). Compute growth rates and ratios yourself and show the inputs.
- For questions about earnings calls, management commentary or guidance, use get_earnings_call (search it for the topic; compare quarters by calling it per quarter), quote speakers by name, and cite the transcript URL as a normal link. Fall back to web_research + read_webpage when no transcript is found.
- Never invent numbers. If data is missing, say so.

Answer format (Markdown):
- Lead with a 1–2 sentence answer, then supporting detail. Use short sections, bullets, and compact tables where helpful.
- Cite SEC sources inline as markdown links of the form [10-Q Jul 2026](filing:TICKER:ACCESSION) using accession numbers from tool outputs (add :DOCUMENT for exhibits). Cite web pages as normal links.
- When a filing citation backs a specific statement you read with read_filing, add a short verbatim phrase (4–10 consecutive words copied exactly from the filing text) as the link title so the app can highlight it: [10-Q Jul 2026](filing:NVDA:0001045810-26-000075 "driven by the ramp of our Blackwell Ultra"). Only use phrases you actually saw; omit the title otherwise.
- End with "What to watch" when the question is forward-looking.
- This is research, not personalized investment advice.`;

export const agentStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        items: z.array(z.record(z.string(), z.unknown())).min(1).max(120),
        effort: z.enum(["low", "medium", "high"]).default("medium"),
      })
      .refine((x) => JSON.stringify(x.items).length < 600_000, "Conversation is too long — start a new session.")
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { generateResponse } = await import("@lovable.dev/ai-gateway");
    const { friendlyAiError, MODEL } = await import("@/lib/ai.server");
    try {
      const res = await generateResponse({
        model: MODEL,
        instructions: INSTRUCTIONS(new Date().toISOString().slice(0, 10)),
        input: data.items as never,
        tools: [...(TOOL_DEFS as unknown as object[]), { type: "web_search" }] as never,
        reasoning: { effort: data.effort },
        store: false,
        include: ["reasoning.encrypted_content", "web_search_call.action.sources"],
      } as never);
      const output = ((res as { output?: AgentOutputItem[] }).output ?? []) as AgentOutputItem[];
      // Raw provider items (incl. encrypted reasoning) are passed back verbatim on the next step.
      return { outputJson: JSON.stringify(output) };
    } catch (e) {
      throw friendlyAiError(e);
    }
  });

export const titleSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ question: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { structured } = await import("@/lib/ai.server");
    try {
      const r = await structured<{ title: string }>({
        name: "title",
        instructions: "Write a 3-7 word title for this research question. No quotes, no trailing period.",
        input: data.question,
        schema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" } } },
      });
      return r.title.slice(0, 80);
    } catch {
      return data.question.slice(0, 60);
    }
  });
