import { forecastRange, forecastSource, type ForecastValues } from "@/lib/estimates/range-quality";

export type ForecastField = "avg" | "low" | "high" | "n";

export function ForecastRangeCell({ raw, count, format, pick }: {
  raw: ForecastValues; count: number | null; format: (value: number | null) => string;
  pick?: (field: ForecastField) => void;
}) {
  const view = forecastRange(raw, count);
  const source = forecastSource(raw, count, format);
  const value = (field: ForecastField, text: string, available: boolean) => pick && available
    ? <button type="button" onClick={() => pick(field)} className="text-inherit hover:underline">{text}</button>
    : <span>{text}</span>;
  const bounds = !view.placeholder && (raw.low != null || raw.high != null) ? (
    <div className="mt-0.5 flex justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
      <span>Low {value("low", format(raw.low ?? null), raw.low != null)}</span>
      <span>High {value("high", format(raw.high ?? null), raw.high != null)}</span>
    </div>
  ) : null;
  return <div className="min-w-[10rem]" title={source}>
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-medium tabular-nums">{value("avg", format(view.mean), raw.avg != null)}</span>
      <span className="text-[11px] text-muted-foreground">{value("n", view.coverage, count != null)}</span>
    </div>
    {view.position != null && <div className="relative mt-1 h-1 rounded-full bg-secondary" aria-hidden="true">
      <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${view.position * 100}%` }} />
    </div>}
    {view.issue && <details className="mt-0.5 text-left text-[10px] text-muted-foreground">
      <summary className="cursor-pointer">{view.issue}</summary>
      <p className="mt-1 max-w-52 leading-relaxed">{source}</p>
      {pick && bounds}
    </details>}
    {!view.issue && bounds}
  </div>;
}
