import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import LoadingState from "@/components/ui/loading-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BaseRateBadge } from "@/components/situations/base-rate";
import {
  alignedCounts,
  COMPONENT_ORDER,
  inScreen,
  leadValue,
  matchBuilder,
  RED_FLAGS,
  situationQuery,
  SURVIVORSHIP_NOTE,
  type Builder,
  type SitComponentDef,
  type SitDir,
  type SitEvidence,
  type SitIndex,
  type SitRow,
} from "@/lib/situations/data";
import { useWatchlist } from "@/lib/workspace";
import { fmtCompactUsd, fmtDate, fmtPrice, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-1.5 align-top";

const DIR_TONE: Record<SitDir, string> = {
  bullish: "border-positive/40 text-positive",
  bearish: "border-negative/40 text-negative",
  neutral: "border-border text-muted-foreground",
};

export function DirIcon({ dir, className }: { dir: SitDir; className?: string }) {
  if (dir === "bullish") return <ArrowUpRight className={cn("size-3 text-positive", className)} aria-label="bullish" />;
  if (dir === "bearish") return <ArrowDownRight className={cn("size-3 text-negative", className)} aria-label="bearish" />;
  return <Minus className={cn("size-3 text-muted-foreground", className)} aria-label="neutral" />;
}

export function ComponentChip({
  id,
  def,
  title,
  strong,
  onClick,
}: {
  id: string;
  def?: SitComponentDef;
  title?: string;
  strong?: boolean;
  onClick?: () => void;
}) {
  const dir = def?.dir ?? "neutral";
  const cls = cn(
    "inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[10.5px]",
    DIR_TONE[dir],
    strong && "bg-secondary font-medium",
  );
  const body = (
    <>
      <DirIcon dir={dir} />
      {def?.label ?? id}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={cn(cls, "hover:bg-secondary")}>
      {body}
    </button>
  ) : (
    <span title={title} className={cls}>
      {body}
    </span>
  );
}

function EvidenceLink({ url, children }: { url?: string | null; children: ReactNode }) {
  if (!url) return <>{children}</>;
  if (url.startsWith("/app"))
    return (
      <Link to={url as "/app"} className="text-link hover:underline">
        {children}
      </Link>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

export function EvidenceList({ items }: { items: SitEvidence[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((e, i) => (
        <li key={i} className="grid gap-0.5 border-l-2 border-border pl-2.5 text-[12.5px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{e.label ?? e.form ?? "Record"}</span>
            {e.date && <span className="num text-[11px] text-muted-foreground">{e.date.startsWith("FY") ? e.date : fmtDate(e.date)}</span>}
            {e.value != null && <span className="num text-[11.5px] tabular-nums">{fmtCompactUsd(e.value)}</span>}
            {e.shares != null && e.price != null && (
              <span className="num text-[11px] text-muted-foreground">
                {Math.round(e.shares).toLocaleString()} sh @ {fmtPrice(e.price)}
              </span>
            )}
            {e.form && e.label && <span className="text-[11px] text-muted-foreground">{e.form}</span>}
            {e.section && <span className="text-[11px] text-muted-foreground">{e.section}</span>}
          </div>
          {e.quote && <blockquote className="text-[12px] leading-snug text-muted-foreground">"{e.quote}"</blockquote>}
          {e.joint?.length ? (
            <p className="text-[11px] text-muted-foreground">Also reported by {e.joint.join(", ")} (counted once)</p>
          ) : null}
          {e.base_rate && <BaseRateBadge rate={e.base_rate} />}
          {e.url && (
            <span className="text-[11px]">
              <EvidenceLink url={e.url}>{e.url.startsWith("/app") ? "Open in app" : "Source"}</EvidenceLink>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** All components for one company with their evidence (drawer body and company panel). */
export function CompanyComponents({
  ticker,
  defs,
  only,
}: {
  ticker: string;
  defs: Record<string, SitComponentDef>;
  only?: readonly string[];
}) {
  const q = useQuery(situationQuery(ticker));
  if (q.isLoading) return <LoadingState label="Loading evidence" variant="Dots" className="px-1 py-3" />;
  if (!q.data) return <p className="text-sm text-muted-foreground">No situation components on file for {ticker}.</p>;
  const keys = COMPONENT_ORDER.filter((k) => k in q.data.components && (!only || only.includes(k)));
  if (!keys.length) return <p className="text-sm text-muted-foreground">Nothing flagged for {ticker}.</p>;
  return (
    <div className="grid gap-4">
      {keys.map((k) => {
        const c = q.data.components[k];
        return (
          <section key={k} className="grid gap-1.5">
            <header className="flex flex-wrap items-center gap-2">
              <ComponentChip id={k} def={defs[k]} strong />
              <span className="text-[12.5px]">{c.headline}</span>
            </header>
            {defs[k]?.desc && <p className="text-[11px] text-muted-foreground">{defs[k].desc}</p>}
            <EvidenceList items={c.evidence} />
          </section>
        );
      })}
      <p className="text-[11px] text-muted-foreground">Updated {fmtRelative(q.data.generated)}.</p>
    </div>
  );
}

type Mode = string; // a screen id, "radar" or "custom"
type SortKey = "lead" | "aligned" | "mcap" | "t";

export function SituationsView({
  idx,
  mode,
  onMode,
}: {
  idx: SitIndex;
  mode: Mode;
  onMode: (m: Mode) => void;
}) {
  const defs = idx.components;
  const watch = useWatchlist();
  const watched = useMemo(() => new Set((watch.data ?? []).map((w) => w.ticker)), [watch.data]);
  const [scope, setScope] = useState<"all" | "watchlist">("all");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: "lead", d: -1 });
  const [open, setOpen] = useState<string | null>(null);
  const [builder, setBuilder] = useState<Builder>({ comps: ["insider_buy", "cheap_hist", "contracts_up"], min: 2, dir: "any" });
  const screen = idx.screens.find((s) => s.id === mode);
  const lead =
    mode === "radar"
      ? "distress"
      : mode === "custom"
        ? builder.comps[0] ?? "insider_buy"
        : (screen?.all ?? screen?.any ?? ["insider_buy"])[0];
  const sectors = useMemo(() => [...new Set(idx.rows.map((r) => r.s).filter(Boolean) as string[])].sort(), [idx.rows]);

  const rows = useMemo(() => {
    const out: { r: SitRow; aligned: number; flags: number }[] = [];
    for (const r of idx.rows) {
      if (scope === "watchlist" && !watched.has(r.t)) continue;
      if (sector !== "all" && r.s !== sector) continue;
      if (mode === "radar") {
        const flags = RED_FLAGS.filter((k) => k in r.c).length;
        if (!flags) continue;
        out.push({ r, aligned: flags, flags });
      } else if (mode === "custom") {
        const m = matchBuilder(r, builder, defs);
        if (m.ok) out.push({ r, aligned: m.aligned, flags: 0 });
      } else if (screen && inScreen(r, screen)) {
        out.push({ r, aligned: alignedCounts(r, defs).total, flags: 0 });
      }
    }
    const val = (x: (typeof out)[number]) =>
      sort.k === "lead"
        ? mode === "radar"
          ? x.flags * 1e15 + (x.r.mcap ?? 0)
          : leadValue(x.r, lead)
        : sort.k === "aligned"
          ? x.aligned
          : sort.k === "mcap"
            ? x.r.mcap
            : null;
    return out.sort((a, b) => {
      if (sort.k === "t") return sort.d * a.r.t.localeCompare(b.r.t);
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.d * (x - y);
    });
  }, [idx.rows, scope, watched, sector, mode, builder, defs, screen, sort, lead]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { radar: idx.rows.filter((r) => RED_FLAGS.some((k) => k in r.c)).length };
    for (const s of idx.screens) m[s.id] = s.n;
    return m;
  }, [idx]);

  const head = (k: SortKey, label: string, right = false) => (
    <th className={cn(th, right && "text-right")}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : k === "t" ? 1 : -1 }))}
        className="hover:text-foreground"
      >
        {label}
        {sort.k === k ? (sort.d === -1 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  const highlight = new Set(
    mode === "radar" ? RED_FLAGS : mode === "custom" ? builder.comps : [...(screen?.all ?? []), ...(screen?.any ?? [])],
  );
  const openRow = open ? idx.rows.find((r) => r.t === open) : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Screen"
          value={mode}
          onChange={onMode}
          options={[
            ...idx.screens.map((s) => ({ v: s.id, l: `${s.title} ${counts[s.id] ?? ""}` })),
            { v: "radar", l: `Red-flag radar ${counts.radar}` },
            { v: "custom", l: "Custom" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Segmented
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { v: "all", l: "All companies" },
            { v: "watchlist", l: `Watchlist ${watched.size || ""}` },
          ]}
        />
        <select
          aria-label="Sector"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="h-7 rounded-md border bg-card px-2 text-[12px]"
        >
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          {rows.length.toLocaleString()} companies · data as of {fmtDate(idx.as_of)} · built {fmtRelative(idx.generated)}
        </span>
      </div>

      {mode === "custom" && <BuilderBar idx={idx} b={builder} onChange={setBuilder} />}

      <Panel
        title={mode === "radar" ? "Red-flag radar" : mode === "custom" ? "Custom screen" : screen?.title}
        subtitle={
          mode === "radar"
            ? "Distress, quality deterioration, concentration changes, insider selling and financing events, most flags first"
            : mode === "custom"
              ? `At least ${builder.min} of the chosen components on${builder.dir !== "any" ? `, ${builder.dir} only` : ""}`
              : screen?.desc
        }
        collapse={false}
        bodyClassName="p-0"
      >
        {(screen?.caveat || mode === "mean_reversion") && (
          <p className="border-b bg-secondary/40 px-3.5 py-2 text-[11.5px] text-muted-foreground">
            {screen?.caveat ?? SURVIVORSHIP_NOTE}
          </p>
        )}
        <div className="max-h-[70vh] overflow-auto scrollbar-thin">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-left">
                {head("t", "Company")}
                <th className={th}>Sector</th>
                {head("mcap", "Mkt cap", true)}
                {head("aligned", mode === "radar" ? "Flags" : "On")}
                {head("lead", defs[lead]?.label ?? "Lead")}
                <th className={th}>All components</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map(({ r, aligned }) => (
                <tr
                  key={r.t}
                  className="cursor-pointer border-b last:border-0 hover:bg-secondary/50"
                  onClick={() => setOpen(r.t)}
                >
                  <td className={td}>
                    <Link
                      to="/app/companies/$ticker"
                      params={{ ticker: r.t }}
                      onClick={(e) => e.stopPropagation()}
                      className="num font-medium text-link hover:underline"
                    >
                      {r.t}
                    </Link>
                    <span className="ml-1.5 text-muted-foreground">{r.n}</span>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-muted-foreground")}>{r.s ?? "–"}</td>
                  <td className={cn(td, "num text-right tabular-nums")}>{r.mcap ? fmtCompactUsd(r.mcap) : "–"}</td>
                  <td className={cn(td, "num tabular-nums")}>{aligned}</td>
                  <td className={cn(td, "min-w-[240px]")}>{r.c[lead]?.h ?? <span className="text-muted-foreground">–</span>}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {COMPONENT_ORDER.filter((k) => k in r.c).map((k) => (
                        <ComponentChip key={k} id={k} def={defs[k]} title={r.c[k].h} strong={highlight.has(k)} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-3.5 py-6 text-center text-sm text-muted-foreground">
                    {scope === "watchlist" && !watched.size
                      ? "Your watchlist is empty. Follow companies to screen them here."
                      : "No company matches right now."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          Each component is an independent fact with its source; "On" counts components, it is not a score. Click a row
          for the evidence. {rows.length > 400 ? `Showing the first 400 of ${rows.length}.` : ""}
        </p>
      </Panel>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>
                  <Link to="/app/companies/$ticker" params={{ ticker: open }} className="text-link hover:underline">
                    {open}
                  </Link>{" "}
                  <span className="font-normal text-muted-foreground">{openRow?.n}</span>
                </SheetTitle>
                <SheetDescription>
                  {openRow ? `${Object.keys(openRow.c).length} components on` : ""}
                  {openRow?.s ? ` · ${openRow.s}` : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <CompanyComponents ticker={open} defs={defs} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BuilderBar({ idx, b, onChange }: { idx: SitIndex; b: Builder; onChange: (b: Builder) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const k of COMPONENT_ORDER) {
      const d = idx.components[k];
      if (!d) continue;
      m.set(d.group, [...(m.get(d.group) ?? []), k]);
    }
    return [...m.entries()];
  }, [idx.components]);
  const toggle = (k: string) =>
    onChange({ ...b, comps: b.comps.includes(k) ? b.comps.filter((x) => x !== k) : [...b.comps, k] });
  return (
    <div className="grid gap-2 rounded-md border bg-card/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map(([g, ks]) => (
          <div key={g} className="grid gap-1">
            <p className="text-[11px] font-medium text-muted-foreground">{g}</p>
            <div className="flex flex-wrap gap-1">
              {ks.map((k) => {
                const on = b.comps.includes(k);
                const d = idx.components[k];
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    title={d.desc}
                    onClick={() => toggle(k)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
                      on ? cn(DIR_TONE[d.dir], "bg-secondary font-medium") : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <DirIcon dir={d.dir} />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <label className="flex items-center gap-1.5">
          At least
          <select
            aria-label="Minimum components on"
            value={b.min}
            onChange={(e) => onChange({ ...b, min: Number(e.target.value) })}
            className="h-7 rounded-md border bg-card px-1.5"
          >
            {Array.from({ length: Math.max(1, b.comps.length) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          of {b.comps.length} chosen
        </label>
        <Segmented
          label="Direction"
          value={b.dir}
          onChange={(v) => onChange({ ...b, dir: v })}
          options={[
            { v: "any", l: "Any direction" },
            { v: "bullish", l: "Bullish" },
            { v: "bearish", l: "Bearish" },
          ]}
        />
      </div>
    </div>
  );
}
