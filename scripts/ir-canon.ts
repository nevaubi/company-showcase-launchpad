/**
 * Cross-document canonical hierarchy pass (reasoning model on the owner's OpenAI key).
 * For each company: summarize every distinct extracted line, ask the model to merge renames, fix
 * dimensions/parents and drop junk, then verify by rebuilding the series. A proposal is kept only if
 * it reduces (or doesn't increase) reconciliation failures; a second round targets what still fails.
 *   bun scripts/ir-canon.ts [--tickers=AAPL,MSFT] [--concurrency=4] [--rounds=2]
 */
import { COVERAGE } from "@/lib/coverage";
import { CANON_INSTRUCTIONS, CANON_SCHEMA, failureNotes, mapFromModel, rawLines, renderLines, type RawLine } from "@/lib/ir/canon";
import { buildIrSeries, normLabel, rawKey, type IrFact, type LabelMapEntry } from "@/lib/ir/kpis";
import { IR_MODELS, OpenAIError, openaiStructured } from "@/lib/openai.server";
import { loadLabelMap } from "@/lib/ir/rebuild.server";
import { buildCompany, loadFacts } from "./ir-build";
import { args, log, sb } from "./lib/supa";

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
  const r = await openaiStructured<CanonOut>({
    model: args.model ?? IR_MODELS.reason,
    name: "ir_canonical_lines",
    instructions: CANON_INSTRUCTIONS,
    input: `Company: ${ticker} (${name}). ${lines.length} extracted lines:\n\n${renderLines(lines, notes)}`,
    schema: CANON_SCHEMA as unknown as Record<string, unknown>,
    effort: "high",
    maxOutputTokens: 100_000,
  });
  return r;
}

async function canonCompany(ticker: string, name: string) {
  const facts: IrFact[] = await loadFacts(ticker);
  if (!facts.length) return;
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
  if (best.map && best.map !== existing) {
    await sb.from("ir_label_map").delete().eq("ticker", ticker);
    const rows = Object.entries(best.map).map(([raw_key, canonical]) => ({ ticker, raw_key, canonical: canonical as never, model: args.model ?? IR_MODELS.reason }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("ir_label_map").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  }
  const p = await buildCompany(ticker);
  log(`${ticker.padEnd(5)} ${lines.length} lines · failures ${base.failed}/${base.total} → ${best.failed}/${best.total}${best.map ? "" : " (kept original)"} · Q ${p?.stats.checksQ.ok}/${p?.stats.checksQ.total} FY ${p?.stats.checksFY.ok}/${p?.stats.checksFY.total} · ${(tokens / 1e3).toFixed(0)}k tokens`);
}

const want = args.tickers?.split(",");
const list = COVERAGE.filter((c) => !want || want.includes(c.ticker));
let next = 0;
let stop = false;
await Promise.all(
  Array.from({ length: Number(args.concurrency ?? 4) }, async () => {
    while (!stop && next < list.length) {
      const c = list[next++];
      try {
        await canonCompany(c.ticker, c.name);
      } catch (e) {
        if (e instanceof OpenAIError && (e.kind === "auth" || e.kind === "quota")) {
          stop = true;
          await sb.from("job_state").upsert({ job: "ir-canon", cursor: 0, paused_reason: e.message.slice(0, 200), updated_at: new Date().toISOString() });
        }
        log(`${c.ticker} canon failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }),
);
process.exit(0);
