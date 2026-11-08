import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Maximize2 } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { openIrCell } from "@/components/ir/breakdowns";
import { useSource } from "@/components/source/source-context";
import { useUnitScale } from "@/hooks/use-preference";
import { fmtIr, periodLabel } from "@/lib/ir/display";
import { buildMap, type MapLine, type MapTile, type MapZone, type Tone } from "@/lib/ir/map";
import type { IrPayload } from "@/lib/ir/payload";
import { cn } from "@/lib/utils";

const TONE_BG: Record<Tone, string> = {
  better: "bg-positive",
  worse: "bg-negative",
  mixed: "bg-warning",
  flat: "bg-muted-foreground/30",
  none: "bg-muted",
};
const TONE_TEXT: Record<Tone, string> = {
  better: "Improving",
  worse: "Weaker",
  mixed: "Mixed",
  flat: "Stable",
  none: "Not enough history",
};

type View = { zone?: string; tile?: string; line?: string };

const pct = (x: number | null, unit: string) =>
  x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}${unit === "pct" ? " pts" : unit === "bps" ? " bps" : "%"}`;

function Bars({ values, className, active, onPick }: { values: (number | null)[]; className?: string; active?: number; onPick?: (i: number) => void }) {
  const nums = values.filter((v): v is number => v != null);
  const max = Math.max(...nums.map(Math.abs), 1e-9);
  const min = Math.min(0, ...nums);
  const range = max - (min < 0 ? min : 0) || 1;
  return (
    <div className={cn("flex items-end gap-[2px]", className)}>
      {values.map((v, i) => {
        const Tag = onPick ? motion.button : motion.span;
        return (
        <Tag
          key={i}
          {...(onPick ? { type: "button", disabled: v == null, onClick: () => onPick(i) } : {})}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ delay: i * 0.02, duration: 0.35, ease: "easeOut" }}
          style={{ height: v == null ? "2px" : `${Math.max(4, (Math.abs(v) / range) * 100)}%`, originY: 1 }}
          className={cn(
            "block min-w-0 flex-1 rounded-[1px]",
            v == null ? "bg-muted" : i === values.length - 1 ? "bg-primary" : "bg-primary/45",
            v != null && v < 0 && "bg-negative/70",
            onPick && v != null && "cursor-pointer hover:bg-primary/80",
            active === i && "ring-2 ring-ring ring-offset-1",
          )}
          aria-label={onPick ? `Quarter ${i + 1}` : undefined}
        />
        );
      })}
    </div>
  );
}

function ToneStrip({ lines, max = 6 }: { lines: MapLine[]; max?: number }) {
  const shown = lines.slice(0, max);
  return (
    <div className="flex flex-wrap gap-[3px]">
      {shown.map((l) => (
        <span key={l.key} title={`${l.label}: ${TONE_TEXT[l.tone]}`} className={cn("h-2 w-5 rounded-[2px]", TONE_BG[l.tone])} />
      ))}
      {lines.length > max && <span className="text-[9px] leading-2 text-muted-foreground">+{lines.length - max}</span>}
    </div>
  );
}

function TileCard({ tile, onOpen, scale }: { tile: MapTile; onOpen: () => void; scale: ReturnType<typeof useUnitScale>[0] }) {
  const head = tile.root ?? tile.lines[0];
  const parts = tile.lines.filter((l) => l !== tile.root);
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-2 text-left transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="line-clamp-1 text-[11px] font-medium">{tile.title}</span>
      <ToneStrip lines={parts.length ? parts : tile.lines} />
      <Bars values={head.values} className="h-9" />
      <span className="num flex min-w-0 items-baseline justify-between gap-1 whitespace-nowrap text-[10px] text-muted-foreground">
        <span className="truncate text-foreground">{head.latest != null ? fmtIr(head.latest, head.unit, scale) : "—"}</span>
        <span className={cn(head.tone === "better" && "text-positive", head.tone === "worse" && "text-negative")}>{pct(head.yoy, head.unit)}</span>
      </span>
    </motion.button>
  );
}

export function IrFinancialMap({ ticker, payload }: { ticker: string; payload: IrPayload }) {
  const map = useMemo(() => buildMap(payload), [payload]);
  const [view, setView] = useState<View>({});
  const [pick, setPick] = useState<number | null>(null);
  const [scale] = useUnitScale();
  const { open } = useSource();
  const root = useRef<HTMLDivElement>(null);
  const byKey = useMemo(() => new Map(payload.series.map((s) => [s.k, s])), [payload]);

  const zone: MapZone | undefined = map.zones.find((z) => z.id === view.zone);
  const tile: MapTile | undefined = zone?.tiles.find((t) => t.id === view.tile);
  const line: MapLine | undefined = tile?.lines.find((l) => l.key === view.line);
  const up = () => {
    setPick(null);
    setView((v) => (v.line ? { zone: v.zone, tile: v.tile } : v.tile ? { zone: v.zone } : {}));
  };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "0") {
        e.preventDefault();
        if (e.key === "0") return setView({});
        up();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  if (!map.zones.length) return null;
  const q = map.quarters;
  const sourceOf = (l: MapLine, i: number) => {
    const s = byKey.get(l.key);
    const c = s?.q[q[i]];
    if (s && c) openIrCell(open, ticker, payload, s, q[i], "q", c);
    setPick(i);
  };
  const focus = line ?? tile?.root ?? tile?.lines[0];

  return (
    <div data-section="Financial map" className="min-w-0">
    <Panel
      title="Financial map"
      subtitle={`${map.lines.toLocaleString()} lines over ${q.length} quarters, ${periodLabel(q[0], "q")} – ${periodLabel(q[q.length - 1], "q")} · ${map.weaker} breakdowns mixed or weaker`}
      collapse={false}
    >
      <div ref={root} tabIndex={-1} className="grid min-w-0 grid-cols-1 outline-none lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 border-b p-3 lg:border-r lg:border-b-0">
          <nav aria-label="Map level" className="mb-3 flex flex-wrap items-center gap-1 text-xs">
            <button type="button" className={cn("rounded px-1.5 py-0.5 hover:bg-muted", !zone && "font-semibold")} onClick={() => (setView({}), setPick(null))}>
              {ticker}
            </button>
            {zone && (
              <>
                <ChevronRight className="size-3 text-muted-foreground" />
                <button type="button" className={cn("rounded px-1.5 py-0.5 hover:bg-muted", !tile && "font-semibold")} onClick={() => (setView({ zone: zone.id }), setPick(null))}>
                  {zone.title}
                </button>
              </>
            )}
            {tile && (
              <>
                <ChevronRight className="size-3 text-muted-foreground" />
                <button type="button" className={cn("max-w-56 truncate rounded px-1.5 py-0.5 hover:bg-muted", !line && "font-semibold")} onClick={() => (setView({ zone: zone!.id, tile: tile.id }), setPick(null))}>
                  {tile.title}
                </button>
              </>
            )}
            {line && (
              <>
                <ChevronRight className="size-3 text-muted-foreground" />
                <span className="max-w-56 truncate px-1.5 font-semibold">{line.label}</span>
              </>
            )}
            {zone && (
              <button type="button" onClick={() => (setView({}), setPick(null))} className="ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-muted-foreground hover:text-foreground">
                <Maximize2 className="size-3" /> Whole company
              </button>
            )}
          </nav>

          <AnimatePresence mode="wait">
            {!zone && (
              <motion.div key="all" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.25 }} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {map.zones.map((z) => (
                  <section key={z.id} className="min-w-0 rounded-lg border bg-muted/30 p-2">
                    <button type="button" onClick={() => setView({ zone: z.id })} className="mb-2 flex w-full items-center justify-between px-1 text-xs font-medium hover:underline">
                      <span>{z.title}</span>
                      <span className="text-muted-foreground">{z.tiles.length} breakdowns</span>
                    </button>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {z.tiles.slice(0, 6).map((t) => (
                        <TileCard key={t.id} tile={t} scale={scale} onOpen={() => setView({ zone: z.id, tile: t.id })} />
                      ))}
                    </div>
                    {z.tiles.length > 6 && (
                      <button type="button" onClick={() => setView({ zone: z.id })} className="mt-2 w-full text-center text-[11px] text-muted-foreground hover:text-foreground">
                        See all {z.tiles.length}
                      </button>
                    )}
                  </section>
                ))}
              </motion.div>
            )}
            {zone && !tile && (
              <motion.div key={zone.id} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.25 }} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {zone.tiles.map((t) => (
                  <TileCard key={t.id} tile={t} scale={scale} onOpen={() => setView({ zone: zone.id, tile: t.id })} />
                ))}
              </motion.div>
            )}
            {tile && !line && (
              <motion.div key={tile.id} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.25 }} className="grid grid-cols-1 gap-1">
                {tile.lines.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => (setView({ zone: zone!.id, tile: tile.id, line: l.key }), setPick(null))}
                    className="grid min-w-0 grid-cols-[8px_minmax(0,1fr)_96px_72px_56px] items-center gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span className={cn("size-2 rounded-full", TONE_BG[l.tone])} title={TONE_TEXT[l.tone]} />
                    <span className={cn("truncate", l.total && "font-semibold")} style={{ paddingLeft: l.depth * 12 }}>
                      {l.label}
                    </span>
                    <Bars values={l.values} className="h-5" />
                    <span className="num text-right">{l.latest != null ? fmtIr(l.latest, l.unit, scale) : "—"}</span>
                    <span className={cn("num text-right text-[11px]", l.tone === "better" && "text-positive", l.tone === "worse" && "text-negative")}>{pct(l.yoy, l.unit)}</span>
                  </button>
                ))}
              </motion.div>
            )}
            {line && (
              <motion.div key={line.key} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Bars values={line.values} className="h-56" active={pick ?? undefined} onPick={(i) => sourceOf(line, i)} />
                <div className="mt-1 flex gap-[2px]">
                  {q.map((e) => (
                    <span key={e} className="num min-w-0 flex-1 truncate text-center text-[9px] text-muted-foreground">
                      {periodLabel(e, "q")}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Click a bar to open the cell it came from in the stored document.</p>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="mt-3 text-[11px] text-muted-foreground">Click anything to zoom in · Esc to zoom out · 0 for the whole company</p>
        </div>

        <aside className="min-w-0 p-4 text-sm">
          {focus ? (
            <>
              <p className="eyebrow">{tile?.title}</p>
              <p className="mt-1 font-medium">{focus.label}</p>
              <p className="num mt-2 text-2xl font-semibold">
                {pick != null && focus.values[pick] != null ? fmtIr(focus.values[pick]!, focus.unit, scale) : focus.latest != null ? fmtIr(focus.latest, focus.unit, scale) : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">{periodLabel(q[pick ?? q.length - 1], "q")}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">vs prior quarter</dt>
                  <dd className="num">{pct(focus.qoq, focus.unit)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">vs a year ago</dt>
                  <dd className="num">{pct(focus.yoy, focus.unit)}</dd>
                </div>
              </dl>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs">
                <span className={cn("size-2 rounded-full", TONE_BG[focus.tone])} /> {TONE_TEXT[focus.tone]}
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Whole company</p>
              <div className="mt-3 grid gap-2 text-xs">
                {map.zones.map((z) => (
                  <button key={z.id} type="button" onClick={() => setView({ zone: z.id })} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted">
                    <span>{z.title}</span>
                    <span className="flex gap-1">
                      {(["better", "mixed", "worse"] as Tone[]).map((t) => (
                        <span key={t} className="num inline-flex items-center gap-1 text-muted-foreground">
                          <span className={cn("size-1.5 rounded-full", TONE_BG[t])} />
                          {z.tones[t]}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-5 grid gap-1 border-t pt-3 text-[11px] text-muted-foreground">
            {(["better", "mixed", "worse", "flat"] as Tone[]).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-4 rounded-[2px]", TONE_BG[t])} /> {TONE_TEXT[t]}
              </span>
            ))}
            <span className="mt-1">Colors compare the latest quarter with the prior quarter and a year ago; for costs, a fall counts as improving. Moves under 2% count as stable.</span>
          </div>
        </aside>
      </div>
    </Panel>
    </div>
  );
}
