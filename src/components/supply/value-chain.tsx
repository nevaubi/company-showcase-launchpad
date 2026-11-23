// End-to-end value chain view: tiers of suppliers → company → tiers of customers, every link sized by the share or
// dollars a filing states. Clicking a company or a line isolates the pathway through it: the rest dims, a strip above
// the drawing lists each link of the pathway with its stated figure and a button that opens the sentence, and the
// evidence panel and the table of links follow. Wide screens draw columns; phones get the same tiers as a list.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, FileText, Focus, Lock, Search, ShieldCheck, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { RELATION_COLOR } from "@/components/supply/supply-map-meta";
import { BASIS_WORD, CHAIN_FLOWS, LINK_TYPE_LABEL, TIER_LABEL, type Chain, type ChainEdge, type ChainFlow, type ChainNode, type TaggedShare } from "@/lib/supply/chain";
import { edgePath, edgeWidth, layoutChain } from "@/lib/supply/chain-layout";
import type { RiskLink } from "@/lib/supply/core";
import { chainEdgePath, chainPath, pathHops, type Isolated, type PathHop } from "@/lib/supply/isolate";
import type { IsolateRequest } from "@/lib/supply/isolate-contract";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChainSize = "share" | "dollars";

const shareText = (e: Pick<ChainEdge, "share" | "basis">) => (e.share != null ? `${e.share}% of ${e.basis ? BASIS_WORD[e.basis] : "an unstated base"}` : null);
/** The one figure a link is labelled with, by what the lines are sized on. */
const tagOf = (e: ChainEdge, size: ChainSize) => (size === "dollars" ? (e.dollars != null ? fmtCompactUsd(e.dollars) : null) : e.share != null ? `${e.share}%` : null);
const logoKey = (n: Pick<ChainNode, "ticker" | "name">) => n.ticker ?? n.name.slice(0, 4).toUpperCase();
const FLOW_OPTIONS = CHAIN_FLOWS.map((f) => ({ v: f.v, l: f.label, title: f.hint }));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type OpenText = (l: RiskLink, label: string) => void;
type OpenTag = (f: TaggedShare) => void;
/** Opens the first filing behind a link: a quoted sentence when there is one, else the tagged fact. */
function openFirst(e: ChainEdge, label: string, onOpenText: OpenText, onOpenTag: OpenTag) {
  const ev = e.evidence.find((x) => x.kind === "text") ?? e.evidence[0];
  if (!ev) return;
  if (ev.kind === "text") onOpenText(ev.link, label);
  else onOpenTag(ev.fact);
}

export interface ValueChainProps {
  chain: Chain;
  flow: ChainFlow;
  onFlow: (f: ChainFlow) => void;
  product: string;
  onProduct: (p: string) => void;
  size: ChainSize;
  /** what the page isolates, resolved against this chain */
  isolated: Isolated | null;
  onIsolate: (request: IsolateRequest) => void;
  names: Record<string, string>;
  onOpenText: OpenText;
  onOpenTag: OpenTag;
  /** right end of the toolbar row: what is isolated, or a hint */
  status?: ReactNode;
}

export function ValueChain({ chain, flow, onFlow, product, onProduct, size, isolated, onIsolate, onOpenText, onOpenTag, status }: ValueChainProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const wide = width >= 640;
  /** the pathway under the pointer or the keyboard focus: a preview of what a click would isolate */
  const [preview, setPreview] = useState<string[] | null>(null);
  useEffect(() => { setPreview(null); }, [chain]);
  const byKey = useMemo(() => new Map(chain.nodes.map((n) => [n.key, n])), [chain]);
  const up = chain.nodes.filter((n) => n.tier < 0).length, down = chain.nodes.filter((n) => n.tier > 0).length;
  const lit = useMemo(() => {
    if (preview) return { nodes: new Set(preview), edges: new Set(preview.slice(1).map((k, i) => `${preview[i]}>${k}`)) };
    return isolated?.chainNodes ? { nodes: isolated.chainNodes, edges: isolated.chainEdges ?? new Set<string>() } : null;
  }, [preview, isolated]);
  const inPath = useMemo(() => new Set(isolated?.path ?? []), [isolated]);
  const hops = useMemo(() => (isolated && isolated.path.length > 1 ? pathHops(chain, isolated.path) : []), [chain, isolated]);
  const pickNode = (key: string) => onIsolate(key === chain.focus ? { kind: "clear" } : { kind: "path", keys: chainPath(chain, key) });
  const pickEdge = (e: ChainEdge) => onIsolate({ kind: "path", keys: chainEdgePath(chain, e) });
  const what = size === "dollars" ? "stated dollars, or a stated share of the seller's revenue" : "the stated share";
  const empty = chain.nodes.length <= 1;

  const focusNode = byKey.get(chain.focus);
  /* the pathway in two halves, each on its own line: into the company, and out of it */
  const upHops = hops.filter((h) => h.to.tier <= 0), downHops = hops.filter((h) => h.from.tier >= 0);
  const litCount = isolated?.chainEdges?.size ?? 0;

  return (
    <div data-section="Value chain" className="flex min-w-0 flex-col">
      {/* one line that never wraps on a wide screen, so what is isolated can change without moving the drawing */}
      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b px-3.5 py-2 sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]">
        <Segmented label="What flows" value={flow} options={FLOW_OPTIONS} onChange={onFlow} />
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={product} onChange={(ev) => onProduct(ev.target.value)} placeholder="Product: wafers, GPUs" aria-label="Filter by product" className="h-8 pl-7 pr-7 text-xs" />
          {product && (
            <button type="button" onClick={() => onProduct("")} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Clear product filter">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="flex h-7 min-w-0 items-center sm:justify-end">{status}</div>
      </div>

      {/* the isolated pathway, in a band of fixed height: picking, extending or clearing a pathway never moves the drawing */}
      {wide && !empty && (
        <div data-section="Isolated pathway" className="grid h-[76px] grid-rows-2 gap-y-1 border-b px-3.5 py-2">
          {hops.length > 0 ? (
            <>
              <PathRow label="Upstream" hops={upHops} size={size} onOpenText={onOpenText} onOpenTag={onOpenTag} hint={`Pick a supplier to extend the pathway upstream of ${focusNode?.name ?? chain.focus}`} />
              <PathRow label="Downstream" hops={downHops} size={size} onOpenText={onOpenText} onOpenTag={onOpenTag} hint={`Pick a customer to extend the pathway downstream of ${focusNode?.name ?? chain.focus}`} />
            </>
          ) : (
            <>
              <PathRow label="Pathway" hops={[]} size={size} onOpenText={onOpenText} onOpenTag={onOpenTag}
                hint={isolated?.chainNodes ? `${isolated.label}: ${litCount} of ${chain.edges.length} links are lit. Click a company or a line to isolate one pathway.` : isolated?.chainNote ? `${isolated.chainNote}. Click a company or a line to isolate a pathway.` : "Click a company or a line to isolate the pathway through it. Each link then shows its stated figure and opens its sentence."} />
              <PathRow label="" hops={[]} size={size} onOpenText={onOpenText} onOpenTag={onOpenTag} hint={`A supplier and then a customer make one pathway through ${focusNode?.name ?? chain.focus}. Esc clears it.`} />
            </>
          )}
        </div>
      )}

      <div ref={ref} className="relative min-h-[320px]">
        {empty ? (
          <div className="grid min-h-[320px] place-content-center gap-2 p-6 text-center text-sm text-muted-foreground">
            No filing states a link of this kind{product.trim() ? ` for “${product.trim()}”` : ""} around {chain.nodes[0]?.name ?? chain.focus}.
            <Button size="sm" variant="outline" className="mx-auto" onClick={() => { onFlow("all"); onProduct(""); }}>
              Show every link
            </Button>
          </div>
        ) : width === 0 ? null : wide ? (
          <ChainColumns chain={chain} byKey={byKey} width={width} lit={lit} inPath={inPath} size={size} onPreview={setPreview} onNode={pickNode} onEdge={pickEdge} />
        ) : (
          <ChainList chain={chain} byKey={byKey} lit={lit} inPath={inPath} size={size} onNode={pickNode} />
        )}
      </div>

      {!empty && (
        <ul data-section="Chain legend" aria-label="Chain key" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3.5 py-2.5 text-[11px] leading-4 text-muted-foreground">
          <li className="text-foreground"><span className="num">{up}</span> upstream · <span className="num">{down}</span> downstream · goods flow left to right</li>
          <li className="inline-flex items-center gap-1.5">
            <svg aria-hidden="true" width={30} height={12} className="shrink-0"><path d="M1 3H29" stroke="currentColor" strokeWidth={2} opacity={0.7} /><path d="M1 8.5H29" stroke="currentColor" strokeWidth={5} opacity={0.7} /></svg>
            <span><span className="font-medium text-foreground">Line width</span> shows {what}</span>
          </li>
          <li className="inline-flex items-center gap-1.5"><svg aria-hidden="true" width={22} height={8} className="shrink-0"><path d="M1 4H21" stroke="currentColor" strokeWidth={1.25} opacity={0.6} /></svg>hairline: named, no {size === "dollars" ? "dollar figure" : "share"} stated</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: RELATION_COLOR.supplier }} />into the company</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: RELATION_COLOR.customer }} />out of the company</li>
          <li className="inline-flex items-center gap-1.5"><Lock aria-hidden="true" className="size-3 text-negative" />single source stated</li>
        </ul>
      )}
    </div>
  );
}

/** A company on the pathway band: its mark and its ticker, or its name when it has none. It gives way before the figures do. */
function StripNode({ n }: { n: ChainNode }) {
  return (
    <li className="inline-flex h-7 min-w-8 shrink items-center gap-1.5 overflow-hidden rounded-md border bg-card px-1 text-xs font-medium shadow-paper" title={n.name}>
      <CompanyLogo ticker={logoKey(n)} size="xs" decorative />
      <span className={cn("min-w-0 truncate", n.ticker && "num")}>{n.ticker ?? n.name}</span>
    </li>
  );
}

/**
 * One half of the isolated pathway as a single line: seller, what the filing states about the link (its kind and its
 * figure), a button that opens the sentence, buyer. The line never wraps: names and words shorten first.
 */
function PathRow({ label, hops, size, hint, onOpenText, onOpenTag }: { label: string; hops: PathHop[]; size: ChainSize; hint: string; onOpenText: OpenText; onOpenTag: OpenTag }) {
  const short = hops.length > 2;
  return (
    <div className="grid h-7 min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="eyebrow truncate">{label}</span>
      {hops.length === 0 ? <p className="truncate text-[11px] leading-4 text-muted-foreground" title={hint}>{hint}</p> : (
        <ol aria-label={`${label} pathway`} className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {hops.map((h, i) => {
            const e = h.edge;
            const share = e ? (short ? (e.share != null ? `${e.share}%` : null) : shareText(e)) : null;
            const dollars = e?.dollars != null ? `≈ ${fmtCompactUsd(e.dollars)}` : null;
            const figure = size === "dollars" ? (dollars ?? share) : (share ?? dollars);
            const kind = e && !short && e.types[0] ? LINK_TYPE_LABEL(e.types[0]) : null;
            const text = e ? ([kind, figure].filter(Boolean).join(" · ") || "named, no figure") : "no stated link";
            const label = `${h.from.name} sells to ${h.to.name}`;
            const full = e ? [label, ...e.types.map(LINK_TYPE_LABEL), shareText(e), dollars, e.sole && "single source stated", e.confirmed && "both companies' filings state it"].filter(Boolean).join(" · ") : `${label}: no filing states this link directly`;
            return (
              <Fragment key={`${h.from.key}>${h.to.key}`}>
                {i === 0 && <StripNode n={h.from} />}
                <li className="inline-flex h-7 min-w-0 shrink-[2] items-center gap-1 text-[11px] leading-4 text-muted-foreground" title={full}>
                  <span className="sr-only">{label}:</span>
                  <span className={cn("num min-w-0 truncate", figure && "text-foreground")}>{text}</span>
                  {e?.sole && <Lock className="size-3 shrink-0 text-negative" aria-label="single source stated" />}
                  {e?.confirmed && <ShieldCheck className="size-3 shrink-0 text-positive" aria-label="both companies' filings state it" />}
                  {e && (
                    <button type="button" onClick={() => openFirst(e, label.replace(" sells to ", " → "), onOpenText, onOpenTag)} aria-label={`Open the source sentence: ${label}`} title="Open the sentence in the filing"
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-highlight-soft px-1.5 font-medium text-foreground transition-colors duration-150 hover:bg-highlight hover:text-highlight-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                      <FileText className="size-3" aria-hidden="true" />{!short && "Source"}
                    </button>
                  )}
                  <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
                </li>
                <StripNode n={h.to} />
              </Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}

interface Lit { nodes: ReadonlySet<string>; edges: ReadonlySet<string> }

function ChainColumns({ chain, byKey, width, lit, inPath, size, onPreview, onNode, onEdge }: {
  chain: Chain;
  byKey: Map<string, ChainNode>;
  width: number;
  lit: Lit | null;
  inPath: ReadonlySet<string>;
  size: ChainSize;
  onPreview: (keys: string[] | null) => void;
  onNode: (key: string) => void;
  onEdge: (e: ChainEdge) => void;
}) {
  const L = useMemo(() => layoutChain(chain, width), [chain, width]);
  const maxD = Math.max(0, ...chain.edges.map((e) => e.dollars ?? 0));
  const degree = useMemo(() => {
    const out = new Map<string, number>(), into = new Map<string, number>();
    for (const e of chain.edges) { out.set(e.from, (out.get(e.from) ?? 0) + 1); into.set(e.to, (into.get(e.to) ?? 0) + 1); }
    return { out, into };
  }, [chain.edges]);
  const sole = useMemo(() => new Set(chain.edges.filter((e) => e.sole).flatMap((e) => [e.from, e.to]).filter((k) => k !== chain.focus)), [chain]);
  /* lit links are drawn last so they sit on top of the dimmed ones */
  const edges = useMemo(() => [...chain.edges].sort((a, b) => Number(lit?.edges.has(a.key) ?? false) - Number(lit?.edges.has(b.key) ?? false)), [chain.edges, lit]);
  return (
    <div className="relative" style={{ height: L.height }}>
      {L.columns.map((c) => (
        <p key={c.tier} className="eyebrow absolute top-2.5 truncate px-2 text-center" style={{ left: c.x, width: c.w }}>
          {TIER_LABEL(c.tier)}{c.tier !== 0 && <span className="num ml-1.5 normal-case tracking-normal">{c.count}</span>}
        </p>
      ))}
      <svg width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={`Links of the value chain around ${byKey.get(chain.focus)?.name ?? chain.focus}. The same links are listed in the table below.`} className="absolute inset-0 block">
        {edges.map((e) => {
          const a = L.boxes.get(e.from), b = L.boxes.get(e.to);
          if (!a || !b) return null;
          const upstream = (byKey.get(e.to)?.tier ?? 0) <= 0;
          const { width: w, sized } = edgeWidth(e, size, maxD);
          const atTarget = (degree.out.get(e.from) ?? 0) > (degree.into.get(e.to) ?? 0);
          const g = edgePath(a, b, atTarget);
          const on = !lit || lit.edges.has(e.key);
          const tag = tagOf(e, size);
          const from = byKey.get(e.from)?.name ?? e.from, to = byKey.get(e.to)?.name ?? e.to;
          return (
            <g key={e.key} opacity={on ? 1 : 0.16} className="transition-opacity duration-150 motion-reduce:transition-none">
              <path d={g.d} fill="none" stroke={upstream ? RELATION_COLOR.supplier : RELATION_COLOR.customer} strokeOpacity={sized ? (lit && on ? 0.85 : 0.6) : lit && on ? 0.8 : 0.42} strokeWidth={lit && on && !sized ? 1.75 : w} strokeLinecap="round" />
              {tag && on && (
                <text x={g.lx} y={g.ly} textAnchor={g.anchor} className="num fill-foreground" style={{ fontSize: 11, paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>{tag}</text>
              )}
              {/* a wide invisible stroke makes the line easy to hit; the table below gives the keyboard the same action for every link */}
              <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" style={{ pointerEvents: "stroke" }}
                onClick={() => onEdge(e)} onMouseEnter={() => onPreview(chainEdgePath(chain, e))} onMouseLeave={() => onPreview(null)}>
                <title>{[`${from} sells to ${to}`, shareText(e), e.dollars != null ? `≈ ${fmtCompactUsd(e.dollars)}` : null, ...e.types.map(LINK_TYPE_LABEL), ...e.products, "Click to isolate this pathway"].filter(Boolean).join(" · ")}</title>
              </path>
            </g>
          );
        })}
      </svg>
      {chain.nodes.map((n) => {
        const p = L.boxes.get(n.key);
        if (!p) return null;
        const focus = n.tier === 0, on = !lit || lit.nodes.has(n.key), pressed = inPath.has(n.key) && !focus;
        return (
          <button
            key={n.key}
            type="button"
            data-agent-click
            data-key={n.key}
            aria-pressed={focus ? undefined : pressed}
            aria-label={`${n.name}, ${TIER_LABEL(n.tier).toLowerCase()}${sole.has(n.key) ? ", single source stated" : ""}. ${focus ? "Show the whole chain" : pressed ? "On the isolated pathway" : "Isolate its pathway"}`}
            title={n.name}
            onClick={() => onNode(n.key)}
            onMouseEnter={() => onPreview(focus ? null : chainPath(chain, n.key))} onMouseLeave={() => onPreview(null)}
            onFocus={() => onPreview(focus ? null : chainPath(chain, n.key))} onBlur={() => onPreview(null)}
            style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
            className={cn(
              "absolute flex items-center gap-1.5 rounded-md border px-1.5 text-left text-xs transition-[opacity,box-shadow,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card motion-reduce:transition-none",
              focus ? "border-ink bg-ink text-ink-foreground" : "bg-card shadow-paper hover:border-foreground/35 hover:shadow-lift",
              pressed && "border-foreground ring-1 ring-foreground",
              !on && "opacity-40",
            )}
          >
            <CompanyLogo ticker={logoKey(n)} size="xs" decorative />
            <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
            {sole.has(n.key) && <Lock className="size-3 shrink-0 text-negative" aria-hidden="true" />}
            {n.ticker && <span className={cn("num shrink-0 text-[11px]", focus ? "opacity-80" : "text-muted-foreground")}>{n.ticker}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ChainList({ chain, byKey, lit, inPath, size, onNode }: { chain: Chain; byKey: Map<string, ChainNode>; lit: Lit | null; inPath: ReadonlySet<string>; size: ChainSize; onNode: (k: string) => void }) {
  return (
    <div className="space-y-3 p-3">
      {chain.tiers.map((t) => {
        const nodes = chain.nodes.filter((n) => n.tier === t);
        return (
          <section key={t} aria-label={TIER_LABEL(t)}>
            <p className="eyebrow mb-1">{TIER_LABEL(t)}{t !== 0 && <span className="num ml-1.5 normal-case tracking-normal">{nodes.length}</span>}</p>
            <ul className="space-y-1">
              {nodes.map((n) => {
                const e = t === 0 ? null : chain.edges.find((x) => (t < 0 ? x.from === n.key && x.to === n.via : x.to === n.key && x.from === n.via));
                const via = n.via && Math.abs(t) > 1 ? byKey.get(n.via) : null;
                const focus = t === 0, on = !lit || lit.nodes.has(n.key), pressed = inPath.has(n.key) && !focus;
                const tag = e ? tagOf(e, size) : null;
                return (
                  <li key={n.key}>
                    <button type="button" data-key={n.key} aria-pressed={focus ? undefined : pressed} onClick={() => onNode(n.key)}
                      aria-label={`${n.name}, ${TIER_LABEL(t).toLowerCase()}. ${focus ? "Show the whole chain" : pressed ? "On the isolated pathway" : "Isolate its pathway"}`}
                      className={cn("flex h-9 w-full items-center gap-2 rounded-md border px-2 text-left text-xs transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                        focus ? "border-ink bg-ink text-ink-foreground" : "bg-card shadow-paper", pressed && "border-foreground ring-1 ring-foreground", !on && "opacity-40")}>
                      <CompanyLogo ticker={logoKey(n)} size="xs" decorative />
                      <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
                      {via && <span className="max-w-[5.5rem] shrink-0 truncate text-[11px] text-muted-foreground">via {via.ticker ?? via.name}</span>}
                      {e?.sole && <Lock className="size-3 shrink-0 text-negative" aria-hidden="true" />}
                      {tag && <span className="num shrink-0">{tag}</span>}
                      {n.ticker && <span className={cn("num shrink-0 text-[11px]", focus ? "opacity-80" : "text-muted-foreground")}>{n.ticker}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** A link's figures and flags as small chips. */
function EdgeChips({ e }: { e: ChainEdge }) {
  const share = shareText(e);
  if (!share && e.dollars == null && !e.confirmed && !e.sole) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
      {share && <span className="num rounded bg-muted px-1.5 py-0.5">{share}</span>}
      {e.dollars != null && <span className="num rounded bg-muted px-1.5 py-0.5" title={e.dollarsFrom === "stated" ? "Revenue, purchase or contract figure the sentence states" : "Stated share × the seller's revenue (last 12 months)"}>≈ {fmtCompactUsd(e.dollars)} {e.dollarsFrom === "stated" ? "stated" : "share × revenue"}</span>}
      {e.confirmed && <span className="inline-flex items-center gap-1 rounded bg-positive-soft px-1.5 py-0.5 text-positive"><ShieldCheck className="size-3" aria-hidden="true" />Both filings state it</span>}
      {e.sole && <span className="inline-flex items-center gap-1 rounded bg-negative-soft px-1.5 py-0.5 text-negative"><Lock className="size-3" aria-hidden="true" />Single source</span>}
    </div>
  );
}

/**
 * The evidence panel in Chain view. It follows what is isolated: with a pathway, every link of it in order with the
 * filings that state it; with one side isolated or nothing isolated, a line that says how to pick a pathway.
 */
export function ChainEvidence({ chain, isolated, names, onFocus, onOpenText, onOpenTag }: {
  chain: Chain;
  isolated: Isolated | null;
  names: Record<string, string>;
  /** maps another company (a company change) */
  onFocus: (ticker: string) => void;
  onOpenText: OpenText;
  onOpenTag: OpenTag;
}) {
  const hops = isolated && isolated.path.length > 1 ? pathHops(chain, isolated.path) : [];
  if (!hops.length) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{isolated?.chainNodes ? `${isolated.label}: ${isolated.chainEdges?.size ?? 0} of ${chain.edges.length} links are lit. ` : isolated?.chainNote ? `${isolated.chainNote}. ` : ""}Pick a company or a line in the chain to isolate its pathway and read the filings behind each link.</p>
        <p className="text-xs">The chain joins every quoted 10-K and 10-Q link with the customer and supplier shares companies tag in their XBRL, so it can reach past the companies we cover: a supplier's own suppliers and a customer's own customers.</p>
      </div>
    );
  }
  const others = [...new Map(hops.flatMap((h) => [h.from, h.to]).filter((n) => n.tier !== 0 && n.ticker && names[n.ticker]).map((n) => [n.key, n])).values()];
  return (
    <div className="space-y-3">
      <div>
        <p className="eyebrow">Pathway</p>
        <p className="mt-0.5 text-sm font-semibold">{isolated?.label}</p>
        <p className="text-[11px] text-muted-foreground"><span className="num">{hops.length}</span> {hops.length === 1 ? "link" : "links"}, upstream to downstream</p>
      </div>
      <ol className="space-y-2">
        {hops.map((h, i) => {
          const e = h.edge;
          const label = `${h.from.name} → ${h.to.name}`;
          return (
            <li key={`${h.from.key}>${h.to.key}`} className="rounded-md border p-3 text-sm">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-medium">
                <span className="num mr-0.5 text-[11px] font-normal text-muted-foreground">{i + 1}</span>
                <CompanyLogo ticker={logoKey(h.from)} size="xs" decorative />{h.from.name}
                <span className="font-normal text-muted-foreground">sells to</span>
                <CompanyLogo ticker={logoKey(h.to)} size="xs" decorative />{h.to.name}
              </p>
              {!e ? <p className="mt-1 text-xs text-muted-foreground">No filing states this link directly.</p> : (
                <>
                  <EdgeChips e={e} />
                  {(e.types.length > 0 || e.products.length > 0) && <p className="mt-1.5 text-[11px] text-muted-foreground">{[...e.types.map(LINK_TYPE_LABEL), ...e.products].join(" · ")}</p>}
                  <ul className="mt-2 space-y-2">
                    {e.evidence.map((ev, j) =>
                      ev.kind === "text" ? (
                        <li key={`t${ev.link.id}`}>
                          <blockquote className="border-l-2 border-highlight pl-2 text-xs italic leading-relaxed text-muted-foreground">“{ev.link.quote}”</blockquote>
                          <button type="button" onClick={() => onOpenText(ev.link, label)} className="mt-1 inline-flex min-h-6 items-center gap-1 rounded bg-highlight-soft px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors duration-150 hover:bg-highlight hover:text-highlight-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                            <FileText className="size-3" aria-hidden="true" /> {names[ev.link.ticker] ?? ev.link.ticker} {ev.link.form}, {fmtDate(ev.link.filed)}
                          </button>
                        </li>
                      ) : (
                        <li key={`x${j}`} className="text-xs">
                          <button type="button" onClick={() => onOpenTag(ev.fact)} className="inline-flex min-h-6 items-center gap-1 rounded bg-highlight-soft px-2 py-0.5 text-left text-[11px] font-medium text-foreground transition-colors duration-150 hover:bg-highlight hover:text-highlight-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                            <Tag className="size-3 shrink-0" aria-hidden="true" /> Tagged in {names[ev.fact.ticker] ?? ev.fact.ticker}'s {ev.fact.form}: “{ev.fact.label}” {(ev.fact.pct * 100).toFixed(1)}% of {ev.fact.benchmark}, period ending {fmtDate(ev.fact.period_end)}
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((n) => (
            <Button key={n.key} size="xs" variant="outline" onClick={() => onFocus(n.ticker as string)}>
              <CompanyLogo ticker={n.ticker as string} size="xs" decorative className="size-4 p-0.5" />Map {names[n.ticker as string] ?? n.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

type EdgeSort = "dollars" | "share" | "evidence";
const SORT_LABEL: Record<EdgeSort, string> = { share: "Stated share", dollars: "≈ Dollars", evidence: "Filings" };

/**
 * Every link drawn in the chain as a table: who sells what to whom, the stated share and the dollars it implies (with
 * how they were worked out), and the filings that state it. It follows what is isolated the way the drawing does: the
 * links inside it stay lit and the rest dim, and no row changes place, so the row under the pointer never moves. A
 * row's source button opens its first filing; its isolate button does what clicking the line does, so the keyboard
 * reaches every link.
 */
export function ChainTable({ chain, names, revenue, isolated, onIsolate, onOpenText, onOpenTag }: {
  chain: Chain;
  names: Record<string, string>;
  revenue: Record<string, number | undefined>;
  isolated: Isolated | null;
  onIsolate: (request: IsolateRequest) => void;
  onOpenText: OpenText;
  onOpenTag: OpenTag;
}) {
  const [sort, setSort] = useState<EdgeSort>("dollars");
  const byKey = useMemo(() => new Map(chain.nodes.map((n) => [n.key, n])), [chain]);
  const litEdges = isolated?.chainEdges ?? null;
  const rows = useMemo(() => {
    const v = (e: ChainEdge) => (sort === "dollars" ? (e.dollars ?? -1) : sort === "share" ? (e.share ?? -1) : e.evidence.length);
    return [...chain.edges].sort((a, b) => v(b) - v(a) || (b.share ?? 0) - (a.share ?? 0) || b.evidence.length - a.evidence.length);
  }, [chain.edges, sort]);
  const litRows = litEdges ? rows.filter((e) => litEdges.has(e.key)).length : rows.length;
  if (!chain.edges.length) return null;
  const quantified = rows.filter((e) => e.dollars != null).length;
  const node = (k: string) => byKey.get(k) ?? { key: k, name: k, ticker: null, tier: 0, via: null };
  const formula = (e: ChainEdge) => {
    if (e.dollars == null) return undefined;
    if (e.dollarsFrom === "stated") return "Revenue, purchase or contract figure stated in the filing sentence";
    const seller = node(e.from).ticker;
    const rev = seller ? revenue[seller] : undefined;
    return rev && e.share != null ? `${e.share}% of revenue × ${fmtCompactUsd(rev)} ${names[seller as string] ?? seller} revenue (last 12 months)` : "Stated share × the seller's revenue (last 12 months)";
  };
  const th = "border-b px-3 py-2 font-medium";
  const head = (k: EdgeSort) => (
    <th scope="col" aria-sort={sort === k ? "descending" : undefined} className={cn(th, "text-right")}>
      <button type="button" onClick={() => setSort(k)} className={cn("inline-flex min-h-6 items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", sort === k ? "text-foreground" : "hover:text-foreground")}>
        {SORT_LABEL[k]}{sort === k && <span aria-hidden="true">↓</span>}
      </button>
    </th>
  );
  const party = (n: ChainNode) => (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={n.name}>
      <CompanyLogo ticker={logoKey(n)} size="xs" decorative />
      <span className={cn("min-w-0 truncate font-medium", n.ticker && "num")}>{n.ticker ?? n.name}</span>
    </span>
  );
  return (
    <section className="min-w-0 border-y bg-card/40" data-section="Chain links" aria-label="Links in the chain">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-3.5 py-2">
        <h2 className="text-[13px] font-semibold tracking-tight">Links in the chain</h2>
        <p className="text-[11px] text-muted-foreground">
          {litEdges ? <><span className="num">{litRows}</span> of <span className="num">{rows.length}</span> links lit · isolated: {isolated?.label}</> : <><span className="num">{rows.length}</span> links</>}
          {" · "}<span className="num">{quantified}</span> with a dollar figure (stated, or a stated share of the seller's revenue)
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className={th}>Seller → buyer</th>
              <th scope="col" className={th}>What changes hands</th>
              {head("share")}
              {head("dollars")}
              {head("evidence")}
              <th scope="col" className={th}>Flags</th>
              <th scope="col" className={cn(th, "text-right")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const a = node(e.from), b = node(e.to);
              const label = `${a.name} → ${b.name}`;
              const td = "border-b px-3 py-1.5 align-top";
              return (
                <tr key={e.key} data-lit={litEdges ? litEdges.has(e.key) : undefined}
                  className={cn("transition-[opacity,background-color] duration-150 hover:bg-secondary/60 motion-reduce:transition-none", litEdges && (litEdges.has(e.key) ? "bg-highlight-soft/50" : "opacity-45 hover:opacity-100 focus-within:opacity-100"))}>
                  <td className={cn(td, "max-w-72")}>
                    <span className="flex min-w-0 items-center gap-1.5">{party(a)}<ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />{party(b)}</span>
                    <span className="block text-[11px] text-muted-foreground">{TIER_LABEL(a.tier)} → {TIER_LABEL(a.tier + 1).toLowerCase()}</span>
                  </td>
                  <td className={cn(td, "max-w-64")}>
                    <span className="flex flex-wrap items-center gap-1">
                      {e.types.map((x) => <span key={x} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{LINK_TYPE_LABEL(x)}</span>)}
                      {e.products.map((x) => <span key={x} className="max-w-40 truncate text-[11px] text-muted-foreground" title={x}>{x}</span>)}
                      {!e.types.length && !e.products.length && <span className="text-[11px] text-muted-foreground">{e.evidence.some((x) => x.kind === "tag") ? "tagged share" : "–"}</span>}
                    </span>
                  </td>
                  <td className={cn(td, "num text-right")}>{e.share != null ? `${e.share}%` : <span className="text-muted-foreground">–</span>}{e.share != null && <span className="block text-[11px] text-muted-foreground">of {e.basis ? BASIS_WORD[e.basis] : "an unstated base"}</span>}</td>
                  <td className={cn(td, "num text-right")} title={formula(e)}>
                    {e.dollars != null ? fmtCompactUsd(e.dollars) : <span className="text-muted-foreground">–</span>}
                    {e.dollars != null && <span className="block text-[11px] text-muted-foreground">{e.dollarsFrom === "stated" ? "stated flow" : "share × revenue"}</span>}
                  </td>
                  <td className={cn(td, "num text-right")}>{e.evidence.length}</td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-1 text-[11px]">
                      {e.confirmed && <span className="inline-flex items-center gap-1 rounded bg-positive-soft px-1.5 py-0.5 text-positive"><ShieldCheck className="size-3" aria-hidden="true" />both filings</span>}
                      {e.sole && <span className="inline-flex items-center gap-1 rounded bg-negative-soft px-1.5 py-0.5 text-negative"><Lock className="size-3" aria-hidden="true" />single source</span>}
                    </span>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    <button type="button" onClick={() => openFirst(e, label, onOpenText, onOpenTag)} aria-label={`Open the source: ${label}`}
                      className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-highlight-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                      <FileText className="size-3" aria-hidden="true" />Source
                    </button>
                    <button type="button" onClick={() => onIsolate({ kind: "path", keys: chainEdgePath(chain, e) })} aria-label={`Isolate the pathway through ${label}`} title="Isolate the pathway through this link"
                      className="ml-1 inline-grid size-7 place-items-center rounded align-middle text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                      <Focus className="size-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
