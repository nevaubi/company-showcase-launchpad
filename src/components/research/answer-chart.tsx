import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Chart spec the assistant writes in a ```chart fenced block. */
export type ChartSpec = {
  type?: "line" | "bar";
  title?: string;
  unit?: string;
  x?: string;
  series?: string[];
  data: Record<string, string | number | null>[];
};

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function parseChartSpec(src: string): ChartSpec | null {
  try {
    const s = JSON.parse(src) as ChartSpec;
    if (!Array.isArray(s.data) || !s.data.length) return null;
    return s;
  } catch {
    return null;
  }
}

function fmt(v: unknown, unit?: string) {
  if (typeof v !== "number") return String(v ?? "");
  const a = Math.abs(v);
  const n = a >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${+v.toFixed(2)}`;
  return unit === "%" ? `${n}%` : unit === "$" ? `$${n}` : n;
}

export function AnswerChart({ spec }: { spec: ChartSpec }) {
  const x = spec.x ?? Object.keys(spec.data[0])[0];
  const series = spec.series?.length ? spec.series : Object.keys(spec.data[0]).filter((k) => k !== x && typeof spec.data[0][k] === "number");
  const Chart = spec.type === "bar" ? BarChart : LineChart;
  return (
    <figure className="not-prose my-3 rounded-md border bg-card p-2">
      {spec.title && <figcaption className="mb-1 px-1 text-xs font-medium">{spec.title}</figcaption>}
      <div className="h-48 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={spec.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey={x} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 10 }} width={44} stroke="var(--muted-foreground)" tickFormatter={(v) => fmt(v, spec.unit)} />
            <Tooltip formatter={(v) => fmt(v, spec.unit)} contentStyle={{ fontSize: 11, background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {series.map((k, i) =>
              spec.type === "bar" ? (
                <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
              ) : (
                <Line key={k} dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
