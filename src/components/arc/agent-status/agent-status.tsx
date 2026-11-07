"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Hand, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import { Button } from "../button/button";
import { createRunClock, formatClock, formatSpan, speakSpan } from "./agent-status-clock";
import { Orb, RollingLabel, StaticLabel, StepList, StepSegments } from "./agent-status-parts";
import type { LabelView } from "./agent-status-parts";
import { useAgentRunSimulation } from "./agent-status-sim";
import type { AgentActivity, AgentInfo, AgentRunStatus, AgentStep } from "./agent-status-types";
import styles from "./agent-status.module.css";

export type { AgentActivity, AgentIcon, AgentInfo, AgentRunStatus, AgentStep, AgentStepStatus } from "./agent-status-types";
export { agentScenarios, useAgentRunSimulation } from "./agent-status-sim";
export type { AgentRunSimulation, AgentScenarioId } from "./agent-status-sim";

export interface AgentStatusProps {
  /** The run's state. Leave it out to play the built in simulated coding run. */
  status?: AgentRunStatus;
  /** What the agent is doing now. In done it is the outcome ("6 files changed"); in failed, the failure ("Tests failed · 2 errors"). */
  activity?: AgentActivity;
  /** Every step of the run, including pending ones, so the progress bar knows the total. The panel lists the latest few. */
  steps?: AgentStep[];
  /** When the run started. The timer counts from here and leaves out paused and failed time. */
  startedAt?: number | Date;
  /** When the run ended. Defaults to the moment the status turned done or stopped. */
  endedAt?: number | Date;
  /** The model or agent running, with its mark. */
  agent?: AgentInfo;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onApprove?: () => void;
  onDeny?: () => void;
  onRetry?: () => void;
  /** Shows an "Open run" button in the panel, for a full log or trace view. */
  onOpenRun?: () => void;
  /** Milliseconds after done or stopped before the pill settles back to Ready. Null keeps the result. Defaults to 4000. */
  settleAfter?: number | null;
  /** Which edge the panel grows from. Defaults to center. */
  align?: "start" | "center" | "end";
  /** Controls the panel. Pair with onExpandedChange. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** How many recent steps the panel lists. Defaults to 5. */
  maxSteps?: number;
  /** A one-off message for screen readers, such as the result of an action. */
  notice?: string;
  className?: string;
}

const PILL = 40;
const PANEL = 384;
const COMPACT = 400;
const serverNow = () => 0;
const defaultAgent: AgentInfo = { name: "Agent" };
const toMs = (value: number | Date | undefined) => value instanceof Date ? value.getTime() : value;
const even = (value: number) => Math.ceil(value / 2) * 2;
const ease = [...motionTokens.ease.standard] as [number, number, number, number];

/**
 * A compact live status pill for a running AI agent, for an app header or the space above a composer. It shows the current
 * activity, a live ring and an elapsed timer, asks for approval inline, and expands in place into the run's recent steps,
 * a step progress bar and run controls. With no props it plays a simulated coding run.
 */
export function AgentStatus(props: AgentStatusProps) {
  if (props.status === undefined) return <SimulatedAgentStatus {...props} />;
  return <AgentStatusView {...props} status={props.status} />;
}

function SimulatedAgentStatus(props: AgentStatusProps) {
  const run = useAgentRunSimulation("coding");
  return <AgentStatusView {...props} status={run.status} activity={run.activity} steps={run.steps} startedAt={run.startedAt} endedAt={run.endedAt} agent={run.agent} notice={run.notice}
    onPause={run.onPause} onResume={run.onResume} onStop={run.onStop} onApprove={run.onApprove} onDeny={run.onDeny} onRetry={run.onRetry} onOpenRun={run.onOpenRun} />;
}

/** Wraps a control that can disappear. If it held focus when it leaves, focus moves to the pill instead of the page. */
function Leaving({ children, className, onLeave, reduced }: { children: ReactNode; className?: string; onLeave: () => void; reduced: boolean }) {
  const present = useIsPresent();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!present && ref.current?.contains(document.activeElement)) onLeave();
  }, [present, onLeave]);
  return <motion.span ref={ref} className={className} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: reduced ? 0 : motionTokens.duration.fast, delay: reduced ? 0 : .06, ease } }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : .1, ease } }}>{children}</motion.span>;
}

function AgentStatusView({
  status, activity, steps = [], startedAt, endedAt, agent = defaultAgent, onPause, onResume, onStop, onApprove, onDeny, onRetry, onOpenRun,
  settleAfter = 4000, align = "center", expanded: expandedProp, defaultExpanded = false, onExpandedChange, maxSteps = 5, notice, className,
}: AgentStatusProps & { status: AgentRunStatus }) {
  const reduced = useReducedMotion() ?? false;
  const panelId = useId();
  const start = toMs(startedAt), end = toMs(endedAt);
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLButtonElement>(null);
  const ghostCollapsed = useRef<HTMLDivElement>(null);
  const ghostExpanded = useRef<HTMLDivElement>(null);

  const [ownExpanded, setOwnExpanded] = useState(defaultExpanded);
  const expanded = expandedProp ?? ownExpanded;
  const setExpanded = useCallback((next: boolean) => {
    if (expandedProp === undefined) setOwnExpanded(next);
    onExpandedChange?.(next);
  }, [expandedProp, onExpandedChange]);
  const focusHead = useCallback(() => headRef.current?.focus({ preventScroll: true }), []);

  // A finished run shows its result, then settles back to Ready. A new run or status resets the countdown.
  const terminalKey = status === "done" || status === "stopped" ? `${status}:${end ?? start ?? 0}` : null;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!terminalKey || settleAfter == null) return;
    const id = window.setTimeout(() => setSettledKey(terminalKey), settleAfter);
    return () => window.clearTimeout(id);
  }, [terminalKey, settleAfter]);
  const view: AgentRunStatus = terminalKey && settledKey === terminalKey ? "idle" : status;

  const [clock] = useState(createRunClock);
  useEffect(() => { clock.sync({ startedAt: start, status, endedAt: end }); }, [clock, start, status, end]);
  const now = useSyncExternalStore(clock.subscribe, clock.getSnapshot, serverNow);
  const elapsed = clock.since(start, now);
  const timerText = formatClock(elapsed);

  let label: LabelView;
  if (view === "working") label = { key: `working:${activity?.label ?? ""}`, text: activity?.label ?? "Working", icon: activity?.icon, progress: activity?.progress, tone: "live" };
  else if (view === "needs-input") label = { key: `input:${activity?.label ?? ""}`, text: activity?.label ?? "Needs your input", icon: activity?.icon ?? Hand, tone: "plain" };
  else if (view === "paused") label = { key: "paused", text: "Paused", icon: Pause, tone: "quiet" };
  else if (view === "done") label = { key: `done:${activity?.label ?? ""}`, text: `Done in ${formatSpan(elapsed)}${activity?.label ? ` · ${activity.label}` : ""}`, tone: "plain" };
  else if (view === "failed") label = { key: `failed:${activity?.label ?? ""}`, text: activity?.label ?? "Run failed", tone: "plain" };
  else if (view === "stopped") label = { key: "stopped", text: `Stopped after ${formatSpan(elapsed)}`, tone: "quiet" };
  else label = { key: "idle", text: "Ready", tone: "quiet" };

  // Width: two hidden ghosts hold the natural width of the collapsed pill and of the expanded header.
  const [natural, setNatural] = useState({ collapsed: 0, expanded: 0 });
  const [avail, setAvail] = useState(0);
  const [bodyH, setBodyH] = useState(0);
  useLayoutEffect(() => {
    const a = ghostCollapsed.current, b = ghostExpanded.current, parent = rootRef.current?.parentElement;
    if (!a || !b || typeof ResizeObserver === "undefined") return;
    const measure = () => setNatural(prev => {
      const collapsed = even(a.getBoundingClientRect().width), expandedWidth = even(b.getBoundingClientRect().width);
      return prev.collapsed === collapsed && prev.expanded === expandedWidth ? prev : { collapsed, expanded: expandedWidth };
    });
    const ghosts = new ResizeObserver(measure);
    ghosts.observe(a);
    ghosts.observe(b);
    const room = new ResizeObserver(([entry]) => { if (entry) setAvail(Math.floor(entry.contentRect.width)); });
    if (parent) room.observe(parent);
    return () => { ghosts.disconnect(); room.disconnect(); };
  }, []);
  const bodyRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setBodyH(Math.ceil(node.offsetHeight)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Inline actions live in the collapsed pill; open, they move to the panel footer. The footprint always follows the collapsed pill.
  const compact = avail > 0 && avail < COMPACT;
  const collapsedInline = view === "needs-input" && (onApprove || onDeny) ? "approval" : view === "failed" && onRetry ? "retry" : null;
  const inline = expanded ? null : collapsedInline;
  const hasTimer = start !== undefined && (view === "working" || view === "paused" || view === "needs-input");
  const timerCollapsed = hasTimer && !(compact && collapsedInline);
  const timerVisible = expanded ? hasTimer : timerCollapsed;

  const collapsedW = natural.collapsed ? avail ? Math.min(natural.collapsed, avail) : natural.collapsed : 0;
  // The panel opens at least as wide as the pill it grows from and keeps that width while open, so its rows never reflow.
  const [panelBase, setPanelBase] = useState(PANEL);
  const toggle = () => {
    if (!expanded) setPanelBase(Math.max(PANEL, collapsedW));
    setExpanded(!expanded);
  };
  const panelW = avail ? Math.min(avail, panelBase) : panelBase;
  const width = expanded ? panelW : collapsedW;
  const height = expanded && bodyH ? PILL + bodyH : PILL;

  const surfaceW = useMotionValue<number | string>("max-content");
  const rootW = useMotionValue<number | string>("auto");
  const surfaceH = useMotionValue(PILL);
  const ready = useRef(false);
  const lastExpanded = useRef(expanded);
  const fadeBase = useRef(0);

  // The label fades out at its right edge only while it is wider than its room, so a growing pill reveals it cleanly.
  const paintFade = useCallback((value: number | string) => {
    const node = surfaceRef.current;
    if (!node) return;
    const room = typeof value === "number" ? value : fadeBase.current;
    node.style.setProperty("--fade", `${Math.min(24, Math.max(0, fadeBase.current - room))}px`);
  }, []);
  useMotionValueEvent(surfaceW, "change", paintFade);

  useLayoutEffect(() => {
    if (!collapsedW) return;
    const toggled = lastExpanded.current !== expanded;
    lastExpanded.current = expanded;
    if (!ready.current || reduced) {
      ready.current = true;
      surfaceW.jump(width);
      rootW.jump(collapsedW);
      return;
    }
    animate(surfaceW, width, toggled ? motionTokens.spring.smooth : { type: "spring", visualDuration: 0.26, bounce: 0 } as const);
    animate(rootW, collapsedW, { type: "spring", visualDuration: 0.26, bounce: 0 } as const);
  }, [width, collapsedW, expanded, reduced, surfaceW, rootW]);

  useLayoutEffect(() => {
    if (!ready.current || reduced) { surfaceH.jump(height); return; }
    animate(surfaceH, height, motionTokens.spring.smooth);
  }, [height, reduced, surfaceH]);

  useLayoutEffect(() => {
    fadeBase.current = expanded ? natural.expanded : natural.collapsed;
    paintFade(surfaceW.get());
  }, [expanded, natural, paintFade, surfaceW]);

  // Escape or a press outside closes the panel.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (event: PointerEvent) => { if (!surfaceRef.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [expanded, setExpanded]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !expanded) return;
    event.stopPropagation();
    setExpanded(false);
    focusHead();
  };
  // If the focused control disappears with a state change, focus falls back to the pill.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget || !expanded) return;
    const from = event.target;
    requestAnimationFrame(() => { if (!from.isConnected && document.activeElement === document.body) focusHead(); });
  };

  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!opened) return;
    const id = window.setTimeout(() => setOpened(false), 1600);
    return () => window.clearTimeout(id);
  }, [opened]);

  const primary = view === "working" && onPause ? { label: "Pause", Icon: Pause, run: onPause, accent: false }
    : view === "paused" && onResume ? { label: "Resume", Icon: Play, run: onResume, accent: true }
      : view === "needs-input" && onApprove ? { label: "Approve", Icon: Check, run: onApprove, accent: true }
        : view === "failed" && onRetry ? { label: "Retry", Icon: RotateCcw, run: onRetry, accent: true } : null;
  const secondary = (view === "working" || view === "paused") && onStop ? { label: "Stop", Icon: Square, run: onStop }
    : view === "needs-input" && onDeny ? { label: "Deny", Icon: X, run: onDeny } : null;

  const inlineButtons = (ghost: boolean) => {
    const tab = ghost ? -1 : undefined;
    if (collapsedInline === "retry") return <Button variant="primary" size="sm" tabIndex={tab} className={`${styles.inlineButton} ${styles.accentButton} ${compact ? styles.iconButton : ""}`} aria-label={compact ? "Retry" : undefined} onClick={onRetry}>
      <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />{compact ? null : "Retry"}
    </Button>;
    return <>
      {onDeny ? <Button variant="secondary" size="sm" tabIndex={tab} className={`${styles.inlineButton} ${compact ? styles.iconButton : ""}`} aria-label={compact ? "Deny" : undefined} onClick={onDeny}>
        {compact ? <X size={16} strokeWidth={1.75} aria-hidden="true" /> : "Deny"}
      </Button> : null}
      {onApprove ? <Button variant="primary" size="sm" tabIndex={tab} className={`${styles.inlineButton} ${styles.accentButton} ${compact ? styles.iconButton : ""}`} aria-label={compact ? "Approve" : undefined} onClick={onApprove}>
        {compact ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : "Approve"}
      </Button> : null}
    </>;
  };

  const started = steps.some(step => step.status !== "pending");
  const activeIndex = steps.findIndex(step => step.status === "active" || step.status === "waiting" || step.status === "failed");
  const finished = steps.filter(step => step.status === "done" || step.status === "skipped").length;
  const stepText = !steps.length ? "" : activeIndex >= 0 ? `Step ${activeIndex + 1} of ${steps.length}` : `${finished} of ${steps.length} steps`;
  const spoken = view === "done" ? `${agent.name}: done in ${speakSpan(elapsed)}${activity?.label ? `, ${activity.label}` : ""}` : view === "stopped" ? `${agent.name}: stopped after ${speakSpan(elapsed)}` : `${agent.name}: ${label.text}`;
  const headLabel = `${agent.name}: ${label.text}${label.progress ? ` ${label.progress.value} of ${label.progress.total}` : ""}${timerVisible ? `, ${timerText} elapsed` : ""}`;
  const surfaceStyle = { width: surfaceW, height: surfaceH, "--panel-w": `${panelW - 2}px` } as unknown as CSSProperties;

  return <motion.div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} data-align={align} style={{ width: rootW }}>
    <motion.div ref={surfaceRef} className={styles.surface} data-expanded={expanded} data-state={view} style={surfaceStyle} onKeyDown={onKeyDown} onBlur={onBlur}>
      <div className={styles.row}>
        <button ref={headRef} type="button" className={styles.head} data-actions={inline ? "" : undefined} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} aria-label={headLabel} onClick={toggle}>
          <Orb state={view} mark={agent.mark} reduced={reduced} />
          <RollingLabel view={label} reduced={reduced} />
          <AnimatePresence mode="popLayout" initial={false}>
            {timerVisible ? <motion.span key="timer" className={styles.timer} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : .1 } }} transition={{ duration: reduced ? 0 : motionTokens.duration.fast, ease }}>{timerText}</motion.span> : null}
          </AnimatePresence>
        </button>
        <AnimatePresence mode="popLayout" initial={false}>
          {inline ? <Leaving key={`${inline}:${compact}`} className={styles.actions} onLeave={focusHead} reduced={reduced}>{inlineButtons(false)}</Leaving> : null}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {expanded ? <motion.div key="body" ref={bodyRef} id={panelId} role="region" aria-label={`${agent.name} run details`} className={styles.body}
          initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: reduced ? 0 : .2, delay: reduced ? 0 : .08, ease } }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : .1, ease } }}>
          {started ? <>
            <div className={styles.progress}>
              <div className={styles.meta}><span className={styles.agentName}>{agent.name}</span><span>{stepText}</span></div>
              <StepSegments steps={steps} progress={activity?.progress} />
            </div>
            <StepList steps={steps} progress={view === "working" || view === "paused" ? activity?.progress : undefined} running={view === "working"} clock={clock} now={now} reduced={reduced} limit={maxSteps} />
          </> : <p className={styles.empty}>{view === "idle" ? `No run yet. Steps show here while ${agent.name} works.` : `Steps show here as ${agent.name} works.`}</p>}
          {primary || secondary || (onOpenRun && started) ? <div className={styles.footer}>
            <AnimatePresence mode="popLayout" initial={false}>
              {primary ? <Leaving key="primary" className={styles.slot} onLeave={focusHead} reduced={reduced}>
                <Button variant={primary.accent ? "primary" : "secondary"} size="sm" className={primary.accent ? styles.accentButton : undefined} onClick={primary.run}>
                  <primary.Icon size={16} strokeWidth={1.75} aria-hidden="true" />{primary.label}
                </Button>
              </Leaving> : null}
              {secondary ? <Leaving key="secondary" className={styles.slot} onLeave={focusHead} reduced={reduced}>
                <Button variant="secondary" size="sm" onClick={secondary.run}>
                  <secondary.Icon size={16} strokeWidth={1.75} aria-hidden="true" />{secondary.label}
                </Button>
              </Leaving> : null}
            </AnimatePresence>
            {onOpenRun && started ? <Button variant="ghost" size="sm" className={compact ? `${styles.open} ${styles.openIcon}` : styles.open} aria-label={compact ? opened ? "Opened" : "Open run" : undefined} onClick={() => { onOpenRun(); setOpened(true); }}>
              {compact ? opened ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
                : opened ? <><Check size={16} strokeWidth={1.75} aria-hidden="true" />Opened</> : <>Open run<ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" /></>}
            </Button> : null}
          </div> : null}
        </motion.div> : null}
      </AnimatePresence>
    </motion.div>

    <div className={styles.ghosts} aria-hidden="true" inert>
      <div ref={ghostCollapsed} className={styles.ghost}>
        <span className={styles.head} data-actions={collapsedInline ? "" : undefined}>
          <span className={styles.orbSpace} />
          <StaticLabel view={label} />
          {timerCollapsed ? <span className={styles.timer}>{timerText}</span> : null}
        </span>
        {collapsedInline ? <span className={styles.actions}>{inlineButtons(true)}</span> : null}
      </div>
      <div ref={ghostExpanded} className={styles.ghost}>
        <span className={styles.head}>
          <span className={styles.orbSpace} />
          <StaticLabel view={label} />
          {hasTimer ? <span className={styles.timer}>{timerText}</span> : null}
        </span>
      </div>
    </div>
    <span className={styles.srOnly} role="status">{[spoken, notice].filter(Boolean).join(". ")}</span>
  </motion.div>;
}

export default AgentStatus;
