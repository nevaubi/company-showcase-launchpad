import { useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import type { Technicals } from "@/lib/technicals/analysis";
import type { ReadSentence } from "@/lib/technicals/read";
import { cn } from "@/lib/utils";
import { CalcSheet, Note, T as S, TechPanel, type Calc } from "./ui";

const toCalc = (sym: string, s: ReadSentence): Calc => ({
  title: `${sym}: ${s.table.title}`,
  sub: s.aside ? `${s.text} ${s.aside}` : s.text,
  formula: s.table.formula,
  cols: s.table.cols,
  rows: s.table.rows,
  note: s.table.note,
});

/** One sentence of the read: a button that opens the table behind its figures. */
function Sentence({ s, onOpen, lead }: { s: ReadSentence; onOpen: () => void; lead?: boolean }) {
  return (
    <li className="border-b last:border-0">
      <button
        type="button"
        onClick={onOpen}
        data-agent-click
        title="Show the figures behind this sentence"
        className="group grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-highlight-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:grid-cols-[6.5rem_minmax(0,1fr)]"
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", s.tone > 0 ? "bg-positive" : s.tone < 0 ? "bg-negative" : "bg-muted-foreground/40")}
          />
          <span className="eyebrow">{s.label}</span>
        </span>
        <span className={cn("text-[13px] leading-5", lead && "font-medium")}>
          {s.text}
          <span className="ml-1.5 whitespace-nowrap text-[11px] text-link opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
            figures
          </span>
          {s.aside && <span className="mt-0.5 block text-[11px] font-normal leading-4 text-muted-foreground">{s.aside}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The technical read: the evidence verdict first, then trend, momentum, stretch, volatility and volume.
 * Every sentence is assembled from computed figures and opens the table behind them.
 */
export function ReadPanel({
  symbol,
  T,
  loading,
  compact,
  actions,
}: {
  symbol: string;
  T: Technicals | null;
  loading: boolean;
  /** The version other pages embed: no page anchor, a one-line caption */
  compact?: boolean;
  actions?: ReactNode;
}) {
  const [calc, setCalc] = useState<Calc | null>(null);
  const verdict = T?.read.find((s) => s.key === "verdict");
  const rest = T?.read.filter((s) => s.key !== "verdict") ?? [];
  return (
    <TechPanel
      section="Technical read"
      id={compact ? undefined : "read"}
      tour={compact ? undefined : "tech-read"}
      title="Technical read"
      actions={actions}
      subtitle={T ? `From ${T.bars.toLocaleString("en-US")} daily bars, ${fmtDate(T.first)} to ${fmtDate(T.asOf)}` : undefined}
    >
      {!T ? (
        loading ? (
          <div className="space-y-3 p-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>Not enough daily history for {symbol} to compute a read (60 sessions are needed).</p>
        )
      ) : (
        <>
          <ul>
            {verdict && <Sentence s={verdict} lead onOpen={() => setCalc(toCalc(symbol, verdict))} />}
            {rest.map((s) => (
              <Sentence key={s.key} s={s} onOpen={() => setCalc(toCalc(symbol, s))} />
            ))}
          </ul>
          <Note>
            {compact
              ? "Built from the figures each sentence prints; select one for its table. A description of the record, not a forecast or advice."
              : "Each sentence is built from the figures it prints; select one for its table. The dots show the direction of the data (green up, red down, grey neither). Descriptions of the record, not forecasts or advice."}
          </Note>
        </>
      )}
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </TechPanel>
  );
}
