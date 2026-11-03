// Extract segment / product / geography / KPI facts from a stored press release or supplement.
// The model only *points* at table cells; every value is re-read from the parsed cell and scaled
// here, so a fact can never carry a number that isn't printed in the document.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { structured } from "@/lib/ai.server";
import { parseNumber, parseTables, renderTablesForModel } from "@/lib/ir/tables";

interface ModelFact {
  t: number;
  r: number;
  c: number;
  category: "segment" | "product" | "geography" | "customer" | "kpi";
  metric: "revenue" | "operating_income" | "gross_profit" | "gross_margin" | "cost" | "units" | "users" | "backlog" | "other";
  label: string;
  parent: string;
  is_total: boolean;
  period_start: string;
  period_end: string;
  months: number;
  unit: "usd" | "pct" | "count" | "usdPerShare" | "ratio";
  scale: number;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t", "r", "c", "category", "metric", "label", "parent", "is_total", "period_start", "period_end", "months", "unit", "scale"],
        properties: {
          t: { type: "integer" },
          r: { type: "integer" },
          c: { type: "integer" },
          category: { type: "string", enum: ["segment", "product", "geography", "customer", "kpi"] },
          metric: { type: "string", enum: ["revenue", "operating_income", "gross_profit", "gross_margin", "cost", "units", "users", "backlog", "other"] },
          label: { type: "string" },
          parent: { type: "string" },
          is_total: { type: "boolean" },
          period_start: { type: "string" },
          period_end: { type: "string" },
          months: { type: "integer" },
          unit: { type: "string", enum: ["usd", "pct", "count", "usdPerShare", "ratio"] },
          scale: { type: "number" },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `You read tables from a public company's earnings press release or financial supplement and point at the cells holding disaggregated data.
Tables are given as "## T<table>" then rows "r<row>: c<cell>=<text> | ...". Use those exact t/r/c indexes; the c index must be the cell that holds the number itself (not a "$" cell).
Return facts ONLY for: revenue/sales/operating income/gross profit/margin by business segment, product or service line, geography or customer type, plus operating KPIs the company highlights (units, subscribers, users, AUM, backlog, same-store sales, deliveries, etc.).
For each group also return the printed total line (e.g. "Total net sales") with is_total=true, and give every child the exact label of that total in "parent". Top-level totals use parent "". Subtotals are totals too: e.g. "Products" (summing iPhone, Mac, iPad, Wearables) gets is_total=true with parent "Total net sales", and iPhone/Mac/... get parent "Products". The children listed under any total must add up to it, so pick parents that reflect the printed hierarchy. Do NOT return consolidated income-statement lines that are not part of a breakdown (e.g. EPS, tax, interest), guidance/outlook, or non-GAAP reconciliation items.
Periods: read column headers. months = 3 for "Three Months Ended", 6/9 for year-to-date, 12 for full year. Dates ISO YYYY-MM-DD; period_start is the first day of the period (estimate from months if not printed).
scale: multiply the printed number to get absolute units ("in millions" → 1000000, "in thousands" → 1000, percentages and per-share → 1). unit "pct" for percentages (value as printed, e.g. 45.2).
Use labels exactly as printed (without footnote markers). Include every period column shown for each row. If no table qualifies, return an empty list.`;

export async function extractIrDocument(id: string) {
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!doc?.path) throw new Error("Document not stored");
  const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(doc.path);
  if (error || !file) throw new Error(error?.message ?? "Download failed");
  const html = await file.text();
  const tables = parseTables(html);
  const rendered = renderTablesForModel(tables);
  const mark = async (status: string, n: number) =>
    supabaseAdmin.from("ir_documents").update({ extracted_at: new Date().toISOString(), extract_status: status, extract_facts: n }).eq("id", id);
  if (!rendered) {
    await mark("no tables", 0);
    return { facts: 0, rejected: 0 };
  }
  const out = await structured<{ facts: ModelFact[] }>({
    name: "ir_kpi_facts",
    instructions: INSTRUCTIONS,
    input: `Company: ${doc.ticker}. Document: ${doc.title} (filed ${doc.filed ?? "unknown"}).\n\n${rendered}`,
    schema: SCHEMA as unknown as Record<string, unknown>,
    effort: "medium",
  });
  const rows: Record<string, unknown>[] = [];
  let rejected = 0;
  const doc_ = doc.source_url.split("/").pop() ?? null;
  for (const f of out.facts) {
    const text = tables[f.t]?.rows[f.r]?.[f.c];
    const n = text == null ? null : parseNumber(text);
    const okPeriod = [3, 6, 9, 12].includes(f.months) && /^\d{4}-\d{2}-\d{2}$/.test(f.period_end);
    const okScale = [1, 1e3, 1e6, 1e9].includes(f.scale);
    if (n == null || !okPeriod || !okScale || !f.label.trim()) {
      rejected++;
      continue;
    }
    rows.push({
      document_id: id,
      ticker: doc.ticker,
      category: f.category,
      metric: f.metric,
      parent: f.parent || null,
      is_total: f.is_total,
      label: f.label.replace(/\s*\(\d\)\s*$/, "").trim(),
      period_label: `${f.months}M ending ${f.period_end}`,
      period_start: /^\d{4}-\d{2}-\d{2}$/.test(f.period_start) ? f.period_start : null,
      period_end: f.period_end,
      months: f.months,
      value: n * f.scale,
      unit: f.unit,
      locator: { t: f.t, r: f.r, c: f.c, text },
      accn: doc.accn,
      doc: doc.source === "sec-exhibit" ? doc_ : null,
      filed: doc.filed,
    });
  }
  await supabaseAdmin.from("ir_kpi_facts").delete().eq("document_id", id);
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await supabaseAdmin.from("ir_kpi_facts").insert(rows.slice(i, i + 500) as never);
    if (e) throw new Error(e.message);
  }
  await mark(rejected ? `ok (${rejected} rejected)` : "ok", rows.length);
  return { facts: rows.length, rejected };
}

/** Next press release waiting for extraction (HTML exhibits; newest first). */
export async function nextToExtract(ticker?: string) {
  let q = supabaseAdmin
    .from("ir_documents")
    .select("id, ticker, title")
    .is("extracted_at", null)
    .in("ext", ["htm", "html"])
    .in("kind", ["press-release", "supplement", "other"])
    .order("filed", { ascending: false })
    .limit(1);
  if (ticker) q = q.eq("ticker", ticker);
  const { data } = await q;
  return data?.[0] ?? null;
}
