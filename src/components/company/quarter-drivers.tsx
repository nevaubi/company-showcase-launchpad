// What moved the latest quarter: revenue by reported segment, operating income line by line, free cash flow from
// operations and capital spending. The sentences and the split are arithmetic on filed numbers
// (src/lib/company/why.ts); no model is called. Everything is on the page: nothing sits behind a button.
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { fmtFig } from "@/lib/company/read";
import type { Why } from "@/lib/company/why";
import { cellTarget } from "@/lib/financials/targets";
import type { CompanyDataset, Statement } from "@/lib/financials/types";
import { cn } from "@/lib/utils";
import { FigButton, signed } from "./fig-button";
import { Spark } from "./spark";

const LINE: Record<Why["id"], { statement: "income" | "cashflow"; key: string }> = {
  revenue: { statement: "income", key: "revenue" },
  operatingIncome: { statement: "income", key: "operatingIncome" },
  fcf: { statement: "cashflow", key: "fcf" },
};

const money = (v: number) => signed(fmtFig(v, "usd"), v);

function DriverCard({ ticker, w, st }: { ticker: string; w: Why; st: Statement }) {
  const i = st.periods.findIndex((p) => p.label === w.metric.period);
  const p = st.periods[i];
  const j = p ? st.periods.findIndex((x) => x.fy === p.fy - 1 && x.fq === p.fq) : -1;
  const now = i >= 0 ? cellTarget(ticker, st, LINE[w.id].key, i, w.metric.label) : null;
  const before = j >= 0 ? cellTarget(ticker, st, LINE[w.id].key, j, w.metric.label) : null;
  const change = w.metric.value - w.metric.previous;
  const names = new Map(w.insight.drivers.map((d) => [d.id, d]));
  const others = w.followUps.slice(1);
  return (
    <div data-driver={w.id} className="min-w-0 px-4 py-3">
      <p className={IR.caption}>
        {w.metric.label} · {w.metric.period}
      </p>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        {now ? (
          <FigButton target={now} className={cn("-ml-1", IR.stat)}>
            {fmtFig(w.metric.value, "usd")}
          </FigButton>
        ) : (
          <span className={IR.stat}>{fmtFig(w.metric.value, "usd")}</span>
        )}
        <Spark
          points={w.metric.series.map((v, k) => ({ label: w.metric.points[k] ?? `Quarter ${k + 1}`, value: v, text: fmtFig(v, "usd") }))}
          width={72}
          height={24}
          name={`${w.metric.label}, last eight quarters`}
          className="mb-1"
        />
      </div>
      <p className={cn("mt-0.5", IR.caption)}>
        {before ? (
          <FigButton target={before} className="-ml-1">
            {fmtFig(w.metric.previous, "usd")}
          </FigButton>
        ) : (
          fmtFig(w.metric.previous, "usd")
        )}{" "}
        a year earlier, a change of <span className={cn("num font-medium", change >= 0 ? "text-positive" : "text-negative")}>{money(change)}</span>
      </p>
      <p className="mt-2 text-[13px] leading-5">
        {w.insight.segments.map((s, k) => (
          <span key={k} className={s.driver && names.has(s.driver) ? "font-medium" : undefined}>
            {s.text}
          </span>
        ))}
      </p>
      <table className={cn("mt-2 w-full", IR.row)}>
        <tbody>
          {w.insight.drivers.map((d) => (
            <tr key={d.id} className="border-t border-border/60">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {d.label}
              </th>
              <td className={cn("py-1", IR.num, d.delta >= 0 ? "text-positive" : "text-negative")}>{money(d.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {others.map((f) => (
        <p key={f.id} className={cn("mt-1.5", IR.caption)}>
          <span className="text-foreground">{f.label}:</span> {f.insight.drivers.map((d) => `${d.label} ${money(d.delta)}`).join(", ")}
        </p>
      ))}
      <p className={cn("mt-1.5", IR.caption)}>From the {w.source}; the split adds up to the change.</p>
    </div>
  );
}

/** `cards` are the result of `whyCards(data)`: the page computes them once to know whether the section exists. */
export function QuarterDrivers({ ticker, data, cards }: { ticker: string; data: CompanyDataset; cards: Why[] }) {
  if (!cards.length) return null;
  const q = data.statements.quarterly;
  return (
    <IrPanel
      section="Why it moved"
      title="Latest quarter: what moved"
      subtitle={`${cards[0].metric.period} against the same quarter a year earlier · computed from the filings, no model`}
      bodyClassName="p-0"
    >
      <div className={cn("grid grid-cols-1 divide-y divide-border/60 lg:divide-x lg:divide-y-0", cards.length >= 3 ? "lg:grid-cols-3" : cards.length === 2 ? "lg:grid-cols-2" : "")}>
        {cards.map((w) => (
          <DriverCard key={w.id} ticker={ticker} w={w} st={q[LINE[w.id].statement]} />
        ))}
      </div>
    </IrPanel>
  );
}
