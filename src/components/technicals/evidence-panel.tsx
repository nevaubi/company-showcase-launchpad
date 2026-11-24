import { useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import type { Technicals } from "@/lib/technicals/analysis";
import { GROUP_LABEL, type Bars } from "@/lib/technicals/conditions";
import { EVIDENCE, REASON_TEXT, type EvidenceCell, type EvidenceRow, type Horizon } from "@/lib/technicals/evidence";
import { POOLED_REASON_TEXT, type PooledRow } from "@/lib/technicals/pooled";
import { cellLabel, evidenceLayout, fmtQ } from "@/lib/technicals/labels";
import { detectableText, pooledFor } from "@/lib/technicals/verdict";
import { cn } from "@/lib/utils";
import { CalcSheet, f2, Note, pc, pp, signTone, T as S, TableWrap, Tag, TechPanel, type Calc } from "./ui";

/** The cross-company verdict of a pooled row, in the same few words as the stock's own. */
function pooledVerdict(p: PooledRow) {
  if (p.verdict === "reliable") return { text: (p.excess ?? 0) > 0 ? "reliable: higher after" : "reliable: lower after", reliable: true };
  const short: Record<string, string> = { small: "small sample", base: "no clear difference", cost: "smaller than costs", unstable: "not stable over time" };
  return { text: short[p.reason] ?? p.reason, reliable: false };
}

const today = (r: EvidenceRow) =>
  !r.active ? "–" : r.kind === "state" ? `since ${fmtDate(r.atDate, { month: "short", day: "numeric" })}` : r.sessionsAgo === 0 ? "today" : `${r.sessionsAgo} session${r.sessionsAgo === 1 ? "" : "s"} ago`;

/**
 * The conditions tested on the symbol's own history: forward returns after each against the all-days base
 * rate, one horizon at a time. Conditions in force today come first; a row opens its cases and all horizons.
 */
export function EvidencePanel({ symbol, T, bars, loading }: { symbol: string; T: Technicals | null; bars: Bars | null; loading: boolean }) {
  const [hz, setHz] = useState<"5" | "20" | "60">("20");
  const [calc, setCalc] = useState<Calc | null>(null);
  const h = +hz as Horizon;
  const E = T?.evidence;
  const P = T?.pooled ?? null;
  const hasPooled = !!P;
  const detect = E ? detectableText(E, symbol) : null;

  const open = (r: EvidenceRow) => {
    const c = r.cells[h];
    const list = (r.cases[h] ?? []).slice(-60).reverse();
    setCalc({
      title: `${symbol}: ${r.name}`,
      value: c ? `${pp(c.test.excess, 2)} over ${h} days` : undefined,
      sub: c
        ? `${c.test.nEff} independent cases (${c.test.n.toLocaleString("en-US")} days), t ${f2(c.test.t)}, p ${f2(c.test.p, 3)}${c.q != null ? `, q ${fmtQ(c.q)}` : ""}`
        : `${r.cases[h]?.length ?? 0} independent cases (${r.days.toLocaleString("en-US")} days) since ${fmtDate(E!.sample.from)}: too few to test`,
      formula: `${r.text}. Forward return: total-return index ${h} trading days later divided by its value on the day, minus 1. Excess: the average log return after the condition minus the average over every ${h}-day window in the same sample. The cases listed are at least ${h} sessions apart, so their windows do not overlap.`,
      cols: ["Day", "Close", `After ${h} days`, "Return"],
      rows: bars
        ? list.map((i) => [fmtDate(bars.d[i]), bars.c[i].toFixed(2), fmtDate(bars.d[i + h]), pp(bars.tr[i + h] / bars.tr[i] - 1, 2)])
        : [],
      note: [
        ...EVIDENCE.horizons.map((x) => {
          const k = r.cells[x];
          return k
            ? `${x} days: excess ${pp(k.test.excess, 2)} (standard error ${pc(k.test.se, 2)}, interval ${k.test.ci ? `${pp(k.test.ci[0])} to ${pp(k.test.ci[1])}` : "–"}); average ${pp(k.test.mean, 2)} against ${pp(k.test.meanAll, 2)} for all days; up ${pc(k.test.hit)} of the time against ${pc(k.test.hitAll)}; halves ${pp(k.test.halves[0])} and ${pp(k.test.halves[1])}; ${REASON_TEXT[k.reason].toLowerCase()}.`
            : `${x} days: too few cases.`;
        }),
        (() => {
          const p = pooledFor(P, r.key, h);
          if (!P) return "The cross-company record is not available right now.";
          if (!p) return r.kind === "state" ? "No cross-company record: the pipeline pools chart events only." : `No cross-company record at ${h} days.`;
          return `Across ${p.symbols.toLocaleString("en-US")} covered companies, a separate line of evidence: ${p.n.toLocaleString("en-US")} events in ${p.months} months, average ${pp(p.mean, 2)} against ${pp(p.base, 2)} on all days, excess ${pp(p.excess, 2)}${p.ci ? ` (95% interval ${pp(p.ci[0])} to ${pp(p.ci[1])}, months clustered)` : ""}${p.q != null ? `, q ${fmtQ(p.q)}` : ""}: ${POOLED_REASON_TEXT[p.reason].toLowerCase()}. An average across companies, not a forecast for ${symbol}.`;
        })(),
        (r.cases[h]?.length ?? 0) > 60 ? `Showing the latest 60 of ${r.cases[h]!.length} cases.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  };

  const Row = ({ r }: { r: EvidenceRow }) => {
    const c = r.cells[h];
    const v = cellLabel(c);
    const t = c?.test;
    return (
      <tr className={cn(S.row, "transition-colors duration-150 hover:bg-highlight-soft/50 motion-reduce:transition-none", !r.active && "text-muted-foreground")}>
        <td className={cn(S.td, "sm:max-w-[12rem] 2xl:max-w-[18rem]")}>
          <button type="button" data-agent-click onClick={() => open(r)} title={`${r.text}. Select for the cases.`} className={cn(S.cellButton, "text-left 2xl:truncate", r.active && "font-medium text-foreground")}>
            {r.name}
          </button>
          {r.active && <span className="block text-[11px] leading-4 text-muted-foreground sm:hidden">{today(r)}</span>}
        </td>
        <td className={cn(S.td, S.wide, "whitespace-nowrap", r.active ? "text-foreground" : "")}>{today(r)}</td>
        <td className={cn(S.num, S.wide)}>
          {t ? (
            <>
              {t.nEff}
              <span className="text-muted-foreground"> / {t.n.toLocaleString("en-US")}</span>
            </>
          ) : (
            <>
              {r.cases[h]?.length ?? 0}
              <span className="text-muted-foreground"> / {r.days.toLocaleString("en-US")}</span>
            </>
          )}
        </td>
        <td className={cn(S.num, S.wide)}>
          {t ? (
            <>
              {pc(t.hit)}
              <span className="text-muted-foreground"> / {pc(t.hitAll)}</span>
            </>
          ) : (
            "–"
          )}
        </td>
        <td className={cn(S.num, v.reliable && "font-medium", v.reliable && signTone(t?.excess))}>{t ? pp(t.excess, 2) : "–"}</td>
        <td className={cn(S.num, S.wide)}>{t?.ci ? `${pp(t.ci[0])} to ${pp(t.ci[1])}` : "–"}</td>
        <td className={cn(S.num, S.wide)}>{fmtQ(c?.q)}</td>
        <td className={cn(S.td, "sm:whitespace-nowrap")} title={v.title}>
          {v.reliable ? <Tag tone={t!.excess > 0 ? "positive" : "negative"}>{v.text}</Tag> : <span className="text-[11px] text-muted-foreground">{v.text}</span>}
        </td>
        <td className={cn(S.td, S.wide, "border-l")}>
          {(() => {
            const p = pooledFor(P, r.key, h);
            if (!p) return <span className="text-[11px] text-muted-foreground">{!P ? "not available" : "no record"}</span>;
            const pv = pooledVerdict(p);
            return (
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5" title={`${p.n.toLocaleString("en-US")} events across ${p.symbols.toLocaleString("en-US")} companies${p.ci ? `, 95% interval ${pp(p.ci[0])} to ${pp(p.ci[1])}` : ""}${p.q != null ? `, q ${fmtQ(p.q)}` : ""}`}>
                <span className={cn("num text-[13px]", pv.reliable && "font-medium", pv.reliable && signTone(p.excess))}>{pp(p.excess, 2)}</span>
                {pv.reliable ? (
                  <Tag tone={(p.excess ?? 0) > 0 ? "positive" : "negative"}>{pv.text}</Tag>
                ) : (
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{p.q != null ? `q ${fmtQ(p.q)}` : pv.text}</span>
                )}
              </span>
            );
          })()}
        </td>
      </tr>
    );
  };

  const layout = E ? evidenceLayout(E, h) : null;
  const active = layout?.active ?? [];
  const cols = 9;
  // Every condition at this horizon, in one table in the sheet: the rows the page summarises in a sentence.
  const openAll = () => {
    if (!E) return;
    setCalc({
      title: `${symbol}: every condition tested, ${h} days`,
      sub: `${E.rows.length} conditions, ${E.tested} tests across the three horizons`,
      formula: `What followed each condition over the next ${h} trading days against ${symbol}'s own base rate, in force today first, then by group. Log excess: the average log return after the condition minus the average over every ${h}-day window. q: adjusted for everything tested on ${symbol}. Across companies: the same chart event pooled across covered companies, simple returns. Select a condition on the page for its cases.`,
      cols: ["Condition", "Group", "Cases", "Log excess", "q", "Verdict", "Across companies"],
      rows: [...E.rows.filter((r) => r.active), ...E.rows.filter((r) => !r.active)].map((r) => {
        const c = r.cells[h];
        const p = pooledFor(P, r.key, h);
        return [
          r.active ? `${r.name} (in force)` : r.name,
          GROUP_LABEL[r.group],
          c ? c.test.nEff : (r.cases[h]?.length ?? 0),
          c ? pp(c.test.excess, 2) : "–",
          fmtQ(c?.q),
          cellLabel(c).text,
          p ? pp(p.excess, 2) : "–",
        ];
      }),
      hi: new Set(E.rows.filter((r) => r.active).map((_, i) => i)),
    });
  };
  return (
    <TechPanel
      section="Evidence"
      id="evidence"
      tour="tech-evidence"
      title="Evidence"
      subtitle={E ? `${E.tested} tests on ${E.sample.bars.toLocaleString("en-US")} sessions, ${fmtDate(E.sample.from)} to ${fmtDate(E.sample.to)}: what followed each condition, against its own base rate` : "What followed each condition, against its own base rate"}
      actions={
        <Segmented
          size="xs"
          label="Horizon"
          value={hz}
          onChange={setHz}
          options={[
            { v: "5", l: "5 days" },
            { v: "20", l: "20 days" },
            { v: "60", l: "60 days" },
          ]}
        />
      }
    >
      {!E ? (
        loading ? (
          <Skeleton className="m-3 h-64" />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>Not enough daily history to test anything.</p>
        )
      ) : E.sample.bars < 4 * h + 60 && E.tested === 0 ? (
        <p className={cn("px-3 py-4", S.caption)}>
          {symbol} has {T!.bars.toLocaleString("en-US")} daily bars. The tests start after the first 252 and need several hundred more, so nothing is tested yet.
        </p>
      ) : (
        <>
          <TableWrap min={900}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className={S.th}>Condition</th>
                  <th className={cn(S.th, S.wide)}>In force</th>
                  <th className={cn(S.thNum, S.wide)} title="Non-overlapping cases / days the condition held">
                    Cases / days
                  </th>
                  <th className={cn(S.thNum, S.wide)} title={`Share of ${h}-day windows that ended higher: after the condition / all days`}>
                    Up share / base
                  </th>
                  <th className={S.thNum} title={`Average ${h}-day log return after the condition minus the all-days average`}>
                    Log excess
                  </th>
                  <th className={cn(S.thNum, S.wide)} title="Block-bootstrap interval of the excess">
                    95% interval
                  </th>
                  <th className={cn(S.thNum, S.wide)} title="p-value adjusted for everything tested on this symbol (Benjamini-Hochberg)">
                    q
                  </th>
                  <th className={S.th}>Verdict</th>
                  <th className={cn(S.th, S.wide, "border-l")} title={`The same condition across every covered company (chart events only; states have no record): excess of the simple ${h}-day return over all days, and its q, adjusted for every event and horizon`}>
                    Across companies, simple return
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-secondary/40">
                  <td colSpan={cols} className="px-3 py-1">
                    <span className="eyebrow">In force today · {active.length}</span>
                  </td>
                </tr>
                {active.length ? (
                  active.map((r) => <Row key={r.key} r={r} />)
                ) : (
                  <tr className={S.row}>
                    <td colSpan={cols} className={cn(S.td, "text-muted-foreground")}>
                      None of the tested conditions holds on the last bar.
                    </td>
                  </tr>
                )}
                {layout!.notable.length > 0 && (
                  <>
                    <tr className="border-b bg-secondary/40">
                      <td colSpan={cols} className="px-3 py-1">
                        <span className="eyebrow">Not in force, with a verdict at {h} days · {layout!.notable.length}</span>
                      </td>
                    </tr>
                    {layout!.notable.map((r) => (
                      <Row key={r.key} r={r} />
                    ))}
                  </>
                )}
                {layout!.summary && (
                  <tr className="border-b" data-section="Other conditions">
                    <td colSpan={cols} className={cn(S.td, "py-2 text-[13px] leading-5")}>
                      <span className="text-muted-foreground">{layout!.summary} </span>
                      <button type="button" data-agent-click onClick={openAll} className="rounded-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        All {E.rows.length} conditions
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
          <p className={cn("border-t px-3 py-1.5 sm:hidden", S.caption)}>Select a condition for its cases, hit rate, interval and q.</p>
          {detect && (
            <p className={cn("border-t px-3 py-2 text-[13px] leading-5")}>
              <span className="font-medium">What the test can see. </span>
              {detect} Real single-stock effects are usually far smaller, so on one stock the usual answer is no clear difference; the column on the right is the second line of evidence, the
              same condition pooled across covered companies (chart events only), with its own q adjusted across every event and horizon. Select a row for both records.
            </p>
          )}
          <Note>
            Returns are total returns (dividends reinvested) over the next {h} trading days; the excess is the average log return after the condition minus the average over every {h}-day window in the same sample (log terms, so it is not directly comparable with the
            up share, which counts simple returns). Standard errors follow
            Hodrick (1992), so overlapping windows and long-lived conditions do not overstate the evidence; the interval resamples the same daily terms in blocks of at least {h} sessions, so it is a check on the shape of the distribution, not a second test. A condition is called reliable only with at least{" "}
            {EVIDENCE.minIndependent} non-overlapping cases, q at or under {pc(EVIDENCE.fdr)}, an interval that excludes zero, a difference from days without the condition above {pc(EVIDENCE.cost, 1)} trading cost, the same sign in both
            halves of the history{hasPooled ? ", and no contradiction from the cross-company record where one exists" : ""}. On simulated price histories with nothing to find, this procedure
            shows a signal for fewer than 5 in 100. Past frequencies, not forecasts.
          </Note>
        </>
      )}
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </TechPanel>
  );
}
