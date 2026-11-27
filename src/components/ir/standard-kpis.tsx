// "Standardized KPIs": the company's KPIs that map to one standard measure across companies (the KPI
// matrix's taxonomy), with the company's own name for each, the latest value and its period, the change
// from a year before, where the value sits among companies of the same industry (or sector when fewer
// than three report it), and a link to the peer comparison. Data: the pipeline's kpistd files.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { useSource } from "@/components/source/source-context";
import { partnerFile } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import "@/components/ir/table.css";

/** [end, value, period label, doc id, page, quote, sheet, cell, derived formula, printed value] */
type StdPoint = [
  string,
  number,
  string,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number | null,
];
interface StdSeries {
  kpi_id: string;
  name: string;
  unit: string | null;
  Q: StdPoint[];
  A: StdPoint[];
  alts: unknown[];
  current: boolean;
}
interface StdCompany {
  ticker: string;
  sector: string | null;
  industry: string | null;
  series: Record<string, StdSeries>;
  /** id → [title, storage path, ext, url, kind, fiscal label, text path] */
  docs: Record<string, (string | null)[]>;
}
interface TaxKpi {
  id: string;
  name: string;
  family: string;
  uclass: string;
  unit: string;
  definition: string;
  higher_is_better: boolean | null;
}
type LatestPoint = [string, number, string, number | null] | null;
interface Latest {
  kpis: Record<
    string,
    Record<string, { q: LatestPoint; a: LatestPoint; ind: string; sec: string }>
  >;
}

export interface StdRow {
  id: string;
  measure: string;
  family: string;
  definition: string;
  uclass: string;
  name: string;
  alts: number;
  point: StdPoint;
  yoy: number | null;
  pct: number | null;
  peers: number;
  scope: "industry" | "sector";
}

/** Value in the measure's class: percent, multiple, dollars per share, money or a count. */
export function fmtStd(v: number, uclass: string): string {
  const neg = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (uclass === "pct") return `${neg}${a.toFixed(a < 10 ? 2 : 1)}%`;
  if (uclass === "x") return `${neg}${a.toFixed(2)}×`;
  if (uclass === "usd_ps" || uclass === "usd_pu") return `${neg}$${a.toFixed(2)}`;
  if (uclass === "usd")
    return a >= 1e9
      ? `${neg}$${(a / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `${neg}$${(a / 1e6).toFixed(0)}M`
        : `${neg}$${a.toLocaleString("en-US")}`;
  return `${neg}${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** The year-on-year change: points for percentages, percent for the rest. */
export function fmtChange(c: number | null, uclass: string): string {
  if (c == null || !Number.isFinite(c)) return DASH;
  const sign = c > 0 ? "+" : c < 0 ? "−" : "";
  return uclass === "pct"
    ? `${sign}${Math.abs(c).toFixed(1)} pt`
    : `${sign}${Math.abs(c * 100).toFixed(1)}%`;
}

/** The point a year before `p` in the same series (within three weeks of the date), if any. */
function yearBefore(pts: StdPoint[], p: StdPoint): StdPoint | undefined {
  const t = Date.parse(p[0]) - 365 * 864e5;
  return pts.find((x) => Math.abs(Date.parse(x[0]) - t) < 21 * 864e5);
}

/** Rows of the table (pure): current series that map to a measure, with change and peer percentile. */
export function standardRows(
  ticker: string,
  co: StdCompany,
  latest: Latest,
  tax: TaxKpi[],
): StdRow[] {
  const meta = new Map(tax.map((k) => [k.id, k]));
  const rows: StdRow[] = [];
  for (const [cid, s] of Object.entries(co.series)) {
    if (s.current === false) continue;
    const m = meta.get(cid);
    if (!m) continue;
    const pts = s.Q.length ? s.Q : s.A;
    const point = pts.at(-1);
    if (!point) continue;
    const prev = yearBefore(pts, point);
    const yoy = prev
      ? m.uclass === "pct"
        ? point[1] - prev[1]
        : prev[1] !== 0
          ? (point[1] - prev[1]) / Math.abs(prev[1])
          : null
      : null;
    // Compare the displayed figure only with other companies reporting this frequency and end date.
    const freq = s.Q.length ? "q" : "a";
    const comparable = Object.entries(latest.kpis[cid] ?? {}).flatMap(([symbol, company]) => {
      const reported = company[freq];
      return symbol !== ticker && reported?.[0] === point[0] && Number.isFinite(reported[1])
        ? [{ company, value: reported[1] }]
        : [];
    });
    const industry = comparable.filter(({ company }) => co.industry && company.ind === co.industry);
    const scope = industry.length >= 2 ? "industry" : "sector";
    const peers =
      scope === "industry"
        ? industry
        : comparable.filter(({ company }) => co.sector && company.sec === co.sector);
    const pct =
      peers.length >= 2
        ? Math.round(
            (100 *
              peers.reduce(
                (n, p) => n + (p.value < point[1] ? 1 : p.value === point[1] ? 0.5 : 0),
                0,
              )) /
              peers.length,
          )
        : null;
    rows.push({
      id: cid,
      measure: m.name,
      family: m.family,
      definition: m.definition,
      uclass: m.uclass,
      name: s.name,
      alts: s.alts?.length ?? 0,
      point,
      yoy,
      pct,
      peers: peers.length + 1,
      scope,
    });
  }
  return rows.sort(
    (a, b) => a.family.localeCompare(b.family) || a.measure.localeCompare(b.measure),
  );
}

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

export function IrStandardKpis({ ticker }: { ticker: string }) {
  const { open } = useSource();
  const co = useQuery({
    queryKey: ["kpistd", "t", ticker],
    queryFn: () => partnerFile<StdCompany>(`kpistd/t/${ticker}.json`),
    staleTime: 3600_000,
    retry: 1,
  });
  const latest = useQuery({
    queryKey: ["kpistd", "latest"],
    queryFn: () => partnerFile<Latest>("kpistd/latest.json"),
    staleTime: 3600_000,
    retry: 1,
  });
  const tax = useQuery({
    queryKey: ["kpistd", "taxonomy"],
    queryFn: () => partnerFile<{ kpis: TaxKpi[] }>("kpistd/taxonomy.json"),
    staleTime: 3600_000,
    retry: 1,
  });
  if (!co.data || !latest.data || !tax.data) return null;
  const rows = standardRows(ticker, co.data, latest.data, tax.data.kpis);
  if (!rows.length) return null;
  const old = Object.values(co.data.series).filter((s) => s.current === false).length;

  const openPoint = (r: StdRow) => {
    const p = r.point;
    const d = p[3] ? co.data!.docs[p[3]] : undefined;
    if (!d?.[3]) return;
    open({
      ticker,
      label: r.measure,
      periodLabel: `${p[2]} · ${fmtDate(p[0])}`,
      unit: r.uclass === "pct" ? "pct" : "usd",
      value: p[1],
      external: {
        url: d[3],
        quote: p[5] ?? `${r.name} ${p[9] ?? p[1]}`,
        date: p[0],
        confidence: `${d[0] ?? "Company document"} · company KPI “${r.name}” mapped to ${r.measure}`,
      },
    });
  };
  const toPeers = (r: StdRow) => {
    try {
      sessionStorage.setItem("fu:kpis:picked", JSON.stringify([r.id]));
      if (co.data!.sector)
        sessionStorage.setItem("fu:kpis:scope", JSON.stringify(`sec:${co.data!.sector}`));
      sessionStorage.setItem("fu:kpis:K", JSON.stringify("q"));
    } catch {
      /* Storage unavailable: the matrix opens with its own defaults. */
    }
  };

  return (
    <IrPanel
      section="Standardized KPIs"
      title="Standardized KPIs"
      subtitle={`${rows.length} of this company's current KPIs map to a standard measure${old ? ` (${old} more it no longer reports are on the peer pages)` : ""}. Click a value for its source, a measure for the peer comparison.`}
      actions={
        <Link
          to="/app/kpis"
          className="text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          All measures
        </Link>
      }
    >
      <div className="irt-root irt-scope relative overflow-x-auto scrollbar-thin">
        <table className={cn("w-full min-w-[34rem] border-separate border-spacing-0", IR.row)}>
          <thead className={IR.caption}>
            <tr>
              <th scope="col" className="border-b py-1.5 pl-4 pr-3 text-left font-normal">
                Measure
              </th>
              <th
                scope="col"
                className="hidden border-b px-3 py-1.5 text-left font-normal sm:table-cell"
              >
                Company's name for it
              </th>
              <th scope="col" className="border-b px-3 py-1.5 text-right font-normal">
                Latest
              </th>
              <th scope="col" className="border-b px-3 py-1.5 text-right font-normal">
                Year on year
              </th>
              <th
                scope="col"
                className="border-b px-3 py-1.5 text-right font-normal"
                title="Percentile of reported values for the same period end and frequency. Ties receive half weight. At least three reporting companies are required; sector figures are used when industry coverage is smaller."
              >
                Peer percentile
              </th>
              <th scope="col" className="border-b py-1.5 pl-3 pr-4 text-right font-normal">
                <span className="sr-only">Peers</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group">
                <th
                  scope="row"
                  className="border-b py-1.5 pl-4 pr-3 text-left font-normal transition-colors duration-150 group-hover:bg-secondary/60"
                  title={r.definition}
                >
                  {r.measure}
                  <span className={cn("block sm:hidden", IR.caption)}>{r.name}</span>
                </th>
                <td className="hidden border-b px-3 py-1.5 text-muted-foreground transition-colors duration-150 group-hover:bg-secondary/60 sm:table-cell">
                  {r.name}
                  {r.alts > 0 && (
                    <span className={cn("block", IR.caption)}>
                      {r.alts} older or alternative series kept apart
                    </span>
                  )}
                </td>
                <td className="border-b p-0 transition-colors duration-150 group-hover:bg-secondary/60">
                  <button
                    type="button"
                    onClick={() => openPoint(r)}
                    className={cn(IR.cellButton, IR.num, "py-1.5")}
                    title={`${r.point[2]} · ended ${fmtDate(r.point[0])}. Click to open the source.`}
                  >
                    <span className={IR.strong}>{fmtStd(r.point[1], r.uclass)}</span>
                    <span className={cn("block", IR.caption)}>{r.point[2]}</span>
                  </button>
                </td>
                <td
                  className={cn(
                    "border-b px-3 py-1.5 transition-colors duration-150 group-hover:bg-secondary/60",
                    IR.num,
                  )}
                >
                  {fmtChange(r.yoy, r.uclass)}
                </td>
                <td
                  className={cn(
                    "border-b px-3 py-1.5 transition-colors duration-150 group-hover:bg-secondary/60",
                    IR.num,
                  )}
                  title={
                    r.pct != null
                      ? `${ordinal(r.pct)} percentile among ${r.peers} ${r.scope} companies, including ${ticker}, for the ${r.point[2]} period ending ${r.point[0]}. Ties receive half weight.`
                      : "Fewer than three companies reported for this period and frequency."
                  }
                >
                  {r.pct == null ? DASH : `${ordinal(r.pct)} percentile`}
                  {r.pct != null && (
                    <span className={cn("block", IR.caption)}>
                      {r.peers} {r.scope} companies
                    </span>
                  )}
                </td>
                <td className="border-b py-1.5 pl-3 pr-4 text-right transition-colors duration-150 group-hover:bg-secondary/60">
                  <Link
                    to="/app/kpis"
                    onClick={() => toPeers(r)}
                    aria-label={`Compare ${r.measure} across companies`}
                    className="text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
                  >
                    Peers
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </IrPanel>
  );
}
