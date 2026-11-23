// One compact line under the IR summary: how many figures were checked against the company's SEC
// statements, how many agree, how many are held or flagged, and the read-time consistency checks;
// "Which" lists every checked figure with both numbers and opens either source.
import { useMemo } from "react";
import { useSource } from "@/components/source/source-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { openIrCell } from "@/components/ir/breakdowns";
import { IR } from "@/components/ir/typography";
import type { ConsistencySummary } from "@/lib/ir/consistency";
import { fmtIr } from "@/lib/ir/display";
import type { IrPayload } from "@/lib/ir/payload";
import { STD_LABEL, type SecCheck, type SecItem } from "@/lib/ir/sec-check";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<SecItem["status"], string> = { agree: "agrees", held: "held", flagged: "differs", released: "agrees, shown again" };
const ORDER: Record<SecItem["status"], number> = { held: 0, flagged: 1, released: 2, agree: 3 };

export function IrChecksLine({ ticker, payload, check, consistency, timings }: { ticker: string; payload: IrPayload; check?: SecCheck | null; consistency?: ConsistencySummary; timings?: { unpackMs: number; tidyMs: number; checkMs: number } }) {
  const { open } = useSource();
  const items = useMemo(() => [...(check?.items ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.line.localeCompare(b.line) || b.e.localeCompare(a.e)), [check]);
  const byKey = useMemo(() => new Map(payload.series.map((s) => [s.k, s])), [payload]);
  const years = consistency?.years ?? 0;
  const formulas = consistency?.formulas ?? 0;
  if (!check?.checked && !years && !formulas && check !== null) return null;

  const openIr = (x: SecItem) => {
    const s = byKey.get(x.k);
    const c = s && ((x.kind === "q" ? s.q : s.y)[x.e] ?? (x.kind === "q" ? s.held?.q : s.held?.y)?.[x.e]);
    if (s && c) openIrCell(open, ticker, payload, s, x.e, x.kind, c);
  };
  const openSec = (x: SecItem) => {
    if (!x.accn) return;
    open({ ticker, label: STD_LABEL[x.line], periodLabel: fmtDate(x.e), unit: x.line === "epsDiluted" ? "usdPerShare" : "usd", value: x.sec, src: { accn: x.accn, concept: x.concept ?? "", end: x.e, value: x.sec } });
  };
  const unit = (x: SecItem) => (x.line === "epsDiluted" ? "usdPerShare" : "usd");

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2", IR.caption)} data-section="IR checks" data-timings={timings ? JSON.stringify(timings) : undefined}>
      {check === null ? (
        <span>Not checked against SEC filings: the company's statements could not be loaded.</span>
      ) : check && check.checked > 0 ? (
        <span className="text-foreground">
          {check.held + check.flagged > 0 && <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" />}
          {check.checked.toLocaleString()} figure{check.checked === 1 ? "" : "s"} checked against SEC filings: {check.agree.toLocaleString()} agree
          {check.held > 0 && `, ${check.held} held`}
          {check.flagged > 0 && `, ${check.flagged} differ`}
          {check.released > 0 && ` (${check.released} the unit guard had held, shown again)`}
        </span>
      ) : (
        <span>No figure here is also in the company's SEC statements.</span>
      )}
      {years > 0 && (
        <span>
          Quarters against the year: {years} checked{consistency!.yearsFailed ? `, ${consistency!.yearsFailed} don't add up` : ", all add up"}
        </span>
      )}
      {formulas > 0 && <span>Calculated values: {formulas} checked{consistency!.formulasFailed ? `, ${consistency!.formulasFailed} don't match their formula` : ", all match"}</span>}
      {items.length > 0 && (
        <Popover>
          <PopoverTrigger className="rounded-sm px-1 text-foreground underline decoration-dotted underline-offset-[3px] hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Which</PopoverTrigger>
          <PopoverContent align="start" className="max-h-[70vh] w-[min(36rem,calc(100vw-2rem))] overflow-auto p-0">
            <div className="border-b px-3 py-2">
              <p className={IR.group}>Checked against the 10-Q and 10-K</p>
              <p className={IR.caption}>Held figures are kept out of totals and charts; differing figures stay, marked at the figure. Equal within 0.05%, or at the precision the release prints.</p>
            </div>
            <table className="w-full text-[13px]">
              <thead className={IR.caption}>
                <tr className="border-b">
                  <th scope="col" className="px-3 py-1 text-left font-normal">Line</th>
                  <th scope="col" className="px-2 py-1 text-left font-normal">Period</th>
                  <th scope="col" className="px-2 py-1 text-right font-normal">Release</th>
                  <th scope="col" className="px-2 py-1 text-right font-normal">Filing</th>
                  <th scope="col" className="px-3 py-1 text-left font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={`${x.k}|${x.kind}|${x.e}`} className="h-7 border-b last:border-0 align-top" title={x.why}>
                    <td className="px-3 py-1">{STD_LABEL[x.line]}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{x.kind === "y" ? "Year to " : ""}{fmtDate(x.e)}</td>
                    <td className="px-2 py-1 text-right">
                      <button type="button" onClick={() => openIr(x)} className={cn(IR.cellButton, IR.num)}>{fmtIr(x.ir, unit(x), "B")}</button>
                    </td>
                    <td className="px-2 py-1 text-right">
                      {x.accn ? <button type="button" onClick={() => openSec(x)} className={cn(IR.cellButton, IR.num)}>{fmtIr(x.sec, unit(x), "B")}</button> : <span className={IR.num}>{fmtIr(x.sec, unit(x), "B")}</span>}
                    </td>
                    <td className="px-3 py-1">
                      <span className={x.status === "agree" ? "text-muted-foreground" : "text-foreground"}>{STATUS[x.status]}</span>
                      {x.why && <span className={cn("block", IR.caption)}>{x.why}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
