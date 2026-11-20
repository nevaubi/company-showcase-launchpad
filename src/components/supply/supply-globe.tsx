// Globe view of the supply-chain page. The company sits at its head office; every named supplier,
// customer, partner and competitor that can be placed is drawn where it is based, with an arc for the
// direction goods and services move. Countries are tinted by how often the filings tie the company to
// them. Nothing is placed by guesswork: names without a known location are listed under the map.
// Browser-only (canvas): the route loads this file lazily inside <ClientOnly>.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe2, Map as MapIcon, Minus, Plus, RotateCcw } from "lucide-react";
import { logoUrl } from "@/components/app/company-logo";
import { analyticsFile } from "@/lib/analytics-files";
import { canonCountry, type CountryRow } from "@/lib/supply/analytics";
import { maxShare, type GraphNode, type HopNode, type NodeRisk, type Relation, type ShockImpact } from "@/lib/supply/core";
import { arcEnds, BASIS_LABEL, frameAll, placeGraph, readHq, SOURCE_LABEL, type Centroid, type Hq, type HqFile, type Placed } from "@/lib/supply/geo";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { countryPlaces, GlobeEngine, type GlobeArc, type GlobeBadge, type GlobeFill, type GlobeHit, type GlobePalette, type GlobePoint } from "./globe/engine";
import { externalLogo, impactKey, overlayHit, RELATION_COLOR, RELATION_LABEL, type Overlay } from "./supply-map-meta";

export const hqQuery = { queryKey: ["analytics", "hq"], queryFn: () => analyticsFile<HqFile>("hq.json"), staleTime: 24 * 60 * 60_000 };

/** Places too small to have a shape in the base map. */
const SMALL: Record<string, [number, number]> = { Singapore: [103.82, 1.35], "Hong Kong": [114.17, 22.32], Luxembourg: [6.13, 49.61], Malta: [14.4, 35.9], Bermuda: [-64.75, 32.3], "Cayman Islands": [-81.25, 19.31], Macau: [113.55, 22.16] };
const SINGULAR: Record<Relation | "focus", string> = { supplier: "Supplier", customer: "Customer", partner: "Partner", competitor: "Competitor", focus: "This company" };

/* ---------- colours: the canvas cannot read CSS variables, so resolve them to sRGB once per theme ---------- */
type Rgb = [number, number, number];
function makeResolver(): (css: string) => Rgb {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  const style = getComputedStyle(document.documentElement);
  return (css) => {
    const m = /^var\((--[\w-]+)\)$/.exec(css.trim());
    const value = m ? style.getPropertyValue(m[1]).trim() : css;
    if (!ctx || !value) return [120, 120, 120];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#787878";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
}
const rgb = (c: Rgb, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

interface Theme { palette: GlobePalette; relation: Record<Relation | "focus", string>; negative: string; hotspot: Rgb; tint: Rgb }
function readTheme(): Theme {
  const r = makeResolver();
  const bg = r("var(--background)"), card = r("var(--card)"), fg = r("var(--foreground)"), muted = r("var(--muted-foreground)"), c1 = r("var(--chart-1)");
  const dark = fg[0] + fg[1] + fg[2] > card[0] + card[1] + card[2];
  return {
    palette: {
      ocean: rgb(mix(bg, c1, dark ? 0.1 : 0.06)), oceanEdge: rgb(mix(bg, c1, dark ? 0.22 : 0.15)), land: rgb(mix(card, fg, dark ? 0.06 : 0)),
      border: rgb(mix(card, fg, 0.3)), coast: rgb(mix(card, fg, 0.42)), ink: rgb(fg), ink2: rgb(muted), ink3: rgb(mix(muted, card, 0.3)),
      grid: rgb(fg, 0.06), glow: rgb(c1, dark ? 0.2 : 0.12), shade: dark ? "rgba(0,0,0,0.5)" : rgb(mix(fg, c1, 0.5), 0.16), panel: rgb(card), accent: rgb(fg),
    },
    relation: {
      customer: rgb(r(RELATION_COLOR.customer)), supplier: rgb(r(RELATION_COLOR.supplier)), partner: rgb(r(RELATION_COLOR.partner)),
      competitor: rgb(r(RELATION_COLOR.competitor)), focus: rgb(fg),
    },
    negative: rgb(r("var(--negative)")), hotspot: r("var(--negative)"), tint: c1,
  };
}

export interface SupplyGlobeProps {
  focus: GraphNode;
  graph: GraphNode[];
  hop2: HopNode[];
  visible: Set<Relation>;
  selected: string | null;
  onSelect: (key: string) => void;
  overlay: Overlay;
  risks: Record<string, NodeRisk>;
  impacts: Map<string, ShockImpact> | null;
  /** country exposure of the company, as shown in the World exposure panel */
  rows: CountryRow[];
  country: string | null;
  onCountry: (country: string | null) => void;
}

interface Tip { kind: "point" | "country"; x: number; y: number; title: string; lines: string[] }
type TipUpdate = Tip | null | ((t: Tip | null) => Tip | null);
/** The hover card keeps its own state: a pointer move updates this small element, not the whole globe component. */
const TipLayer = forwardRef<{ set: (t: TipUpdate) => void }, { width: () => number }>(function TipLayer({ width }, ref) {
  const [shown, setShown] = useState<Tip | null>(null);
  useImperativeHandle(ref, () => ({ set: setShown }), []);
  if (!shown) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lift"
      style={{ left: Math.max(8, Math.min(shown.x + 14, width() - 270)), top: Math.max(8, shown.y + 14) }}>
      <p className="font-medium">{shown.title}</p>
      {shown.lines.map((l, i) => <p key={i} className="text-muted-foreground">{l}</p>)}
    </div>
  );
});
const rowWeight = (r: CountryRow) => r.links + r.hq + r.facilities * 1.5 + r.policy;

export default function SupplyGlobe({ focus, graph, hop2, visible, selected, onSelect, overlay, risks, impacts, rows, country, onCountry }: SupplyGlobeProps) {
  const { data: hqFile, isLoading: hqLoading, isError: hqError, refetch: refetchHq } = useQuery(hqQuery);
  const hqMissing = !hqLoading && (hqError || !hqFile);
  const hq = useMemo(() => readHq(hqFile), [hqFile]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [flat, setFlat] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(null);
  const tipRef = useRef<{ set: (t: TipUpdate) => void }>(null);
  const setTip = useCallback((t: TipUpdate) => tipRef.current?.set(t), []);
  const [menu, setMenu] = useState<{ x: number; y: number; points: GlobePoint[] } | null>(null);
  const [showAllUnplaced, setShowAllUnplaced] = useState(false);
  const unplacedRef = useRef<HTMLDivElement>(null);
  /** set when the selection was made on the globe itself, so the camera is not moved under the pointer */
  const pickedHere = useRef(false);

  /* country names: the base map's spelling on one side, the page's canonical spelling on the other */
  const places = useMemo(() => {
    const byCanon = new Map<string, { atlas: string; at: [number, number] }>();
    for (const p of countryPlaces()) { const c = canonCountry(p.name); if (c && !byCanon.has(c)) byCanon.set(c, { atlas: p.name, at: p.at }); }
    return byCanon;
  }, []);
  const centroid = useCallback<Centroid>((c) => SMALL[c] ?? places.get(c)?.at ?? null, [places]);
  const canonOfAtlas = useMemo(() => new Map([...places].map(([canon, p]) => [p.atlas, canon])), [places]);

  const home = focus.ticker ? hq[focus.ticker] : undefined;
  const nodes = useMemo(() => [...graph, ...hop2].filter((n) => n.relation !== "focus" && visible.has(n.relation as Relation)), [graph, hop2, visible]);
  const { placed, unplaced } = useMemo(() => placeGraph(nodes, hq, centroid), [nodes, hq, centroid]);
  const placedByKey = useMemo(() => new Map(placed.map((p) => [p.key, p])), [placed]);
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
  const rowByCountry = useMemo(() => new Map(rows.map((r) => [r.country, r])), [rows]);

  /* ---------- engine lifetime ---------- */
  const handlers = useRef<{ onSelect: typeof onSelect; onCountry: typeof onCountry; country: string | null; placedByKey: typeof placedByKey; nodeByKey: typeof nodeByKey; risks: typeof risks; rowByCountry: typeof rowByCountry; canonOfAtlas: typeof canonOfAtlas; home: Hq | undefined; selected: string | null }>(null as never);
  handlers.current = { onSelect, onCountry, country, placedByKey, nodeByKey, risks, rowByCountry, canonOfAtlas, home, selected };
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const local = (clientX: number, clientY: number) => { const r = wrap.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top }; };
    const describe = (p: GlobePoint): string[] => {
      const h = handlers.current, at = h.placedByKey.get(p.key), node = h.nodeByKey.get(p.key), risk = h.risks[p.key];
      if (p.key === "focus") { const o = h.home; return [p.hub, o ? `${o.precision === "city" ? "Head office" : "Head-office country"} · ${SOURCE_LABEL[o.source]}` : "Head office"]; }
      const out: string[] = [];
      if (at) out.push(`${SINGULAR[at.relation]}${at.hop === 2 ? " of a direct link" : ""} · ${at.place}`, `${BASIS_LABEL[at.basis]}${at.source ? ` · ${SOURCE_LABEL[at.source]}` : ""}`);
      const share = node ? maxShare(node) : 0;
      if (share > 0) out.push(`${share}% stated share`);
      if (risk?.dollars != null) out.push(`${fmtCompactUsd(risk.dollars)} exposure`);
      if (risk?.singleSource) out.push("Single source");
      if (risk?.hotspots.length) out.push(`Hotspot: ${risk.hotspots.join(", ")}`);
      return out;
    };
    let engine: GlobeEngine;
    try {
      engine = new GlobeEngine(canvas, {
        onHover: (hit: GlobeHit | null, cx, cy) => {
          if (!hit) { setTip((t) => (t?.kind === "country" ? t : null)); return; }
          const { x, y } = local(cx, cy);
          if (hit.kind === "point") setTip({ kind: "point", x, y, title: hit.point.name, lines: describe(hit.point) });
          else setTip({ kind: "point", x, y, title: `${hit.points.length} names here`, lines: [...hit.points.slice(0, 6).map((p) => p.name), ...(hit.points.length > 6 ? [`and ${hit.points.length - 6} more`] : []), "Click to list them"] });
        },
        onPick: (p) => { setMenu(null); if (p.key !== "focus") { pickedHere.current = handlers.current.selected !== p.key; handlers.current.onSelect(p.key); } },
        onClusterMenu: (points, cx, cy) => { const { x, y } = local(cx, cy); setTip(null); setMenu({ x, y, points }); },
        onMove: () => { setMenu(null); setTip(null); },
        onCountry: (name, kind, cx, cy) => {
          const h = handlers.current, canon = name ? h.canonOfAtlas.get(name) ?? null : null;
          if (kind === "pick") { if (canon) h.onCountry(h.country === canon ? null : canon); return; }
          if (!canon) { setTip((t) => (t?.kind === "country" ? null : t)); return; }
          const row = h.rowByCountry.get(canon), { x, y } = local(cx, cy);
          if (!row) return;
          const lines = [`${row.links} link${row.links === 1 ? "" : "s"} name this country`];
          if (row.hq) lines.push(`${row.hq} counterpart${row.hq === 1 ? "y" : "ies"} based here`);
          if (row.facilities) lines.push(`${row.facilities} facilit${row.facilities === 1 ? "y" : "ies"} stated`);
          if (row.policy) lines.push(`${row.policy} policy item${row.policy === 1 ? "" : "s"}`);
          if (row.dollars > 0) lines.push(`${fmtCompactUsd(row.dollars)} stated exposure`);
          if (row.hotspot) lines.push("Geopolitical hotspot");
          lines.push("Click for the region detail below");
          setTip({ kind: "country", x, y, title: canon, lines });
        },
      });
    } catch {
      setFailed(true);
      return;
    }
    engineRef.current = engine;
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(wrap);
    const applyTheme = () => setTheme(readTheme());
    applyTheme();
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => { ro.disconnect(); mo.disconnect(); engine.destroy(); engineRef.current = null; };
  }, []);

  useEffect(() => { if (theme) engineRef.current?.setPalette(theme.palette); }, [theme]);
  const viewRef = useRef<{ lon: number; lat: number; zoom: number } | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setFlat(flat);
    /* the flat map shows the whole world at once, so centre it near the equator; the globe goes back to the company's side */
    const v = viewRef.current;
    if (v) { if (flat) engine.flyTo(v.lon, 14, 1, 500); else engine.flyTo(v.lon, v.lat, v.zoom, 500); }
  }, [flat]);

  /* ---------- scene ---------- */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !theme) return;
    const points: GlobePoint[] = [], arcs: GlobeArc[] = [], badges: GlobeBadge[] = [];
    const flagged = (key: string) => overlayHit(overlay, risks[key]);
    const dim = (p: Placed) => { const n = nodeByKey.get(p.key); return impacts != null && n != null && !impacts.has(impactKey(n)); };
    if (home) {
      points.push({ key: "focus", name: focus.name, hub: home.place, lon: home.lon, lat: home.lat, color: theme.relation.focus, weight: 4200, active: true, lead: true, hollow: home.precision !== "city", logo: focus.ticker ? logoUrl(focus.ticker) : undefined });
    }
    for (const p of placed) {
      const node = nodeByKey.get(p.key);
      const share = node ? maxShare(node) : 0, isDim = dim(p), hot = selected === p.key;
      points.push({
        key: p.key, name: p.name, hub: p.place, lon: p.lon, lat: p.lat,
        color: theme.relation[p.relation], weight: p.hop === 2 ? 60 : 220 + Math.min(share, 40) * 55, active: true, faded: isDim,
        logo: p.ticker ? logoUrl(p.ticker) ?? externalLogo(node?.domain ?? null, p.ticker) : externalLogo(node?.domain ?? null, null),
        hollow: p.basis !== "hq", ring: flagged(p.key) ? theme.negative : undefined,
      });
      const from = p.hop === 2 && p.parent ? placedByKey.get(p.parent) : null;
      const anchor: [number, number] | null = p.hop === 2 ? (from ? [from.lon, from.lat] : null) : home ? [home.lon, home.lat] : null;
      if (!anchor || p.relation === "focus") continue;
      const ends = arcEnds(p.relation, anchor, [p.lon, p.lat]);
      arcs.push({
        id: p.key, a: ends.a, b: ends.b, twoWay: ends.twoWay, plain: ends.plain,
        color: flagged(p.key) ? theme.negative : theme.relation[p.relation],
        dash: p.hop === 2 ? [2, 5] : p.relation === "competitor" ? [5, 5] : [],
        width: p.hop === 2 ? 1 : 1.3 + Math.min(share, 40) / 9,
        hot, dim: isDim || (selected != null && !hot),
      });
      if (p.hop === 1 && share >= 10) badges.push({ lon: p.lon, lat: p.lat, text: `${Math.round(share)}%`, key: p.key });
    }
    engine.setScene({ points, arcs, badges, selected });
  }, [theme, home, focus, placed, placedByKey, nodeByKey, selected, overlay, risks, impacts]);

  /* ---------- country tint ---------- */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !theme) return;
    const max = Math.max(1, ...rows.map(rowWeight));
    const fills: GlobeFill[] = [];
    for (const r of rows) {
      const atlas = places.get(r.country)?.atlas;
      if (!atlas || rowWeight(r) <= 0) continue;
      const strength = 0.1 + 0.42 * Math.sqrt(rowWeight(r) / max);
      fills.push({ name: atlas, color: rgb(r.hotspot ? theme.hotspot : theme.tint), alpha: r.country === country ? Math.min(0.85, strength + 0.3) : strength });
    }
    engine.setFills(fills);
  }, [theme, rows, places, country]);

  /* ---------- camera ---------- */
  const focusKey = focus.ticker ?? focus.name;
  const placedCount = placed.length;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !home) return;
    /* open on the side of the globe that shows the most of this company's links */
    const view = frameAll([[home.lon, home.lat], ...placed.filter((p) => p.hop === 1).map((p) => [p.lon, p.lat] as [number, number])]);
    viewRef.current = view;
    engine.setHome(view.lon, view.lat, view.zoom);
    /* a name already selected (picked in another view, or before the head offices arrived) is framed instead of the overview */
    const at = selected ? placedByKey.get(selected) : null;
    const anchor = at ? (at.hop === 2 && at.parent ? placedByKey.get(at.parent) ?? home : home) : null;
    if (at && anchor) engine.frame([anchor.lon, anchor.lat], [at.lon, at.lat]);
    else engine.flyTo(view.lon, view.lat, view.zoom, 900);
    setMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recentre when the company changes or its links arrive, not on every re-layout
  }, [focusKey, home?.lon, home?.lat, placedCount > 0]);
  useEffect(() => {
    const engine = engineRef.current, at = selected ? placedByKey.get(selected) : null;
    if (pickedHere.current) { pickedHere.current = false; return; }
    if (!engine || !at) return;
    const anchor = at.hop === 2 && at.parent ? placedByKey.get(at.parent) : home;
    if (anchor) engine.frame([anchor.lon, anchor.lat], [at.lon, at.lat]); else engine.flyTo(at.lon, at.lat, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the selection, not every re-layout
  }, [selected]);

  const jump = (key: string) => { if (key) onSelect(key); };
  /* the list of names at one place behaves like a small dialog: focus moves in, Escape closes it, focus goes back to the map */
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => { setMenu(null); canvasRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }, [menu]);
  const sorted = useMemo(() => [...placed].sort((a, b) => a.hop - b.hop || a.relation.localeCompare(b.relation) || a.name.localeCompare(b.name)), [placed]);
  const exact = placed.filter((p) => p.basis === "hq").length;
  const shownUnplaced = showAllUnplaced ? unplaced : unplaced.slice(0, 18);
  const control = "grid size-7 place-items-center rounded-md border bg-card text-muted-foreground shadow-paper transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div data-section="Supply globe" className="flex flex-col">
      <div ref={wrapRef} className="relative h-[440px] overflow-hidden sm:h-[580px]">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-roledescription="interactive map"
          aria-label={`Map of ${focus.name}'s named supply-chain links: ${placed.length} placed, ${unplaced.length} not placed. Arrow keys turn the map, plus and minus zoom, zero returns to the company. Use the "Jump to a name" list to pick a company.`}
          className="absolute inset-0 size-full touch-pan-y select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        />
        {failed && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">This browser could not start the map. The Network view shows the same links.</p>}
        {!failed && hqMissing && (
          <p role="alert" className="absolute inset-x-0 top-14 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-md border bg-card px-3 py-2 text-center text-xs text-muted-foreground shadow-paper">
            Head-office positions could not be loaded, so nothing can be placed yet.
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void refetchHq()}>Retry</button>
          </p>
        )}
        {!failed && !hqLoading && !hqMissing && !home && (
          <p className="pointer-events-none absolute inset-x-0 top-14 mx-auto w-fit max-w-[90%] rounded-md border bg-card px-3 py-2 text-center text-xs text-muted-foreground shadow-paper">
            No head office on file for {focus.name}, so links are shown without arcs from the company.
          </p>
        )}

        <div className="absolute left-3 top-3 flex max-w-[60%] flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="supply-globe-jump">Jump to a name on the map</label>
          <select id="supply-globe-jump" value={selected && placedByKey.has(selected) ? selected : ""} onChange={(e) => jump(e.target.value)}
            className="h-7 max-w-[220px] rounded-md border bg-card px-2 text-xs shadow-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">Jump to a name ({placed.length})</option>
            {(["supplier", "customer", "partner", "competitor"] as const).map((r) => {
              const list = sorted.filter((p) => p.relation === r);
              return list.length ? <optgroup key={r} label={RELATION_LABEL[r]}>{list.map((p) => <option key={p.key} value={p.key}>{p.hop === 2 ? "· " : ""}{p.name} ({p.place})</option>)}</optgroup> : null;
            })}
          </select>
        </div>

        <div role="group" aria-label="Map controls" data-agent-controls className="absolute right-3 top-3 flex flex-col gap-1.5">
          <button type="button" className={control} aria-label="Zoom in" title="Zoom in (or Ctrl + scroll)" onClick={() => engineRef.current?.zoomBy(1.7)}><Plus className="size-3.5" /></button>
          <button type="button" className={control} aria-label="Zoom out" title="Zoom out (or Ctrl + scroll)" onClick={() => engineRef.current?.zoomBy(1 / 1.7)}><Minus className="size-3.5" /></button>
          <button type="button" className={control} aria-label="Back to the company" title="Back to the company" onClick={() => engineRef.current?.reset()}><RotateCcw className="size-3.5" /></button>
          <button type="button" className={control} aria-pressed={flat} aria-label={flat ? "Show as a globe" : "Show as a flat map"} title={flat ? "Show as a globe" : "Show as a flat map"} onClick={() => setFlat((f) => !f)}>
            {flat ? <Globe2 className="size-3.5" /> : <MapIcon className="size-3.5" />}
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-paper backdrop-blur-sm">
          {(["supplier", "customer", "partner", "competitor"] as const).filter((r) => visible.has(r)).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: RELATION_COLOR[r] }} />{RELATION_LABEL[r]}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" />head office</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border-[1.5px] border-muted-foreground" />country only</span>
          <span>arrow = direction of supply</span>
        </div>

        <TipLayer ref={tipRef} width={() => wrapRef.current?.clientWidth ?? 600} />
        {menu && (
          <div ref={menuRef} role="dialog" aria-label="Names at this place" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } }} className="absolute z-20 w-60 rounded-md border bg-popover p-1.5 text-xs text-popover-foreground shadow-lift"
            style={{ left: Math.max(8, Math.min(menu.x, (wrapRef.current?.clientWidth ?? 600) - 250)), top: Math.max(8, Math.min(menu.y, (wrapRef.current?.clientHeight ?? 500) - 40 - Math.min(menu.points.length, 10) * 28)) }}>
            <p className="px-1.5 pb-1 text-muted-foreground">{menu.points.length} names here</p>
            <ul className="flex flex-col">
              {menu.points.slice(0, 10).map((p) => (
                <li key={p.key}>
                  <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => { closeMenu(); if (p.key !== "focus") { pickedHere.current = selected !== p.key; onSelect(p.key); } }}>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {menu.points.length > 10 && <p className="px-1.5 pt-1 text-muted-foreground">and {menu.points.length - 10} more: zoom in to separate them</p>}
            <button type="button" className="mt-1 w-full rounded px-1.5 py-1 text-left text-muted-foreground hover:bg-accent" onClick={closeMenu}>Close</button>
          </div>
        )}
      </div>

      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        <p>
          <span className="num text-foreground">{placed.length}</span> of <span className="num">{placed.length + unplaced.length}</span> names on the map
          {placed.length > 0 && <> · <span className="num">{exact}</span> at their head office, <span className="num">{placed.length - exact}</span> at country level</>}
          {hqFile?.generatedAt && <> · head offices as of {fmtDate(hqFile.generatedAt)} (source on hover)</>}
        </p>
        {unplaced.length > 0 && (
          <div ref={unplacedRef} className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span>Not placed (no single location on record):</span>
            {shownUnplaced.map((u) => (
              <button key={u.key} type="button" title={`${u.name}: ${u.why}. Open the filing evidence.`} aria-pressed={selected === u.key} onClick={() => onSelect(u.key)}
                className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-foreground hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === u.key && "ring-2 ring-highlight")}>
                <span className="size-1.5 rounded-full" style={{ background: RELATION_COLOR[u.relation] }} />{u.name}
              </button>
            ))}
            {unplaced.length > shownUnplaced.length && <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => {
              setShowAllUnplaced(true);
              /* keep keyboard focus: move it to the first name that was hidden */
              const at = shownUnplaced.length;
              requestAnimationFrame(() => unplacedRef.current?.querySelectorAll<HTMLButtonElement>("button")[at]?.focus());
            }}>and {unplaced.length - shownUnplaced.length} more</button>}
          </div>
        )}
      </div>
    </div>
  );
}
