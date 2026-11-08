"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Bell, Check, FileText, Minus, PenLine, ScanText, Sheet, Split } from "lucide-react";
import { Button } from "../components/arc/button/button";
import { motionTokens } from "../components/arc/lib/motion-tokens";
import { ActionLink } from "../components/arc/blocks/hero-section/hero-content";
import type { HeroAction } from "../components/arc/blocks/hero-section/hero-content";
import { ease, heroGroup, heroRise, useHeroReducedMotion } from "../components/arc/blocks/hero-section/hero-motion";
import shell from "../components/arc/blocks/hero-section/hero-section.module.css";
import styles from "../components/arc/blocks/hero-section/hero-relay.module.css";

type NodeId = "trigger" | "lookup" | "branch" | "slack" | "linear" | "warehouse";
type Status = "idle" | "running" | "done" | "skipped";

/**
 * Bank of America's last three earnings filings. EPS and the change from the prior quarter come from each quarter's
 * Supplemental Information (8-K Exhibit 99.3); prior-quarter comparisons avoid the 2025 restatement. Step times are
 * illustrative. The branch sends a filing to the coverage team when EPS moves more than 10% in a quarter.
 */
const EVENTS = [
  { company: "Bank of America", filed: "Oct 14, 2026", quarter: "3Q26", reading: "EPS $0.91, down 24.8% from 2Q26", routed: true, total: "52 s", s: { lookup: "6.2 s", branch: "0.1 s", slack: "0.4 s", linear: "41 s", warehouse: "5.8 s" } },
  { company: "Bank of America", filed: "Jul 14, 2026", quarter: "2Q26", reading: "EPS $1.21, up 9.0% from 1Q26", routed: false, total: "13 s", s: { lookup: "5.9 s", branch: "0.1 s", slack: "", linear: "", warehouse: "6.4 s" } },
  { company: "Bank of America", filed: "Apr 15, 2026", quarter: "1Q26", reading: "EPS $1.11, up 13.3% from 4Q25", routed: true, total: "49 s", s: { lookup: "6.6 s", branch: "0.1 s", slack: "0.3 s", linear: "38 s", warehouse: "6.1 s" } },
] as const;
type RelayEvent = (typeof EVENTS)[number];

/**
 * One run in phases. Odd phases run a step, even phases carry the data along the edges out of it; the last phase holds the
 * finished run on screen before the next event arrives. Durations in milliseconds.
 */
const PHASES = [900, 420, 380, 640, 380, 360, 440, 760, 2800];
const DONE = PHASES.length - 1;
const STEPS: Record<NodeId, [start: number, end: number]> = { trigger: [1, 2], lookup: [3, 4], branch: [5, 6], slack: [7, 8], linear: [7, 8], warehouse: [7, 8] };
const ACTIONS = ["slack", "linear", "warehouse"] as const;

function statusOf(id: NodeId, phase: number, event: RelayEvent): Status {
  const [start, end] = STEPS[id];
  if ((id === "slack" || id === "linear") && !event.routed && phase >= 6) return "skipped";
  return phase < start ? "idle" : phase < end ? "running" : "done";
}

/** The graph is drawn at a fixed size and scaled to its column, like a screenshot, so it never reflows mid run. */
type Box = { x: number; y: number; w: number; h: number };
const LAYOUTS = {
  wide: {
    width: 640, height: 524, summary: 480,
    nodes: { trigger: { x: 170, y: 0, w: 300, h: 60 }, lookup: { x: 170, y: 112, w: 300, h: 60 }, branch: { x: 170, y: 224, w: 300, h: 60 }, slack: { x: 0, y: 356, w: 200, h: 84 }, linear: { x: 220, y: 356, w: 200, h: 84 }, warehouse: { x: 440, y: 356, w: 200, h: 84 } } as Record<NodeId, Box>,
  },
  narrow: {
    width: 344, height: 316, summary: 0,
    nodes: { trigger: { x: 0, y: 0, w: 344, h: 52 }, lookup: { x: 0, y: 78, w: 344, h: 52 }, branch: { x: 0, y: 156, w: 344, h: 52 }, slack: { x: 0, y: 244, w: 108, h: 72 }, linear: { x: 118, y: 244, w: 108, h: 72 }, warehouse: { x: 236, y: 244, w: 108, h: 72 } } as Record<NodeId, Box>,
  },
};
type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

const EDGES: { from: NodeId; to: NodeId; phase: number }[] = [
  { from: "trigger", to: "lookup", phase: 2 },
  { from: "lookup", to: "branch", phase: 4 },
  { from: "branch", to: "slack", phase: 6 },
  { from: "branch", to: "linear", phase: 6 },
  { from: "branch", to: "warehouse", phase: 6 },
];

function edgePath(layout: Layout, from: NodeId, to: NodeId) {
  const a = layout.nodes[from], b = layout.nodes[to];
  const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
  const mid = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + mid} ${x2} ${y2 - mid} ${x2} ${y2}`;
}

const RESULTS: Record<(typeof ACTIONS)[number], (event: RelayEvent) => string> = {
  slack: event => `Sent in ${event.s.slack}`,
  linear: event => `${event.quarter} recap in ${event.s.linear}`,
  warehouse: event => `13 quarters in ${event.s.warehouse}`,
};

const glyph = (Icon: typeof FileText) => <Icon size={16} strokeWidth={1.75} className={styles.glyph} aria-hidden="true" />;

export interface FiledUnderPipelineHeroProps {
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  animateIn?: boolean;
  className?: string;
}

/**
 * FiledUnder's pipeline as a split hero: an earnings filing lands, the supplement is read, a rule decides whether the
 * coverage team hears about it, and the memo and model update on their own. Filings replay while the hero is on screen;
 * "Run next filing" plays the next one at once. Under reduced motion each run shows finished.
 */
export function FiledUnderPipelineHero({ primaryAction = { label: "Start free", doneLabel: "Workspace created" }, secondaryAction = { label: "See a sample memo", doneLabel: "Opening the memo" }, animateIn = true, className }: FiledUnderPipelineHeroProps) {
  const item = heroRise;
  const reduced = useHeroReducedMotion();
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<keyof typeof LAYOUTS>("wide");
  const [scale, setScale] = useState(1);
  const [run, setRun] = useState({ index: 0, count: 1, phase: 0 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const next = width < 520 ? "narrow" : "wide";
      setMode(next);
      setScale(Math.min(1, width / LAYOUTS[next].width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The run only plays while the hero is on screen and the tab is visible.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let onScreen = false;
    const sync = () => setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([entry]) => { if (!entry) return; onScreen = entry.isIntersecting; sync(); });
    io.observe(node);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  useEffect(() => {
    if (reduced || !visible) return;
    const timer = window.setTimeout(() => setRun(current => current.phase < DONE
      ? { ...current, phase: current.phase + 1 }
      : { index: (current.index + 1) % EVENTS.length, count: current.count + 1, phase: 0 }), PHASES[run.phase]);
    return () => window.clearTimeout(timer);
  }, [run.phase, run.index, reduced, visible]);

  const sendTest = () => setRun(current => ({ index: (current.index + 1) % EVENTS.length, count: current.count + 1, phase: 1 }));

  const layout = LAYOUTS[mode];
  const event = EVENTS[run.index]!;
  // Reduced motion: every event is shown as its finished run; the button moves to the next one at once.
  const phase = reduced ? DONE : run.phase;
  const status = (id: NodeId) => statusOf(id, phase, event);
  const narrow = mode === "narrow";

  // Reduced motion: Motion skips every transform (rise, tilt entrance); opacity still fades briefly.
  return <MotionConfig reducedMotion="user"><section ref={root} className={[shell.hero, shell.screen, styles.hero, className].filter(Boolean).join(" ")}>
    <div className={styles.inner}>
      <motion.div className={styles.copy} variants={heroGroup} initial={animateIn ? "hidden" : false} animate="shown">
        <motion.h1 variants={item} className={[shell.title, styles.title].join(" ")}>Filings in. Research out.</motion.h1>
        <motion.p variants={item} className={[shell.description, styles.description].join(" ")}>FiledUnder reads each earnings filing the day it lands, updates your model and drafts a cited recap, then tells your team when the numbers move.</motion.p>
        <motion.div variants={item} className={styles.actions}>
          <ActionLink action={primaryAction} kind="primary" />
          <ActionLink action={secondaryAction} kind="secondary" />
        </motion.div>
        <motion.p variants={item} className={styles.fine}>Every figure links back to its page in the SEC filing.</motion.p>
      </motion.div>

      <motion.div
        className={styles.canvas}
        initial={animateIn ? { opacity: 0, y: 24 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: ease.enter, delay: .28 }}
      >
        <div className={styles.toolbar}>
          <span className={styles.file}><i className={styles.live} data-on={visible || reduced || undefined} aria-hidden="true" />Watching BAC filings</span>
          <Button variant="secondary" size="sm" onClick={sendTest}>Run next filing</Button>
        </div>
        <div ref={stage} className={styles.stage} style={{ height: layout.height * scale }}>
          <div className={styles.graph} role="group" aria-label={`FiledUnder pipeline for the ${event.company} ${event.quarter} filing`} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
            <svg className={styles.edges} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {EDGES.map(edge => {
                const d = edgePath(layout, edge.from, edge.to);
                const skipped = status(edge.to) === "skipped";
                const lit = phase >= edge.phase && !skipped;
                return <g key={`${edge.from}-${edge.to}`}>
                  <path d={d} className={styles.wire} data-skipped={skipped || undefined} />
                  <motion.path
                    d={d}
                    className={styles.flow}
                    initial={false}
                    animate={{ pathLength: lit ? 1 : 0, opacity: lit ? 1 : 0 }}
                    transition={lit && !reduced ? { pathLength: { duration: PHASES[edge.phase]! / 1000, ease: ease.inOut }, opacity: { duration: .08 } } : { duration: 0 }}
                  />
                </g>;
              })}
            </svg>

            <RelayNode box={layout.nodes.trigger} status={status("trigger")} icon={glyph(FileText)} title="Earnings 8-K filed" sub={`${event.company}, ${event.filed}`} />
            <RelayNode box={layout.nodes.lookup} status={status("lookup")} icon={glyph(ScanText)} title="Read the supplement" sub={status("lookup") === "done" ? event.reading : "Segments, expenses and credit"} meta={event.s.lookup} />
            <RelayNode box={layout.nodes.branch} status={status("branch")} icon={glyph(Split)} title="EPS moved over 10%" sub={status("branch") === "done" ? event.routed ? "Yes, alert coverage" : "No, update only" : "Condition"} meta={event.s.branch} />
            {ACTIONS.map(id => {
              const s = status(id);
              const copy = {
                slack: { icon: glyph(Bell), title: narrow ? "Alert" : "Alert #coverage", waiting: "Coverage team" },
                linear: { icon: glyph(PenLine), title: narrow ? "Memo" : "Draft the recap", waiting: "Cited memo" },
                warehouse: { icon: glyph(Sheet), title: narrow ? "Model" : "Update the model", waiting: "Quarterly model" },
              }[id];
              const sub = s === "skipped" ? "Skipped" : s === "done" ? narrow ? event.s[id] : RESULTS[id](event) : s === "running" ? "Running" : narrow ? "Waiting" : copy.waiting;
              return <RelayNode key={id} box={layout.nodes[id]} compact status={s} icon={copy.icon} title={copy.title} sub={sub} />;
            })}

            {!narrow && <div className={styles.summary} style={{ top: layout.summary, width: layout.width }}>
              <span className={styles.event}><code>8-K · {event.quarter}</code><span>Filing <span className={styles.num}>{run.count.toLocaleString("en-US")}</span></span></span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={phase === DONE ? `done-${run.count}` : phase === 0 ? "waiting" : "running"}
                  className={styles.result}
                  data-done={phase === DONE || undefined}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: motionTokens.duration.fast, ease: ease.standard }}
                >
                  {phase === DONE ? <><Check size={14} strokeWidth={2} aria-hidden="true" /><span>Done in <span className={styles.num}>{event.total}</span></span></> : phase === 0 ? "Waiting for the next filing" : <><i className={styles.spinner} aria-hidden="true" />Running</>}
                </motion.span>
              </AnimatePresence>
            </div>}
          </div>
        </div>
      </motion.div>
    </div>
  </section></MotionConfig>;
}

function RelayNode({ box, status, icon, title, sub, meta, compact = false }: { box: Box; status: Status; icon: ReactNode; title: string; sub: string; meta?: string; compact?: boolean }) {
  return <div className={styles.node} data-status={status} data-compact={compact || undefined} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
    <span className={styles.icon}>{icon}</span>
    <span className={styles.text}>
      <strong>{title}</strong>
      <small>{sub}</small>
    </span>
    <span className={styles.state}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          className={styles.stateInner}
          initial={{ opacity: 0, scale: .6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: .6 }}
          transition={motionTokens.spring.snappy}
        >
          {status === "running" ? <i className={styles.spinner} role="img" aria-label="Running" />
            : status === "done" ? <>{meta && <span className={styles.meta}>{meta}</span>}<Check size={14} strokeWidth={2} className={styles.check} role="img" aria-label="Done" /></>
            : status === "skipped" ? <Minus size={14} strokeWidth={2} className={styles.skip} role="img" aria-label="Skipped" />
            : <i className={styles.pending} role="img" aria-label="Waiting" />}
        </motion.span>
      </AnimatePresence>
    </span>
  </div>;
}

export default FiledUnderPipelineHero;
