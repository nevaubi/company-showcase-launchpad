import { cn } from "@/lib/utils";

/** Diverging cell colour for a correlation: positive warm, negative cool. */
export function corrStyle(v: number | null) {
  if (v == null) return undefined;
  const a = Math.min(1, Math.abs(v)) * 0.7;
  return { background: `color-mix(in oklab, var(${v >= 0 ? "--negative" : "--positive"}) ${(a * 100).toFixed(0)}%, transparent)` };
}

export function CorrHeatmap({
  labels,
  m,
  onPick,
  picked,
}: {
  labels: string[];
  m: (number | null)[][];
  onPick?: (a: string, b: string) => void;
  picked?: [string, string] | null;
}) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="text-[11px]">
        <thead>
          <tr>
            <th />
            {labels.map((l) => (
              <th key={l} className="h-16 w-8 px-0 align-bottom font-medium text-muted-foreground">
                <div className="mx-auto w-4 origin-bottom-left translate-x-2 -rotate-45 whitespace-nowrap">{l}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((a, i) => (
            <tr key={a}>
              <th className="pr-2 text-right font-medium text-muted-foreground">{a}</th>
              {labels.map((b, j) => {
                const v = m[i][j];
                const on = picked && ((picked[0] === a && picked[1] === b) || (picked[0] === b && picked[1] === a));
                return (
                  <td key={b} className="p-0">
                    <button
                      type="button"
                      disabled={i === j}
                      onClick={() => onPick?.(a, b)}
                      title={`${a} / ${b}: ${v == null ? "—" : v.toFixed(2)}`}
                      style={corrStyle(i === j ? null : v)}
                      className={cn("num h-8 w-8 text-[10px] tabular-nums", i === j && "bg-muted", on && "ring-2 ring-ink ring-inset")}
                    >
                      {i === j || v == null ? "" : v.toFixed(2).replace(/^(-?)0/, "$1")}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
