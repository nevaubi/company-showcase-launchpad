// Prompt and checks for the "what changed" brief on a filing comparison. Pure.
import { textsOf, type Change, type Redline } from "./core";
import { norm } from "./diff";

export interface SummaryBullet { text: string; changeIds: string[]; quote: string }
export interface RedlineSummary { headline: string; bullets: SummaryBullet[]; model: string; createdAt: string; dropped: number }

export const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "bullets"],
  properties: {
    headline: { type: "string", description: "One sentence: the single most important change." },
    bullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "changeIds", "quote"],
        properties: {
          text: { type: "string", description: "One or two sentences on what changed and why it matters to an investor." },
          changeIds: { type: "array", items: { type: "string" } },
          quote: { type: "string", description: "Verbatim words (8-30) copied from the added or removed text of one cited change." },
        },
      },
    },
  },
} as const;

const clip = (t: string | null | undefined, n: number) => (!t ? "" : t.length > n ? `${t.slice(0, n)}…` : t);

/** Top changes worth summarising (no figure-only updates). */
export function summaryCandidates(r: Redline, n = 30): Change[] {
  return r.changes.filter((c) => !c.figuresOnly).sort((a, b) => b.score - a.score).slice(0, n);
}

export function summaryPrompt(r: Redline, name: string): { instructions: string; input: string } {
  const sec = new Map(r.sections.map((s) => [s.key, s.title]));
  const lines = summaryCandidates(r).map((c) => {
    const t = textsOf(c);
    const added = c.type === "changed" ? c.ops!.filter((o) => o.t === "+").map((o) => o.s.trim()).join(" … ") : c.type === "added" ? t.after : "";
    const removed = c.type === "changed" ? c.ops!.filter((o) => o.t === "-").map((o) => o.s.trim()).join(" … ") : c.type === "removed" ? t.before : "";
    return [
      `[${c.id}] ${sec.get(c.section) ?? c.section} · ${c.type}${c.isHeading ? " heading" : ""} · score ${c.score} · ${c.why.join("; ")}`,
      c.context ? `  Under: ${clip(c.context, 160)}` : "",
      added ? `  ADDED: ${clip(added, 900)}` : "",
      removed ? `  REMOVED: ${clip(removed, 600)}` : "",
      c.type === "changed" ? `  NEW PARAGRAPH: ${clip(t.after, 500)}` : "",
    ].filter(Boolean).join("\n");
  });
  return {
    instructions: [
      `You are a buy-side analyst summarising how ${name}'s ${r.form} filed ${r.to.filed} changed versus the ${r.form} filed ${r.from.filed}.`,
      "Use only the changes listed. Write 5-8 bullets ordered by investor importance: new or removed risks, hardened language (a hypothetical that is now a fact), legal/regulatory developments, demand/supply/customer signals, accounting or controls changes.",
      "Each bullet cites the change ids it relies on and includes one verbatim quote (8-30 words) copied exactly from the ADDED, REMOVED or NEW PARAGRAPH text of a cited change.",
      "Do not state numbers that are not in the cited text. Do not speculate beyond what the text says; say what changed and why it matters.",
    ].join("\n"),
    input: lines.join("\n\n"),
  };
}

/** Keep bullets whose quote is verbatim in a cited change and whose numbers appear in that text. */
export function vetSummary(raw: { headline: string; bullets: SummaryBullet[] }, r: Redline): { headline: string; bullets: SummaryBullet[]; dropped: number } {
  const byId = new Map(r.changes.map((c) => [c.id, c]));
  const textOf = (id: string) => { const c = byId.get(id); if (!c) return ""; const t = textsOf(c); return `${t.before ?? ""} \n ${t.after ?? ""}`; };
  const digits = (s: string) => s.match(/\d[\d,.]*\d|\d/g)?.map((x) => x.replace(/[,]/g, "").replace(/\.$/, "")) ?? [];
  let dropped = 0;
  const bullets = raw.bullets.filter((b) => {
    const ids = b.changeIds.filter((id) => byId.has(id));
    if (!ids.length || !b.quote.trim()) { dropped++; return false; }
    const src = ids.map(textOf).join(" \n ");
    const q = norm(b.quote.replace(/^["“'‘]|["”'’]$/g, "").replace(/…$/, ""));
    if (q.length < 12 || !norm(src).includes(q)) { dropped++; return false; }
    const have = new Set(digits(src));
    if (digits(b.text).some((d) => !have.has(d))) { dropped++; return false; }
    b.changeIds = ids;
    return true;
  });
  // The headline may only use numbers that appear in the compared text.
  const all = new Set(digits(summaryCandidates(r).map((c) => { const t = textsOf(c); return `${t.before ?? ""} ${t.after ?? ""}`; }).join(" ")));
  const headline = digits(raw.headline).every((d) => all.has(d)) ? raw.headline : bullets[0]?.text ?? "";
  return { headline, bullets, dropped };
}
