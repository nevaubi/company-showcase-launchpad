import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { BASIS_TEXT, FDIC_LINES, RATIO_FIELDS, TREND_FIELDS } from "@/lib/sources/company/fdic-fields";
import { absSentence, dayLabel, quarterLabel, roundedNote, showCell, unitLabel } from "@/lib/sources/company/present";
import type { CompanyOfficial, OfficialBank } from "@/lib/sources/company/types";
import { cn } from "@/lib/utils";
import { ChartersCompared, RatioTiles, TrendCharts, TrendTable } from "./bank-charts";
import { SourceLine } from "./chart-parts";
import { DepositsByStateView } from "./deposits-by-state";
import { AppLink, DatasetLink, OutLink, RecordLink } from "./record-link";

export const BANKS_CAPTION = "Insured bank, as reported to the FDIC. Not the consolidated company.";

function sortBanks(banks: OfficialBank[]): OfficialBank[] {
  const figure = (b: OfficialBank) => b.assets?.value ?? -1;
  return [...banks].sort((a, b) => Number(b.lines.length > 0) - Number(a.lines.length > 0) || figure(b) - figure(a) || Number(a.kind !== "insured") - Number(b.kind !== "insured"));
}

/**
 * Every FDIC institution the mapping proves for the company, the selected bank's call-report lines and its
 * quarterly history. Figures are each bank's own, as reported to the FDIC; they are never added together.
 */
export function InsuredBanks({ data, selected, onSelect, pending }: { ticker?: string; data: CompanyOfficial; selected: string | null; onSelect: (cert: string) => void; pending: boolean }) {
  const banks = useMemo(() => sortBanks(data.banks), [data.banks]);
  const withFigures = banks.filter(b => b.lines.length > 0);
  const current = banks.find(b => b.cert === selected && b.lines.length) ?? withFigures[0] ?? null;
  const insured = banks.filter(b => b.kind === "insured").length;
  const trusts = banks.length - insured;
  const outside = banks.filter(b => b.kind === "insured" && !b.inCohort).length;
  const reportDate = withFigures[0]?.reportDate ?? null;
  const unitOf = (field: string) => withFigures[0]?.lines.find(l => l.field === field)?.unit ?? null;
  return (
    <div id="official-banks" data-section="Insured banks" className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] xl:col-span-2">
      <Panel
        collapse={false}
        className="rounded-md border bg-card shadow-paper"
        bodyClassName="p-0"
        title="Insured banks"
        subtitle={`${insured} insured ${insured === 1 ? "bank" : "banks"}${trusts ? ` and ${trusts} trust ${trusts === 1 ? "company" : "companies"}` : ""} the company holds, proven by identifier${reportDate ? ` · FDIC report date ${dayLabel(reportDate)}` : ""}`}
        actions={data.sources.current ? <DatasetLink dataset={data.sources.current.dataset} snapshot={data.sources.current.snapshot} className="text-[11px] text-muted-foreground">FDIC table</DatasetLink> : undefined}
      >
        <p className="border-b px-3.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{BANKS_CAPTION}</span> Each bank's own figures; banks are never added together.
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                <th className="pl-3.5 font-normal">Bank, as the FDIC names it</th>
                <th className="font-normal">Certificate</th>
                <th className="font-normal">State</th>
                <th className="text-right font-normal">Total assets{unitOf("ASSET") ? <span className="block text-[10px]">{unitLabel(unitOf("ASSET"))}</span> : null}</th>
                <th className="pr-3.5 text-right font-normal">Deposits{unitOf("DEP") ? <span className="block text-[10px]">{unitLabel(unitOf("DEP"))}</span> : null}</th>
              </tr>
            </thead>
            <tbody>
              {banks.map(b => {
                const on = current?.cert === b.cert;
                const assets = b.lines.find(l => l.field === "ASSET");
                const deposits = b.lines.find(l => l.field === "DEP");
                return (
                  <tr key={b.cert} className={cn("border-b align-top last:border-0", on && "bg-secondary/60")}>
                    <td className="py-1 pl-3.5 pr-2">
                      {b.lines.length ? (
                        <button type="button" aria-pressed={on} onClick={() => onSelect(b.cert)} className={cn("min-h-6 rounded-[3px] text-left transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on && "font-medium")}>
                          {b.name}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{b.name}</span>
                      )}
                      {b.note && <span className="block text-[11px] text-muted-foreground">{b.note}</span>}
                    </td>
                    <td className="num py-1 pr-2 text-[11px]">
                      {b.fdicUrl ? (
                        <OutLink href={b.fdicUrl} className="text-muted-foreground" label={`FDIC record of certificate ${b.cert}`}>{b.cert}</OutLink>
                      ) : b.linkRef ? (
                        <RecordLink at={b.linkRef} className="text-muted-foreground" title="Open the stored FDIC record of this institution">{b.cert}</RecordLink>
                      ) : (
                        <span className="text-muted-foreground">{b.cert}</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-[11px] text-muted-foreground">{b.state ?? "–"}</td>
                    <td className="num py-1 text-right">{assets ? <RecordLink at={assets.ref} title={showCell(assets.cell, assets.unit).title}>{showCell(assets.cell, assets.unit).text}</RecordLink> : <span className="text-muted-foreground">{"–"}</span>}</td>
                    <td className="num py-1 pr-3.5 text-right">{deposits ? <RecordLink at={deposits.ref} title={showCell(deposits.cell, deposits.unit).title}>{showCell(deposits.cell, deposits.unit).text}</RecordLink> : <span className="text-muted-foreground">{"–"}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(outside > 0 || trusts > 0) && (
          <p className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
            Figures are shown for insured banks in the FDIC 500 cohort (insured institutions chosen by assets on 30 Jun 2026), whose stored tables state each field's unit.
            {outside > 0 && ` ${outside} ${outside === 1 ? "bank sits" : "banks sit"} outside it.`}
            {trusts > 0 && ` ${trusts === 1 ? "A trust company files" : "Trust companies file"} a call report but ${trusts === 1 ? "is" : "are"} not FDIC insured; ${trusts === 1 ? "its certificate opens" : "their certificates open"} the stored FDIC row.`} A bank's certificate opens the FDIC's own record.
          </p>
        )}
        {data.abs.map(a => (
          <p key={a.sponsorCik} className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
            {absSentence(a)} <AppLink href="/app/alt-data/credit" className="text-foreground">Securitized credit</AppLink>
          </p>
        ))}
        {data.trends.length > 1 && <ChartersCompared trends={data.trends} banks={banks} selected={current?.cert ?? null} onSelect={onSelect} />}
        {data.trendsNote && data.trends.length > 1 && <p className="px-3.5 pb-2 text-[11px] text-muted-foreground">{data.trendsNote}</p>}
        {current && <BankDetail bank={current} data={data} pending={pending || data.history?.cert !== current.cert} />}
        {!withFigures.length && <p className="border-t px-3.5 py-2 text-[13px] text-muted-foreground">{data.historyNote ?? "No FDIC figures are stored for these institutions."}</p>}
      </Panel>
    </div>
  );
}

/** The selected charter: its trend charts and ratio tiles (or the same figures as tables), then its deposits by state. */
function BankDetail({ bank, data, pending }: { bank: OfficialBank; data: CompanyOfficial; pending: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const history = data.history?.cert === bank.cert ? data.history : null;
  const deposits = data.deposits?.cert === bank.cert ? data.deposits : null;
  const others = bank.lines.filter(l => !TREND_FIELDS.includes(l.field) && !RATIO_FIELDS.includes(l.field));
  return (
    <div data-section="Bank detail" className="min-w-0 border-t">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pt-2.5">
        <h3 className="mr-auto min-w-0 truncate text-[13px] font-semibold">{bank.name}</h3>
        {bank.reportDate && <span className="num text-[11px] text-muted-foreground">FDIC report date {dayLabel(bank.reportDate)}</span>}
        <Segmented label="Bank figures: charts or tables" size="xs" value={view} onChange={setView} options={[{ v: "chart", l: "Charts" }, { v: "table", l: "Tables" }]} />
      </div>
      <div className={cn("min-w-0 transition-opacity duration-150", pending && "opacity-50")}>
        {view === "chart" ? (
          <>
            {history ? <TrendCharts bank={bank} history={history} /> : <p className="px-3.5 py-2 text-[13px] text-muted-foreground">{data.historyNote ?? "No quarterly history is stored for this bank."}</p>}
            {others.length > 0 && (
              <p className="px-3.5 pb-2 text-[11px] text-muted-foreground">
                Also reported for {bank.reportDate ? dayLabel(bank.reportDate) : "the latest quarter"}:{" "}
                {others.map((l, i) => {
                  const shown = showCell(l.cell, l.unit);
                  return (
                    <span key={l.field}>
                      {i > 0 && " · "}
                      {l.label}
                      {BASIS_TEXT[l.basis] ? `, ${BASIS_TEXT[l.basis]}` : ""}{" "}
                      <RecordLink at={l.ref} title={shown.title} className="num text-foreground">{shown.text || "empty"}</RecordLink> {unitLabel(l.unit)}
                    </span>
                  );
                })}
              </p>
            )}
            {history && <RatioTiles history={history} />}
          </>
        ) : (
          <div className="grid grid-cols-1 @container lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Latest quarter as reported to the FDIC</caption>
                <tbody>
                  {FDIC_LINES.map(def => {
                    const l = bank.lines.find(x => x.field === def.field);
                    if (!l) return null;
                    const shown = showCell(l.cell, l.unit);
                    return (
                      <tr key={l.field} className="h-7 border-b last:border-0">
                        <td className="pl-3.5 pr-2" title={l.title ?? undefined}>
                          {l.label}
                          {BASIS_TEXT[l.basis] && <span className="ml-1 text-[11px] text-muted-foreground">{BASIS_TEXT[l.basis]}</span>}
                        </td>
                        <td className="num text-right font-medium">
                          <RecordLink at={l.ref} title={shown.title}>{shown.text || <span className="text-muted-foreground">empty</span>}</RecordLink>
                        </td>
                        <td className="whitespace-nowrap pl-2 pr-3.5 text-[11px] text-muted-foreground">{unitLabel(l.unit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {roundedNote(bank.lines.map(l => l.unit)) && <p className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">{roundedNote(bank.lines.map(l => l.unit))}</p>}
            </div>
            <div className="min-w-0">{history ? <TrendTable history={history} /> : <p className="px-3.5 py-2 text-[13px] text-muted-foreground">{data.historyNote ?? "No quarterly history is stored for this bank."}</p>}</div>
          </div>
        )}
        {history && (
          <div className="border-t px-3.5 py-1.5">
            <SourceLine source={history.sources[0] ?? null} table="Open history table">
              FDIC quarterly reports, {history.points.length ? `${quarterLabel(history.points[0].period)} to ${quarterLabel(history.points[history.points.length - 1].period)}` : ""}
              {history.sources.length > 1 ? "; the latest quarter from the current-quarter table" : ""}
            </SourceLine>
          </div>
        )}
      </div>
      {deposits ? (
        <div className={cn("transition-opacity duration-150", pending && "opacity-50")}>
          <DepositsByStateView data={deposits} />
        </div>
      ) : data.depositsNote && data.history?.cert === bank.cert ? (
        <p data-section="Deposits by state" className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">Deposits by state: {data.depositsNote}</p>
      ) : null}
    </div>
  );
}
