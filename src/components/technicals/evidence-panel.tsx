import { Fragment, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import type { Technicals } from "@/lib/technicals/analysis";
import { GROUP_LABEL, type Bars, type ConditionGroup } from "@/lib/technicals/conditions";
import { EVIDENCE, REASON_TEXT, type EvidenceCell, type EvidenceRow, type Horizon } from "@/lib/technicals/evidence";
import { cn } from "@/lib/utils";
import { CalcSheet, f2, Note, pc, pp, signTone, T as S, TableWrap, Tag, TechPanel, type Calc } from "./ui";

const GROUPS: ConditionGroup[] = ["trend", "momentum", "stretch", "volatility", "volume"];

/** Short verdict for a cell: what failed first, in the fewest words that stay true. */
function verdictOf(c: EvidenceCell | undefined) {
  if (!c) return { text: "too few cases", title: `Fewer than ${EVIDENCE.minReport} non-overlapping cases: no statistics` };
  if (c.verdict === "reliable") return { text: c.test.excess > 0 ? "reliable: higher after" : "reliable: lower after", title: REASON_TEXT.ok, reliable: true };
  const short: Record<string, string> = {
    small: `small sample (${c.test.nEff})`,
    base: "no clear difference",
    interval: "interval includes zero",
    cost: "smaller than costs",
    unstable: "not stable over time",
    pooled: "not seen across companies",
  };
  return { text: short[c.reason] ?? c.reason, title: REASON_TEXT[c.reason] };
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
  const hasPooled = !!E?.rows.some((r) => EVIDENCE.horizons.some((x) => r.cells[x]?.pooled));

  const open = (r: EvidenceRow) => {
    const c = r.cells[h];
    const list = (r.cases[h] ?? []).slice(-60).reverse();
    setCalc({
      title: `${symbol}: ${r.name}`,
      value: c ? `${pp(c.test.excess, 2)} over ${h} days` : undefined,
      sub: c
        ? `${c.test.nEff} independent cases (${c.test.n.toLocaleString("en-US")} days), t ${f2(c.test.t)}, p ${f2(c.test.p, 3)}${c.q != null ? `, q ${f2(c.q, 3)}` : ""}`
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
        c?.pooled
          ? `Across tracked companies the same event has ${c.pooled.n.toLocaleString("en-US")} occurrences with a ${h}-day excess of ${pp(c.pooled.excess, 2)}${c.pooled.ci ? ` (95% interval ${pp(c.pooled.ci[0])} to ${pp(c.pooled.ci[1])})` : ""}.`
          : "",
        (r.cases[h]?.length ?? 0) > 60 ? `Showing the latest 60 of ${r.cases[h]!.length} cases.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  };

  const Row = ({ r }: { r: EvidenceRow }) => {
    const c = r.cells[h];
    const v = verdictOf(c);
    const t = c?.test;
    return (
      <tr className={cn(S.row, "transition-colors duration-150 hover:bg-highlight-soft/50 motion-reduce:transition-none", !r.active && "text-muted-foreground")}>
        <td className={cn(S.td, "max-w-[18rem]")}>
          <button type="button" data-agent-click onClick={() => open(r)} title={`${r.text}. Select for the cases.`} className={cn(S.cellButton, "truncate text-left", r.active && "font-medium text-foreground")}>
            {r.name}
          </button>
        </td>
        <td className={cn(S.td, "whitespace-nowrap", r.active ? "text-foreground" : "")}>{today(r)}</td>
        <td className={S.num}>
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
        <td className={S.num}>
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
        <td className={S.num}>{t?.ci ? `${pp(t.ci[0])} to ${pp(t.ci[1])}` : "–"}</td>
        <td className={S.num}>{t ? f2(t.t) : "–"}</td>
        <td className={S.num}>{c?.q != null ? f2(c.q, c.q < 0.1 ? 3 : 2) : "–"}</td>
        <td className={cn(S.td, "whitespace-nowrap")} title={c?.pooled?.ci ? `${v.title}. Across tracked companies: ${pp(c.pooled.ci[0])} to ${pp(c.pooled.ci[1])}.` : v.title}>
          {v.reliable ? <Tag tone={t!.excess > 0 ? "positive" : "negative"}>{v.text}</Tag> : <span className="text-[11px] text-muted-foreground">{v.text}</span>}
        </td>
      </tr>
    );
  };

  const active = E?.rows.filter((r) => r.active) ?? [];
  const cols = 9;
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
          <TableWrap min={820}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className={S.th}>Condition</th>
                  <th className={S.th}>In force</th>
                  <th className={S.thNum} title="Non-overlapping cases / days the condition held">
                    Cases / days
                  </th>
                  <th className={S.thNum} title={`Share of ${h}-day windows that ended higher: after the condition / all days`}>
                    Up share / base
                  </th>
                  <th className={S.thNum} title={`Average ${h}-day log return after the condition minus the all-days average`}>
                    Excess, {h} days
                  </th>
                  <th className={S.thNum} title="Block-bootstrap interval of the excess">
                    95% interval
                  </th>
                  <th className={S.thNum} title="Excess divided by its Hodrick standard error">
                    t
                  </th>
                  <th className={S.thNum} title="p-value adjusted for everything tested on this symbol (Benjamini-Hochberg)">
                    q
                  </th>
                  <th className={S.th}>Verdict</th>
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
                {GROUPS.map((g) => {
                  const rows = E.rows.filter((r) => r.group === g && !r.active);
                  if (!rows.length) return null;
                  return (
                    <Fragment key={g}>
                      <tr className="border-b bg-secondary/40">
                        <td colSpan={cols} className="px-3 py-1">
                          <span className="eyebrow">Not in force · {GROUP_LABEL[g]}</span>
                        </td>
                      </tr>
                      {rows.map((r) => (
                        <Row key={r.key} r={r} />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <Note>
            Returns are total returns (dividends reinvested) over the next {h} trading days; the excess is measured in log terms against every {h}-day window in the same sample. Standard errors follow
            Hodrick (1992), so overlapping windows and long-lived conditions do not overstate the evidence; the interval is a block bootstrap. A condition is called reliable only with at least{" "}
            {EVIDENCE.minIndependent} non-overlapping cases, q at or under {pc(EVIDENCE.fdr)}, an interval that excludes zero, an excess above {pc(EVIDENCE.cost, 1)} trading cost, the same sign in both
            halves of the history{hasPooled ? ", and the same finding across tracked companies where those statistics exist" : ""}. On simulated price histories with nothing to find, this procedure
            shows a signal for fewer than 5 in 100. Past frequencies, not forecasts.
          </Note>
        </>
      )}
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </TechPanel>
  );
}
