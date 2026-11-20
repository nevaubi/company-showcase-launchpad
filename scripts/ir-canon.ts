/**
 * Cross-document canonical hierarchy pass (reasoning model on the owner's OpenAI key).
 * For each company: summarize every distinct extracted line, ask the model to merge renames, fix
 * dimensions/parents and drop junk, then verify by rebuilding the series. A proposal is kept only if
 * it reduces (or doesn't increase) reconciliation failures; a second round targets what still fails.
 *   bun scripts/ir-canon.ts [--tickers=AAPL,MSFT] [--concurrency=4] [--rounds=2] [--resume --max=40]
 * --resume continues the full-coverage pass from the cursor in job_state `ir-canon` (the worker loop
 * runs it daily) and --max caps companies with figures per run.
 */
import { COVERAGE } from "@/lib/coverage";
import { CANON_INSTRUCTIONS, CANON_SCHEMA, failureNotes, mapFromModel, rawLines, renderLines, type RawLine } from "@/lib/ir/canon";
import { buildIrSeries, normLabel, rawKey, type IrFact, type LabelMapEntry } from "@/lib/ir/kpis";
import { IR_MODELS, openaiStructured } from "@/lib/openai.server";
import { classifyError } from "@/lib/jobs/failure";
import { rankOrder } from "@/lib/jobs/priority";
import { paidOrLane } from "@/lib/ir/credit-fallback";
import { laneStructured } from "@/lib/ir/openai-lane.server";
import { FREE_TIERS } from "@/lib/ir/openai-allowance";
import { loadLabelMap } from "@/lib/ir/rebuild.server";
import { buildCompany, loadFacts } from "./ir-build";
import { args, log, sb } from "./lib/supa";
import { loadRank } from "./lib/rank";
import { canonLap, staleLabelKeys, type CanonLap } from "./lib/canon-lap";

type CanonOut = { lines: { id: number; category: string; metric: string; label: string; parent: string; is_total: boolean; drop: boolean; reason: string }[] };

/** Every distinct printed (unit, quarter, value) the tables show — a merge may dedupe these, never lose them. */
function shownValues(facts: IrFact[], map?: Record<string, LabelMapEntry>) {
  const { series } = buildIrSeries(facts, map ? { labelMap: map } : {});
  const values = new Set<string>();
  // newest filing date shown per (unit, quarter, line) — used to recognise restated values
  const shownFiled = new Map<string, string>();
  for (const s of series)
    for (const [e, c] of Object.entries(s.cells)) {
      if (!c.fact) continue; // derived cells (Q4 = FY − 9M) change with their inputs
      values.add(`${s.unit}|${e}|${Math.round(c.v)}`);
      const k = `${s.unit}|${e}|${normLabel(s.label)}`;
      const filed = c.fact.filed ?? "";
      if (filed > (shownFiled.get(k) ?? "")) shownFiled.set(k, filed);
    }
  return { values, shownFiled };
}

/**
 * Printed values the base tables show that a proposal would make disappear. Not counted: lines it
 * drops as junk, and values replaced by a later filing's restatement of the same line and quarter.
 */
function lostValues(facts: IrFact[], base: Set<string>, map: Record<string, LabelMapEntry>): { lost: number; lines: Set<string> } {
  const after = shownValues(facts, map);
  const byValue = new Map<string, IrFact[]>();
  for (const f of facts) {
    if (f.months !== 3) continue;
    const k = `${f.unit}|${f.period_end}|${Math.round(f.value)}`;
    byValue.set(k, [...(byValue.get(k) ?? []), f]);
  }
  let lost = 0;
  // the merged lines (unit + canonical label) the lost values collapsed into
  const lines = new Set<string>();
  for (const v of base) {
    if (after.values.has(v)) continue;
    const fs = byValue.get(v) ?? [];
    const excused = fs.some((f) => {
      const m = map[rawKey(f)];
      if (m?.drop) return true;
      const newer = after.shownFiled.get(`${f.unit}|${f.period_end}|${normLabel(m?.label ?? f.label)}`);
      return newer != null && newer > (f.filed ?? "");
    });
    if (excused) continue;
    lost++;
    for (const f of fs) lines.add(`${f.unit}|${normLabel(map[rawKey(f)]?.label ?? f.label)}`);
  }
  return { lost, lines };
}

/** Undo every rename into the lines that swallowed real numbers; the rest of the proposal stands. */
function revertCollisions(proposal: Record<string, LabelMapEntry>, lines: Set<string>) {
  const out = { ...proposal };
  for (const [k, m] of Object.entries(proposal)) if (lines.has(`${k.split("|")[2]}|${normLabel(m.label)}`)) delete out[k];
  return out;
}

function batches(lines: RawLine[], max = 380): RawLine[][] {
  const byMetric = new Map<string, RawLine[]>();
  for (const l of lines) byMetric.set(l.metric, [...(byMetric.get(l.metric) ?? []), l]);
  const out: RawLine[][] = [];
  let cur: RawLine[] = [];
  for (const group of [...byMetric.values()].sort((a, b) => b.length - a.length)) {
    if (group.length > max) {
      const byCat = new Map<string, RawLine[]>();
      for (const l of group) byCat.set(l.category, [...(byCat.get(l.category) ?? []), l]);
      for (const g of byCat.values()) for (let i = 0; i < g.length; i += max) out.push(g.slice(i, i + max));
      continue;
    }
    if (cur.length + group.length > max) {
      out.push(cur);
      cur = [];
    }
    cur.push(...group);
  }
  if (cur.length) out.push(cur);
  return out;
}

async function ask(ticker: string, name: string, lines: RawLine[], notes: string[]) {
  const req = {
    name: "ir_canonical_lines",
    instructions: CANON_INSTRUCTIONS,
    input: `Company: ${ticker} (${name}). ${lines.length} extracted lines:\n\n${renderLines(lines, notes)}`,
    schema: CANON_SCHEMA as unknown as Record<string, unknown>,
    effort: "high" as const,
    maxOutputTokens: 100_000,
  };
  // An empty paid balance moves the call to the owner's free large-model lane instead of pausing.
  // rethrow: a lane timeout or a cut-off reply surfaces as itself, never as "the free lane is spent".
  return paidOrLane(() => openaiStructured<CanonOut>({ model: args.model ?? IR_MODELS.reason, ...req }), () => laneStructured<CanonOut>({ ...req, model: FREE_TIERS.large.models[0], rethrow: true }));
}

/** none = no figures; kept = the stored/original map stays; replaced = a better map was written. */
async function canonCompany(ticker: string, name: string): Promise<"none" | "kept" | "replaced"> {
  const facts: IrFact[] = await loadFacts(ticker);
  if (!facts.length) return "none";
  const lines = rawLines(facts);
  const base = failureNotes(facts, undefined, 0);
  const baseValues = shownValues(facts).values;
  const allowed = baseValues.size * 0.002;
  let map: Record<string, LabelMapEntry> = {};
  let tokens = 0;
  const rounds = Number(args.rounds ?? 2);
  let best = { map: undefined as Record<string, LabelMapEntry> | undefined, failed: base.failed, total: base.total };
  // The stored map from an earlier pass competes on the same terms; one that loses real numbers is retired.
  const existing = await loadLabelMap(ticker);
  if (existing) {
    const r = failureNotes(facts, existing, 0);
    const { lost } = lostValues(facts, baseValues, existing);
    log(`${ticker} stored map: failures ${r.failed}/${r.total}, ${lost} shown values lost`);
    if (r.failed <= best.failed && r.total >= base.total * 0.85 && lost <= allowed) best = { map: existing, failed: r.failed, total: r.total };
  }
  for (let round = 1; round <= rounds; round++) {
    const current = failureNotes(facts, Object.keys(map).length ? map : undefined, 80);
    if (round > 1 && current.failed === 0) break;
    // Round 1 reviews every line; later rounds only the lines involved in failing breakdowns.
    let todo = lines;
    if (round > 1) {
      const words = current.notes.join(" ").toLowerCase();
      todo = lines.filter((l) => words.includes(`"${(map[l.key]?.label ?? l.label).toLowerCase()}"`) || words.includes(`"${(map[l.key]?.parent ?? l.parent).toLowerCase()}"`));
      if (!todo.length) break;
    }
    const results = await Promise.all(
      batches(todo).map(async (b) => {
        const cats = new Set(b.map((l) => l.category));
        const notes = current.notes.filter((n) => [...cats].some((c) => n.startsWith(`[${c}/`)));
        const r = await ask(ticker, name, b.map((l) => (map[l.key] ? { ...l, ...map[l.key], parent: map[l.key].parent ?? "" } : l)), notes);
        tokens += r.usage.input_tokens + r.usage.output_tokens;
        return mapFromModel(b, r.data);
      }),
    );
    let proposal: Record<string, LabelMapEntry> = Object.assign({}, map, ...results);
    let after = failureNotes(facts, proposal, 0);
    let lv = lostValues(facts, baseValues, proposal);
    log(`${ticker} round ${round}: failures ${current.failed}/${current.total} → ${after.failed}/${after.total}, ${lv.lost} shown values lost`);
    // Merges that swallow real numbers are undone line by line, keeping the rest of the proposal.
    for (let fix = 1; fix <= 3 && lv.lost > allowed && lv.lines.size; fix++) {
      proposal = revertCollisions(proposal, lv.lines);
      after = failureNotes(facts, proposal, 0);
      lv = lostValues(facts, baseValues, proposal);
      log(`${ticker} round ${round} repair ${fix}: failures ${after.failed}/${after.total}, ${lv.lost} shown values lost`);
    }
    // Keep a proposal only if it fails no more checks, doesn't hide coverage (dropping lines to "pass")
    // and doesn't merge away real numbers (two different values collapsing into one line).
    if (after.failed <= best.failed && after.total >= base.total * 0.85 && lv.lost <= allowed) best = { map: proposal, failed: after.failed, total: after.total };
    map = proposal;
  }
  if (!best.map && existing) await sb.from("ir_label_map").delete().eq("ticker", ticker);
  const replaced = !!best.map && best.map !== existing;
  if (best.map && best.map !== existing) {
    // Write the new map first, then delete the keys it no longer has: a kill in between (the 4 h
    // deadline) leaves a complete map instead of none (review F20). created_at marks the new map.
    const at = new Date().toISOString();
    const rows = Object.entries(best.map).map(([raw_key, canonical]) => ({ ticker, raw_key, canonical: canonical as never, model: args.model ?? IR_MODELS.reason, created_at: at }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("ir_label_map").upsert(rows.slice(i, i + 500), { onConflict: "ticker,raw_key" });
      if (error) throw new Error(error.message);
    }
    const old: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("ir_label_map").select("raw_key").eq("ticker", ticker).order("raw_key").range(from, from + 999);
      if (error) throw new Error(error.message);
      old.push(...(data ?? []).map((r) => r.raw_key));
      if ((data ?? []).length < 1000) break;
    }
    const stale = staleLabelKeys(old, rows.map((r) => r.raw_key));
    for (let i = 0; i < stale.length; i += 200) {
      const { error } = await sb.from("ir_label_map").delete().eq("ticker", ticker).in("raw_key", stale.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
  }
  const p = await buildCompany(ticker);
  log(`${ticker.padEnd(5)} ${lines.length} lines · failures ${base.failed}/${base.total} → ${best.failed}/${best.total}${best.map ? "" : " (kept original)"} · Q ${p?.stats.checksQ.ok}/${p?.stats.checksQ.total} FY ${p?.stats.checksFY.ok}/${p?.stats.checksFY.total} · ${(tokens / 1e3).toFixed(0)}k tokens`);
  return replaced ? "replaced" : "kept";
}

const want = args.tickers?.split(",");
const resume = args.resume !== undefined && !want;
// Top 1,000 by 20-day dollar volume first (PRIORITY_ORDER=0 keeps COVERAGE order); the cursor indexes this list.
const rank = await loadRank();
const byTicker = new Map(COVERAGE.map((c) => [c.ticker, c]));
const all = rankOrder(COVERAGE.filter((c) => !want || want.includes(c.ticker)).map((c) => c.ticker), rank).map((t) => byTicker.get(t)!);
const { data: run } = await sb.from("job_runs").insert({ job: "ir-canon" }).select("id").single();
const { data: st } = resume ? await sb.from("job_state").select("cursor").eq("job", "ir-canon").maybeSingle() : { data: null };
// --resume walks a stored lap (ranked once when the lap starts); the cursor indexes that lap (review F7).
const LAP = "ops/ir-canon-lap.json";
let start = 0;
let lapOrder = all;
/** false when a new lap could not be stored: the run reads it but leaves the cursor where it was */
let lapSaved = true;
if (resume) {
  let stored: CanonLap | null = null;
  try {
    const { data } = await sb.storage.from("ir-documents").download(LAP);
    stored = data ? (JSON.parse(await data.text()) as CanonLap) : null;
  } catch {
    stored = null;
  }
  const r = canonLap(stored, st?.cursor ?? 0, all.map((c) => c.ticker), Date.now());
  if (r.fresh || r.lap.order.length !== stored?.order.length) {
    const { error } = await sb.storage.from("ir-documents").upload(LAP, new Blob([JSON.stringify(r.lap)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (error) {
      lapSaved = false;
      log(`ir-canon: could not store the lap order (${error.message}) — this run leaves the cursor unchanged`);
    } else if (r.fresh) log(`ir-canon: new lap of ${r.lap.order.length} companies`);
  }
  lapOrder = r.lap.order.flatMap((t) => (byTicker.has(t) ? [byTicker.get(t)!] : []));
  start = r.start;
}
const list = resume ? lapOrder.slice(start) : all;
const cap = Number(args.max ?? (resume ? 40 : Infinity));
let next = 0;
let processed = 0;
let kept = 0;
let replaced = 0;
let failed = 0;
let stop: string | null = null;
/** list index of the first company a provider stop left unread (two workers: the earliest one wins) */
let retryFrom = Infinity;
// The end of the lap (cursor = its length) starts a new lap on the next run.
const cursorAt = () => start + Math.min(next, retryFrom);
// Never move the cursor past a company a provider stop left unread.
const saveCursor = () => (resume && lapSaved && !stop ? sb.from("job_state").upsert({ job: "ir-canon", cursor: cursorAt(), paused_reason: null, updated_at: new Date().toISOString() }) : null);
await Promise.all(
  Array.from({ length: Number(args.concurrency ?? 4) }, async () => {
    while (!stop && next < list.length && processed < cap) {
      const idx = next++;
      const c = list[idx];
      try {
        const r = await canonCompany(c.ticker, c.name);
        if (r !== "none") processed++;
        if (r === "kept") kept++;
        if (r === "replaced") replaced++;
        await saveCursor();
      } catch (e) {
        const cls = classifyError(e);
        if (cls === "quota" || cls === "config") {
          // This company (not whichever the other worker holds) is retried first on the next run.
          retryFrom = Math.min(retryFrom, idx);
          stop ??= `${cls === "config" ? "auth" : "quota"}: ${(e as Error).message.slice(0, 190)}`;
          await sb.from("job_state").upsert({ job: "ir-canon", cursor: resume && lapSaved ? cursorAt() : (st?.cursor ?? 0), paused_reason: stop, updated_at: new Date().toISOString() });
        } else failed++;
        log(`${c.ticker} canon failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }),
);
log(`ir-canon: ${processed} companies with figures processed${resume ? `, cursor ${cursorAt()}/${lapOrder.length}` : ""}`);
// Run row: freshness of the label canon is measured by successful passes, not by map inserts (a
// healthy pass that keeps every stored map writes nothing to ir_label_map).
if (run) await sb.from("job_runs").update({ finished_at: new Date().toISOString(), ok: !stop && (processed > 0 || failed === 0), items: processed, detail: { processed, kept, replaced, failed, stop, cursor: cursorAt(), of: lapOrder.length } }).eq("id", run.id);
process.exit(stop ? 3 : 0);
