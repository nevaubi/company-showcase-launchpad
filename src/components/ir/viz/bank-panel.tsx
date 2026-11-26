// 4. The bank panel: net interest income and margin, noninterest revenue mix, the efficiency ratio as printed,
// credit, capital, deposits and loans. Every chart is one of the company's printed lines under its own name, each on
// its own axis (never two units on one chart). Shown only when the company's figures include them.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { decimalsOf, fmtChange, fmtValue } from "./format";
import { statOf } from "./model";
import { VizNote } from "./parts";
import { SectionChart } from "./section-chart";
import type { BankPanelProps, VizSeries } from "./types";

function Block({ title, note, children, className }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("min-w-0", className)}>
      <h3 className="text-[13px] font-medium leading-5">{title}</h3>
      {note && <p className="mb-1 text-[11px] leading-4 text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

/** "27,036 · +12.8% YoY": the latest figure of a line in its title row. */
function headline(s: VizSeries, scale: BankPanelProps["scale"]) {
  const st = statOf(s);
  if (!st) return "";
  return `${st.latest.short}: ${fmtValue(st.latest.value, s.unit, scale, s.printedUnit, decimalsOf(st.latest))}${st.yoy ? `, ${fmtChange(st.yoy)} YoY` : ""}`;
}

function One({ s, scale, onOpen, height = 140 }: { s: VizSeries; scale: BankPanelProps["scale"]; onOpen?: BankPanelProps["onOpen"]; height?: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] leading-4 text-foreground">{s.label}</p>
      <p className="num mb-1 text-[11px] leading-4 text-muted-foreground">{headline(s, scale)}</p>
      <SectionChart title={s.label} series={[s]} scale={scale} onOpen={onOpen} height={height} />
    </div>
  );
}

export function BankPanel({ figures, scale, onOpen, className }: BankPanelProps) {
  if (!figures) return null;
  const f = figures;
  const any = f.nii || f.nim || f.noninterest || f.noninterestLines.length || f.efficiency || f.credit.length || f.capital.length || f.balances.length;
  if (!any) return null;
  const lines = (xs: VizSeries[]) => xs.filter((s) => s.points.length);
  return (
    <div className={cn("@container grid min-w-0 grid-cols-1 gap-6", className)}>
      <Block title="Net interest income and margin" note="Two printed lines, each on its own axis.">
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          {f.nii ? <One s={f.nii} scale={scale} onOpen={onOpen} /> : <VizNote>Net interest income is not printed.</VizNote>}
          {f.nim ? <One s={f.nim} scale={scale} onOpen={onOpen} /> : <VizNote>No net interest margin is printed.</VizNote>}
        </div>
      </Block>

      <Block title={f.noninterest?.label ?? "Noninterest revenue"} note={f.noninterest ? "The printed lines of the section, stacked where they add up to the printed total; smaller lines are summed as other lines." : undefined}>
        {f.noninterest ? (
          <SectionChart title={f.noninterest.label} series={f.noninterest.parts} parts={f.noninterest} view="stacked" scale={scale} onOpen={onOpen} />
        ) : f.noninterestLines.length ? (
          <SectionChart title="Noninterest revenue lines" series={f.noninterestLines} scale={scale} onOpen={onOpen} />
        ) : (
          <VizNote>No noninterest revenue section is printed with its lines.</VizNote>
        )}
      </Block>

      <Block title="Efficiency" note={f.efficiency ? `${f.efficiency.label} as the company prints it; not computed here.` : undefined}>
        {f.efficiency ? <One s={f.efficiency} scale={scale} onOpen={onOpen} /> : <VizNote>No efficiency or overhead ratio is printed, and none is computed.</VizNote>}
      </Block>

      <Block title="Credit" note={f.credit.length ? "Provision, net charge-offs and the allowance, each on its own axis." : undefined}>
        {f.credit.length ? (
          <div className={cn("grid grid-cols-1 gap-4", f.credit.length === 2 ? "@2xl:grid-cols-2" : f.credit.length >= 3 ? "@2xl:grid-cols-3" : "")}>
            {lines(f.credit).map((s) => (
              <One key={s.key} s={s} scale={scale} onOpen={onOpen} height={120} />
            ))}
          </div>
        ) : (
          <VizNote>No provision, charge-off or allowance line is printed.</VizNote>
        )}
      </Block>

      <Block title="Capital" note={f.capital.length ? "Ratios as printed, in percent." : undefined}>
        {f.capital.length ? <SectionChart title="Capital ratios" series={f.capital} scale={scale} onOpen={onOpen} height={170} /> : <VizNote>No capital ratio is printed.</VizNote>}
      </Block>

      <Block title="Deposits and loans" note={f.balances.length ? "Balances at each period end." : undefined}>
        {f.balances.length ? <SectionChart title="Deposits and loans" series={f.balances} scale={scale} onOpen={onOpen} height={170} /> : <VizNote>No deposit or loan balance is printed.</VizNote>}
      </Block>
    </div>
  );
}
