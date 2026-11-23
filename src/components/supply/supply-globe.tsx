// Globe view of the supply-chain page. The company sits at its head office; every named supplier, customer,
// partner and competitor that can be placed is drawn where it is based, as its logo, with an arc for the direction
// goods and services move. Arc width follows the same stated dollars (or stated share) as the Network view's bands.
// Countries are tinted by how often the filings tie the company to them. Nothing is placed by guesswork: names
// without a known location are listed under the map.
//
// Isolation (suppliers only, customers only, one pathway) is owned by the page: this view draws the set it is given
// (`isolate`), frames it, captions it and raises requests through `onIsolate` (legend chips, the selected name's bar,
// Escape). See src/lib/supply/isolate-contract.ts.
//
// Wheel and touch never fight the page: a plain wheel scrolls the page until the map has been pressed (then it zooms
// toward the pointer, and never hands a zoom limit on to the page) and again once the pointer leaves the map; Ctrl or
// ⌘ + wheel and two fingers always zoom; one finger pans the page until a tap has engaged the map.
// Browser-only (canvas): the route loads this file lazily inside <ClientOnly>.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crosshair, Globe2, Map as MapIcon, Minus, Plus, RotateCcw, Waypoints, X } from "lucide-react";
import { CompanyLogo, logoUrl } from "@/components/app/company-logo";
import { analyticsFile } from "@/lib/analytics-files";
import { canonCountry, type CountryRow } from "@/lib/supply/analytics";
import { maxShare, NOT_TRADE, type GraphNode, type HopNode, type NodeRisk, type Relation, type RiskLink, type ShockImpact } from "@/lib/supply/core";
import type { IsolateProps, IsolateRequest } from "@/lib/supply/isolate-contract";
import { arcEnds, BASIS_LABEL, placeGraph, readHq, SOURCE_LABEL, statedPlaces, US_STATE_PLACES, US_STATES, type Centroid, type Hq, type HqFile, type Placed } from "@/lib/supply/geo";
import { isTradeNode, nodeFacts, type NodeFacts } from "@/lib/supply/describe";
import { sideBasis, type Basis } from "@/lib/supply/network-layout";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { flowWidth } from "./globe/arcs";
import { countryPlaces, GlobeEngine, type GlobeArc, type GlobeBox, type GlobeFill, type GlobeHit, type GlobePalette, type GlobePoint, type GlobeRegionLabel } from "./globe/engine";
import { externalLogo, impactOf, overlayHit, RELATION_COLOR, RELATION_DASH, RELATION_LABEL, RELATION_ONE, RELATION_ORDER, RELATION_SHAPE, type Overlay } from "./supply-map-meta";
import { LineSample, NodeHoverCard, RelationMark } from "./supply-marks";

export const hqQuery = { queryKey: ["analytics", "hq"], queryFn: () => analyticsFile<HqFile>("hq.json"), staleTime: 24 * 60 * 60_000 };

/** Places too small to have a shape in the base map. */
const SMALL: Record<string, [number, number]> = { Singapore: [103.82, 1.35], "Hong Kong": [114.17, 22.32], Luxembourg: [6.13, 49.61], Malta: [14.4, 35.9], Bermuda: [-64.75, 32.3], "Cayman Islands": [-81.25, 19.31], Macau: [113.55, 22.16] };
/** U.S. state names for the map, written once it is close enough to hold them. */
const STATE_LABELS: GlobeRegionLabel[] = Object.entries(US_STATE_PLACES).filter(([code]) => code !== "DC").map(([code, [lat, lon, km]]) => ({ name: US_STATES[code], short: code, lon, lat, size: km / 6371 }));

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
      ocean: rgb(mix(bg, c1, dark ? 0.12 : 0.07)), land: rgb(mix(card, fg, dark ? 0.07 : 0)), rim: rgb(mix(card, fg, dark ? 0.32 : 0.24)),
      border: rgb(mix(card, fg, dark ? 0.26 : 0.2)), coast: rgb(mix(card, fg, dark ? 0.42 : 0.36)), ink: rgb(fg), ink2: rgb(muted), ink3: rgb(mix(muted, card, 0.32)),
      grid: rgb(fg, dark ? 0.07 : 0.06), panel: rgb(card), accent: rgb(fg), plate: rgb(r("var(--logo-plate)")),
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
  | { kind: "point" | "country"; x: number; y: number; title: string; lines: string[]; marks?: { relation: Relation | "focus"; name: string }[] };
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
          {shown.marks.map((m, i) => <li key={i} className="flex min-w-0 items-center gap-1.5">{m.relation === "focus" ? <span className="size-2 shrink-0 rounded-full bg-foreground" /> : <RelationMark relation={m.relation} size={8} />}<span className="truncate">{m.name}</span></li>)}
        </ul>
      )}
      {shown.lines.map((l, i) => <p key={i} className={cn("text-muted-foreground", i === shown.lines.length - 1 && shown.lines.length > 1 ? "mt-1.5 border-t pt-1.5 text-foreground" : "mt-0.5")}>{l}</p>)}
    </div>
  );
});
const SEVERITY: Record<ShockImpact["severity"], string> = { high: "High impact", medium: "Medium impact", low: "Low impact" };
const rowWeight = (r: CountryRow) => r.links + r.hq + r.facilities * 1.5 + r.policy;
const WIDTH_TEXT: Record<Basis, string> = { dollars: "stated dollars", share: "stated share", none: "" };
const relationWord = (r: Relation | "focus") => (r === "focus" ? "this company" : RELATION_ONE[r].toLowerCase());
const isHop = (n: GraphNode | HopNode): n is HopNode => (n as HopNode).hop === 2;
/**
 * Initials plate for a name without a ticker. The trailing space keeps the logo lookup from landing on a covered
 * company whose ticker happens to spell the same letters: OpenAI is not Opendoor (OPEN), Hon Hai is not Honeywell (HON).
 */
const plateKey = (name: string) => `${name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()} `;

export default function SupplyGlobe({ focus, graph, hop2, visible, selected, onSelect, overlay, risks, impacts, rows, country, onCountry, isolate, isolateLabel, onIsolate }: SupplyGlobeProps) {
  const { data: hqFile, isLoading: hqLoading, isError: hqError, refetch: refetchHq } = useQuery(hqQuery);
  const hqMissing = !hqLoading && (hqError || !hqFile);
  const hq = useMemo(() => readHq(hqFile), [hqFile]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [flat, setFlat] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [wheelHint, setWheelHint] = useState(false);
  const tipRef = useRef<{ set: (t: TipUpdate) => void }>(null);
  const setTip = useCallback((t: TipUpdate) => tipRef.current?.set(t), []);
  const [menu, setMenu] = useState<{ x: number; y: number; points: GlobePoint[]; title: string } | null>(null);
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
  const lit = useCallback((key: string) => !isolate || isolate.has(key), [isolate]);

  /* what a link's width stands for on each side: the same choice the Network view makes for its bands */
  const sides = useMemo(() => {
    const out = {} as Record<Relation, { basis: Basis; max: number; value: (key: string) => number }>;
    for (const r of RELATION_ORDER) {
      const cards = graph.filter((n) => n.relation === r).map((n) => ({ key: n.key, dollars: risks[n.key]?.dollars ?? null, share: maxShare(n), trade: isTradeNode(n) }));
      const basis: Basis = r === "supplier" || r === "customer" ? sideBasis(cards) : "none";
      const values = new Map(cards.map((c) => [c.key, !c.trade ? 0 : basis === "dollars" ? c.dollars ?? 0 : basis === "share" ? c.share : 0]));
      out[r] = { basis, max: Math.max(0, ...values.values()), value: (key) => values.get(key) ?? 0 };
    }
    return out;
  }, [graph, risks]);

  /* ---------- engine lifetime ---------- */
  const handlers = useRef<{ onSelect: typeof onSelect; onCountry: typeof onCountry; country: string | null; placedByKey: typeof placedByKey; nodeByKey: typeof nodeByKey; risks: typeof risks; rowByCountry: typeof rowByCountry; canonOfAtlas: typeof canonOfAtlas; home: Hq | undefined; selected: string | null; impacts: typeof impacts }>(null as never);
  handlers.current = { onSelect, onCountry, country, placedByKey, nodeByKey, risks, rowByCountry, canonOfAtlas, home, selected, impacts };
  useEffect(() => {
    const canvas = canvasRef.current, base = baseRef.current, wrap = wrapRef.current;
    if (!canvas || !base || !wrap) return;
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
    const listed = (points: GlobePoint[]) => {
      const byKey = handlers.current.nodeByKey;
      return points.slice(0, 8).map((p) => ({ relation: (byKey.get(p.key)?.relation ?? "focus") as Relation | "focus", name: p.key === "focus" ? `${p.name} (this company)` : p.name }));
    };
    const more = (n: number) => (n > 8 ? [`and ${n - 8} more`] : []);
    let hintTimer = 0;
    let engine: GlobeEngine;
    try {
      engine = new GlobeEngine(canvas, base, {
        onHover: (hit: GlobeHit | null, cx, cy) => {
          if (!hit) { setTip((t) => (t?.kind === "country" ? t : null)); return; }
          const { x, y } = local(cx, cy);
          if (hit.kind === "point") { setTip(describe(hit.point, x, y)); return; }
          const n = hit.points.length;
          if (hit.kind === "cluster") setTip({ kind: "point", x, y, title: `${n} names here`, marks: listed(hit.points), lines: [...more(n), "Click to zoom in, or to list them"] });
          else if (hit.kind === "arc") setTip({ kind: "point", x, y, title: `${n} links drawn as one`, marks: listed(hit.points), lines: [...more(n), "Click to list them; zoom in to separate them"] });
          else setTip({ kind: "point", x, y, title: `${n} ${n === 1 ? "name" : "names"} beyond the horizon`, marks: listed(hit.points), lines: [...more(n), "Click to turn the globe to them"] });
        },
        onPick: (p) => { setMenu(null); if (p.key !== "focus") { pickedHere.current = handlers.current.selected !== p.key; handlers.current.onSelect(p.key); } },
        onClusterMenu: (points, cx, cy) => { const { x, y } = local(cx, cy); setTip(null); setMenu({ x, y, points, title: `${points.length} names here` }); },
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
        onEngage: (on) => { setEngaged(on); if (on) setWheelHint(false); },
        onWheelPassed: () => { setWheelHint(true); window.clearTimeout(hintTimer); hintTimer = window.setTimeout(() => setWheelHint(false), 1800); },
      });
    } catch {
      setFailed(true);
      return;
    }
    engineRef.current = engine;
    engine.setRegions(STATE_LABELS);
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(wrap);
    const applyTheme = () => setTheme(readTheme());
    applyTheme();
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => { window.clearTimeout(hintTimer); ro.disconnect(); mo.disconnect(); engine.destroy(); engineRef.current = null; };
  }, [setTip]);

  useEffect(() => { if (theme) engineRef.current?.setPalette(theme.palette); }, [theme]);

  /* ---------- scene ---------- */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !theme) return;
    const points: GlobePoint[] = [], arcs: GlobeArc[] = [];
    const flagged = (key: string) => overlayHit(overlay, risks[key]);
    const outside = (p: Placed) => { const n = nodeByKey.get(p.key); return impacts != null && n != null && !impactOf(impacts, n); };
    if (home) {
      const mark = focus.ticker ? logoUrl(focus.ticker) : undefined;
      points.push({ key: "focus", name: focus.name, hub: home.place, lon: home.lon, lat: home.lat, color: theme.relation.focus, weight: 1, lead: true, approx: home.precision !== "city", logo: mark, logoTrusted: !!mark, shape: "circle" });
    }
    for (const p of placed) {
      if (p.relation === "focus") continue;
      const node = nodeByKey.get(p.key), side = sides[p.relation];
      const value = p.hop === 1 ? side.value(p.key) : 0, share = node ? maxShare(node) : 0;
      const weight = value > 0 && side.max > 0 ? Math.sqrt(value / side.max) : 0;
      const dim = !lit(p.key), faded = outside(p);
      /* a covered company's bundled mark; otherwise a logo looked up by domain, good enough for its own badge */
      const mark = p.ticker ? logoUrl(p.ticker) : undefined;
      points.push({
        key: p.key, name: p.name, hub: p.place, lon: p.lon, lat: p.lat,
        color: theme.relation[p.relation], weight, faded, dim,
        logo: mark ?? externalLogo(node?.domain ?? null, p.ticker), logoTrusted: !!mark,
        approx: p.basis !== "hq", ring: flagged(p.key) ? theme.negative : undefined, shape: RELATION_SHAPE[p.relation],
        /* the figure behind the width, written as the Network cards write it */
        note: p.hop === 1 && value > 0 ? (share > 0 ? `${share}%` : side.basis === "dollars" ? fmtCompactUsd(value) : undefined) : undefined,
      });
      const from = p.hop === 2 && p.parent ? placedByKey.get(p.parent) : null;
      const anchor = p.hop === 2 ? (from ? from.key : null) : home ? "focus" : null;
      if (!anchor) continue;
      const ends = arcEnds(p.relation, [0, 0], [1, 1]), toNode = ends.b[0] === 1;
      /* financing, acquisitions and regulators are ties, not flows: a thin dashed line with no direction marks */
      const notTrade = NOT_TRADE.has(risks[p.key]?.nature ?? "trade");
      arcs.push({
        id: p.key, node: p.key, from: toNode ? anchor : p.key, to: toNode ? p.key : anchor,
        twoWay: notTrade ? false : ends.twoWay, plain: notTrade || ends.plain,
        color: flagged(p.key) ? theme.negative : theme.relation[p.relation],
        dash: notTrade ? [2, 4] : RELATION_DASH[p.relation],
        thin: p.hop === 2 || notTrade || ends.plain,
        width: p.hop === 2 || notTrade ? 1 : flowWidth(value, side.max),
        value: side.max > 0 ? value / side.max : 0,
        dim: dim || (anchor !== "focus" && !lit(anchor)), faded,
      });
    }
    engine.setScene({ points, arcs, selected, maxValue: 1 });
  }, [theme, home, focus, placed, placedByKey, nodeByKey, selected, overlay, risks, impacts, sides, lit]);

  /* ---------- country tint ---------- */
  /* countries the filing sentences name as countries: "Georgia" in a row that only U.S.-state sentences produced is not tinted */
  const statedAsCountry = useMemo(() => new Set(nodes.flatMap((n) => statedPlaces(n.links as RiskLink[]).countries)), [nodes]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !theme) return;
    const max = Math.max(1, ...rows.map(rowWeight));
    const fills: GlobeFill[] = [];
    for (const r of rows) {
      const atlas = places.get(r.country)?.atlas;
      if (!atlas || rowWeight(r) <= 0) continue;
      if (Object.values(US_STATES).includes(r.country) && !statedAsCountry.has(r.country) && r.hq + r.facilities + r.policy === 0) continue;
      const strength = 0.08 + 0.2 * Math.sqrt(rowWeight(r) / max), picked = r.country === country;
      fills.push({ name: atlas, color: rgb(r.hotspot ? theme.hotspot : theme.tint), alpha: picked ? Math.min(0.5, strength + 0.14) : strength, outline: picked });
    }
    engine.setFills(fills);
  }, [theme, rows, places, country, statedAsCountry]);

  /* ---------- camera ---------- */
  /** Fly to a name: with the link to the company (or to the name it hangs off) in view when it stands clear, closer when it stands in a crowd. */
  const revealRef = useRef<(at: Placed) => void>(() => undefined);
  revealRef.current = (at) => engineRef.current?.reveal(at.key, at.hop === 2 && at.parent && placedByKey.has(at.parent) ? at.parent : home ? "focus" : undefined);
  const focusKey = focus.ticker ?? focus.name;
  const placedCount = placed.length;
  /* the view the reset control, the 0 key and the first frame go to: the isolated names when there are some, otherwise the company and its direct links */
  const homeView = useMemo(() => {
    if (!home) return null;
    const lit = isolate ? placed.filter((p) => isolate.has(p.key)) : [];
    const shown = lit.length ? lit : placed.filter((p) => p.hop === 1);
    return { places: [[home.lon, home.lat], ...shown.map((p) => [p.lon, p.lat])] as [number, number][], maxZoom: lit.length ? 9 : 7 };
  }, [home, isolate, placed]);
  const ready = theme != null;
  useEffect(() => { if (homeView) engineRef.current?.setHome(homeView.places, homeView.maxZoom); }, [homeView, ready]);
  const frameContext = useCallback((ms?: number) => engineRef.current?.reset(ms), []);
  useEffect(() => {
    const engine = engineRef.current;
    /* wait for the first scene (it needs the theme's colours), so a name picked before the map opened can be found */
    if (!engine || !home || !ready) return;
    /* a name already selected (picked in another view, or before the head offices arrived) is framed instead of the overview */
    const at = selected ? placedByKey.get(selected) : null;
    if (at) revealRef.current(at); else frameContext();
    setMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recentre when the company changes or its links arrive, not on every re-layout
  }, [focusKey, home?.lon, home?.lat, placedCount > 0, ready]);
  useEffect(() => {
    const engine = engineRef.current, at = selected ? placedByKey.get(selected) : null;
    if (pickedHere.current) { pickedHere.current = false; return; }
    if (!engine || !at || !ready) return;
    /* the scene effect above has already handed the engine this selection: fly once it is drawn */
    revealRef.current(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the selection, not every re-layout
  }, [selected]);
  /* isolation: the camera fits the lit set, and goes back to the overview when it is cleared */
  const litKey = isolate ? [...isolate].sort().join("|") : "";
  const wasIsolated = useRef(false);
  useEffect(() => {
    if (!litKey && !wasIsolated.current) return;
    wasIsolated.current = !!litKey;
    frameContext();
    setMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit when the isolated set changes, not when the layout does
  }, [litKey]);
  const flatMounted = useRef(false);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setFlat(flat);
    if (flatMounted.current) frameContext(500);
    flatMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the projection is switched
  }, [flat]);

  const jump = (key: string) => { if (key) onSelect(key); };
  /* the list of names at one place behaves like a small dialog: focus moves in, Escape closes it, focus goes back to the map */
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => { setMenu(null); canvasRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }, [menu]);
  const sorted = useMemo(() => [...placed].sort((a, b) => a.hop - b.hop || a.relation.localeCompare(b.relation) || a.name.localeCompare(b.name)), [placed]);
  const exact = placed.filter((p) => p.basis === "hq").length;
  const control = "grid size-8 place-items-center text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none";
  const quiet = "inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-xs font-medium transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

  /* ---------- isolation: what this view can ask for ---------- */
  const ask = useCallback((r: IsolateRequest) => { setMenu(null); onIsolate?.(r); }, [onIsolate]);
  /** the relation whose names are exactly the lit set, when the isolation is "suppliers only" or the like */
  const litRelation = useMemo(() => {
    if (!isolate) return null;
    for (const r of RELATION_ORDER) {
      const keys = nodes.filter((n) => n.relation === r).map((n) => n.key);
      if (keys.length && keys.every((k) => isolate.has(k)) && nodes.every((n) => n.relation === r || !isolate.has(n.key))) return r;
    }
    return null;
  }, [isolate, nodes]);
  const selNode = selected ? nodeByKey.get(selected) ?? null : null;
  const selPlaced = selected ? placedByKey.get(selected) ?? null : null;
  /** the pathway through the selected name, upstream to downstream: a second-order name brings the first-order name it hangs off */
  const pathwayOf = (n: GraphNode | HopNode): IsolateRequest => {
    if (!isHop(n)) return { kind: "node", key: n.key };
    return { kind: "path", keys: n.relation === "customer" ? [n.parent, n.key] : [n.key, n.parent] };
  };
  const selIsolated = !!(selNode && isolate && isolate.has(selNode.key) && isolate.size <= 1 + (isHop(selNode) ? 1 : hop2.filter((h) => h.parent === selNode.key).length));
  const litOnMap = isolate ? placed.filter((p) => isolate.has(p.key)).length : 0;

  /* names drawn on the canvas keep clear of the controls laid over it */
  const jumpRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const base = wrap.getBoundingClientRect();
      const boxes: GlobeBox[] = [];
      for (const el of [jumpRef.current, controlsRef.current, dockRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        boxes.push({ x: r.left - base.left - 4, y: r.top - base.top - 4, w: r.width + 8, h: r.height + 8 });
      }
      engineRef.current?.setReserved(boxes);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    for (const el of [jumpRef.current, dockRef.current]) if (el) ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [failed]);

  const visibleRelations = RELATION_ORDER.filter((r) => visible.has(r));
  const widthNote = (["supplier", "customer"] as const).filter((r) => visible.has(r) && sides[r].basis !== "none").map((r) => `${RELATION_LABEL[r].toLowerCase()}: ${WIDTH_TEXT[sides[r].basis]}`);
  /* names that could not be placed, grouped by the reason, so the reason is stated once */
  const unplacedGroups = useMemo(() => {
    const groups = new Map<string, typeof unplaced>();
    for (const u of unplaced) {
      const reason = u.why.startsWith("filing names") ? "The filing ties the name to more than one country" : u.why === "no head office on file" ? "No head office on file" : "No location stated in the filing";
      const list = groups.get(reason);
      if (list) list.push(u); else groups.set(reason, [u]);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  }, [unplaced]);

  return (
    <div data-section="Supply globe" className="flex flex-col" onKeyDown={(e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      /* Escape steps back once: the open list, then the isolation, then the hold on the wheel */
      if (menu) { e.stopPropagation(); closeMenu(); } else if (isolate && onIsolate) { e.stopPropagation(); ask({ kind: "clear" }); } else engineRef.current?.release();
    }}>
      <div ref={wrapRef} data-engaged={engaged || undefined} className="relative h-[440px] overflow-hidden sm:h-[580px]">
        <p id="supply-globe-help" className="sr-only">
          Arrow keys move the map, plus and minus zoom, zero returns to the company, Escape clears an isolation. The scroll wheel zooms after you press the map, or with Control held; it scrolls the page otherwise. Use the list of names above the map to pick a company; the names that could not be placed are listed below it.
        </p>
        <canvas ref={baseRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-roledescription="interactive map"
          aria-label={`Map of ${focus.name}'s named supply-chain links: ${placed.length} placed, ${unplaced.length} not placed${isolate ? `. Isolated: ${isolateLabel ?? "a subset"}, ${litOnMap} on the map` : ""}.`}
          aria-describedby="supply-globe-help"
          className="absolute inset-0 size-full cursor-grab select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        />
        <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 z-10 transition-shadow duration-150 motion-reduce:transition-none", engaged && "shadow-[inset_0_0_0_1.5px_var(--ring)]")} />
        {failed && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">This browser could not start the map. The Network view shows the same links.</p>}
        {!failed && hqMissing && (
          <p role="alert" className="absolute inset-x-0 top-14 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-md border bg-card px-3 py-2 text-center text-xs text-muted-foreground shadow-paper">
            Head-office positions could not be loaded, so nothing can be placed yet.
            <button type="button" className="inline-flex min-h-7 items-center underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void refetchHq()}>Retry</button>
          </p>
        )}
        {!failed && !hqLoading && !hqMissing && !home && (
          <p className="pointer-events-none absolute inset-x-0 top-14 mx-auto w-fit max-w-[90%] rounded-md border bg-card px-3 py-2 text-center text-xs text-muted-foreground shadow-paper">
            No head office on file for {focus.name}, so links are shown without arcs from the company.
          </p>
        )}

        <div ref={jumpRef} className="absolute left-3 top-3 z-10 max-w-[calc(100%-5.5rem)]">
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

        <div ref={controlsRef} role="group" aria-label="Map controls" data-agent-controls className="absolute right-3 top-3 z-10 flex flex-col divide-y overflow-hidden rounded-md border bg-card shadow-paper">
          <button type="button" className={control} aria-label="Zoom in" title="Zoom in" onClick={() => engineRef.current?.zoomBy(1.8)}><Plus className="size-3.5" /></button>
          <button type="button" className={control} aria-label="Zoom out" title="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.8)}><Minus className="size-3.5" /></button>
          <button type="button" className={control} aria-label="Back to the company" title={isolate ? "Fit the isolated names" : "Back to the company and its direct links"} onClick={() => frameContext()}><RotateCcw className="size-3.5" /></button>
          <button type="button" className={control} aria-pressed={flat} aria-label={flat ? "Show as a globe" : "Show as a flat map"} title={flat ? "Show as a globe" : "Show as a flat map"} onClick={() => setFlat((f) => !f)}>
            {flat ? <Globe2 className="size-3.5" /> : <MapIcon className="size-3.5" />}
          </button>
        </div>

        {/* what is isolated and what is selected, docked at the foot of the map so they never cover a name that was just clicked */}
        <div ref={dockRef} className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1.5">
          {/* how the wheel and one finger behave right now: shown while the map holds them, and for a moment when a wheel passed over it */}
          {(wheelHint || engaged) && (
            <p aria-hidden="true" data-globe-hint="" className="pointer-events-none rounded-md border bg-card px-2 py-1 text-[11px] text-muted-foreground shadow-paper">
              {engaged ? <><span className="hidden [@media(pointer:fine)]:inline">Scroll zooms the map. Move the pointer away to scroll the page.</span><span className="[@media(pointer:fine)]:hidden">Map is active. Tap outside it to scroll the page.</span></> : "Click the map to zoom with the wheel, or hold Ctrl."}
            </p>
          )}
          {isolate && (
            <div role="status" data-globe-isolated="" className="flex max-w-full items-center gap-1 rounded-md border bg-card py-0.5 pl-2.5 pr-0.5 text-xs shadow-paper">
              <Waypoints aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate"><span className="text-muted-foreground">Isolated: </span><span className="font-medium">{isolateLabel ?? "selected names"}</span><span className="num text-muted-foreground"> · {litOnMap} on the map</span></span>
              {onIsolate && <button type="button" data-agent-click className={cn(quiet, "shrink-0")} onClick={() => ask({ kind: "clear" })}><X aria-hidden="true" className="size-3.5" />Show all</button>}
            </div>
          )}
          {selNode && (
            <div data-globe-selected="" className="flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border bg-card py-0.5 pl-1.5 pr-0.5 text-xs shadow-paper">
              <span className="flex min-w-0 items-center gap-1.5 py-1 pr-1">
                <CompanyLogo ticker={selNode.ticker ?? plateKey(selNode.name)} src={externalLogo(selNode.domain, selNode.ticker)} size="xs" decorative />
                <span className="min-w-0 truncate font-medium">{selNode.name}</span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline">{relationWord(selNode.relation)}{isHop(selNode) ? ", second order" : ""} · {selPlaced ? selPlaced.place : "not placed"}</span>
              </span>
              {onIsolate && (selIsolated
                ? <button type="button" data-agent-click className={quiet} onClick={() => ask({ kind: "clear" })}><X aria-hidden="true" className="size-3.5" />Show all</button>
                : <button type="button" data-agent-click className={quiet} onClick={() => ask(pathwayOf(selNode))}><Waypoints aria-hidden="true" className="size-3.5" />Isolate this pathway</button>)}
              {selPlaced && <button type="button" data-agent-click className={quiet} aria-label={`Zoom to ${selNode.name}`} onClick={() => revealRef.current(selPlaced)}><Crosshair aria-hidden="true" className="size-3.5" />Zoom to</button>}
            </div>
          )}
        </div>

        <TipLayer ref={tipRef} size={() => ({ w: wrapRef.current?.clientWidth ?? 600, h: wrapRef.current?.clientHeight ?? 500 })} />
        {menu && (
          <div ref={menuRef} role="dialog" aria-label="Names at this place" className="absolute z-30 w-64 rounded-md border bg-popover p-1.5 text-xs text-popover-foreground shadow-lift"
            style={{ left: Math.max(8, Math.min(menu.x, (wrapRef.current?.clientWidth ?? 600) - 264)), top: Math.max(8, Math.min(menu.y, (wrapRef.current?.clientHeight ?? 500) - 48 - Math.min(menu.points.length, 10) * 30)) }}>
            <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">{menu.title}</p>
            <ul className="flex flex-col">
              {menu.points.slice(0, 10).map((p) => {
                const node = nodeByKey.get(p.key), rel = node?.relation;
                return (
                  <li key={p.key}>
                    <button type="button" className="flex h-7 w-full items-center gap-2 rounded px-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => { closeMenu(); if (p.key !== "focus") { pickedHere.current = selected !== p.key; onSelect(p.key); } }}>
                      <CompanyLogo ticker={(p.key === "focus" ? focus.ticker : node?.ticker) ?? plateKey(p.name)} src={node ? externalLogo(node.domain, node.ticker) : undefined} size="xs" decorative />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {rel && rel !== "focus" ? <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><RelationMark relation={rel} size={8} />{relationWord(rel)}</span> : <span className="shrink-0 text-[11px] text-muted-foreground">this company</span>}
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ul aria-label={onIsolate ? "Map key. Press a relation to show only its names." : "Map key"} data-agent-controls className="flex flex-wrap items-center gap-1.5">
            {visibleRelations.map((r) => {
              const count = placed.filter((p) => p.relation === r).length, on = litRelation === r;
              const body = <><RelationMark relation={r} size={10} /><LineSample relation={r} width={18} /><span className="text-foreground">{RELATION_LABEL[r]}</span><span className="num">{count}</span></>;
              return (
                <li key={r}>
                  {onIsolate ? (
                    <button type="button" data-globe-isolate={r} aria-pressed={on} disabled={!count} title={on ? "Show every relation again" : `Show ${RELATION_LABEL[r].toLowerCase()} only`}
                      onClick={() => ask(on ? { kind: "clear" } : { kind: "relation", relation: r })}
                      className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none", on ? "border-foreground bg-accent" : "bg-card")}>
                      {body}
                    </button>
                  ) : <span className="inline-flex h-7 items-center gap-1.5">{body}</span>}
                </li>
              );
            })}
          </ul>
          <ul aria-label="Marker key" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] border-[1.5px] border-muted-foreground" />at its head office</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-muted-foreground" />country or state level</li>
          </ul>
        </div>
        <p>
          Arrows point the way goods and services move; partnerships run both ways.
          {widthNote.length > 0 && <> Line width: {widthNote.join("; ")}, as in the Network view. Links that end in one cluster are drawn as one.</>}
          {impacts && <span className="text-foreground"> Shock view: names the simulated shock does not reach are drawn pale.</span>}
        </p>
        <p>
          <span className="num text-foreground">{placed.length}</span> of <span className="num">{placed.length + unplaced.length}</span> names on the map
          {placed.length > 0 && <> · <span className="num">{exact}</span> at their head office, <span className="num">{placed.length - exact}</span> at country or state level</>}
          {hqFile?.generatedAt && <> · head offices as of {fmtDate(hqFile.generatedAt)}, source on hover</>}
        </p>
        {unplaced.length > 0 && (
          <div role="group" aria-label="Names not placed on the map" data-globe-unplaced="" className="@container mt-1 border-t pt-2">
            <p className="text-[13px] font-semibold text-foreground">Not placed <span className="num font-normal text-muted-foreground">{unplaced.length}</span></p>
            <p className="mt-0.5">No single location is on record for these names, so they are listed instead of guessed. Each one opens its filing sentence.</p>
            {unplacedGroups.map(([reason, list]) => (
              <div key={reason} className="mt-2">
                <p className="eyebrow">{reason} · {list.length}</p>
                <ul className="mt-1 grid grid-cols-1 gap-x-5 @xl:grid-cols-2 @5xl:grid-cols-3">
                  {list.map((u) => {
                    const node = nodeByKey.get(u.key), named = u.why.startsWith("filing names") ? u.why.replace(/^filing names \d+ countries \(|\)$/g, "") : null;
                    return (
                      <li key={u.key} className="min-w-0 border-b border-border/60">
                        <button type="button" aria-pressed={selected === u.key} aria-label={`${u.name}, ${relationWord(u.relation)}, not placed: ${u.why}. Open the filing evidence.`} onClick={() => onSelect(u.key)}
                          className={cn("flex h-7 w-full min-w-0 items-center gap-2 rounded-[3px] px-1 text-left text-[13px] text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none", selected === u.key && "bg-accent font-medium", !lit(u.key) && "opacity-50")}>
                          <CompanyLogo ticker={u.ticker ?? plateKey(u.name)} src={node ? externalLogo(node.domain, node.ticker) : undefined} size="xs" decorative />
                          <span className="min-w-0 flex-1 truncate" title={u.name}>{u.name}</span>
                          {named && <span className="hidden max-w-[40%] shrink truncate text-[11px] text-muted-foreground sm:inline" title={named}>{named}</span>}
                          {u.relation !== "focus" && <span className="inline-flex w-[6.75rem] shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground"><RelationMark relation={u.relation} size={8} />{relationWord(u.relation)}{u.hop === 2 ? ", 2nd order" : ""}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
