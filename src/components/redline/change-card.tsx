import { useState } from "react";
import { FileSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSource } from "@/components/source/source-context";
import { requestResearch } from "@/lib/research/request";
import { textsOf, type Change, type FilingRef } from "@/lib/redline/core";
import type { Op } from "@/lib/redline/diff";
import { cn } from "@/lib/utils";

const LEVEL_CLS: Record<Change["level"], string> = {
  high: "border-negative/40 bg-negative/10 text-negative",
  medium: "border-highlight/60 bg-highlight-soft text-foreground",
  low: "border-border bg-secondary text-muted-foreground",
};

export const TYPE_LABEL = (c: Pick<Change, "type" | "isHeading" | "section" | "figuresOnly">) => {
  const risk = c.section === "1A" || c.section === "II-1A";
  if (c.figuresOnly) return "Updated figures";
  if (c.type === "added") return c.isHeading ? (risk ? "New risk factor" : "New heading") : "Added";
  if (c.type === "removed") return c.isHeading ? (risk ? "Risk factor removed" : "Heading removed") : "Removed";
  return c.isHeading ? (risk ? "Risk factor reworded" : "Heading reworded") : "Rewritten";
};

/** Inline word diff: insertions highlighted, deletions struck through. */
export function DiffText({ ops, clamp }: { ops: Op[]; clamp: boolean }) {
  return (
    <p className={cn("whitespace-pre-wrap text-[13px] leading-relaxed", clamp && "line-clamp-6")}>
      {ops.map((o, i) =>
        o.t === "=" ? <span key={i}>{o.s}</span>
          : o.t === "+" ? <ins key={i} className="rounded-sm bg-positive/15 text-foreground no-underline decoration-positive/60 [text-decoration-line:underline] [text-decoration-thickness:1.5px]">{o.s}</ins>
          : <del key={i} className="rounded-sm bg-negative/10 text-negative/80">{o.s}</del>,
      )}
    </p>
  );
}

/** A phrase that locates the paragraph inside the filing viewer. */
function locatePhrase(t: string | null): string | undefined {
  if (!t) return undefined;
  const words = t.replace(/\s+/g, " ").trim().split(" ");
  return words.slice(0, Math.min(12, words.length)).join(" ");
}

export function ChangeCard({ c, ticker, sectionTitle, from, to, highlighted }: {
  c: Change;
  ticker: string;
  sectionTitle: string;
  from: FilingRef;
  to: FilingRef;
  highlighted?: boolean;
}) {
  const { open } = useSource();
  const [expanded, setExpanded] = useState(false);
  const t = textsOf(c);
  const text = c.type === "removed" ? t.before : t.after;
  const long = (text?.length ?? 0) > 700;
  const ops: Op[] = c.ops ?? [{ t: c.type === "added" ? "+" : "-", s: text ?? "" }];
  const openIn = (f: FilingRef, phrase: string | undefined) =>
    open({ ticker, label: `${sectionTitle} · ${TYPE_LABEL(c)}`, unit: "usd", value: 0, doc: { accn: f.accn, doc: f.doc, form: f.form, filed: f.filed, title: `${f.form} filed ${f.filed}`, search: phrase } });
  const snippet = (text ?? "").slice(0, 600);

  return (
    <article id={`change-${c.id}`} className={cn("scroll-mt-24 border-b px-3.5 py-3 transition-colors", highlighted && "bg-highlight-soft/50")}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className={cn("num inline-flex items-center gap-1 rounded border px-1.5 py-px font-semibold uppercase tracking-wide", LEVEL_CLS[c.level])} title="Materiality score (0–100)">
          {c.level} <span className="font-normal opacity-80">{c.score}</span>
        </span>
        <span className="font-semibold">{TYPE_LABEL(c)}</span>
        <span className="text-muted-foreground">· {sectionTitle}</span>
        {c.context && <span className="min-w-0 max-w-full truncate text-muted-foreground" title={c.context}>· under “{c.context.length > 90 ? `${c.context.slice(0, 88)}…` : c.context}”</span>}
      </header>
      {(c.why.length > 0 || c.terms.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.why.map((w) => <span key={w} className="rounded bg-secondary px-1.5 py-px text-[10.5px] text-muted-foreground">{w}</span>)}
        </div>
      )}
      <div className={cn("mt-2", c.isHeading && "font-semibold")}>
        <DiffText ops={ops} clamp={long && !expanded} />
        {long && <button type="button" className="mt-1 text-xs font-medium text-link hover:underline" onClick={() => setExpanded((x) => !x)}>{expanded ? "Show less" : "Show the whole paragraph"}</button>}
      </div>
      <footer className="mt-2 flex flex-wrap items-center gap-1">
        {c.type !== "removed" && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openIn(to, locatePhrase(t.after))}><FileSearch /> {to.form} {to.filed.slice(0, 4)}</Button>}
        {c.type !== "added" && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openIn(from, locatePhrase(t.before))}><FileSearch /> {from.form} {from.filed.slice(0, 4)}</Button>}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => requestResearch(`${ticker} ${to.form} filed ${to.filed} vs the ${from.form} filed ${from.filed} — ${sectionTitle}, ${TYPE_LABEL(c).toLowerCase()}${c.context ? ` under "${c.context.slice(0, 120)}"` : ""}. What does this change signal for investors, and is it reflected elsewhere (calls, estimates, peers)?\n\n"${snippet}${(text?.length ?? 0) > 600 ? "…" : ""}"`)}>
          <Sparkles /> Ask the assistant
        </Button>
      </footer>
    </article>
  );
}
