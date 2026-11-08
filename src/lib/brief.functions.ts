import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Proactive morning brief. The browser assembles numbered facts (each with its own
 * source link); the model may only cite fact ids, so every claim stays sourced.
 */
export const getDailyBrief = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) =>
    z
      .object({
        date: z.string().max(12),
        key: z.string().max(80),
        tickers: z.array(z.string().max(8)).max(40),
        facts: z.array(z.object({ id: z.string().max(12), area: z.string().max(30), text: z.string().max(600) })).max(220),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { cached, structured } = await import("@/lib/ai.server");
    return cached(`brief:v1:${data.date}:${data.key}`, 8 * 3600_000, async () =>
      structured<{ headline: string; items: { title: string; body: string; tickers: string[]; stance: string; urgency: string; factIds: string[] }[]; watch: string[] }>({
        name: "daily_brief",
        effort: "medium",
        instructions:
          "You are a buy-side analyst who wrote overnight on behalf of the user. From the numbered facts (SEC filings, insider trades, alt data, verified supply-chain quotes, rule-based trade setups with historical hit rates, hedge fund leverage/positioning, Treasury auction demand), pick the 5-8 things that matter most for the user's watchlist and the market and explain *why* — connect facts across areas (e.g. a supplier's filing that affects a watchlist name, leverage building while auctions weaken). Every item must cite the fact ids it relies on; never state a number that isn't in a cited fact. stance: bullish/bearish/neutral/risk. urgency: high/medium/low. 'watch' = 2-4 short things to check next. Plain, specific, no hype.",
        input: `Date ${data.date}. Watchlist: ${data.tickers.join(", ") || "(empty — focus on market-wide)"}\n\n${data.facts.map((f) => `[${f.id}] (${f.area}) ${f.text}`).join("\n")}`,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "items", "watch"],
          properties: {
            headline: { type: "string" },
            watch: { type: "array", items: { type: "string" } },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "body", "tickers", "stance", "urgency", "factIds"],
                properties: {
                  title: { type: "string" },
                  body: { type: "string" },
                  tickers: { type: "array", items: { type: "string" } },
                  stance: { type: "string", enum: ["bullish", "bearish", "neutral", "risk"] },
                  urgency: { type: "string", enum: ["high", "medium", "low"] },
                  factIds: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      }),
    );
  });
