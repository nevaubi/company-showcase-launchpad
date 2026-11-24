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
import { maxShare, NOT_TRADE, type GraphNode, type HopNode, type NodeRisk, type Relation, type ShockImpact } from "@/lib/supply/core";
import type { IsolateProps } from "@/lib/supply/isolate-contract";
import { arcEnds, BASIS_LABEL, frameAll, placeGraph, readHq, SOURCE_LABEL, type Centroid, type Hq, type HqFile, type Placed } from "@/lib/supply/geo";
import { nodeFacts, type NodeFacts } from "@/lib/supply/describe";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { countryPlaces, GlobeEngine, type GlobeArc, type GlobeBadge, type GlobeBox, type GlobeFill, type GlobeHit, type GlobePalette, type GlobePoint } from "./globe/engine";
import { externalLogo, impactOf, overlayHit, RELATION_COLOR, RELATION_DASH, RELATION_LABEL, RELATION_ORDER, RELATION_SHAPE, type Overlay } from "./supply-map-meta";
import { LineSample, NodeHoverCard, RelationMark } from "./supply-marks";

export const hqQuery = { queryKey: ["analytics", "hq"], queryFn: () => analyticsFile<HqFile>("hq.json"), staleTime: 24 * 60 * 60_000 };

/** Places too small to have a shape in the base map. */
const SMALL: Record<string, [number, number]> = { Singapore: [103.82, 1.35], "Hong Kong": [114.17, 22.32], Luxembourg: [6.13, 49.61], Malta: [14.4, 35.9], Bermuda: [-64.75, 32.3], "Cayman Islands": [-81.25, 19.31], Macau: [113.55, 22.16] };

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
      ocean: rgb(mix(bg, c1, dark ? 0.1 : 0.05)), land: rgb(mix(card, fg, dark ? 0.06 : 0)), rim: rgb(mix(card, fg, dark ? 0.3 : 0.22)),
      border: rgb(mix(card, fg, 0.3)), coast: rgb(mix(card, fg, 0.42)), ink: rgb(fg), ink2: rgb(muted), ink3: rgb(mix(muted, card, 0.3)),
      grid: rgb(fg, 0.05), panel: rgb(card), accent: rgb(fg),
    },
    relation: {
      customer: rgb(r(RELATION_COLOR.customer)), supplier: rgb(r(RELATION_COLOR.supplier)), partner: rgb(r(RELATION_COLOR.partner)),
      competitor: rgb(r(RELATION_COLOR.competitor)), focus: rgb(fg),
    },
    negative: rgb(r("var(--negative)")), hotspot: r("var(--negative)"), tint: c1,
  };
}

export interface SupplyGlobeProps extends IsolateProps {
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

type Tip =
  | { kind: "node"; x: number; y: number; name: string; facts: NodeFacts; place: string; basis: string; picked: boolean; shock: string | null }
  | { kind: "point" | "country"; x: number; y: number; title: string; lines: string[]; marks?: { relation: Relation; name: string }[] };
type TipUpdate = Tip | null | ((t: Tip | null) => Tip | null);
/** The hover card keeps its own state: a pointer move updates this small element, not the whole globe component. */
const TipLayer = forwardRef<{ set: (t: TipUpdate) => void }, { size: () => { w: number; h: number } }>(function TipLayer({ size }, ref) {
  const [shown, setShown] = useState<Tip | null>(null);
  useImperativeHandle(ref, () => ({ set: setShown }), []);
  if (!shown) return null;
  const { w, h } = size();
  const left = Math.max(8, Math.min(shown.x + 16, w - 296));
  /* below the pointer when there is room, otherwise above it */
  const pos = shown.y < h - 260 ? { left, top: Math.max(8, shown.y + 16) } : { left, bottom: Math.max(8, h - shown.y + 16) };
  if (shown.kind === "node") return <NodeHoverCard name={shown.name} facts={shown.facts} place={shown.place} basis={shown.basis} shock={shown.shock} className="absolute" style={pos} action={shown.picked ? "Evidence is open" : "Click for the sentence"} />;
  return (
    <div aria-hidden="true" data-supply-tip="" className="pointer-events-none absolute z-20 w-[260px] rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-lift" style={pos}>
      <p className="text-[13px] font-semibold leading-snug">{shown.title}</p>
      {shown.marks && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {shown.marks.map((m, i) => <li key={i} className="flex min-w-0 items-center gap-1.5"><RelationMark relation={m.relation} size={8} /><span className="truncate">{m.name}</span></li>)}
        </ul>
      )}
      {shown.lines.map((l, i) => <p key={i} className={cn("text-muted-foreground", i === shown.lines.length - 1 && shown.lines.length > 1 ? "mt-1.5 border-t pt-1.5 text-foreground" : "mt-0.5")}>{l}</p>)}
    </div>
  );
});
const SEVERITY: Record<ShockImpact["severity"], string> = { high: "High impact", medium: "Medium impact", low: "Low impact" };
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
  const handlers = useRef<{ onSelect: typeof onSelect; onCountry: typeof onCountry; country: string | null; placedByKey: typeof placedByKey; nodeByKey: typeof nodeByKey; risks: typeof risks; rowByCountry: typeof rowByCountry; canonOfAtlas: typeof canonOfAtlas; home: Hq | undefined; selected: string | null; impacts: typeof impacts }>(null as never);
  handlers.current = { onSelect, onCountry, country, placedByKey, nodeByKey, risks, rowByCountry, canonOfAtlas, home, selected, impacts };
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const local = (clientX: number, clientY: number) => { const r = wrap.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top }; };
    /** The hover card for one marker: the same card the Network view shows, plus where the name sits and why. */
    const describe = (p: GlobePoint, x: number, y: number): Tip => {
      const h = handlers.current, at = h.placedByKey.get(p.key), node = h.nodeByKey.get(p.key);
      if (p.key === "focus" || !node || !at) {
        const o = h.home;
        return { kind: "point", x, y, title: p.name, lines: [p.hub, o ? `${o.precision === "city" ? "Head office" : "Head-office country"} · ${SOURCE_LABEL[o.source]}` : "Head office", "The company this map is about"] };
      }
      const hit = impactOf(h.impacts, node);
      const shock = h.impacts ? (hit ? `${SEVERITY[hit.severity]}${hit.revenuePct != null ? `, ${(hit.revenuePct * 100).toFixed(1)}% of revenue at risk` : ""}` : "Not reached by the shock") : null;
      return { kind: "node", x, y, name: p.name, facts: nodeFacts(node, h.risks[p.key]), place: at.place, basis: `${BASIS_LABEL[at.basis]}${at.source ? `, ${SOURCE_LABEL[at.source]}` : ""}`, picked: h.selected === p.key, shock };
    };
    let engine: GlobeEngine;
    try {
      engine = new GlobeEngine(canvas, {
        onHover: (hit: GlobeHit | null, cx, cy) => {
          if (!hit) { setTip((t) => (t?.kind === "country" ? t : null)); return; }
          const { x, y } = local(cx, cy);
          if (hit.kind === "point") { setTip(describe(hit.point, x, y)); return; }
          const nodes = handlers.current.nodeByKey;
          const marks = hit.points.slice(0, 8).map((p) => ({ relation: (nodes.get(p.key)?.relation ?? "supplier") as Relation, name: p.key === "focus" ? `${p.name} (this company)` : p.name }));
          setTip({ kind: "point", x, y, title: `${hit.points.length} names here`, marks, lines: [...(hit.points.length > 8 ? [`and ${hit.points.length - 8} more`] : []), "Click to list them or zoom in"] });
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
          if (row.dollars > 0) lines.push(`${fmtCompactUsd(row.dollars)} stated flows`);
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
    const dim = (p: Placed) => { const n = nodeByKey.get(p.key); return impacts != null && n != null && !impactOf(impacts, n); };
    if (home) {
      points.push({ key: "focus", name: focus.name, hub: home.place, lon: home.lon, lat: home.lat, color: theme.relation.focus, weight: 4200, active: true, lead: true, hollow: home.precision !== "city", logo: focus.ticker ? logoUrl(focus.ticker) : undefined, shape: "circle" });
    }
    for (const p of placed) {
      const node = nodeByKey.get(p.key);
      const share = node ? maxShare(node) : 0, isDim = dim(p), hot = selected === p.key;
      points.push({
        key: p.key, name: p.name, hub: p.place, lon: p.lon, lat: p.lat,
        color: theme.relation[p.relation], weight: p.hop === 2 ? 60 : 220 + Math.min(share, 40) * 55, active: true, faded: isDim,
        logo: p.ticker ? logoUrl(p.ticker) ?? externalLogo(node?.domain ?? null, p.ticker) : externalLogo(node?.domain ?? null, null),
        hollow: p.basis !== "hq", ring: flagged(p.key) ? theme.negative : undefined, shape: p.relation === "focus" ? "circle" : RELATION_SHAPE[p.relation],
      });
      const from = p.hop === 2 && p.parent ? placedByKey.get(p.parent) : null;
      const anchor: [number, number] | null = p.hop === 2 ? (from ? [from.lon, from.lat] : null) : home ? [home.lon, home.lat] : null;
      if (!anchor || p.relation === "focus") continue;
      const ends = arcEnds(p.relation, anchor, [p.lon, p.lat]);
      /* financing, acquisitions and regulators are ties, not flows: a thin dashed line with no direction marks */
      const notTrade = NOT_TRADE.has(risks[p.key]?.nature ?? "trade");
      arcs.push({
        id: p.key, a: ends.a, b: ends.b, twoWay: notTrade ? false : ends.twoWay, plain: notTrade || ends.plain,
        color: flagged(p.key) ? theme.negative : theme.relation[p.relation],
        dash: notTrade ? [2, 4] : p.hop === 2 ? [2, 5] : RELATION_DASH[p.relation],
        width: p.hop === 2 || notTrade ? 1 : 1.3 + Math.min(share, 40) / 9,
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
  const control = "grid size-8 place-items-center text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none";

  /* names drawn on the canvas keep clear of the controls laid over it */
  const jumpRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const base = wrap.getBoundingClientRect();
      const boxes: GlobeBox[] = [];
      for (const el of [jumpRef.current, controlsRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        boxes.push({ x: r.left - base.left - 4, y: r.top - base.top - 4, w: r.width + 8, h: r.height + 8 });
      }
      engineRef.current?.setReserved(boxes);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    if (jumpRef.current) ro.observe(jumpRef.current);
    measure();
    return () => ro.disconnect();
  }, [failed]);

  const visibleRelations = RELATION_ORDER.filter((r) => visible.has(r));

  return (
    <div data-section="Supply globe" className="flex flex-col">
      <div ref={wrapRef} className="relative h-[440px] overflow-hidden sm:h-[580px]">
        <p id="supply-globe-help" className="sr-only">
          Arrow keys turn the map, plus and minus zoom, zero returns to the company. Use the list of names above the map to pick a company; the names that could not be placed are listed below it.
        </p>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-roledescription="interactive map"
          aria-label={`Map of ${focus.name}'s named supply-chain links: ${placed.length} placed, ${unplaced.length} not placed.`}
          aria-describedby="supply-globe-help"
          className="absolute inset-0 size-full touch-pan-y select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        />
        {failed && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">This browser could not start the map. The Network view shows the same links.</p>}
        {!failed && hqMissing && (
          <p role="alert" className="absolute inset-x-0 top-14 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-md border bg-card px-3 py-2 text-center text-xs text-muted-foreground shadow-paper">
            Head-office positions could not be loaded, so nothing can be placed yet.
            <button type="button" className="inline-flex min-h-6 items-center underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void refetchHq()}>Retry</button>
          </p>
        )}
        {!failed && !hqLoading && !hqMissing && !home && (
          <p className="pointer-events-none absolute inset-x-0 top-14 mx-auto w-fit max-w-[90%] rounded-md border bg-card px-3 py-2 text-center text-xs text-muted-foreground shadow-paper">
            No head office on file for {focus.name}, so links are shown without arcs from the company.
          </p>
        )}

        <div ref={jumpRef} className="absolute left-3 top-3 max-w-[calc(100%-5.5rem)]">
          <label className="sr-only" htmlFor="supply-globe-jump">Jump to a name on the map</label>
          <select id="supply-globe-jump" value={selected && placedByKey.has(selected) ? selected : ""} onChange={(e) => jump(e.target.value)}
            className="h-8 w-[240px] max-w-full rounded-md border bg-card px-2 text-xs shadow-paper transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">Jump to a name ({placed.length} on the map)</option>
            {RELATION_ORDER.map((r) => {
              const list = sorted.filter((p) => p.relation === r);
              return list.length ? <optgroup key={r} label={`${RELATION_LABEL[r]} (${list.length})`}>{list.map((p) => <option key={p.key} value={p.key}>{p.hop === 2 ? "· " : ""}{p.name} · {p.place}</option>)}</optgroup> : null;
            })}
          </select>
        </div>

        <div ref={controlsRef} role="group" aria-label="Map controls" data-agent-controls className="absolute right-3 top-3 flex flex-col divide-y overflow-hidden rounded-md border bg-card shadow-paper">
          <button type="button" className={control} aria-label="Zoom in" title="Zoom in (or Ctrl + scroll)" onClick={() => engineRef.current?.zoomBy(1.7)}><Plus className="size-3.5" /></button>
          <button type="button" className={control} aria-label="Zoom out" title="Zoom out (or Ctrl + scroll)" onClick={() => engineRef.current?.zoomBy(1 / 1.7)}><Minus className="size-3.5" /></button>
          <button type="button" className={control} aria-label="Back to the company" title="Back to the company" onClick={() => engineRef.current?.reset()}><RotateCcw className="size-3.5" /></button>
          <button type="button" className={control} aria-pressed={flat} aria-label={flat ? "Show as a globe" : "Show as a flat map"} title={flat ? "Show as a globe" : "Show as a flat map"} onClick={() => setFlat((f) => !f)}>
            {flat ? <Globe2 className="size-3.5" /> : <MapIcon className="size-3.5" />}
          </button>
        </div>

        <TipLayer ref={tipRef} size={() => ({ w: wrapRef.current?.clientWidth ?? 600, h: wrapRef.current?.clientHeight ?? 500 })} />
        {menu && (
          <div ref={menuRef} role="dialog" aria-label="Names at this place" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } }} className="absolute z-30 w-64 rounded-md border bg-popover p-1.5 text-xs text-popover-foreground shadow-lift"
            style={{ left: Math.max(8, Math.min(menu.x, (wrapRef.current?.clientWidth ?? 600) - 264)), top: Math.max(8, Math.min(menu.y, (wrapRef.current?.clientHeight ?? 500) - 48 - Math.min(menu.points.length, 10) * 30)) }}>
            <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">{menu.points.length} names here</p>
            <ul className="flex flex-col">
              {menu.points.slice(0, 10).map((p) => {
                const rel = nodeByKey.get(p.key)?.relation;
                return (
                  <li key={p.key}>
                    <button type="button" className="flex h-7 w-full items-center gap-2 rounded px-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => { closeMenu(); if (p.key !== "focus") { pickedHere.current = selected !== p.key; onSelect(p.key); } }}>
                      {rel && rel !== "focus" ? <RelationMark relation={rel} size={8} /> : <span className="size-2 shrink-0 rounded-full bg-foreground" />}
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {rel && rel !== "focus" && <span className="shrink-0 text-[11px] text-muted-foreground">{RELATION_LABEL[rel].slice(0, -1).toLowerCase()}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {menu.points.length > 10 && <p className="px-2 pt-1 text-[11px] text-muted-foreground">and {menu.points.length - 10} more: zoom in to separate them</p>}
            <button type="button" className="mt-1 flex h-7 w-full items-center rounded px-2 text-left text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={closeMenu}>Close</button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t px-4 py-3 text-[11px] text-muted-foreground">
        <ul aria-label="Map key" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {visibleRelations.map((r) => (
            <li key={r} className="inline-flex items-center gap-1.5">
              <RelationMark relation={r} size={10} /><LineSample relation={r} width={18} />
              <span className="text-foreground">{RELATION_LABEL[r]}</span>
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5"><RelationMark relation="supplier" size={10} className="[&_path]:fill-muted-foreground [&_path]:stroke-muted-foreground" />head office</li>
          <li className="inline-flex items-center gap-1.5"><RelationMark relation="supplier" size={10} hollow className="[&_path]:stroke-muted-foreground" />country only</li>
          <li>arrows point the way goods and services move; partnerships run both ways</li>
          {impacts && <li className="text-foreground">Shock view: names the simulated shock does not reach are drawn pale</li>}
        </ul>
        <p>
          <span className="tabular-nums text-foreground">{placed.length}</span> of <span className="tabular-nums">{placed.length + unplaced.length}</span> names on the map
          {placed.length > 0 && <> · <span className="tabular-nums">{exact}</span> at their head office, <span className="tabular-nums">{placed.length - exact}</span> at country level</>}
          {hqFile?.generatedAt && <> · head offices as of {fmtDate(hqFile.generatedAt)}, source on hover</>}
        </p>
        {unplaced.length > 0 && (
          <div ref={unplacedRef} role="group" aria-label="Names not placed on the map" className="flex flex-wrap items-center gap-1.5">
            <span>Not placed, no single location on record:</span>
            {shownUnplaced.map((u) => (
              <button key={u.key} type="button" title={`${u.name}: ${u.why}`} aria-label={`${u.name}, ${u.relation === "focus" ? "this company" : RELATION_LABEL[u.relation].slice(0, -1).toLowerCase()}, not placed: ${u.why}. Open the filing evidence.`} aria-pressed={selected === u.key} onClick={() => onSelect(u.key)}
                className={cn("inline-flex h-6 items-center gap-1.5 rounded border bg-card px-2 text-foreground shadow-paper transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", selected === u.key && "border-foreground ring-1 ring-foreground")}>
                {u.relation !== "focus" && <RelationMark relation={u.relation} size={8} />}{u.name}
              </button>
            ))}
            {unplaced.length > shownUnplaced.length && <button type="button" className="inline-flex h-6 items-center underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
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
