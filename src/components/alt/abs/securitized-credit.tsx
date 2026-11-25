// Securitized credit: the SEC Form ABS-EE asset data of registered auto loan, auto lease and commercial
// mortgage deals. A monitor of every stored deal of one family, and a deal page that opens in place.
// The view state comes from the address (`absSearch`, src/lib/abs/view/url-state.ts) through props, as
// SourceExplorer does: the route validates it and passes `onChange(patch)`.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { Input } from "@/components/ui/input";
import { getAbsDeal, getAbsMonitor } from "@/lib/abs/read.functions";
import { FAMILIES, FAMILY_LABEL } from "@/lib/abs/view/codes";
import { dealModel } from "@/lib/abs/view/deal";
import { count, day } from "@/lib/abs/view/format";
import { filterRows, monitorModel, type MonitorModel } from "@/lib/abs/view/monitor";
import { STAGE_LIMIT, STAGE_RULE } from "@/lib/abs/view/stage";
import type { AbsFamily, Coverage } from "@/lib/abs/view/types";
import { closeDeal, familyOf, openDeal, selectFamily, selectQuery, selectSort, type AbsSearch } from "@/lib/abs/view/url-state";
import { DealPage } from "./deal-page";
import { MonitorTable, OfferingOnly } from "./monitor-table";
import { Note } from "./ui";

export type { AbsSearch } from "@/lib/abs/view/url-state";

const STALE = 5 * 60_000;

/** The server reads answer a value; a failure becomes the query's error, with the server's sentence. */
function unwrap<T>(answer: { ok: true; data: T } | { ok: false; message: string }): T {
  if (!answer.ok) throw new Error(answer.message);
  return answer.data;
}

export function SecuritizedCredit({ state, onChange }: { state: AbsSearch; onChange: (patch: Partial<AbsSearch>) => void }) {
  const family = familyOf(state);
  // one read is about fifteen selects: a failure is shown with its retry button, never retried on its own
  const monitor = useQuery({
    queryKey: ["abs_monitor", family],
    queryFn: async () => unwrap(await getAbsMonitor({ data: { family } })),
    staleTime: STALE,
    enabled: !state.deal,
    retry: false,
  });
  const deal = useQuery({
    queryKey: ["abs_deal", state.deal],
    queryFn: async () => unwrap(await getAbsDeal({ data: { deal: state.deal! } })),
    staleTime: STALE,
    enabled: !!state.deal,
    retry: false,
  });
  const model = useMemo(() => (monitor.data ? monitorModel(monitor.data) : null), [monitor.data]);
  const dealView = useMemo(() => (deal.data ? dealModel(deal.data) : null), [deal.data]);

  if (state.deal) {
    const back = () => onChange(closeDeal());
    return (
      <div data-section="Securitized credit" className="grid grid-cols-1 content-start gap-4">
        {deal.isPending ? (
          <Note className="py-10 text-center text-[12px]">Reading the deal's filings</Note>
        ) : deal.isError ? (
          <div className="grid gap-2">
            <BackLink onBack={back} />
            <DataUnavailable title="This deal could not be read" error={deal.error} onRetry={() => void deal.refetch()} />
          </div>
        ) : !dealView ? (
          <div className="grid gap-2">
            <BackLink onBack={back} />
            <Note>No stored deal has the id {state.deal}.</Note>
          </div>
        ) : (
          <DealPage model={dealView} onBack={back} />
        )}
      </div>
    );
  }

  return (
    <div data-section="Securitized credit" className="grid grid-cols-1 content-start gap-4">
      <CoverageLine coverage={monitor.data?.coverage ?? null} />
      <div data-section="Credit controls" className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Asset class"
          value={family}
          options={FAMILIES.map((f) => ({ v: f, l: FAMILY_LABEL[f] }))}
          onChange={(f: AbsFamily) => onChange(selectFamily(f))}
        />
        <Input
          type="search"
          value={state.q ?? ""}
          onChange={(e) => onChange(selectQuery(e.target.value))}
          placeholder="Filter by name or CIK"
          aria-label="Filter deals by name or CIK"
          className="h-8 w-full max-w-60 text-[13px]"
        />
        {model && (
          <span className="text-[12px] text-muted-foreground">
            {count(filterRows(model.rows, state.q).length)} of {count(model.rows.length)} deals
          </span>
        )}
      </div>
      <div data-section="Deal monitor">
        <Panel title="Deal monitor" subtitle={model ? <MonitorSubtitle model={model} /> : FAMILY_LABEL[family]} collapse={false} bodyClassName="p-0">
          {monitor.isPending ? (
            <Note className="py-10 text-center text-[12px]">Reading the stored filings</Note>
          ) : monitor.isError ? (
            <DataUnavailable title="The monitor could not be read" error={monitor.error} onRetry={() => void monitor.refetch()} className="m-3.5" />
          ) : model ? (
            <MonitorTable
              model={model}
              sort={state.sort}
              q={state.q}
              onSort={(text, isDefault) => onChange(selectSort(text, isDefault))}
              onOpen={(id) => onChange(openDeal(id, family))}
            />
          ) : null}
        </Panel>
      </div>
      {model && model.offeringOnly.length > 0 && (
        <div data-section="Pools at cut-off">
          <Panel title="Pools at cut-off only" collapse={false}>
            <OfferingOnly model={model} onOpen={(id) => onChange(openDeal(id, family))} />
          </Panel>
        </div>
      )}
      <div data-section="How to read">
        <Panel title="How to read this page" collapse={false}>
          <div className="grid max-w-4xl gap-1.5">
            <Note>
              One row is one deal, the issuing trust, with the figures of its newest current monthly file. Nothing is added across deals,
              and lease securitization values are never added to loan balances. Only the filing SEC accepted last for a cover period
              feeds figures; amendments that replace a filing are listed on the deal page.
            </Note>
            <Note>
              {STAGE_RULE} {STAGE_LIMIT}
            </Note>
            <Note>
              Only deals registered with the SEC file Form ABS-EE: privately placed deals are not here. Names and CIKs are as filed, and no
              pool is attributed to a listed company.
            </Note>
            {model && <LimitNotes model={model} />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="w-fit rounded-sm text-[12px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Back to the monitor
    </button>
  );
}

function CoverageLine({ coverage }: { coverage: Coverage | null }) {
  if (!coverage) return <p data-section="Coverage" className="h-[18px] text-[12px] text-muted-foreground" aria-hidden />;
  const parts = coverage.families.map(
    (f) => `${FAMILY_LABEL[f.family].toLowerCase()} ${count(f.deals)} ${f.deals === 1 ? "deal" : "deals"}, ${f.filings == null ? "–" : count(f.filings)} filings`,
  );
  return (
    <p data-section="Coverage" className="text-[12px] leading-relaxed text-muted-foreground">
      Stored: {parts.join(" · ")}.
      {coverage.listed ? ` ${count(coverage.listed)} more filings are listed on EDGAR and wait to be read, oldest first; loading continues.` : ""}
      {coverage.newest_loaded_at ? ` Newest stored ${day(coverage.newest_loaded_at)}.` : ""}
    </p>
  );
}

function MonitorSubtitle({ model }: { model: MonitorModel }) {
  const top = model.periodEnds[0];
  if (!top) return <>{FAMILY_LABEL[model.family]}</>;
  const behind = model.rows.length - top.deals;
  return (
    <>
      {FAMILY_LABEL[model.family]}: newest period {day(top.recordsEnd)} for {count(top.deals)} {top.deals === 1 ? "deal" : "deals"}
      {behind > 0 ? `; ${count(behind)} report an earlier period` : ""}. Figures of each deal's newest current monthly file; trends
      over up to {model.trendCap} stored periods.
    </>
  );
}

function LimitNotes({ model }: { model: MonitorModel }) {
  const l = model.limits;
  const notes: string[] = [];
  if (l.filings_total != null && l.filings_read < l.filings_total)
    notes.push(`The monitor read the newest ${count(l.filings_read)} of ${count(l.filings_total)} stored filings of this family.`);
  if (l.trend_cut) notes.push(`Trends show the newest ${model.trendCap} periods of each deal, to keep the read bounded.`);
  if (l.stage_unread) notes.push(`${count(l.stage_unread)} current filings were placed by their cover period alone: the period their records state was not read.`);
  return (
    <>
      {notes.map((n) => (
        <Note key={n}>{n}</Note>
      ))}
    </>
  );
}
