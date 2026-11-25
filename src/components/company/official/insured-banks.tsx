import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { BASIS_TEXT, FDIC_LINES } from "@/lib/sources/company/fdic-fields";
import { absSentence, axisUnit, dayLabel, historySeries, quarterLabel, showCell, unitLabel } from "@/lib/sources/company/present";
import type { BankHistory, CompanyOfficial, OfficialBank, OfficialSource } from "@/lib/sources/company/types";
import { cn } from "@/lib/utils";
import { BankHistoryChart } from "./bank-history-chart";
import { AppLink, DatasetLink, OutLink, RecordLink } from "./record-link";

export const BANKS_CAPTION = "Insured bank, as reported to the FDIC. Not the consolidated company.";
const SHORT: Record<string, string> = { ASSET: "Assets", DEP: "Deposits", LNLSNET: "Net loans", NETINC: "Net income", NIMY: "Margin", ROA: "ROA", NTLNLSR: "Charge-offs", RBCT1CER: "CET1", NCLNLSR: "Noncurrent" };

const retrieved = (s: OfficialSource | null | undefined) => (s?.retrievedAt ? dayLabel(s.retrievedAt.slice(0, 10)) : "an unknown date");

function sortBanks(banks: OfficialBank[]): OfficialBank[] {
  const figure = (b: OfficialBank) => b.assets?.value ?? -1;
  return [...banks].sort((a, b) => Number(b.lines.length > 0) - Number(a.lines.length > 0) || figure(b) - figure(a) || Number(a.kind !== "insured") - Number(b.kind !== "insured"));
}

/**
 * Every FDIC institution the mapping proves for the company, the selected bank's call-report lines and its
 * quarterly history. Figures are each bank's own, as reported to the FDIC; they are never added together.
 */
export function InsuredBanks({ ticker, data, selected, onSelect, pending }: { ticker: string; data: CompanyOfficial; selected: string | null; onSelect: (cert: string) => void; pending: boolean }) {
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
        {current && <BankDetail ticker={ticker} bank={current} history={data.history} note={data.historyNote} pending={pending || data.history?.cert !== current.cert} />}
        {!withFigures.length && <p className="border-t px-3.5 py-2 text-[13px] text-muted-foreground">{data.historyNote ?? "No FDIC figures are stored for these institutions."}</p>}
      </Panel>
    </div>
  );
}

/** The history opens with quarters whose cells are empty (not zeros the FDIC uses for "not reported"). */
const leadEmpty = (points: { value: number | null; gap: string | null }[]) => {
  const first = points.findIndex(p => p.value != null);
  return first > 0 && points.slice(0, first).every(p => p.gap !== "not-reported");
};

function BankDetail({ bank, history, note, pending }: { ticker: string; bank: OfficialBank; history: BankHistory | null; note: string | null; pending: boolean }) {
  const fields = history?.measures.map(m => m.field) ?? [];
  const [field, setField] = useState("ASSET");
  const [view, setView] = useState<"chart" | "table">("chart");
  const pick = fields.includes(field) ? field : fields[0];
  const series = history && pick ? historySeries(history, pick) : null;
  const sourceName = (p: { ref: { dataset: string } }) => (history && p.ref.dataset === history.sources[0]?.dataset ? "FDIC quarterly history" : "FDIC latest quarter");
  return (
    <div className="grid grid-cols-1 border-t @container lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
        <div className="flex h-8 items-center justify-between px-3.5 text-[11px] text-muted-foreground">
          <span className="truncate font-medium text-foreground">{bank.name}</span>
          <span className="num shrink-0">{bank.reportDate ? dayLabel(bank.reportDate) : ""}</span>
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {FDIC_LINES.map(def => {
              const l = bank.lines.find(x => x.field === def.field);
              if (!l) return null;
              const shown = showCell(l.cell, l.unit);
              return (
                <tr key={l.field} className="h-7 border-t">
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
      </div>
      <div data-section="Bank history" className={cn("min-w-0 transition-opacity duration-150", pending && "opacity-50")}>
        <div className="flex flex-wrap items-center gap-2 px-3.5 pb-1 pt-2">
          {fields.length > 0 && <Segmented label="Measure" size="xs" value={pick} onChange={setField} options={fields.map(f => ({ v: f, l: SHORT[f] ?? f, title: history!.measures.find(m => m.field === f)!.label }))} />}
          {series && <Segmented label="View" size="xs" value={view} onChange={v => setView(v)} options={[{ v: "chart", l: "Chart" }, { v: "table", l: "Table" }]} />}
        </div>
        {series && series.points.length > 1 ? (
          <div className="px-3.5 pb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{series.label}</span> · {axisUnit(series.unit)} · {quarterLabel(series.points[0].period)} to {quarterLabel(series.points[series.points.length - 1].period)}
            </div>
            {view === "chart" ? (
              <BankHistoryChart points={series.points} unit={series.unit} label={`${bank.name}: ${series.label}`} sourceName={sourceName} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[360px] text-[13px]">
                  <thead>
                    <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                      <th className="font-normal">Quarter</th>
                      <th className="text-right font-normal">{series.label} ({unitLabel(series.unit)})</th>
                      <th className="pl-3 font-normal">Stored record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...series.points].reverse().map(p => {
                      const shown = showCell(p.cell, series.unit);
                      return (
                        <tr key={p.period} className="h-7 border-b last:border-0">
                          <td className="num text-[11px]">{quarterLabel(p.period)}</td>
                          <td className="num text-right" title={shown.title}>{shown.text || <span className="text-muted-foreground">empty</span>}{p.gap === "not-reported" && <span className="ml-1 text-[11px] text-muted-foreground">not drawn</span>}</td>
                          <td className="pl-3 text-[11px] text-muted-foreground"><RecordLink at={p.ref}>{sourceName(p)}, row {p.ref.row.toLocaleString("en-US")}</RecordLink></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {series.notReported > 0 && `${series.notReported} ${series.notReported === 1 ? "quarter is" : "quarters are"} stored as 0 before the ratio was reported and not drawn. `}
              {leadEmpty(series.points) && `No figure is stored before ${quarterLabel(series.points.find(p => p.value != null)!.period)}. `}
              The bank's own reports; quarters before the company held it may be included. History retrieved {retrieved(history?.sources[0])}
              {history && history.sources.length > 1 ? `, latest quarter retrieved ${retrieved(history.sources[1])}` : ""}.
            </p>
          </div>
        ) : (
          <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{note ?? (series ? "Only one quarter is stored for this bank." : "No quarterly history is stored for this bank.")}</p>
        )}
      </div>
    </div>
  );
}
