// Pure timeline shaping for the assistant's tool-call UI.
import type { Step } from "@/lib/research/loop";
import { TOOL_GROUP } from "@/lib/research/tool-defs";

export type TimelineItem =
  | { type: "think"; step: Step }
  | { type: "single"; step: Step }
  | { type: "group"; steps: Step[] }
  | { type: "parallel"; steps: Step[] };

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Short, human summary of a call's arguments: ticker, host, query, target. */
export function argSummary(name: string, a: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (name === "browser_task") {
    const t = (a.tasks as { goal?: string }[] | undefined) ?? [];
    return t.length > 1 ? `${t.length} goals` : s(t[0]?.goal).slice(0, 90);
  }
  if (name === "render_view") {
    try {
      const v = JSON.parse(s(a.spec)) as { type?: string; title?: string };
      return v.title || v.type || "";
    } catch {
      return "";
    }
  }
  if (name === "create_file") return `${s(a.name)}.${s(a.format)}`;
  if (name === "run_code") return s(a.title) || ((a.tickers as string[] | undefined) ?? []).join(", ");
  if (name === "highlight") return s(a.label) || s(a.target);
  if (name === "guide") {
    const n = ((a.stops as unknown[] | undefined) ?? []).length;
    return `${n} stop${n === 1 ? "" : "s"}`;
  }
  for (const k of ["target", "query", "q", "ticker", "symbol", "page", "series_id", "url", "accession"]) {
    const v = a[k];
    if (typeof v === "string" && v) return k === "url" ? hostOf(v) : v.slice(0, 90);
  }
  const tickers = a.tickers;
  if (Array.isArray(tickers) && tickers.length) return tickers.slice(0, 4).join(", ");
  return "";
}

/**
 * Turn steps into display items:
 * - reasoning stays its own line
 * - consecutive finished calls of a groupable tool collapse into one ("Read 4 web pages")
 * - several calls from the same model step show side by side
 */
export function buildTimeline(steps: Step[]): TimelineItem[] {
  const visible = steps.filter((s) => s.name !== "sources" && s.name !== "update_plan");
  const out: TimelineItem[] = [];
  let i = 0;
  while (i < visible.length) {
    const s = visible[i];
    if (s.kind === "think") {
      out.push({ type: "think", step: s });
      i++;
      continue;
    }
    // Run of same-name finished calls.
    let j = i;
    while (j < visible.length && visible[j].kind !== "think" && visible[j].name === s.name && visible[j].status === "done") j++;
    if (j - i >= 2 && TOOL_GROUP[s.name]) {
      out.push({ type: "group", steps: visible.slice(i, j) });
      i = j;
      continue;
    }
    // Parallel batch: same batch number, several calls.
    if (s.batch != null) {
      let k = i;
      while (k < visible.length && visible[k].kind !== "think" && visible[k].batch === s.batch) k++;
      if (k - i >= 2) {
        const batch = visible.slice(i, k);
        const allSame = batch.every((b) => b.name === s.name);
        if (allSame && batch.every((b) => b.status === "done") && TOOL_GROUP[s.name]) out.push({ type: "group", steps: batch });
        else out.push({ type: "parallel", steps: batch });
        i = k;
        continue;
      }
    }
    out.push({ type: "single", step: s });
    i++;
  }
  return out;
}
