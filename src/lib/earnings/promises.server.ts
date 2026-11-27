import { createHash } from "node:crypto";
import type { CoverageCompany } from "@/lib/coverage";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { vetPromises, type CallText, type RawPromise, type TrackedPromise } from "./promises";
import { listCalls, loadTranscript, queue, PROMISE_PREFIX } from "../transcripts.server";
import type { TranscriptRef } from "../transcripts/parse";

interface PromiseResult {
  promises: TrackedPromise[];
  calls: { url: string; date: string; quarter: string | null }[];
  error?: string;
}
function promiseKey(ticker: string, refs: TranscriptRef[]) {
  const hash = createHash("sha256")
    .update(JSON.stringify(refs.map((r) => [r.url, r.date, r.quarter, r.contentVersion])))
    .digest("hex")
    .slice(0, 16);
  return `promises:v1:${ticker}:${refs[0].date}:${hash}`;
}
export async function storedPromises(co: CoverageCompany): Promise<PromiseResult> {
  const { calls, error } = await listCalls(co);
  if (calls.length < 2)
    return {
      promises: [],
      calls: [],
      error: error || "Two archived calls are needed to track commitments.",
    };
  const refs = calls.slice(0, 5);
  const { data, error: dbError } = await supabaseAdmin
    .from("ai_cache")
    .select("payload")
    .eq("key", promiseKey(co.ticker, refs))
    .maybeSingle();
  if (dbError) throw new Error(dbError.message);
  if (data) return data.payload as unknown as PromiseResult;
  await queue(co.ticker, PROMISE_PREFIX);
  const old = await supabaseAdmin
    .from("ai_cache")
    .select("payload")
    .like("key", `promises:v1:${co.ticker}:%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = old.data?.payload as unknown as PromiseResult | undefined;
  const valid = new Set(calls.map((call) => call.url));
  if (previous?.calls?.length && previous.calls.every((call) => valid.has(call.url)))
    return previous;
  return {
    promises: [],
    calls: [],
    error: "Commitments are being checked against the archived calls.",
  };
}
export async function analyzePromises(co: CoverageCompany) {
  const { calls } = await listCalls(co);
  const refs = calls.slice(0, 5);
  if (refs.length < 2) return;
  const { cached, structured } = await import("@/lib/ai.server");
  return cached(
    promiseKey(co.ticker, refs),
    Infinity,
    async () => {
      const loaded = await Promise.all(refs.map((r) => loadTranscript(co, r.url)));
      if (loaded.some((r) => !r.transcript))
        throw new Error("One or more transcripts are still being archived");
      const calls: CallText[] = loaded
        .map((l, i) =>
          l.transcript
            ? {
                url: refs[i].url,
                date: refs[i].date!,
                quarter: refs[i].quarter ?? null,
                text: l.transcript.turns
                  .filter((t) => t.kind === "management")
                  .map((t) => t.text)
                  .join("\n"),
              }
            : null,
        )
        .filter((c): c is CallText => !!c)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (calls.filter((c) => c.text.trim()).length < 2)
        return {
          promises: [],
          calls: calls.map(({ url, date, quarter }) => ({ url, date, quarter })),
          error: "Need management remarks from two calls",
        };
      const res = await structured<{ promises: RawPromise[] }>({
        name: "promises",
        effort: "medium",
        instructions:
          "You track whether management keeps its word. From the earnings-call management remarks below (oldest first, each headed by its call date), list concrete forward-looking commitments: numeric guidance, margin/growth targets, product or plant launch dates, capex/buyback/dividend plans, cost programs, debt targets. Skip vague aspirations. 'quote' MUST be copied character-for-character from that call (one or two sentences). Then grade each against LATER calls only: kept / missed / partial, with 'outcomeQuote' copied character-for-character from the later call and its outcomeCallDate; if no later call settles it, status 'pending' with outcomeQuote and outcomeCallDate null. summary: one plain sentence of what was promised. note: one short sentence explaining the grade. deadline: the stated timeframe or null. 8-20 promises, prefer ones that are gradable.",
        input: calls
          .map((c) => `=== CALL ${c.date} (${c.quarter ?? ""}) ===\n${c.text.slice(0, 40_000)}`)
          .join("\n\n"),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["promises"],
          properties: {
            promises: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "quote",
                  "callDate",
                  "category",
                  "summary",
                  "deadline",
                  "status",
                  "outcomeQuote",
                  "outcomeCallDate",
                  "note",
                ],
                properties: {
                  quote: { type: "string" },
                  callDate: { type: "string" },
                  category: {
                    type: "string",
                    enum: [
                      "guidance",
                      "margin",
                      "growth",
                      "product",
                      "capital",
                      "cost",
                      "balance sheet",
                      "other",
                    ],
                  },
                  summary: { type: "string" },
                  deadline: { type: ["string", "null"] },
                  status: { type: "string", enum: ["kept", "missed", "partial", "pending"] },
                  outcomeQuote: { type: ["string", "null"] },
                  outcomeCallDate: { type: ["string", "null"] },
                  note: { type: "string" },
                },
              },
            },
          },
        },
      });
      return {
        promises: vetPromises(res.promises ?? [], calls),
        calls: calls.map(({ url, date, quarter }) => ({ url, date, quarter })),
      };
    },
    () => true,
  );
}
