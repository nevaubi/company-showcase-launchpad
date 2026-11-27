// What a tab says when it has nothing to show: the coverage ledger's sentence for this company and
// kind of data, so "not stored yet" reads differently from "looked, and there is none" and from
// "does not apply". Rules and wording: src/lib/coverage/corpora.ts (`emptyNote`).
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { emptyNote, type CorpusId, type CoverageRow, type CoverageState } from "@/lib/coverage/corpora";
import { companyCoverageQuery } from "@/lib/coverage/read";
import { cn } from "@/lib/utils";

/** The ledger's row for one company and kind of data; undefined while loading or when there is none. */
export function useCoverageRow(ticker: string, corpus: CorpusId): CoverageRow | undefined {
  const q = useQuery(companyCoverageQuery(ticker));
  return q.data?.rows.find((r) => r.corpus === corpus);
}

/**
 * The ledger's note for an empty tab, or `fallback` when the ledger has nothing to say (no row yet,
 * still loading, or it holds items the tab is not showing). `only` limits it to some states.
 */
export function CoverageNote({ ticker, corpus, fallback = null, only, className }: { ticker: string; corpus: CorpusId; fallback?: ReactNode; only?: readonly CoverageState[]; className?: string }) {
  const row = useCoverageRow(ticker, corpus);
  const note = row && (!only || only.includes(row.state)) ? emptyNote(row) : null;
  if (!note) return <>{fallback}</>;
  return (
    <span className={cn("block", className)} data-coverage={row!.state}>
      <span className="font-medium text-foreground">{note.title}.</span> {note.body}
    </span>
  );
}
