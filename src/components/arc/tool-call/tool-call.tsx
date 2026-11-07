"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls, Transition } from "motion/react";
import { Ban, ChevronDown, CircleAlert, RotateCcw, ShieldQuestionMark } from "lucide-react";
import { Button } from "../button/button";
import { CopyButton } from "../copy-button/copy-button";
import { TextShimmer } from "../text-shimmer/text-shimmer";
import { motionTokens } from "../lib/motion-tokens";
import { toolCallSampleList, toolCallSamples } from "./tool-call-data";
import { ToolMark, toolKey, toolName } from "./tool-call-marks";
import { InputList, OutputView, inputText, outputText, summarize } from "./tool-call-output";
import type { ToolCallData, ToolCallRenderOutput, ToolCallStatus } from "./tool-call-types";
import styles from "./tool-call.module.css";

export type { ToolCallCustomTool, ToolCallData, ToolCallInput, ToolCallListItem, ToolCallOutput, ToolCallRenderOutput, ToolCallStatus, ToolCallTool, ToolCallToolId, ToolCallValue } from "./tool-call-types";
export { toolCallSampleList, toolCallSamples } from "./tool-call-data";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const SIMULATED_DELAY = 900;

/** 640ms, 1.2s, 12s: short and tabular, so a duration never shifts its neighbours. */
export function formatDuration(ms?: number) {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

const titleFor = (call: ToolCallData, status: ToolCallStatus) => call.titles?.[status] ?? call.title;

function describe(call: ToolCallData, status: ToolCallStatus) {
  const name = toolName(call.tool);
  const title = titleFor(call, status);
  if (status === "running") return `${name}: ${title}`;
  if (status === "success") return `${name}: ${[title, call.summary ?? summarize(call.output)].filter(Boolean).join(", ")}`;
  if (status === "error") return `${name}: ${title}. ${call.message ?? ""}`.trim();
  if (status === "approval") return `${name}: ${title} needs your approval`;
  return `${name}: ${title}, denied`;
}

const statusLabel: Record<ToolCallStatus, string> = { running: "Running", success: "Done", error: "Failed", approval: "Needs approval", denied: "Denied" };

/* Height changes: one critically damped spring for every panel, row and fold, or an instant cut with reduced motion. */
const heightTransition = (reduced: boolean): Transition => reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };

/**
 * Springs an element to the height of its content whenever that content grows or shrinks (a reason line appearing,
 * actions wrapping), so the rows below glide instead of jumping. A width change from the container cuts straight to
 * the new height, so resizing the window never wobbles.
 */
function useAutoHeight(reduced: boolean) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = outer.current, content = inner.current;
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
      box.style.overflow = "hidden";
      controls = animate(box, { height: [from, nextHeight] }, { ...motionTokens.spring.smooth, onComplete: release });
    });
    observer.observe(content);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [reduced]);
  return { outer, inner };
}

function Spinner() {
  return <svg className={styles.spinner} width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.75" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>;
}

/** The success tick draws itself once, quick to start and easing into place. */
function DrawnCheck({ reduced }: { reduced: boolean }) {
  return <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <motion.path d="M3.25 8.5 6.5 11.75 12.75 4.75" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .32, ease: [...motionTokens.ease.standard], delay: .04 }} />
  </svg>;
}

function StatusIcon({ status, reduced }: { status: ToolCallStatus; reduced: boolean }) {
  const icon = status === "running" ? <Spinner />
    : status === "success" ? <DrawnCheck reduced={reduced} />
    : status === "error" ? <CircleAlert size={16} strokeWidth={1.75} />
    : status === "approval" ? <ShieldQuestionMark size={16} strokeWidth={1.75} />
    : <Ban size={16} strokeWidth={1.75} />;
  return <span className={styles.status} aria-hidden="true">
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={status} className={styles.statusIcon} data-status={status}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .6 }}
        transition={reduced ? { duration: 0 } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.instant } }}>{icon}</motion.span>
    </AnimatePresence>
  </span>;
}

function Section({ label, copy, children }: { label: string; copy?: string; children: ReactNode }) {
  return <div className={styles.section} role="group" aria-label={label}>
    <div className={styles.sectionHead}>
      <span className={styles.sectionLabel} aria-hidden="true">{label}</span>
      {copy ? <CopyButton value={copy} label={`Copy ${label.toLowerCase()}`} iconOnly variant="plain" className={styles.copy} /> : null}
    </div>
    <div className={styles.well}>{children}</div>
  </div>;
}

type GroupContextValue = { touch: () => void };
const GroupContext = createContext<GroupContextValue | null>(null);

interface CallRowProps {
  call: ToolCallData;
  flush?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  onDeny?: () => void;
  onRetry?: () => void;
  renderOutput?: ToolCallRenderOutput;
  className?: string;
}

/** One call: the row and its Input and Output panel. Without handlers, Allow, Deny and Retry run a local simulation. */
function CallRow({ call: source, flush = false, open: openProp, defaultOpen = false, onOpenChange, onApprove, onDeny, onRetry, renderOutput, className }: CallRowProps) {
  const reduced = useReducedMotion() ?? false;
  const group = useContext(GroupContext);
  const id = useId();
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  // A simulated status only applies while the status it replaced is still the one passed in.
  const [local, setLocal] = useState<{ base: ToolCallStatus; status: ToolCallStatus } | null>(null);
  const status = local && local.base === source.status ? local.status : source.status;
  const call = { ...source, status };
  const [seen, setSeen] = useState(status);
  const [announcement, setAnnouncement] = useState("");
  const [simNote, setSimNote] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const { outer, inner } = useAutoHeight(reduced);

  if (seen !== status) {
    setSeen(status);
    setAnnouncement(describe(call, status));
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const simulate = (first: ToolCallStatus, final: ToolCallStatus | undefined, note: string) => {
    const base = source.status;
    setLocal({ base, status: first });
    setSimNote(note);
    window.clearTimeout(timer.current);
    if (final) timer.current = window.setTimeout(() => setLocal({ base, status: final }), SIMULATED_DELAY);
  };

  const toggle = () => {
    group?.touch();
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const approve = () => onApprove ? onApprove() : simulate("running", "success", "Allowed. This preview simulates the call, so nothing was sent.");
  const deny = () => onDeny ? onDeny() : simulate("denied", undefined, "Denied. The call did not run.");
  const retry = () => onRetry ? onRetry() : simulate("running", call.output ? "success" : "error", "Retrying. This preview simulates the call.");

  const title = titleFor(call, status);
  const summary = call.summary ?? summarize(call.output);
  const duration = formatDuration(call.durationMs);
  const note = (status === "error" || status === "approval") && call.message ? call.message : undefined;
  const name = toolName(call.tool);
  const ids = { name: `${id}-name`, title: `${id}-title`, state: `${id}-state`, body: `${id}-body` };
  const stateText = status === "success" ? [statusLabel.success, summary, duration].filter(Boolean).join(", ") : status === "error" ? [statusLabel.error, call.message].filter(Boolean).join(": ") : statusLabel[status];

  const asideKind = status === "approval" ? "approval" : status === "error" ? "error" : status === "denied" ? "denied" : status === "success" && (summary || duration) ? "meta" : null;
  const aside = asideKind === "approval"
    ? <span className={styles.actions}>
      <Button variant="secondary" size="sm" className={styles.action} onClick={deny} aria-label={`Deny: ${title}`}>Deny</Button>
      <Button variant="primary" size="sm" className={cx(styles.action, styles.allow)} onClick={approve} aria-label={`Allow: ${title}`}>Allow</Button>
    </span>
    : asideKind === "error"
      ? <span className={styles.actions}>
        <Button variant="secondary" size="sm" className={styles.action} onClick={retry} aria-label={`Retry: ${title}`}><RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />Retry</Button>
      </span>
      : asideKind === "meta"
        ? <span className={styles.meta} aria-hidden="true">
          {summary ? <span className={styles.metaSummary}>{summary}{duration ? <span className={styles.metaDot}>·</span> : null}</span> : null}
          {duration ? <span>{duration}</span> : null}
        </span>
        : asideKind === "denied" ? <span className={styles.meta} aria-hidden="true">Denied</span> : null;

  const custom = status === "success" ? renderOutput?.(call) : undefined;
  const result = status === "running" ? { label: "Output", body: <TextShimmer className={styles.pending}>Waiting for the result</TextShimmer> }
    : status === "approval" ? { label: "Output", body: <p className={styles.pending}>Runs after you allow it.</p> }
    : status === "denied" ? { label: "Output", body: <p className={styles.pending}>Not run. You denied this call.</p> }
    : status === "error" ? { label: "Error", body: <p className={styles.errorText}>{call.message ?? "The call failed without a reason."}</p>, copy: call.message }
    : custom != null ? { label: "Output", body: custom }
    : call.output ? { label: "Output", body: <OutputView output={call.output} />, copy: outputText(call.output) }
    : { label: "Output", body: <p className={styles.pending}>No output.</p> };

  return <div className={cx(styles.call, flush ? styles.flush : styles.standalone, className)} data-status={status} data-open={open || undefined}>
    <div ref={outer} className={styles.headClip}>
      <div ref={inner} className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={ids.body} aria-labelledby={`${ids.name} ${ids.title} ${ids.state}`} onClick={toggle} />
        <ToolMark tool={call.tool} className={styles.mark} />
        <span className={styles.title} aria-hidden="true">
          <span id={ids.name} className={styles.srOnly}>{name}:</span>
          <span id={ids.title} className={styles.titleInner}><TextShimmer active={status === "running"} className={styles.titleText}>{title}</TextShimmer></span>
        </span>
        {note ? <span className={styles.note} aria-hidden="true">{note}</span> : null}
        <span className={styles.aside}>
          <AnimatePresence initial={false} mode="popLayout">
            {asideKind ? <motion.span key={asideKind} className={styles.asideInner} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }}>{aside}</motion.span> : null}
          </AnimatePresence>
        </span>
        <StatusIcon status={status} reduced={reduced} />
        <span id={ids.state} className={styles.srOnly}>{stateText}</span>
        <ChevronDown size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden="true" />
      </div>
    </div>
    <AnimatePresence initial={false}>
      {open ? <motion.div key="body" id={ids.body} className={styles.bodyClip} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={heightTransition(reduced)}>
        <div className={styles.body}>
          {call.input && Object.keys(call.input).length ? <Section label="Input" copy={inputText(call.input)}><InputList input={call.input} /></Section> : null}
          <Section label={result.label} copy={result.copy}>{result.body}</Section>
        </div>
      </motion.div> : null}
    </AnimatePresence>
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}{simNote ? ` ${simNote}` : ""}</span>
  </div>;
}

export interface ToolCallProps extends Partial<ToolCallData> {
  /** Opens the Input and Output panel on first render. */
  defaultOpen?: boolean;
  /** Controls the panel. Pair with onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Allow on a call awaiting approval. Without it the preview simulates the call. */
  onApprove?: () => void;
  /** Deny on a call awaiting approval. Without it the call is marked denied locally. */
  onDeny?: () => void;
  /** Retry on a failed call. Without it the preview simulates a successful retry. */
  onRetry?: () => void;
  /** Draws a custom result for a successful call. Return undefined to use the built in view. */
  renderOutput?: ToolCallRenderOutput;
  className?: string;
}

const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;

/**
 * An inline tool call for agent and chat transcripts: the tool's mark, what the model did, quiet meta, and a status.
 * Click the row to open the arguments and the result. With no props it shows a sample GitHub search.
 */
export function ToolCall({ defaultOpen, open, onOpenChange, onApprove, onDeny, onRetry, renderOutput, className, ...data }: ToolCallProps) {
  const base: ToolCallData = data.title === undefined ? toolCallSamples.issues : { id: "tool-call", tool: "web", title: data.title, status: "success" };
  const call = { ...base, ...defined(data) } as ToolCallData;
  return <div className={styles.root}>
    <CallRow call={call} defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} onApprove={onApprove} onDeny={onDeny} onRetry={onRetry} renderOutput={renderOutput} className={className} />
  </div>;
}

export interface ToolCallGroupProps {
  /** The calls in order. Defaults to four settled sample calls. */
  calls?: ToolCallData[];
  /** The agent is still working in this group, so the header keeps saying "Using" between calls. Defaults to any call running. */
  active?: boolean;
  /** Opens the list on first render. Defaults to open while any call is still running or waiting. */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Folds the list once every call has finished, unless the person has opened or closed anything. Defaults to true. */
  autoCollapse?: boolean;
  onApprove?: (call: ToolCallData) => void;
  onDeny?: (call: ToolCallData) => void;
  onRetry?: (call: ToolCallData) => void;
  renderOutput?: ToolCallRenderOutput;
  className?: string;
}

const isWaiting = (status: ToolCallStatus) => status === "running" || status === "approval" || status === "error";

/** "Used 4 tools" with a stack of the tools' marks. Opening it staggers the calls in; calls that need a decision open it on their own. */
export function ToolCallGroup({ calls = toolCallSampleList, active: activeProp, defaultOpen, open: openProp, onOpenChange, autoCollapse = true, onApprove, onDeny, onRetry, renderOutput, className }: ToolCallGroupProps) {
  const reduced = useReducedMotion() ?? false;
  const id = useId();
  const [openState, setOpenState] = useState(() => defaultOpen ?? calls.some(call => isWaiting(call.status)));
  const open = openProp ?? openState;
  const [staggering, setStaggering] = useState(false);
  const touched = useRef(false);
  const wasBusy = useRef(false);

  const running = calls.some(call => call.status === "running");
  const asking = calls.some(call => call.status === "approval");
  const failed = calls.filter(call => call.status === "error").length;
  const active = activeProp ?? running;
  const busy = running || asking || failed > 0 || active;
  const total = calls.reduce((sum, call) => sum + (call.status === "success" || call.status === "error" ? call.durationMs ?? 0 : 0), 0);
  const label = asking && !running ? "Waiting for approval" : (running || active) && !failed ? `Using ${plural(calls.length, "tool")}` : `Used ${plural(calls.length, "tool")}`;
  const meta = failed && !running ? `${failed} failed` : asking || running || active ? undefined : formatDuration(total);

  const setOpen = (next: boolean, byPerson: boolean) => {
    if (byPerson) touched.current = true;
    if (next && byPerson) setStaggering(true);
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  // A call that needs a decision (approval or a failure) opens a closed group, so it is never hidden.
  const attention = calls.filter(call => call.status === "approval" || call.status === "error").map(call => `${call.id}:${call.status}`).join("|");
  const [seenAttention, setSeenAttention] = useState(attention);
  if (attention !== seenAttention) {
    setSeenAttention(attention);
    if (attention && openProp === undefined && !openState) setOpenState(true);
  }

  useEffect(() => { if (busy) wasBusy.current = true; }, [busy]);
  useEffect(() => {
    if (busy || !autoCollapse || !open || touched.current || !wasBusy.current || !calls.length) return;
    const timeout = window.setTimeout(() => {
      wasBusy.current = false;
      if (openProp === undefined) setOpenState(false);
      onOpenChange?.(false);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [busy, autoCollapse, open, calls.length, openProp, onOpenChange]);

  // Each tool appears once in the stack, in the order it was first used.
  const stack = calls.reduce<ToolCallData["tool"][]>((tools, call) => tools.some(tool => toolKey(tool) === toolKey(call.tool)) ? tools : [...tools, call.tool], []);
  const shown = stack.slice(0, 4);

  return <GroupContext.Provider value={{ touch: () => { touched.current = true; } }}>
    <div className={cx(styles.root, styles.group, className)} data-open={open || undefined}>
      <div className={styles.groupHead}>
        <button type="button" className={styles.groupToggle} aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen(!open, true)}>
          <span className={styles.stack} aria-hidden="true">
            <AnimatePresence initial={false}>
              {shown.map((tool, index) => <motion.span key={toolKey(tool)} className={styles.stackItem} style={{ zIndex: index + 1 }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .6, width: 0, marginLeft: 0 }}
                animate={{ opacity: 1, scale: 1, width: 20, marginLeft: index ? -4 : 0 }}
                exit={{ opacity: 0, scale: .6, width: 0, marginLeft: 0 }}
                transition={reduced ? { duration: 0 } : { ...motionTokens.spring.morph, opacity: { duration: motionTokens.duration.fast } }}>
                <ToolMark tool={tool} size={12} className={styles.stackMark} />
              </motion.span>)}
            </AnimatePresence>
            {stack.length > shown.length ? <span className={styles.stackMore}>+{stack.length - shown.length}</span> : null}
          </span>
          <TextShimmer active={(running || active) && !asking && !failed} className={styles.groupLabel}>{label}</TextShimmer>
          <span className={styles.groupMeta}>
            <AnimatePresence initial={false} mode="popLayout">
              {meta ? <motion.span key={meta} className={failed ? styles.groupMetaFailed : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : motionTokens.duration.fast }}>{meta}</motion.span> : null}
            </AnimatePresence>
          </span>
          <ChevronDown size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden="true" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? <motion.div key="list" id={`${id}-list`} className={styles.listClip} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={heightTransition(reduced)} onAnimationComplete={() => setStaggering(false)}>
          <div className={styles.calls} role="list">
            <AnimatePresence initial={staggering}>
              {calls.map((call, index) => <motion.div key={call.id} role="listitem" className={styles.item}
                initial={reduced ? { opacity: 0 } : staggering ? { opacity: 0, y: -6 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={reduced ? { duration: 0 } : staggering
                  ? { opacity: { duration: motionTokens.duration.standard, delay: index * .02 }, y: { ...motionTokens.spring.snappy, delay: index * .02 } }
                  : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, delay: .06 } }}>
                <CallRow call={call} flush renderOutput={renderOutput}
                  onApprove={onApprove ? () => onApprove(call) : undefined}
                  onDeny={onDeny ? () => onDeny(call) : undefined}
                  onRetry={onRetry ? () => onRetry(call) : undefined} />
              </motion.div>)}
            </AnimatePresence>
          </div>
        </motion.div> : null}
      </AnimatePresence>
    </div>
  </GroupContext.Provider>;
}

export default ToolCall;
