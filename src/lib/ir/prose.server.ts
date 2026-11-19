// Read the figures stated in the running text of a stored IR document (see prose-core.ts).
// Runs only in bounded batch scripts (scripts/ir-prose.ts, the deep build); page views never call it.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { structured } from "@/lib/ai.server";
import { EXTRACTABLE_KINDS, pool } from "@/lib/ir/extract.server";
import { applyRulings, ARBITER_INSTRUCTIONS, ARBITER_SCHEMA, crossCheck, type Dispute, dropTableDuplicates, preferPrinted, PROSE_INSTRUCTIONS, renderDisputes, PROSE_SCHEMA, proseBlocks, proseChunks, proseFacts, proseTokens, renderProse, type ProseFact, type ProseOutput } from "@/lib/ir/prose-core";
import { fixRowDates, printedDates } from "@/lib/ir/dates";
import { decodeHtml } from "@/lib/ir/tables";
import { laneStructured } from "@/lib/ir/openai-lane.server";
import { paidOrLane } from "@/lib/ir/credit-fallback";
import { FREE_TIERS } from "@/lib/ir/openai-allowance";
import { estimateCredits, hasOpenAIKey, IR_MODELS, OpenAIError, openaiStructured, type Usage } from "@/lib/openai.server";

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, cached_tokens: a.cached_tokens + b.cached_tokens });

async function ask(input: string, model: string): Promise<{ out: ProseOutput; usage: Usage; model: string }> {
  if (hasOpenAIKey()) {
    const req = { name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown>, effort: "low" as const };
    // An empty paid OpenAI balance moves the primary read to the free lane instead of pausing.
    const r = await paidOrLane(() => openaiStructured<ProseOutput>({ model, ...req }), () => laneStructured<ProseOutput>({ ...req, model: FREE_TIERS.mini.models[0] }));
    return { out: r.data, usage: r.usage, model: r.model };
  }
  const out = await structured<ProseOutput>({ name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown>, effort: "low" });
  return { out, usage: ZERO, model: "lovable-gateway" };
}

/** Text documents the prose reader covers: HTML releases, supplements and letters (PDF text sits in the page tables). */
const proseDoc = (d: { ext: string | null }) => ["htm", "html"].includes(d.ext ?? "");

/** What every reader is told about the document, including the period ends it prints (52/53-week calendars). */
function docContext(doc: { ticker: string; title: string; kind: string; exhibit: string | null; filed: string | null }, ends: Set<string>) {
  const printed = [...ends].sort().reverse().slice(0, 12);
  return `Company: ${doc.ticker}. Document: ${doc.title} (${doc.kind}${doc.exhibit ? `, ${doc.exhibit}` : ""}, filed ${doc.filed ?? "unknown"}).${printed.length ? ` Period-end dates this document prints: ${printed.join(", ")}.` : ""}`;
}

/** Stronger model (the free large-model allowance) settles figures the two readers read differently; none = drop them all. */
const ARBITER_MODEL = process.env["IR_OPENAI_ARBITER_MODEL"] || "gpt-5.4";
async function arbitrate(input: string, disputes: Dispute[], ends: Set<string>, filed: string | null): Promise<ProseFact[]> {
  if (!disputes.length) return [];
  const { kept, rest } = preferPrinted(disputes, ends, filed);
  if (!rest.length) return kept;
  const req = { name: "ir_arbiter", instructions: ARBITER_INSTRUCTIONS, input: `${input}\n\n${renderDisputes(rest)}`, schema: ARBITER_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 6000 };
  // Free OpenRouter models settle disputes first (third opinion only — they pick between the two
  // readings, never add a figure); the OpenAI arbiter takes over when they are capped or failing.
  // IR_ARBITER_ORDER=openai-first restores the old order. Nothing from either = disputes stay dropped.
  const { freeStructured } = await import("@/lib/ir/free-lane.server");
  const free = () => freeStructured<{ rulings: { d: number; pick: string }[] }>(req, (d) => applyRulings(rest, d.rulings).length);
  const openai = async () => (await laneStructured<{ rulings: { d: number; pick: string }[] }>({ model: ARBITER_MODEL, ...req }))?.data ?? null;
  const [first, second] = process.env["IR_ARBITER_ORDER"] === "openai-first" ? [openai, free] : [free, openai];
  const f = (await first()) ?? (await second());
  return [...kept, ...(f ? applyRulings(rest, f.rulings) : [])];
}

/**
 * Read one document's text. Facts the document also prints in a table (same period and value) are
 * left to the table reader; the rest are stored with method "text" and cite their sentence.
 */
export async function readIrProse(id: string, opts: { model?: string; concurrency?: number; chunkChars?: number; /** read and return, store nothing (pilots) */ dry?: boolean; /** false = skip the OpenAI second reader */ second?: boolean } = {}) {
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!doc?.path) throw new Error("Document not stored");
  const mark = (patch: Record<string, unknown>) => (opts.dry ? Promise.resolve() : supabaseAdmin.from("ir_documents").update({ prose_at: new Date().toISOString(), ...patch }).eq("id", id));
  if (!proseDoc(doc)) {
    await mark({ prose_status: "skipped:not html", prose_facts: 0 });
    return { facts: 0, rejected: 0, duplicates: 0, usage: null as Usage | null, credits: 0, records: [] as unknown[] };
  }
  const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(doc.path);
  if (error || !file) throw new Error(error?.message ?? "Download failed");
  const html = await file.text();
  const blocks = proseBlocks(html);
  const ends = printedDates(decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "), true);
  const tokens = proseTokens(blocks, 1500);
  const chunks = proseChunks(blocks, tokens, opts.chunkChars ?? 14_000);
  if (!chunks.length) {
    await mark({ prose_status: "no text figures", prose_facts: 0 });
    return { facts: 0, rejected: 0, duplicates: 0, usage: null, credits: 0, records: [] as unknown[] };
  }
  const model = opts.model ?? IR_MODELS.extract;
  const context = docContext(doc, ends);
  let usage = ZERO;
  let credits = 0;
  let rejected = 0;
  let unreadable = 0;
  let agreed = 0;
  let conflicts = 0;
  let added = 0;
  let checked = 0;
  let upheld = 0;
  const droppedLog: string[] = [];
  const reads = await pool(chunks, opts.concurrency ?? 3, async (c, i) => {
    try {
      const input = `${context}\n\nText (part ${i + 1} of ${chunks.length}):\n\n${renderProse(c.blocks, c.tokens)}`;
      // The second reader (owner's free OpenAI allowance) reads the same numbered text in parallel.
      const [r, second] = await Promise.all([
        ask(input, model),
        opts.second === false ? null : laneStructured<ProseOutput>({ name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown> }),
      ]);
      usage = addUsage(usage, r.usage);
      credits += estimateCredits(model, r.usage) ?? 0;
      const got = proseFacts(r.out, c.blocks, c.tokens, doc.filed);
      rejected += got.rejected;
      if (!second) return got.rows.map((f) => ({ ...f, model: r.model }));
      checked++;
      const other = proseFacts(second.data, c.blocks, c.tokens, doc.filed);
      const x = crossCheck(got.rows, other.rows, doc.filed);
      agreed += x.agreed;
      conflicts += x.conflicts;
      added += x.secondOnly.length;
      const ruled = await arbitrate(input, x.dropped, ends, doc.filed);
      upheld += ruled.length;
      if (opts.dry) for (const d of x.dropped) droppedLog.push(`${d.f.label} = ${d.f.value} (${d.f.months}m ${d.f.period_end}) vs ${d.other.map((o) => `${o.label} (${o.months}m ${o.period_end})`).join(" / ")} → ${ruled.find((k) => k.locator.n === d.f.locator.n)?.period_end ?? "dropped"}`);
      return [...x.rows.map((f) => ({ ...f, model: x.both.has(f) ? `${r.model}+${second.model}` : r.model })), ...ruled.map((f) => ({ ...f, model: `${r.model}|${ARBITER_MODEL}` }))];
    } catch (e) {
      // An unusable answer for one part loses that part only.
      if (e instanceof OpenAIError && e.kind === "rejected") {
        usage = addUsage(usage, e.usage ?? ZERO);
        unreadable++;
        return [] as (ProseFact & { model: string })[];
      }
      throw e;
    }
  });
  // Every part came back unusable: nothing was read, so the document isn't done (the runner retries it).
  if (unreadable && unreadable === chunks.length) throw new Error(`no usable answer for any of ${chunks.length} parts`);
  // Same-day documents (the release, its supplement and deck) print the same figures in their tables.
  // A failed lookup must not pass for "no tables": the document would store figures its tables already hold.
  const sib = doc.filed ? await supabaseAdmin.from("ir_documents").select("id").eq("ticker", doc.ticker).eq("filed", doc.filed).limit(50) : { data: [], error: null };
  if (sib.error) throw new Error(`sibling lookup failed: ${sib.error.message}`);
  const ids = [...new Set([id, ...(sib.data ?? []).map((d) => d.id)])];
  const { data: existing, error: exErr } = await supabaseAdmin.from("ir_kpi_facts").select("period_end, months, value, unit").in("document_id", ids).neq("method", "text").limit(50_000);
  if (exErr) throw new Error(`table figures lookup failed: ${exErr.message}`);
  const all = reads.flat();
  const printed = (existing ?? []).flatMap((e) => (e.period_end && e.months != null ? [{ period_end: e.period_end, months: e.months, value: e.value, unit: e.unit }] : []));
  const kept = dropTableDuplicates(all, printed);
  const records = kept.map(({ tol: _tol, ...f }) => ({
    document_id: id,
    ticker: doc.ticker,
    ...fixRowDates(f, ends),
    accn: doc.accn,
    doc: null,
    document_kind: doc.kind,
    filed: doc.filed,
    method: "text",
  }));
  const check = checked ? { checked, parts: chunks.length, agreed, conflicts, upheld, secondOnly: added, dropped: droppedLog } : null;
  if (opts.dry) return { facts: records.length, rejected, duplicates: all.length - kept.length, usage, credits, records, check };
  await supabaseAdmin.from("ir_kpi_facts").delete().eq("document_id", id).eq("method", "text");
  for (let i = 0; i < records.length; i += 500) {
    const { error: e } = await supabaseAdmin.from("ir_kpi_facts").insert(records.slice(i, i + 500) as never);
    if (e) throw new Error(e.message);
  }
  const checkNote = check ? `, cross-checked ${checked}/${chunks.length} parts: ${agreed} agreed, ${conflicts} disputed, ${upheld} settled by ${ARBITER_MODEL}` : "";
  await mark({ prose_status: `${unreadable ? `partial (${unreadable} of ${chunks.length} parts unreadable)` : rejected ? `ok (${rejected} rejected)` : "ok"}${checkNote}`, prose_facts: records.length });
  return { facts: records.length, rejected, duplicates: all.length - kept.length, usage, credits, records: [] as unknown[], check };
}

/** Claim the next document whose text hasn't been read (newest first). Safe under concurrent runners. */
export async function nextForProse(opts: { ticker?: string } = {}) {
  let q = supabaseAdmin
    .from("ir_documents")
    .select("id, ticker, title, filed")
    .is("prose_status", null)
    .in("ext", ["htm", "html"])
    .in("kind", EXTRACTABLE_KINDS)
    .not("path", "is", null)
    // The table reader goes first, so sentences repeating a table cell are recognised.
    .not("extract_status", "is", null)
    .neq("extract_status", "working")
    .order("filed", { ascending: false, nullsFirst: false })
    .limit(12);
  if (opts.ticker) q = opts.ticker.includes(",") ? q.in("ticker", opts.ticker.split(",")) : q.eq("ticker", opts.ticker);
  const { data } = await q;
  for (const d of data ?? []) {
    // prose_at holds the claim time while working, so only abandoned claims are ever re-queued.
    const { data: claimed } = await supabaseAdmin.from("ir_documents").update({ prose_status: "working", prose_at: new Date().toISOString() }).eq("id", d.id).is("prose_status", null).select("id");
    if (claimed?.length) return d;
  }
  return null;
}

/** Re-queue documents a crashed reader left claimed (claims older than 30 minutes; a document takes seconds). */
export async function resetStaleProse(tickers?: string[]) {
  let q = supabaseAdmin
    .from("ir_documents")
    .update({ prose_status: null, prose_at: null })
    .eq("prose_status", "working")
    .or(`prose_at.is.null,prose_at.lt.${new Date(Date.now() - 30 * 60_000).toISOString()}`);
  if (tickers?.length) q = q.in("ticker", tickers);
  return q;
}

// ---------- second-reader verification of figures already stored ----------

/** Text-read documents stored before the second reader existed (their status has no cross-check note). */
export async function nextForVerify(opts: { ticker?: string } = {}) {
  let q = supabaseAdmin
    .from("ir_documents")
    .select("id, ticker, title, filed, prose_status")
    .gt("prose_facts", 0)
    .or("prose_status.like.ok%,prose_status.like.partial%")
    .not("prose_status", "like", "%cross-checked%")
    .not("prose_status", "like", "%check failed%")
    .order("filed", { ascending: false, nullsFirst: false })
    .limit(12);
  if (opts.ticker) q = opts.ticker.includes(",") ? q.in("ticker", opts.ticker.split(",")) : q.eq("ticker", opts.ticker);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const d of data ?? []) {
    // The claim keeps the old status after the prefix, so an abandoned claim can be put back exactly.
    const { data: claimed } = await supabaseAdmin.from("ir_documents").update({ prose_status: `checking|${d.prose_status}`, prose_at: new Date().toISOString() }).eq("id", d.id).eq("prose_status", d.prose_status!).select("id");
    if (claimed?.length) return { ...d, old: d.prose_status! };
  }
  return null;
}

/** Put verification claims older than 30 minutes back to the status they had. */
export async function resetStaleVerify() {
  const { data } = await supabaseAdmin.from("ir_documents").select("id, prose_status").like("prose_status", "checking|%").lt("prose_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1000);
  for (const d of data ?? []) await supabaseAdmin.from("ir_documents").update({ prose_status: d.prose_status!.slice("checking|".length) }).eq("id", d.id);
}

/**
 * Re-read a document's text with the second reader only (owner's free OpenAI allowance) and hold its
 * stored text figures to the same rule as new reads: a figure the second reader dates differently is
 * deleted, a balance/flow disagreement is settled by the stock rules, the rest stay. Throws a quota
 * error when the day's allowance is spent so the runner stops and the document waits for tomorrow.
 */
export async function verifyIrProse(id: string, old: string, opts: { /** report, change nothing */ dry?: boolean } = {}) {
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!doc?.path) throw new Error("Document not stored");
  const { data: stored, error: sErr } = await supabaseAdmin.from("ir_kpi_facts").select("id, category, metric, breakdown, parent, is_total, label, period_label, period_start, period_end, months, value, unit, locator").eq("document_id", id).eq("method", "text").limit(5000);
  if (sErr) throw new Error(`stored figures lookup failed: ${sErr.message}`);
  const done = (note: string) => (opts.dry ? Promise.resolve() : supabaseAdmin.from("ir_documents").update({ prose_status: `${old}, ${note}`, prose_at: new Date().toISOString() }).eq("id", id));
  const log: string[] = [];
  if (!stored?.length) {
    await done("cross-checked: nothing stored");
    return { agreed: 0, removed: 0, settled: 0, unverified: 0, log };
  }
  const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(doc.path);
  if (error || !file) throw new Error(error?.message ?? "Download failed");
  const html = await file.text();
  const blocks = proseBlocks(html);
  const ends = printedDates(decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "), true);
  const tokens = proseTokens(blocks, 1500);
  const chunks = proseChunks(blocks, tokens, 14_000);
  type Row = (typeof stored)[number];
  const asFact = (r: Row): ProseFact => ({ ...r, period_label: r.period_label ?? "", months: r.months ?? 0, period_end: r.period_end!, locator: r.locator as ProseFact["locator"], tol: 0 }) as ProseFact;
  const facts = stored.filter((r) => r.period_end && typeof (r.locator as { n?: unknown } | null)?.n === "number").map((r) => [r, asFact(r)] as const);
  const context = docContext(doc, ends);
  const remove: string[] = [];
  const settle: { id: string; months: number; period_start: string | null; period_label: string }[] = [];
  const redate: { id: string; period_end: string; period_start: string | null; months: number; period_label: string }[] = [];
  let agreed = 0;
  let checkedTokens = 0;
  await pool(chunks, 2, async (c, i) => {
    const mine = facts.filter(([, f]) => c.tokens.some((t) => t.n === f.locator.n));
    const originals = new Set(mine.map(([, f]) => f));
    if (!mine.length) return;
    const input = `${context}\n\nText (part ${i + 1} of ${chunks.length}):\n\n${renderProse(c.blocks, c.tokens)}`;
    const second = await laneStructured<ProseOutput>({ name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown> });
    if (!second) throw new OpenAIError("free OpenAI allowance spent or unavailable", "quota", 0);
    const other = proseFacts(second.data, c.blocks, c.tokens, doc.filed).rows.map((f) => ({ ...f, ...fixRowDates(f, ends) }));
    const x = crossCheck(mine.map(([, f]) => f), other, doc.filed);
    agreed += x.agreed;
    checkedTokens += mine.length;
    const ruled = await arbitrate(input, x.dropped, ends, doc.filed);
    const kept = new Set([...x.rows, ...ruled.filter((k) => originals.has(k))]);
    for (const k of ruled) {
      if (originals.has(k)) continue;
      // the arbiter chose the second reading: the stored figure takes its period
      const r = mine.find(([, f]) => f.locator.n === k.locator.n && f.value === k.value && f.label === k.label)?.[0];
      if (r) redate.push({ id: r.id, period_end: k.period_end, period_start: k.period_start, months: k.months, period_label: k.period_label });
    }
    const redated = new Set(redate.map((d) => d.id));
    for (const [r, f] of mine) {
      if (!kept.has(f) && !redated.has(r.id)) {
        // a balance/flow settlement keeps a re-classed copy of the stored figure, not the figure itself
        const settled = x.rows.find((k) => !originals.has(k) && k.locator.n === f.locator.n && k.value === f.value && k.label === f.label);
        if (!settled) {
          remove.push(r.id);
          const o = x.dropped.find((d) => d.f === f)?.other ?? [];
          log.push(`removed ${f.label} = ${f.value} (${f.months}m ${f.period_end}) — second reader: ${o.map((v) => `${v.label} (${v.months}m ${v.period_end})`).join(" / ")}`);
        }
        else if (settled.months !== f.months) settle.push({ id: r.id, months: settled.months, period_start: settled.period_start, period_label: settled.period_label });
      }
    }
  });
  if (opts.dry) return { agreed, removed: remove.length, settled: settle.length + redate.length, unverified: facts.length - checkedTokens, log: [...log, ...redate.map((d) => `re-dated ${d.id.slice(0, 8)} → ${d.months}m ${d.period_end}`)] };
  for (let i = 0; i < remove.length; i += 200) {
    const { error: e } = await supabaseAdmin.from("ir_kpi_facts").delete().in("id", remove.slice(i, i + 200));
    if (e) throw new Error(`delete failed: ${e.message}`);
  }
  for (const s of settle) await supabaseAdmin.from("ir_kpi_facts").update({ months: s.months, period_start: s.period_start, period_label: s.period_label }).eq("id", s.id);
  for (const d of redate) await supabaseAdmin.from("ir_kpi_facts").update({ period_end: d.period_end, period_start: d.period_start, months: d.months, period_label: d.period_label }).eq("id", d.id);
  const unverified = facts.length - checkedTokens;
  await done(`cross-checked later: ${agreed} agreed, ${remove.length} removed${settle.length + redate.length ? `, ${settle.length + redate.length} re-dated` : ""}`);
  await supabaseAdmin.from("ir_documents").update({ prose_facts: stored.length - remove.length }).eq("id", id);
  return { agreed, removed: remove.length, settled: settle.length + redate.length, unverified, log };
}
