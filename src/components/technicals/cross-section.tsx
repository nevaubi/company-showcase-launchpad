import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalcSheet, type Calc } from "@/components/technicals/deep";
import { methodsQuery } from "@/lib/technicals/data";
import {
  niceTicks,
  crossQuery,
  METRICS,
  ols,
  peersQuery,
  percentileOfRank,
  quantileSorted,
  rowsOf,
  SCATTER_KEYS,
  type CrossFile,
  type CrossRow,
  type PeersFile,
} from "@/lib/technicals/cross";
import { useUniverse } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TILE_KEYS = [
  "rs_spy63",
  "rs_spy252",
  "rs_sector63",
  "rs_sector252",
  "mom12_1",
  "vol60",
  "beta",
  "avg_corr",
];
const TABLE_KEYS = ["r63", "r252", "mom12_1", "rs_sector252", "vol60", "beta", "sharpe1y", "maxdd"];
/** Lower is ranked first for these (as in the pipeline's sector ranks). */
const LOW_FIRST = new Set(["vol60", "beta", "avg_corr"]);
const th = "px-3 py-1.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap";

function val(r: CrossRow | undefined, k: string): number | null {
  const v = r?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
const tone = (k: string, v: number | null) =>
  v == null || !METRICS[k]?.signed ? "" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "";

function Num({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show the calculation"
      className={cn(
        "num rounded-sm tabular-nums decoration-dotted underline-offset-2 hover:bg-highlight-soft hover:underline",
        className,
      )}
    >
      {children}
    </button>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Rank of `sym` within its sector for metric k: the pipeline's rank when published, else computed the same way. */
function sectorRank(
  X: CrossFile,
  rows: CrossRow[],
  me: CrossRow,
  k: string,
): [number, number] | null {
  const pub = X.ranks[me.sym]?.[k];
  if (pub) return pub;
  const v = val(me, k);
  if (v == null || !me.sector) return null;
  const peers = rows.filter(
    (r) => r.kind === "stock" && r.sector === me.sector && val(r, k) != null,
  );
  const better = peers.filter((r) => (LOW_FIRST.has(k) ? val(r, k)! < v : val(r, k)! > v)).length;
  return [better + 1, peers.length];
}

export function CrossSection({ symbol, onPick }: { symbol: string; onPick: (s: string) => void }) {
  const X = useQuery(crossQuery);
  const P = useQuery(peersQuery(symbol));
  const methods = useQuery(methodsQuery);
  const uni = useUniverse();
  const names = useMemo(
    () => new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c.name])),
    [uni.data],
  );
  const [calc, setCalc] = useState<Calc | null>(null);
  const rows = useMemo(() => (X.data ? rowsOf(X.data) : []), [X.data]);
  const me = rows.find((r) => r.sym === symbol);

  if (X.isLoading) return <Skeleton className="h-96" />;
  if (!X.data)
    return (
      <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        The cross-section is not available right now. It is rebuilt every weekday evening after the
        per-symbol runs.
      </p>
    );
  const Xd = X.data;
  const sector = me?.sector ?? null;
  const method = methods.data?.cross ?? "";

  /** Calculation sheet for one metric: this company against its sector. */
  const show = (k: string, r: CrossRow) => {
    const m = METRICS[k];
    const sec = rows
      .filter((x) => x.kind === "stock" && x.sector === r.sector && val(x, k) != null)
      .sort((a, b) => (LOW_FIRST.has(k) ? val(a, k)! - val(b, k)! : val(b, k)! - val(a, k)!));
    const i = sec.findIndex((x) => x.sym === r.sym);
    const vals = sec.map((x) => val(x, k)!).sort((a, b) => a - b);
    const pick = new Set(
      [0, 1, 2, i - 1, i, i + 1, sec.length - 3, sec.length - 2, sec.length - 1].filter(
        (j) => j >= 0 && j < sec.length,
      ),
    );
    const list = [...pick].sort((a, b) => a - b);
    const rk = sectorRank(Xd, rows, r, k);
    setCalc({
      title: `${r.sym}: ${m.label}`,
      value: m.fmt(val(r, k)),
      sub: rk ? `rank ${rk[0]} of ${rk[1]} in ${r.sector}` : undefined,
      formula: m.def,
      note: `${method} As of ${fmtDate(Xd.as_of)}. Sector median ${m.fmt(quantileSorted(vals, 0.5))}. Rows show the top and bottom of the sector and the names around ${r.sym}.`,
      cols: ["Rank", "Company", m.label],
      rows: list.map((j) => [
        j + 1,
        `${sec[j].sym} ${names.get(sec[j].sym) ?? ""}`.trim(),
        m.fmt(val(sec[j], k)),
      ]),
      hi: new Set(list.map((j, n) => (j === i ? n : -1)).filter((n) => n >= 0)),
    });
  };

  return (
    <div className="grid gap-4">
      {me ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            {TILE_KEYS.map((k) => {
              const v = val(me, k);
              const rk = sectorRank(Xd, rows, me, k);
              return (
                <div key={k} className="bg-card px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">{METRICS[k].label}</p>
                  {v == null ? (
                    <p className="num text-base">–</p>
                  ) : (
                    <Num
                      onClick={() => show(k, me)}
                      className={cn("text-base font-medium", tone(k, v))}
                    >
                      {METRICS[k].fmt(v)}
                    </Num>
                  )}
                  <p className="text-[10.5px] text-muted-foreground">
                    {rk
                      ? `${rk[0]} of ${rk[1]} in sector`
                      : k.startsWith("rs_sector")
                        ? "no sector ETF"
                        : " "}
                  </p>
                </div>
              );
            })}
          </div>
          <RankTable X={Xd} rows={rows} me={me} onShow={show} />
        </>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {symbol} is not in the cross-section (companies only, with enough history). The scatter
          shows every covered company.
        </p>
      )}
      <Scatter
        rows={rows}
        me={me}
        symbol={symbol}
        sector={sector}
        names={names}
        onPick={onPick}
        asOf={Xd.as_of}
        method={method}
      />
      {sector && (
        <SectorTable
          rows={rows}
          sector={sector}
          symbol={symbol}
          names={names}
          onPick={onPick}
          onShow={show}
        />
      )}
      {P.data && <Peers P={P.data} symbol={symbol} names={names} onPick={onPick} />}
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </div>
  );
}

function RankTable({
  X,
  rows,
  me,
  onShow,
}: {
  X: CrossFile;
  rows: CrossRow[];
  me: CrossRow;
  onShow: (k: string, r: CrossRow) => void;
}) {
  const keys = X.rank_keys.filter((k) => X.ranks[me.sym]?.[k]);
  if (!keys.length) return null;
  return (
    <Panel
      title={`Rank within ${me.sector}`}
      subtitle="1 = highest momentum, 3M return, 1Y relative strength vs sector and Sharpe; lowest volatility and beta"
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b text-left">
              <th className={th}>Measure</th>
              <th className={cn(th, "text-right")}>Value</th>
              <th className={cn(th, "text-right")}>Rank</th>
              <th className={cn(th, "text-right")}>Percentile</th>
              <th className={cn(th, "w-1/3")} />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const [i, m] = sectorRank(X, rows, me, k)!;
              const p = percentileOfRank(i, m);
              return (
                <tr key={k} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{METRICS[k].label}</td>
                  <td className={cn("px-3 py-1.5 text-right", tone(k, val(me, k)))}>
                    <Num onClick={() => onShow(k, me)}>{METRICS[k].fmt(val(me, k))}</Num>
                  </td>
                  <td className="num px-3 py-1.5 text-right">
                    {i} / {m}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{Math.round(p * 100)}%</td>
                  <td className="px-3 py-1.5">
                    <div className="h-1.5 rounded-full bg-secondary">
                      <div
                        className="h-1.5 rounded-full bg-chart-1"
                        style={{ width: `${Math.round(p * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        Percentile is the share of sector names ranked below. As of {fmtDate(X.as_of)}.
      </p>
    </Panel>
  );
}

function Scatter({
  rows,
  me,
  symbol,
  sector,
  names,
  onPick,
  asOf,
  method,
}: {
  rows: CrossRow[];
  me: CrossRow | undefined;
  symbol: string;
  sector: string | null;
  names: Map<string, string>;
  onPick: (s: string) => void;
  asOf: string;
  method: string;
}) {
  const [xk, setXk] = useState("beta");
  const [yk, setYk] = useState("r252");
  const [only, setOnly] = useState<"all" | "sector">("all");
  const [hover, setHover] = useState<CrossRow | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>();
  const pts = rows.filter(
    (r) =>
      r.kind === "stock" &&
      val(r, xk) != null &&
      val(r, yk) != null &&
      (only === "all" || !sector || r.sector === sector),
  );
  const H = Math.min(440, Math.max(280, W * 0.55));
  const m = { t: 12, r: 16, b: 34, l: 56 };
  const xv = pts.map((p) => val(p, xk)!),
    yv = pts.map((p) => val(p, yk)!);
  const xs = [...xv].sort((a, b) => a - b),
    ys = [...yv].sort((a, b) => a - b);
  let xd: [number, number] = [quantileSorted(xs, 0.005), quantileSorted(xs, 0.995)];
  let yd: [number, number] = [quantileSorted(ys, 0.005), quantileSorted(ys, 0.995)];
  const mx = val(me, xk),
    my = val(me, yk);
  if (mx != null) xd = [Math.min(xd[0], mx), Math.max(xd[1], mx)];
  if (my != null) yd = [Math.min(yd[0], my), Math.max(yd[1], my)];
  const padx = (xd[1] - xd[0]) * 0.04 || 1,
    pady = (yd[1] - yd[0]) * 0.04 || 1;
  xd = [xd[0] - padx, xd[1] + padx];
  yd = [yd[0] - pady, yd[1] + pady];
  const clip = (v: number, d: [number, number]) => Math.max(d[0], Math.min(d[1], v));
  const X = (v: number) => m.l + ((clip(v, xd) - xd[0]) / (xd[1] - xd[0])) * (W - m.l - m.r);
  const Y = (v: number) => H - m.b - ((clip(v, yd) - yd[0]) / (yd[1] - yd[0])) * (H - m.t - m.b);
  const fit = ols(xv, yv);
  const ticks = (d: [number, number]) => niceTicks(d[0], d[1], 6);
  const ordered = [...pts].sort(
    (a, b) =>
      Number(a.sym === symbol) - Number(b.sym === symbol) ||
      Number(a.sector === sector) - Number(b.sector === sector),
  );
  const pick = (v: string, set: (k: string) => void, label: string) => (
    <Select value={v} onValueChange={set}>
      <SelectTrigger aria-label={label} className="h-7 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SCATTER_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {METRICS[k].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <Panel
      title="Cross-sectional scatter"
      subtitle={`${pts.length} companies · correlation ${Number.isFinite(fit.r) ? fit.r.toFixed(2) : "–"} · dashed line = least-squares fit · axes clipped at the 0.5th and 99.5th percentiles`}
      collapse={false}
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {pick(xk, setXk, "X axis")}
          <span className="text-xs text-muted-foreground">vs</span>
          {pick(yk, setYk, "Y axis")}
          <Segmented
            size="xs"
            label="Universe"
            value={only}
            onChange={setOnly}
            options={[
              { v: "all", l: "All" },
              { v: "sector", l: "Sector" },
            ]}
          />
        </div>
      }
    >
      <div ref={ref} className="relative px-2 pt-2">
        {W > 0 && pts.length > 1 && (
          <svg
            width={W}
            height={H}
            role="img"
            aria-label={`${METRICS[yk].label} against ${METRICS[xk].label}`}
          >
            {ticks(yd).map((t) => (
              <g key={`y${t}`}>
                <line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} stroke="var(--border)" />
                <text
                  x={m.l - 6}
                  y={Y(t) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {METRICS[yk].fmt(t)}
                </text>
              </g>
            ))}
            {ticks(xd).map((t) => (
              <text
                key={`x${t}`}
                x={X(t)}
                y={H - m.b + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {METRICS[xk].fmt(t)}
              </text>
            ))}
            <text
              x={W - m.r}
              y={H - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {METRICS[xk].label}
            </text>
            <text x={m.l + 4} y={m.t + 8} className="fill-muted-foreground text-[11px]">
              {METRICS[yk].label}
            </text>
            {Number.isFinite(fit.b) && (
              <line
                x1={X(xd[0])}
                x2={X(xd[1])}
                y1={Y(fit.a + fit.b * xd[0])}
                y2={Y(fit.a + fit.b * xd[1])}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 3"
              />
            )}
            {ordered.map((p) => {
              const mine = p.sym === symbol,
                inSec = !!sector && p.sector === sector;
              return (
                <circle
                  key={p.sym}
                  cx={X(val(p, xk)!)}
                  cy={Y(val(p, yk)!)}
                  r={mine ? 6 : 3}
                  fill={
                    mine
                      ? "var(--foreground)"
                      : inSec
                        ? "var(--chart-1)"
                        : "var(--muted-foreground)"
                  }
                  fillOpacity={mine ? 1 : inSec ? 0.7 : 0.25}
                  stroke={mine ? "var(--foreground)" : "none"}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(p)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick(p.sym)}
                />
              );
            })}
            {mx != null && my != null && (
              <text
                x={X(mx) + 9}
                y={Y(my) + 4}
                className="fill-foreground text-[11px] font-semibold"
              >
                {symbol}
              </text>
            )}
          </svg>
        )}
        {hover && (
          <div className="pointer-events-none absolute top-2 right-3 rounded-md border bg-popover px-2.5 py-1.5 text-[11.5px] shadow-sm">
            <p className="font-medium">
              {hover.sym}{" "}
              <span className="font-normal text-muted-foreground">
                {names.get(hover.sym) ?? ""}
              </span>
            </p>
            <p className="text-muted-foreground">{hover.sector}</p>
            <p className="num">
              {METRICS[xk].label}: {METRICS[xk].fmt(val(hover, xk))}
            </p>
            <p className="num">
              {METRICS[yk].label}: {METRICS[yk].fmt(val(hover, yk))}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 px-3.5 pb-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block size-2 rounded-full bg-foreground" /> {symbol}
        </span>
        {sector && (
          <span className="flex items-center gap-1">
            <i className="inline-block size-2 rounded-full bg-chart-1" /> {sector}
          </span>
        )}
        <span className="flex items-center gap-1">
          <i className="inline-block size-2 rounded-full bg-muted-foreground/40" /> other covered
          companies
        </span>
        <span>Click a point to open that company.</span>
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        {method} As of {fmtDate(asOf)}.
      </p>
    </Panel>
  );
}

function SectorTable({
  rows,
  sector,
  symbol,
  names,
  onPick,
  onShow,
}: {
  rows: CrossRow[];
  sector: string;
  symbol: string;
  names: Map<string, string>;
  onPick: (s: string) => void;
  onShow: (k: string, r: CrossRow) => void;
}) {
  const [sk, setSk] = useState("mom12_1");
  const [dir, setDir] = useState<1 | -1>(-1);
  const list = rows
    .filter((r) => r.kind === "stock" && r.sector === sector)
    .sort(
      (a, b) =>
        dir * ((val(a, sk) ?? -Infinity) - (val(b, sk) ?? -Infinity)) || a.sym.localeCompare(b.sym),
    );
  const sortBy = (k: string) => {
    if (k === sk) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSk(k);
      setDir(-1);
    }
  };
  return (
    <Panel
      title={`${sector}: covered companies`}
      subtitle={`${list.length} companies · click a header to sort, a company to open it, a value for its calculation`}
      collapse={480}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead>
            <tr className="border-b text-left">
              <th className={cn(th, "sticky left-0 bg-card")}>Company</th>
              {TABLE_KEYS.map((k) => (
                <th key={k} className={cn(th, "text-right")}>
                  <button
                    type="button"
                    onClick={() => sortBy(k)}
                    className={cn("hover:text-foreground", k === sk && "text-foreground")}
                  >
                    {METRICS[k].label}
                    {k === sk ? (dir === -1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className={th}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr
                key={r.sym}
                className={cn(
                  "border-b last:border-0 hover:bg-secondary/50",
                  r.sym === symbol && "bg-highlight-soft",
                )}
              >
                <td className="sticky left-0 bg-card px-3 py-1">
                  <button
                    type="button"
                    onClick={() => onPick(r.sym)}
                    className="text-left hover:underline"
                  >
                    <span className="num font-semibold">{r.sym}</span>{" "}
                    <span className="text-[11px] text-muted-foreground">
                      {names.get(r.sym) ?? ""}
                    </span>
                  </button>
                </td>
                {TABLE_KEYS.map((k) => (
                  <td key={k} className={cn("px-3 py-1 text-right", tone(k, val(r, k)))}>
                    {val(r, k) == null ? (
                      "–"
                    ) : (
                      <Num onClick={() => onShow(k, r)}>{METRICS[k].fmt(val(r, k))}</Num>
                    )}
                  </td>
                ))}
                <td className="px-3 py-1">
                  {r.trend ? (
                    <span
                      className={cn(
                        "rounded px-1.5 py-px text-[10.5px]",
                        r.trend === "up"
                          ? "bg-positive/10 text-positive"
                          : r.trend === "down"
                            ? "bg-negative/10 text-negative"
                            : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {r.trend}
                    </span>
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Peers({
  P,
  symbol,
  names,
  onPick,
}: {
  P: PeersFile;
  symbol: string;
  names: Map<string, string>;
  onPick: (s: string) => void;
}) {
  const [calc, setCalc] = useState<Calc | null>(null);
  const M = P.matrix;
  const showPair = (a: string, b: string, v: number | null) =>
    setCalc({
      title: `Return correlation: ${a} and ${b}`,
      value: v == null ? "–" : v.toFixed(3),
      formula: "Pearson correlation of the two companies' daily total returns over the window.",
      note: `${P.window}. ${M.basis}. Sector median ${P.sector_median?.toFixed(2) ?? "–"}, all ${P.n_names} covered names ${P.all_median?.toFixed(2) ?? "–"}.`,
      cols: ["Pair", "Correlation"],
      rows: [[`${a} / ${b}`, v == null ? "–" : v.toFixed(3)]],
    });
  const list = (xs: [string, number, string][]) => (
    <table className="w-full text-[12px]">
      <tbody>
        {xs.slice(0, 10).map(([s, v, sec]) => (
          <tr key={s} className="border-b last:border-0">
            <td className="px-3 py-1">
              <button type="button" onClick={() => onPick(s)} className="text-left hover:underline">
                <span className="num font-semibold">{s}</span>{" "}
                <span className="text-[11px] text-muted-foreground">{names.get(s) ?? ""}</span>
              </button>
            </td>
            <td className="px-3 py-1 text-right">
              <Num onClick={() => showPair(symbol, s, v)}>{v.toFixed(2)}</Num>
            </td>
            <td
              className="max-w-[10rem] truncate px-3 py-1 text-[11px] text-muted-foreground"
              title={sec}
            >
              {sec}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        title="Sector peer correlation matrix"
        subtitle={`${M.basis} · ${P.window}`}
        collapse={false}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto p-2">
          <table className="text-[11px]">
            <thead>
              <tr>
                <th />
                {M.names.map((n) => (
                  <th key={n} className="px-1 py-1 font-medium">
                    <button type="button" onClick={() => onPick(n)} className="num hover:underline">
                      {n}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {M.names.map((a, i) => (
                <tr key={a}>
                  <th className="num px-1 py-1 text-left font-medium">{a}</th>
                  {M.c[i].map((v, j) => (
                    <td key={j} className="p-0.5">
                      {i === j ? (
                        <div className="h-7 w-11 rounded-sm bg-secondary" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => showPair(a, M.names[j], v)}
                          title={`${a} vs ${M.names[j]}: ${v == null ? "–" : v.toFixed(3)}`}
                          className="num h-7 w-11 rounded-sm text-center tabular-nums hover:ring-1 hover:ring-foreground/40"
                          style={{
                            background:
                              v == null
                                ? undefined
                                : `color-mix(in srgb, var(--chart-1) ${Math.round(Math.max(0, v) * 70)}%, transparent)`,
                          }}
                        >
                          {v == null ? "–" : v.toFixed(2)}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          Sector median correlation {P.sector_median?.toFixed(2) ?? "–"}, all covered names{" "}
          {P.all_median?.toFixed(2) ?? "–"}. Darker = more correlated. As of {fmtDate(P.as_of)}.
        </p>
      </Panel>
      <Panel
        title="Most and least correlated covered names"
        subtitle={`${P.n_names} covered companies · ${P.window}`}
        collapse={false}
        bodyClassName="p-0"
      >
        <p className="px-3 pt-2 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
          Most correlated
        </p>
        {list(P.top)}
        <p className="px-3 pt-3 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
          Least correlated
        </p>
        {list(P.bottom)}
      </Panel>
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </div>
  );
}
