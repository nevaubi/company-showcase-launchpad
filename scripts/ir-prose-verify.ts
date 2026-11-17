/**
 * Hold text figures stored before the second reader existed to the cross-check (see verifyIrProse):
 * re-read each document with the OpenAI second reader only, inside the owner's free daily allowance,
 * and delete figures the two readers date differently. Stops by itself when the day's allowance is
 * spent; the always-on worker starts it again (scripts/ir-deep-loop.ts).
 *   bun scripts/ir-prose-verify.ts [--ticker=COST[,WMT]] [--max=500] [--concurrency=6] [--reserve=0.4] [--resume]
 */
import { nextForVerify, resetStaleVerify, verifyIrProse } from "@/lib/ir/prose.server";
import { laneEnabled, laneUsed } from "@/lib/ir/openai-lane.server";
import { args, sb } from "./lib/supa";
import { runBatch } from "./lib/runner";

if (!laneEnabled()) {
  console.log("OpenAI second reader is off (no OPENAI_API_KEY or IR_OPENAI_LANE=0) — nothing to do");
  process.exit(0);
}
// New reads come first: the check pass only uses what they leave (--reserve, default 40% of the day).
const reserve = Number(args.reserve ?? 0.4);
const used = await laneUsed("mini");
if (used > 1 - reserve) {
  console.log(`today's free allowance is ${(used * 100).toFixed(0)}% used — leaving the rest to new reads`);
  process.exit(0);
}
await runBatch<{ id: string; ticker: string; label: string; old: string }>({
  job: args.ticker ? `ir-prose-verify:${args.ticker}` : "ir-prose-verify",
  max: Number(args.max ?? 500),
  concurrency: Number(args.concurrency ?? 6),
  claim: async () => {
    const d = await nextForVerify(args.ticker ? { ticker: args.ticker } : {});
    return d ? { id: d.id, ticker: d.ticker, old: d.old, label: `${d.filed ?? ""} ${d.title}` } : null;
  },
  // Failures put the document back as it was; a hard error marks it so it isn't retried forever.
  release: (d, status) => sb.from("ir_documents").update({ prose_status: status?.startsWith("error") ? `${d.old}, check failed` : d.old }).eq("id", d.id),
  reset: () => resetStaleVerify(),
  process: async (d) => {
    const r = await verifyIrProse(d.id, d.old);
    // Removed figures change the company's series: report them as work so the runner rebuilds it.
    return { facts: r.removed + r.settled, note: `${r.agreed} agreed, ${r.removed} removed${r.settled ? `, ${r.settled} re-classed` : ""}${r.unverified ? `, ${r.unverified} outside checked parts` : ""}` };
  },
});
process.exit(0);
