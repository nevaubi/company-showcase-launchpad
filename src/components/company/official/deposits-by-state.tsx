import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Segmented } from "@/components/app/segmented";
import { StateGrid } from "@/components/alt/library/charts/state-grid";
import type { MapPlace } from "@/lib/sources/boards/types";
import { axisText, countText, depositsView, valueAxis } from "@/lib/sources/company/charts";
import { showCell, unitLabel } from "@/lib/sources/company/present";
import { SOD_DOCUMENTATION } from "@/lib/sources/company/sod-fields";
import type { DepositsByState } from "@/lib/sources/company/types";
import { placeByCode } from "@/lib/sources/geo/us-states";
import { recordHref } from "@/lib/sources/links";
import { FigureHead, SourceLine } from "./chart-parts";
import { OutLink, RecordLink } from "./record-link";

/** The largest branch states listed beside the grid; every state is in the table view. */
const RANKED = 10;

/**
 * One charter's deposits by branch state in the FDIC's Summary of Deposits: a state tile grid shaded by the stored
 * deposits sums, the largest states as ranked bars beside it with their branch counts, and the bank's stored totals
 * as the headline. Each square, bar and figure opens its record. A state with no square colour has no branch record
 * of this bank in the survey; nothing is filled in for it.
 */
export function DepositsByStateView({ data }: { data: DepositsByState }) {
  const router = useRouter();
  const [view, setView] = useState<"chart" | "table">("chart");
  const v = depositsView(data);
  const unit = data.unit;
  const open = (row: number) => router.history.push(recordHref(data.source.dataset, data.source.snapshot, row));
  const known = v.states.map(s => ({ s, place: placeByCode(s.code) }));
  const toPlace = ({ s, place }: (typeof known)[number]): MapPlace => ({ code: s.code, name: place!.name, key: s.code, value: s.value, display: s.value == null ? "–" : showCell(s.deposits, unit).text, text: s.deposits.text, row: s.ref.row });
  const places = known.filter(k => k.place?.grid).map(toPlace);
  const territories = known.filter(k => k.place && !k.place.grid).map(toPlace);
  const unplaced = known.filter(k => !k.place).map(k => k.s.code);
  const ranked = v.states.filter(s => s.value != null).slice(0, RANKED);
  const year = data.totals?.surveyYear ?? null;
  const branches = countText(data.totals?.branches);
  const states = countText(data.totals?.states);
  const axisMax = valueAxis([v.max], unit);
  return (
    <div data-section="Deposits by state" className="min-w-0 border-t px-3.5 pb-2.5 pt-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          <FigureHead
            title={year ? `Deposits, ${year} Summary of Deposits` : "Deposits, Summary of Deposits"}
            reader={v.reader}
            cell={data.totals?.deposits ?? null}
            unit={unit}
            period={null}
            at={v.totalsRef ? { ...v.totalsRef, field: data.fields.deposits } : null}
          />
          {(branches || states) && (
            <p className="text-[11px] text-muted-foreground">
              {branches && (
                <>
                  <RecordLink at={v.totalsRef!} className="num text-foreground">{branches}</RecordLink> {branches === "1" ? "branch" : "branches"}
                </>
              )}
              {states && ` in ${states} ${states === "1" ? "state or territory" : "states and territories"}`}
            </p>
          )}
        </div>
        <Segmented label="Deposits by state: chart or table" size="xs" value={view} onChange={setView} options={[{ v: "chart", l: "Chart" }, { v: "table", l: "Table" }]} />
      </div>
      {view === "chart" ? (
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <div className="min-w-0">
            <StateGrid
              places={places}
              territories={territories}
              scale="sequential"
              domain={[0, v.max || 1]}
              rangeLabels={["0", axisText(v.max, axisMax)]}
              unit={unitLabel(unit)}
              period={year ? `${year} survey` : undefined}
              label={`Deposits by branch state, ${unitLabel(unit)}`}
              onOpen={p => p.row != null && open(p.row)}
            />
          </div>
          <div className="min-w-0">
            <p className="mb-1 flex text-[11px] text-muted-foreground">
              <span>Largest states</span>
              <span className="ml-auto">{unitLabel(unit)} · branches</span>
            </p>
            <ol className="space-y-1">
              {ranked.map(s => {
                const name = placeByCode(s.code)?.name ?? s.code;
                const shown = showCell(s.deposits, unit);
                return (
                  <li key={s.code}>
                    <RecordLink at={s.ref} title={`${name}: ${shown.text} ${unitLabel(unit)}, ${countText(s.branches) ?? showCell(s.branches, null).text} branches. ${shown.title}`} className="group block">
                      <span className="flex items-baseline gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
                        <span className="num text-foreground">{axisText(s.value!, axisMax)}</span>
                        <span className="num w-10 text-right text-muted-foreground">{countText(s.branches) ?? "–"}</span>
                      </span>
                      <span className="mt-0.5 block h-1.5 rounded-full bg-secondary">
                        <span className="block h-1.5 rounded-full bg-[var(--chart-1)] transition-opacity duration-150 group-hover:opacity-80" style={{ width: `${Math.max(1.5, (s.value! / (v.max || 1)) * 100)}%` }} />
                      </span>
                    </RecordLink>
                  </li>
                );
              })}
            </ol>
            {v.states.length > ranked.length && <p className="mt-1 text-[11px] text-muted-foreground">{v.states.length - ranked.length} more {v.states.length - ranked.length === 1 ? "state" : "states"} in the table view.</p>}
          </div>
        </div>
      ) : (
        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <caption className="sr-only">Deposits and branches by state</caption>
            <thead>
              <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
                <th className="font-normal">State</th>
                <th className="text-right font-normal">Deposits ({unitLabel(unit)})</th>
                <th className="text-right font-normal">Branches</th>
                <th className="pl-3 text-right font-normal">Stored record</th>
              </tr>
            </thead>
            <tbody>
              {v.states.map(s => {
                const shown = showCell(s.deposits, unit);
                return (
                  <tr key={s.code} className="h-7 border-b last:border-0">
                    <td>{placeByCode(s.code)?.name ?? s.code}</td>
                    <td className="num text-right" title={shown.title}>{shown.text || <span className="text-muted-foreground">empty</span>}</td>
                    <td className="num text-right">{countText(s.branches) ?? showCell(s.branches, null).text}</td>
                    <td className="pl-3 text-right text-[11px]">
                      <RecordLink at={s.ref} className="text-muted-foreground">row {s.ref.row.toLocaleString("en-US")}</RecordLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          The bank's own branches, summed by branch state as stored; a state with no colour has no branch record of this bank in the survey.
          {unplaced.length > 0 && ` Branch states not on the grid: ${unplaced.join(", ")}.`}
          {!v.reader && " Amounts as filed, in USD thousands."}
        </p>
        <SourceLine source={data.source} extra={<> <OutLink href={SOD_DOCUMENTATION} className="text-foreground">About the survey</OutLink></>}>
          FDIC Summary of Deposits{year ? `, ${year} survey` : ""}, FDIC 500 cohort
        </SourceLine>
      </div>
    </div>
  );
}
