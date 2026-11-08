import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ALLOWED = "h2, h3, p, ul, ol, li, strong, em, mark, blockquote, table, thead, tbody, tr, th, td, a";

/** Writing assistant for research docs. Returns sanitized-by-schema HTML fragments. */
export const docAssist = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) =>
    z
      .object({
        mode: z.enum(["continue", "summarize", "rewrite", "draft", "critique"]),
        instruction: z.string().max(1500).default(""),
        selection: z.string().max(12000).default(""),
        document: z.string().max(30000).default(""),
        title: z.string().max(200).default(""),
        fundamentals: z.string().max(6000).default(""),
        useWeb: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { generateResponse } = await import("@lovable.dev/ai-gateway");
    const { friendlyAiError, MODEL, outputText } = await import("@/lib/ai.server");
    const task = {
      continue: "Continue the document from where it ends with the next one to three paragraphs, matching its voice.",
      summarize: "Summarize the selected text into a tight set of bullet points.",
      rewrite: "Rewrite the selected text to be clearer and more concise, preserving every figure.",
      draft: "Draft the section requested in the instruction.",
      critique: "Act as a skeptical editor: list the weakest claims, missing evidence and counter-arguments in the document.",
    }[data.mode];
    try {
      const res = await generateResponse({
        model: MODEL,
        instructions: `You are an equity research writing assistant inside a document editor. ${task}
Output ONLY an HTML fragment using these tags: ${ALLOWED}. No <html>, <body>, markdown, or code fences.
Use exact figures with periods. When you use the reported fundamentals provided, mention the period. ${data.useWeb ? "You may search the web for recent facts; add source links as <a href>." : "Do not invent facts beyond the document and data provided."}`,
        input: [
          {
            role: "user",
            content: `Document title: ${data.title}\n\nInstruction: ${data.instruction || "(none)"}\n\nSelected text:\n${data.selection || "(none)"}\n\nCurrent document (plain text):\n${data.document.slice(-20000)}\n\n${data.fundamentals ? `Reported fundamentals from SEC filings:\n${data.fundamentals}` : ""}`,
          },
        ],
        tools: data.useWeb ? ([{ type: "web_search" }] as never) : undefined,
        reasoning: { effort: data.mode === "critique" || data.mode === "draft" ? "medium" : "low" },
      } as never);
      const html = outputText(res as { output?: unknown[] })
        .replace(/^```(?:html)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
        .trim();
      return { html };
    } catch (e) {
      throw friendlyAiError(e);
    }
  });

/** Natural-language to spreadsheet cells, using FU()/PRICE() formulas for live data. */
export const sheetAssist = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) =>
    z
      .object({
        instruction: z.string().min(3).max(1500),
        anchor: z.string().regex(/^[A-Z]{1,3}\d{1,5}$/),
        snapshot: z.string().max(12000).default(""),
        catalog: z.string().max(6000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { structured } = await import("@/lib/ai.server");
    return structured<{ cells: { ref: string; value: string }[]; formats: { column: string; format: "general" | "number" | "usd" | "usdM" | "pct" | "x" }[]; note: string }>({
      name: "sheet_patch",
      effort: "medium",
      instructions: `You build spreadsheet tables for equity analysts. Return the cells to write, starting at the anchor cell unless the instruction says otherwise.
Available formula functions: SUM, AVERAGE, MIN, MAX, MEDIAN, COUNT, ROUND, ABS, IF, IFERROR, GROWTH(new, old) (=new/old-1), CAGR(first, last, years), PRICE("TICKER") (latest price), and FU("TICKER", "metricKey", "period", ["M"|"B"]) which returns a reported SEC value — period is like "FY2025", "Q2 FY27", "TTM" or "latest"; the optional 4th argument scales to millions/billions.
Prefer FU() formulas over typed numbers so values stay sourced. Put labels in the first column and periods across the header row. Use formulas referencing other cells for growth and margins. Keep tables compact (≤ 14 rows × 10 columns).`,
      input: `Anchor cell: ${data.anchor}\nInstruction: ${data.instruction}\n\nCurrent sheet (non-empty cells):\n${data.snapshot || "(empty)"}\n\nData catalog:\n${data.catalog}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["cells", "formats", "note"],
        properties: {
          cells: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["ref", "value"], properties: { ref: { type: "string" }, value: { type: "string" } } },
          },
          formats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["column", "format"],
              properties: { column: { type: "string" }, format: { type: "string", enum: ["general", "number", "usd", "usdM", "pct", "x"] } },
            },
          },
          note: { type: "string" },
        },
      },
    });
  });
