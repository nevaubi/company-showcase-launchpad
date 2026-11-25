import { Panel } from "@/components/app/page-header";
import { Sparkline } from "@/components/charts/sparkline";
import { useSource } from "@/components/source/source-context";
import type { SourceRef } from "@/lib/financials/types";
import { assetsTie, dayLabel, quarterLabel, showCell, unitLabel, usdShort } from "@/lib/sources/company/present";
import type { Y9cReport } from "@/lib/sources/company/types";
import { Y9C_INSTRUCTIONS_URL } from "@/lib/sources/company/y9c-fields";
import { OutLink, RecordLink } from "./record-link";

export const Y9C_CAPTION = "As filed with the Federal Reserve on form FR Y-9C, consolidated holding company.";

/** The statement's total assets for a date, with its SEC source. */
export type StatementAssets = (date: string) => { value: number; src?: SourceRef } | null;

/**
 * The registrant's FR Y-9C capital lines for the stored quarters, exactly as filed, with the unit the Fed's own
 * instructions establish (y9c-fields.ts) and a tie of the report's total assets to the 10-Q.
 */
export function HoldingCompanyReport({ ticker, report, statementAssets }: { ticker: string; report: Y9cReport; statementAssets: StatementAssets }) {
  const { open } = useSource();
  const q = report.quarters;
  const tie = assetsTie(q, d => statementAssets(d)?.value ?? null);
  const tieQuarter = tie.kind !== "none" ? q.find(x => x.reportDate === tie.date) : null;
  const statement = tie.kind !== "none" ? statementAssets(tie.date) : null;
  const retrievedAt = report.source.retrievedAt ? dayLabel(report.source.retrievedAt.slice(0, 10)) : null;
  return (
    <div id="official-y9c" data-section="Holding company regulatory report" className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] xl:col-span-2">
      <Panel
        collapse={false}
        className="rounded-md border bg-card shadow-paper"
        bodyClassName="p-0"
        title="Holding company regulatory report"
        subtitle={`${report.legalName} · FR Y-9C · RSSD ${report.rssd}`}
        actions={q.length ? <RecordLink at={q[q.length - 1].ref} className="text-[11px] text-muted-foreground" title="Open the latest stored report">Stored report</RecordLink> : undefined}
      >
        <p className="border-b px-3.5 py-1.5 text-[11px] font-medium">{Y9C_CAPTION}</p>
        {q.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                  <th className="pl-3.5 font-normal">Line</th>
                  {q.map(x => (
                    <th key={x.reportDate} className="text-right font-normal" title={dayLabel(x.reportDate)}>{quarterLabel(x.reportDate)}</th>
                  ))}
                  <th className="pl-3 font-normal">Unit</th>
                  <th className="w-[72px] pr-3.5 font-normal"><span className="sr-only">Trend</span></th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map(l => {
                  const values = l.cells.map(c => (c.kind === "number" ? c.value : null));
                  const trend = values.length >= 3 && values.every(v => v != null) ? (values as number[]) : null;
                  return (
                    <tr key={l.field} className="h-7 border-b last:border-0">
                      <td className="pl-3.5 pr-2" title={`${l.label} (${l.field})`}>
                        {l.short}
                        <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{l.field}</span>
                      </td>
                      {l.cells.map((c, i) => {
                        const shown = showCell(c, l.unit, { decimals: "stored" });
                        return (
                          <td key={q[i].reportDate} className="num text-right">
                            {shown.empty && c.kind === "empty" ? <span className="text-[11px] text-muted-foreground" title={shown.title}>blank</span> : <RecordLink at={c.ref} title={shown.title}>{shown.text}</RecordLink>}
                          </td>
                        );
                      })}
                      <td className="pl-3 text-[11px] text-muted-foreground" title={l.unitEvidence ?? undefined}>{unitLabel(l.unit)}</td>
                      <td className="pr-3.5">{trend && <Sparkline values={trend} tone="neutral" fill={false} className="h-4 w-14" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3.5 py-3 text-[13px] text-muted-foreground">No stored FR Y-9C row could be confirmed for this holding company.</p>
        )}
        <div className="space-y-1 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          {tie.kind !== "none" && tieQuarter && (
            <p>
              <span className="text-foreground">
                {tie.kind === "equal"
                  ? `Total assets on the FR Y-9C equal the 10-Q's at ${dayLabel(tie.date)}.`
                  : `Total assets on the FR Y-9C and the 10-Q differ at ${dayLabel(tie.date)}: 10-Q less FR Y-9C is ${usdShort(tie.difference)}.`}
              </span>{" "}
              <RecordLink at={tieQuarter.totalAssets.ref}>FR Y-9C, BHCK2170 {showCell(tieQuarter.totalAssets, tieQuarter.totalAssets.unit).text} USD thousands</RecordLink>
              {" · "}
              {statement?.src ? (
                <button type="button" className="rounded-[3px] transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => open({ ticker, label: "Total assets (10-Q)", periodLabel: dayLabel(tie.date), unit: "usd", value: statement.value, src: statement.src })}>
                  10-Q, total assets {usdShort(statement.value)}
                </button>
              ) : (
                <span>10-Q, total assets {usdShort(tie.statementUsd)}</span>
              )}
            </p>
          )}
          <p>Ratios are as filed, to four decimals. The company's own releases (IR tab) print some of the same ratios rounded, and some are estimates when released.</p>
          <p>
            Units from the <OutLink href={Y9C_INSTRUCTIONS_URL} className="text-foreground">FR Y-9C instructions</OutLink>: ratios in percent, amounts in USD thousands; the supplementary leverage ratio is shown as filed, the instructions state no unit for it.
            {" "}Report dates {q.length ? `${dayLabel(q[0].reportDate)} to ${dayLabel(q[q.length - 1].reportDate)}` : "none"}; file retrieved {retrievedAt ?? "on an unknown date"}.
            {report.source.newerSnapshot && " A newer file of this table is loaded; the mapping still points at this one until its quarterly rebuild."}
          </p>
          {report.missing.map(m => (
            <p key={m.reportDate}>{dayLabel(m.reportDate)}: {m.reason}</p>
          ))}
        </div>
      </Panel>
    </div>
  );
}
