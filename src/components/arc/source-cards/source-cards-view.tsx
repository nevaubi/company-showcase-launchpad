"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";
import { ArrowUpRight, ChevronDown, CircleAlert, Globe, RotateCcw, SearchX } from "lucide-react";
import { Button } from "../button/button";
import { TextShimmer } from "../text-shimmer/text-shimmer";
import { motionTokens } from "../lib/motion-tokens";
import { SourceMark, markForUrl, sourceHost, sourceSiteNames } from "./source-cards-marks";
import type { SourceCardsMarkId } from "./source-cards-marks";
import type { SourceCardsSource, SourceCardsStatus } from "./source-cards-data";
import styles from "./source-cards.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const ease = [...motionTokens.ease.enter] as [number, number, number, number];
const HIGHLIGHT_MS = 2600;
const PREVIEW_WIDTH = 304;

export interface SourceCardsProps {
  /** The sources, in citation order: source 1 is cited as [1]. Leave out to render the self-playing demo. */
  sources?: SourceCardsSource[];
  /** "searching" streams cards into reserved slots, "done" shows the count, "error" keeps what arrived and offers Retry. */
  status?: SourceCardsStatus;
  /** How many sources the search will return, for "Searching 3 of 8" and reserved slots. */
  total?: number;
  /** The search query, shown quietly beside the status. */
  query?: string;
  /** Search time in ms, shown after the count when done ("7 sources · 2.1s"). */
  duration?: number;
  /** Cards shown before the rest collapse into a stack of marks. Defaults to 3. */
  max?: number;
  /** Controlled expanded state of the overflow stack. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Controlled highlighted source number (1-based), usually set from a clicked citation. Uncontrolled highlights clear after 2.6s. */
  highlighted?: number | null;
  onHighlightChange?: (n: number | null) => void;
  /** Called when a card is chosen. Without it, cards are plain links that open in a new tab. */
  onSourceClick?: (source: SourceCardsSource, n: number) => void;
  /** Shows Retry on error and Search again when nothing was found. */
  onRetry?: () => void;
  /** Error detail shown after "Search failed". */
  error?: string;
  /** Hide the status line when your UI already shows search progress. */
  hideStatus?: boolean;
  /** The answer, rendered between the status line and the cards. SourceCitation inside it highlights its card. */
  children?: ReactNode;
  /** Accessible name of the source list. Defaults to "Sources". */
  label?: string;
  className?: string;
}

interface ResolvedSource {
  key: string;
  n: number;
  source: SourceCardsSource;
  host: string;
  /** The short domain on the card: docs.stripe.com reads as stripe.com, en.wikipedia.org as wikipedia.org. */
  domain: string;
  path: string;
  site: string;
  mark?: SourceCardsMarkId;
}

interface ContextValue { sources: ResolvedSource[]; highlighted: number | null; highlight: (n: number) => void }
const SourceCardsContext = createContext<ContextValue | null>(null);

/** Keeps the last two labels (three for country second levels such as bbc.co.uk), so docs.stripe.com reads as stripe.com. */
function shortDomain(host: string) {
  const labels = host.split(".");
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) return host;
  const countrySecondLevel = labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3;
  return labels.slice(countrySecondLevel ? -3 : -2).join(".");
}

function resolve(source: SourceCardsSource, index: number): ResolvedSource {
  const host = sourceHost(source.url);
  const mark = source.mark ?? markForUrl(source.url);
  let path = "";
  try { const url = new URL(source.url); path = url.pathname === "/" ? "" : decodeURIComponent(url.pathname); } catch { /* not a URL */ }
  const domain = shortDomain(host);
  return { key: source.id ?? `${source.url}#${index}`, n: index + 1, source, host, domain, path, site: source.site ?? (mark ? sourceSiteNames[mark] : host), mark };
}

export interface SourceCitationProps {
  /** The 1-based source number this citation points to. */
  n: number;
  /** Extra handler, for example to scroll the cards into view. Inside SourceCards the click already highlights the card. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

/** An inline [n] citation. Inside SourceCards it names its source for screen readers and highlights the matching card when clicked. */
export function SourceCitation({ n, onClick, className }: SourceCitationProps) {
  const context = useContext(SourceCardsContext);
  const item = context?.sources[n - 1];
  const active = context?.highlighted === n;
  return <button type="button" className={cx(styles.cite, className)} data-active={active || undefined}
    aria-label={item ? `Source ${n}: ${item.source.title}, ${item.host}` : `Source ${n}`}
    onClick={event => { context?.highlight(n); onClick?.(event); }}>{n}</button>;
}

/** Springs a box to its content's height so whatever sits below glides instead of jumping. Width changes cut straight to the new height. */
export function useAutoHeight(reduced: boolean) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = outerRef.current, content = innerRef.current;
    if (!box || !content || typeof ResizeObserver === "undefined") return;
    let height = content.offsetHeight, width = content.offsetWidth;
    let controls: AnimationPlaybackControls | undefined;
    const release = () => { box.style.height = ""; box.style.overflow = ""; controls = undefined; };
    const observer = new ResizeObserver(() => {
      const nextHeight = content.offsetHeight, nextWidth = content.offsetWidth;
      const resized = nextWidth !== width;
      width = nextWidth;
      if (nextHeight === height) return;
      const from = controls ? box.getBoundingClientRect().height : height;
      height = nextHeight;
      controls?.stop();
      if (reduced || resized) { release(); return; }
      box.style.overflow = "clip";
      box.style.overflowClipMargin = "8px";
      controls = animate(box, { height: [from, nextHeight] }, { type: "spring", visualDuration: .3, bounce: 0, onComplete: release });
    });
    observer.observe(content);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [reduced]);
  return { outerRef, innerRef };
}

function Spinner() {
  return <svg className={styles.spinner} width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.75" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>;
}

/** A count that rolls up a few pixels when it changes, in a tabular slot sized to its digits so nothing beside it shifts. */
function Roll({ value, reduced }: { value: number; reduced: boolean }) {
  const text = String(value);
  return <span className={styles.roll} style={{ minWidth: `${text.length}ch` }}>
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={text} className={styles.rollValue}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
        transition={{ duration: reduced ? .1 : .16, ease }}>{text}</motion.span>
    </AnimatePresence>
  </span>;
}

type Preview = { n: number; align: "start" | "end"; side: "top" | "bottom" };

/**
 * A row of cited sources under an AI answer. Cards stream into reserved slots while the model searches, overflow
 * collapses into a stack of site marks, hovering or focusing a card lifts a preview with the passage, and an inline
 * SourceCitation highlights its card.
 */
export function SourceCardsView({
  sources = [], status = "done", total, query, duration, max = 3,
  expanded: expandedProp, defaultExpanded = false, onExpandedChange,
  highlighted: highlightedProp, onHighlightChange, onSourceClick, onRetry, error,
  hideStatus = false, children, label = "Sources", className,
}: SourceCardsProps) {
  const reduced = useReducedMotion() ?? false;
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => sources.map(resolve), [sources]);
  const count = items.length;
  const searching = status === "searching";
  const visibleMax = Math.max(1, max);

  const [expandedState, setExpandedState] = useState(defaultExpanded);
  const expanded = expandedProp ?? expandedState;
  const setExpanded = useCallback((next: boolean) => { if (expandedProp === undefined) setExpandedState(next); onExpandedChange?.(next); }, [expandedProp, onExpandedChange]);

  const [highlightState, setHighlightState] = useState<{ n: number | null; at: number }>({ n: null, at: 0 });
  const highlighted = highlightedProp !== undefined ? highlightedProp : highlightState.n;
  // A citation that points into the collapsed stack also opens it, so the highlighted card is always on screen.
  const highlight = useCallback((n: number | null) => {
    if (highlightedProp === undefined) setHighlightState(state => ({ n, at: state.at + 1 }));
    onHighlightChange?.(n);
    if (n !== null && n > visibleMax && n <= count && !expanded) setExpanded(true);
  }, [highlightedProp, onHighlightChange, visibleMax, count, expanded, setExpanded]);

  // Uncontrolled highlights fade after a moment; clicking the same citation again restarts the clock.
  useEffect(() => {
    if (highlightedProp !== undefined || highlightState.n === null) return;
    const timer = window.setTimeout(() => setHighlightState(state => ({ ...state, n: null })), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightedProp, highlightState]);

  // Cards that exist on first render appear at rest; only cards that arrive later fade in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(frame); }, []);

  /* ---------- Hover preview: a short intent delay, then instant while moving between cards. ---------- */
  const [preview, setPreview] = useState<Preview | null>(null);
  const timers = useRef<{ open?: number; close?: number; lastClosed: number }>({ lastClosed: 0 });
  const clearTimers = () => { window.clearTimeout(timers.current.open); window.clearTimeout(timers.current.close); };
  const placePreview = (n: number, element: HTMLElement): Preview => {
    const root = rootRef.current;
    const box = element.getBoundingClientRect();
    const rootBox = root?.getBoundingClientRect() ?? box;
    return { n, align: box.left - rootBox.left + PREVIEW_WIDTH > rootBox.width + 1 ? "end" : "start", side: box.top < 220 ? "bottom" : "top" };
  };
  const openPreview = (n: number, element: HTMLElement, now: number, immediate = false) => {
    clearTimers();
    const warm = preview !== null || now - timers.current.lastClosed < 400;
    if (immediate || warm) { setPreview(placePreview(n, element)); return; }
    timers.current.open = window.setTimeout(() => setPreview(placePreview(n, element)), 320);
  };
  const closePreview = (delay = 80) => {
    clearTimers();
    timers.current.close = window.setTimeout(() => { setPreview(null); timers.current.lastClosed = performance.now(); }, delay);
  };
  useEffect(() => () => clearTimers(), []);

  const cardHandlers = (n: number): CardHandlers => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") openPreview(n, event.currentTarget, event.timeStamp); },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") closePreview(); },
    onFocus: (event: FocusEvent<HTMLElement>) => { if (event.currentTarget.matches(":focus-visible")) openPreview(n, event.currentTarget, event.timeStamp, true); },
    onBlur: () => closePreview(0),
  });

  /* ---------- Slots: cards, reserved skeletons while searching, and the overflow stack. ---------- */
  const expected = searching ? Math.max(count, total ?? visibleMax) : count;
  const shown = expanded ? items : items.slice(0, visibleMax);
  const cardSlots = expanded ? expected : Math.min(expected, visibleMax);
  const overflow = expanded ? [] : items.slice(visibleMax);
  const stackSlot = !expanded && expected > visibleMax;
  // While results stream in, the stack itself is the way in; the toggle joins once the count settles (or to close an open stack).
  const canToggle = count > visibleMax && (!searching || expanded);
  const empty = !searching && status !== "error" && count === 0;
  const showGrid = cardSlots > 0 || stackSlot;

  const { outerRef: gridOuterRef, innerRef: gridInnerRef } = useAutoHeight(reduced);
  const { outerRef: answerOuterRef, innerRef: answerInnerRef } = useAutoHeight(reduced);

  const statusKey = searching ? "searching" : status === "error" ? "error" : empty ? "empty" : "done";
  const live = statusKey === "searching" ? `Searching${query ? ` for ${query}` : ""}`
    : statusKey === "error" ? `Search failed. ${error ?? ""}`.trim()
    : statusKey === "empty" ? "No sources found" : `${count} ${count === 1 ? "source" : "sources"} found`;

  // Slots that leave (collapsing the stack, a failed search dropping its reserved slots) pop out of the grid and fade where
  // they stand, so the card or stack taking their cell crossfades with them and the height glides once.
  const slotExit = { opacity: 0, transition: { duration: .12, ease } };
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: .1 } }, transition: { duration: .16, ease } };

  const statusIcon = statusKey === "searching" ? <Spinner />
    : statusKey === "error" ? <CircleAlert size={14} strokeWidth={1.75} />
    : statusKey === "empty" ? <SearchX size={14} strokeWidth={1.75} />
    : <Globe size={14} strokeWidth={1.75} />;

  const statusText = statusKey === "searching"
    ? <><TextShimmer className={styles.shimmer}>Searching</TextShimmer>{total !== undefined || count > 0 ? <span className={styles.statusCount}><Roll value={count} reduced={reduced} />{total !== undefined ? <> of {Math.max(total, count)}</> : " found"}</span> : null}</>
    : statusKey === "error" ? <span>Search failed</span>
    : statusKey === "empty" ? <span>No sources found</span>
    : <span><Roll value={count} reduced={reduced} /> {count === 1 ? "source" : "sources"}</span>;

  const statusDetail = statusKey === "error" ? error
    : statusKey === "done" ? (duration !== undefined ? `${(duration / 1000).toFixed(1)}s` : undefined)
    : query;

  const action = statusKey === "error" && onRetry
    ? <Button key="retry" variant="secondary" size="sm" className={styles.action} onClick={onRetry}><RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />Retry</Button>
    : statusKey === "empty" && onRetry
      ? <Button key="again" variant="secondary" size="sm" className={styles.action} onClick={onRetry}><RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />Search again</Button>
      : canToggle
        ? <button key="toggle" type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={`${id}-list`} onClick={() => setExpanded(!expanded)}>
            <span className={styles.toggleLabel}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={expanded ? "less" : "all"} {...fade}>{expanded ? "Show fewer" : `Show all ${count}`}</motion.span>
              </AnimatePresence>
            </span>
            <ChevronDown size={14} strokeWidth={1.75} className={styles.toggleIcon} aria-hidden="true" />
          </button>
        : null;

  const context = useMemo<ContextValue>(() => ({ sources: items, highlighted, highlight }), [items, highlighted, highlight]);

  return <SourceCardsContext.Provider value={context}>
    <div ref={rootRef} className={cx(styles.root, className)} onKeyDown={event => { if (event.key === "Escape" && preview) { event.stopPropagation(); setPreview(null); } }}>
      <span className={styles.srOnly} aria-live="polite">{live}</span>

      {hideStatus ? null : <div className={styles.header}>
        <div className={styles.statusLine} data-status={statusKey}>
          <span className={styles.statusIcon} aria-hidden="true">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={statusKey} className={styles.statusGlyph} {...fade}>{statusIcon}</motion.span>
            </AnimatePresence>
          </span>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={statusKey} className={styles.statusText} {...fade}>
              <span className={styles.statusLabel}>{statusText}</span>
              {statusDetail ? <span className={styles.statusDetail}><span aria-hidden="true">·</span> {statusDetail}</span> : null}
            </motion.span>
          </AnimatePresence>
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {action ? <motion.span key={statusKey === "error" || statusKey === "empty" ? statusKey : "toggle"} className={styles.headerAction} {...fade}>{action}</motion.span> : null}
        </AnimatePresence>
      </div>}

      {children !== undefined ? <div ref={answerOuterRef}><div ref={answerInnerRef} className={styles.answer}>{children}</div></div> : null}

      <div ref={gridOuterRef}>
        <div ref={gridInnerRef}>
          <AnimatePresence initial={false}>
          {showGrid ? <motion.ul key="grid" id={`${id}-list`} className={styles.grid} aria-label={label} aria-busy={searching || undefined} style={{ ["--sc-cols" as string]: visibleMax + 1 }}
            exit={{ opacity: 0, transition: { duration: .12 } }}>
            <AnimatePresence initial={false} mode="popLayout">
            {Array.from({ length: cardSlots }, (_, index) => {
              const item = shown[index];
              const open = item && preview?.n === item.n ? preview : null;
              return <motion.li key={`slot-${index}`} className={styles.slot} data-open={open ? "" : undefined} exit={slotExit}>
                <AnimatePresence initial={false}>
                  {!item ? <motion.span key="skeleton" className={styles.skeleton} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .12 } }} transition={{ duration: .16 }}>
                    <span className={styles.skeletonTop}><span className={styles.bar} style={{ width: 14 }} /><span className={styles.bar} style={{ width: "44%" }} /></span>
                    <span className={styles.bar} style={{ width: "88%" }} />
                    <span className={styles.bar} style={{ width: "62%" }} />
                  </motion.span> : null}
                </AnimatePresence>
                {item ? <SourceCard key={item.key} item={item} highlighted={highlighted === item.n} enter={mounted} reduced={reduced}
                  describedBy={open ? `${id}-preview-${item.n}` : undefined} onSourceClick={onSourceClick} handlers={cardHandlers(item.n)} /> : null}
                <AnimatePresence>
                  {open && item ? <PreviewCard key="preview" id={`${id}-preview-${item.n}`} item={item} placement={open} reduced={reduced} /> : null}
                </AnimatePresence>
              </motion.li>;
            })}
            {stackSlot ? <motion.li key="stack" className={styles.slot} exit={slotExit}>
              <AnimatePresence initial={false}>
                {!overflow.length ? <motion.span key="skeleton" className={styles.skeleton} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .12 } }} transition={{ duration: .16 }}>
                  <span className={styles.skeletonTop}><span className={cx(styles.bar, styles.barMarks)} /></span>
                  <span className={styles.bar} style={{ width: "46%" }} />
                  <span className={styles.bar} style={{ width: "70%" }} />
                </motion.span> : null}
              </AnimatePresence>
              {overflow.length ? <motion.button type="button" className={cx(styles.card, styles.stack)} aria-expanded={false} aria-controls={`${id}-list`}
                aria-label={`Show ${overflow.length} more ${overflow.length === 1 ? "source" : "sources"}: ${overflow.map(item => item.site).join(", ")}`}
                initial={mounted ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: .18, ease }}
                onClick={() => setExpanded(true)}>
                <span className={styles.stackMarks} aria-hidden="true">
                  <AnimatePresence initial={false}>
                    {overflow.slice(0, 3).map((item, index) => <motion.span key={item.key} className={styles.stackMark} style={{ zIndex: 3 - index }}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", visualDuration: .22, bounce: 0 }}>
                      <SourceMark mark={item.mark} icon={item.source.icon} host={item.host} size={12} />
                    </motion.span>)}
                  </AnimatePresence>
                </span>
                <span className={styles.stackText}>
                  <span className={styles.stackCount}>+<Roll value={overflow.length} reduced={reduced} /> more</span>
                  <span className={styles.stackSites}>{[...new Set(overflow.map(item => item.site.split(" · ")[0]))].join(", ")}</span>
                </span>
              </motion.button> : null}
            </motion.li> : null}
            </AnimatePresence>
          </motion.ul> : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  </SourceCardsContext.Provider>;
}

interface SourceCardProps {
  item: ResolvedSource;
  highlighted: boolean;
  enter: boolean;
  reduced: boolean;
  describedBy?: string;
  onSourceClick?: (source: SourceCardsSource, n: number) => void;
  handlers: CardHandlers;
}

type CardHandlers = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
};

function SourceCard({ item, highlighted, enter, reduced, describedBy, onSourceClick, handlers }: SourceCardProps) {
  const { source, n, host } = item;
  const body = <>
    <span className={styles.cardTop}>
      <span className={styles.cardMark}><SourceMark mark={item.mark} icon={source.icon} host={host} /></span>
      <span className={styles.domain}>{item.domain}</span>
      <span className={cx(styles.chip, styles.cardChip)} aria-hidden="true">{n}</span>
    </span>
    <span className={styles.cardTitle}>{source.title}</span>
  </>;
  const shared = {
    className: styles.card,
    "data-highlighted": highlighted || undefined,
    "aria-describedby": describedBy,
    initial: enter ? (reduced ? { opacity: 0 } : { opacity: 0, y: 4 }) : false,
    animate: { opacity: 1, y: 0 },
    transition: { duration: .18, ease },
    ...handlers,
  } as const;
  if (onSourceClick) {
    return <motion.button type="button" {...shared} aria-label={`${n}. ${source.title}, ${host}`} onClick={() => onSourceClick(source, n)}>{body}</motion.button>;
  }
  return <motion.a {...shared} href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`${n}. ${source.title}, ${host}, opens in a new tab`}>{body}</motion.a>;
}

function PreviewCard({ id, item, placement, reduced }: { id: string; item: ResolvedSource; placement: Preview; reduced: boolean }) {
  const y = placement.side === "top" ? 4 : -4;
  return <motion.div id={id} role="tooltip" className={styles.preview} data-side={placement.side} data-align={placement.align}
    style={{ transformOrigin: `${placement.align === "start" ? "left" : "right"} ${placement.side === "top" ? "bottom" : "top"}` }}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }}
    transition={{ duration: .16, ease }}>
    <span className={styles.previewHead}>
      <SourceMark mark={item.mark} icon={item.source.icon} host={item.host} size={16} />
      <span className={styles.previewSite}>{item.site}</span>
      {item.source.published ? <span className={styles.previewDate}>{item.source.published}</span> : null}
    </span>
    <span className={styles.previewTitle}>{item.source.title}</span>
    {item.source.snippet ? <span className={styles.previewSnippet}>{item.source.snippet}</span> : null}
    <span className={styles.previewUrl}><span className={styles.previewPath}>{item.host}{item.path}</span><ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" /></span>
  </motion.div>;
}
