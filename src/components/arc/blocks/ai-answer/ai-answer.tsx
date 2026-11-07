"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { AnimatePresence, animate, motion, useReducedMotion, useMotionValue } from "motion/react";
import { ArrowRight, ArrowUp, ChevronDown, CircleAlert, Link2, RotateCcw, Square, SquarePen } from "lucide-react";
import { motionTokens } from "../../lib/motion-tokens";
import { TextShimmer } from "../../text-shimmer/text-shimmer";
import { Tooltip } from "../../tooltip/tooltip";
import { answerScripts, defaultModels, sampleQuestion, type AnswerBlock, type AnswerModel, type AnswerSource } from "./ai-answer-data";
import { demoFollowUps, demoRespond, type AnswerEvent, type AnswerRequest, type AnswerResponder, type RegenerateMode } from "./ai-answer-demo";
import { blocksToMarkdown, markdownForCopy } from "./ai-answer-markdown";
import { AnswerBody, ReasoningText, SourceMark, type Hot } from "./ai-answer-body";
import { ActionBar, DrawnCheck, IconButton, SwapIcon, useClipboard } from "./ai-answer-actions";
import styles from "./ai-answer.module.css";

/** Eases the copy label's width to `target` on a spring with no overshoot. The first measurement lands at once, so the control
 *  starts at its current word's width instead of the widest one. */
function useFitWidth(target: number | undefined, reduced: boolean | null | undefined) {
  const width = useMotionValue<number | "auto">("auto");
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!target) return;
    if (!placed.current || reduced) { placed.current = true; width.jump(target); return; }
    const controls = animate(width, target, { type: "spring", visualDuration: .22, bounce: 0 });
    return () => controls.stop();
  }, [target, reduced, width]);
  return width;
}

export type { AnswerBlock, AnswerModel, AnswerSource } from "./ai-answer-data";
export type { AnswerEvent, AnswerRequest, AnswerResponder, RegenerateMode } from "./ai-answer-demo";

const { spring, duration, ease, stagger } = motionTokens;
/** Moves, resizes and swaps settle without overshoot, so nothing wobbles. */
const settle = { type: "spring", visualDuration: 0.24, bounce: 0 } as const;
const enter = [...ease.enter] as [number, number, number, number];
const standard = [...ease.standard] as [number, number, number, number];
const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/* ---------------------------------------------------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------------------------------------------------- */

export interface AnswerFeedback {
  /** "up", "down", or null when the person takes their feedback back. */
  value: "up" | "down" | null;
  reason?: string;
  question: string;
  /** The rated answer, as markdown. */
  answer: string;
  model: AnswerModel;
  /** Zero based index of the rated version. */
  version: number;
}

export interface AiAnswerProps {
  /** The question. Leave it out for the demo; pass an empty string for the empty state. */
  question?: string;
  /** A finished answer to show at once. Without it, the block streams one from `respond` (or the scripted demo). */
  answer?: AnswerBlock[];
  /** Sources for a finished answer, numbered in order: [1] in the text is the first source. */
  sources?: AnswerSource[];
  /** Reasoning summary for a finished answer. */
  reasoning?: string;
  /** Usage for a finished answer. Durations in seconds. */
  usage?: { tokens?: number; thoughtSeconds?: number; seconds?: number };
  /** Related questions under the answer. */
  followUps?: string[];
  /** Questions offered in the empty state. */
  suggestions?: string[];
  /** Title in the top bar. Defaults to the question. */
  title?: string;
  /** The model that writes the answer. Defaults to Claude Opus 5.5. */
  model?: AnswerModel;
  /** Models offered under Regenerate, Switch model. */
  models?: AnswerModel[];
  /** Streams an answer from your model. Yield reasoning, sources, thought, text and done events; throw to show the error state. */
  respond?: AnswerResponder;
  /** Called on thumbs up, thumbs down with a reason, and when feedback is taken back. */
  onFeedback?: (feedback: AnswerFeedback) => void;
  /** Called when a question is asked from the composer, a related question or a suggestion, before its answer streams. */
  onFollowUp?: (question: string) => void;
  /** Returns the link copied by Share. `version` is undefined for the thread link in the top bar. Without it, a sample link is copied. */
  onShare?: (info: { question: string; answer: string; version?: number }) => string | Promise<string>;
  className?: string;
}

/* ---------------------------------------------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------------------------------------------- */

type Status = "thinking" | "writing" | "done" | "stopped" | "error";

interface Version {
  id: number;
  mode: RegenerateMode;
  model: AnswerModel;
  status: Status;
  reasoning: string;
  sources: AnswerSource[];
  text: string;
  started: number;
  firstText?: number;
  ended?: number;
  thought?: number;
  seconds?: number;
  tokens?: number;
  error?: string;
  feedback?: "up" | "down";
  /** Rendered whole, without the chunked reveal: a finished answer passed in as props. */
  instant?: boolean;
}

interface Turn { id: number; question: string; versions: Version[]; index: number; followUps: string[] }

type Action =
  | { type: "turn"; turn: Turn | null }
  | { type: "version"; version: Version }
  | { type: "reset"; id: number; now: number }
  | { type: "event"; id: number; event: AnswerEvent; now: number }
  | { type: "end"; id: number; status: "stopped" | "error"; error?: string; now: number }
  | { type: "select"; index: number }
  | { type: "feedback"; id: number; value?: "up" | "down" };

const working = (status: Status) => status === "thinking" || status === "writing";

function patch(turn: Turn, id: number, change: (version: Version) => Version): Turn {
  return { ...turn, versions: turn.versions.map(version => version.id === id ? change(version) : version) };
}

function reducer(turn: Turn | null, action: Action): Turn | null {
  if (action.type === "turn") return action.turn;
  if (!turn) return turn;
  switch (action.type) {
    case "version": return { ...turn, versions: [...turn.versions, action.version], index: turn.versions.length };
    case "reset": return patch(turn, action.id, v => ({ ...v, status: "thinking", reasoning: "", sources: [], text: "", started: action.now, firstText: undefined, ended: undefined, thought: undefined, error: undefined }));
    case "select": return { ...turn, index: Math.max(0, Math.min(turn.versions.length - 1, action.index)) };
    case "feedback": return patch(turn, action.id, v => ({ ...v, feedback: action.value }));
    case "end": return patch(turn, action.id, v => working(v.status) ? { ...v, status: action.status, error: action.error, ended: action.now } : v);
    case "event": {
      const { event, now } = action;
      if (!turn.versions.some(v => v.id === action.id && working(v.status))) return turn;
      if (event.type === "done" && event.followUps?.length) turn = { ...turn, followUps: event.followUps };
      return patch(turn, action.id, v => {
        switch (event.type) {
          case "reasoning": return { ...v, reasoning: v.reasoning + event.text };
          case "sources": return { ...v, sources: event.sources };
          case "thought": return { ...v, thought: event.seconds };
          case "text": return { ...v, text: v.text + event.text, status: "writing", firstText: v.firstText ?? now };
          case "done": return {
            ...v, status: "done", ended: now,
            tokens: event.tokens ?? v.tokens,
            thought: v.thought ?? (v.firstText ? Math.max(1, Math.round((v.firstText - v.started) / 1000)) : undefined),
            seconds: event.seconds ?? Math.round((now - v.started) / 100) / 10,
          };
        }
      });
    }
  }
}

let ids = 0;
const nextId = () => ++ids;

/* ---------------------------------------------------------------------------------------------------------------
 * Hooks and small parts
 * ------------------------------------------------------------------------------------------------------------- */

const noop = () => () => {};
/** Reduced motion, false until hydrated so server and client agree. */
function useReduced() {
  const prefers = useReducedMotion();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  return Boolean(hydrated && prefers);
}

/**
 * Follows its content's height. When `morphKey` changes (a version switch or a regenerate) the height springs from the old
 * answer to the new one while the two crossfade, so the actions below glide instead of jumping. Otherwise it is plain auto.
 */
function AutoHeight({ morphKey, reduced, children }: { morphKey: number; reduced: boolean; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const rest = useRef(0);
  const key = useRef(morphKey);
  useEffect(() => {
    const node = inner.current;
    if (!node) return;
    const observer = new ResizeObserver(() => { if (!outer.current?.dataset.morphing) rest.current = node.offsetHeight; });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const box = outer.current, node = inner.current;
    if (key.current === morphKey || !box || !node) return;
    key.current = morphKey;
    const from = rest.current, to = node.offsetHeight;
    rest.current = to;
    if (reduced || Math.abs(from - to) < 2) return;
    box.dataset.morphing = "";
    const release = () => { box.style.height = ""; delete box.dataset.morphing; rest.current = node.offsetHeight; };
    const controls = animate(box, { height: [from, to] }, { ...spring.smooth, onComplete: release });
    return () => { controls.stop(); release(); };
  }, [morphKey, reduced]);
  return <div ref={outer} className={styles.autoHeight}><div ref={inner}>{children}</div></div>;
}

function Disclosure({ open, label, onToggle, controls, children }: { open: boolean; label: ReactNode; onToggle: () => void; controls: string; children?: ReactNode }) {
  return <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
    {children}
    <span className={styles.disclosureLabel}>{label}</span>
    <ChevronDown className={styles.chevron} data-open={open || undefined} aria-hidden="true" />
  </button>;
}

function Panel({ open, id, reduced, children }: { open: boolean; id: string; reduced: boolean; children: ReactNode }) {
  return <motion.div id={id} className={styles.panel} initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
    transition={reduced ? { duration: 0 } : { height: spring.smooth, opacity: { duration: open ? duration.standard : duration.fast, ease: standard } }} inert={!open || undefined}>
    {children}
  </motion.div>;
}

/**
 * Up to four site marks on small round chips that overlap by 6px. Hovering the row fans them apart around their center on the
 * CSS spring (`translate`, so it never fights the entrance scale), and they settle back on leave.
 */
function MarkStack({ sources, reduced }: { sources: AnswerSource[]; reduced: boolean }) {
  const shown = sources.slice(0, 4);
  return <span className={styles.stack} aria-hidden="true">
    <AnimatePresence initial={false}>
      {shown.map((source, k) => <motion.span key={source.id} className={styles.stackItem} style={{ zIndex: 4 - k, "--fan": k - (shown.length - 1) / 2 } as CSSProperties}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        transition={reduced ? { duration: duration.fast } : { ...settle, delay: k * stagger.item * 1.5, opacity: { duration: duration.fast, delay: k * stagger.item * 1.5 } }}>
        <SourceMark source={source} />
      </motion.span>)}
    </AnimatePresence>
  </span>;
}

const formatTokens = (n: number) => n.toLocaleString("en-US");

/* ---------------------------------------------------------------------------------------------------------------
 * Top bar and composer
 * ------------------------------------------------------------------------------------------------------------- */

/** Share in the top bar: the word crossfades to Copied while the label cell eases to the new word's measured width with no
 *  overshoot, so the button never holds empty space for a longer word and never jumps. */
function ShareButton({ disabled, reduced, getLink, announce }: { disabled: boolean; reduced: boolean; getLink: () => Promise<string>; announce: (message: string) => void }) {
  const share = useClipboard();
  const label = share.state === "copied" ? "Copied" : share.state === "error" ? "Failed" : "Share";
  const measures = useRef<Record<string, HTMLSpanElement | null>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const read = () => setWidths(Object.fromEntries(Object.entries(measures.current).map(([key, node]) => [key, node?.offsetWidth ?? 0])));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    Object.values(measures.current).forEach(node => { if (node) observer.observe(node); });
    return () => observer.disconnect();
  }, []);
  const width = widths[label];
  const fitWidth = useFitWidth(width, reduced);
  return <button type="button" className={styles.shareButton} data-state={share.state} disabled={disabled} aria-label="Share thread" onClick={async () => {
    const ok = await share.copy(getLink);
    announce(ok ? "Thread link copied. This preview copies a sample link" : "Could not copy the thread link");
  }}>
    <SwapIcon id={share.state} reduced={reduced}>
      {share.state === "copied" ? <DrawnCheck reduced={reduced} /> : share.state === "error" ? <CircleAlert aria-hidden="true" /> : <Link2 aria-hidden="true" />}
    </SwapIcon>
    <motion.span className={styles.shareLabel} aria-hidden="true" style={{ width: fitWidth }}>
      {["Share", "Copied", "Failed"].map(word => <span key={word} ref={node => { measures.current[word] = node; }} className={styles.shareMeasure}>{word}</span>)}
      <AnimatePresence initial={false}>
        <motion.span key={label} className={styles.shareLabelText}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : .1, ease: standard } }}
          transition={{ duration: reduced ? 0 : .16, ease: standard }}>{label}</motion.span>
      </AnimatePresence>
    </motion.span>
  </button>;
}

interface ComposerProps {
  busy: boolean;
  reduced: boolean;
  hasThread: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (question: string) => void;
  onStop: () => void;
}

/** A docked composer. Enter sends, Shift+Enter adds a line. While an answer streams, Send turns into Stop in the same spot. */
function Composer({ busy, reduced, hasThread, inputRef, onSubmit, onStop }: ComposerProps) {
  const id = useId();
  const [value, setValue] = useState("");
  const ready = value.trim().length > 0;
  const submit = () => {
    if (busy || !ready) return;
    onSubmit(value.trim());
    setValue("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  };
  return <div className={styles.dock}>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); submit(); }}>
      <label htmlFor={id} className={styles.srOnly}>{hasThread ? "Ask a follow-up" : "Ask a question"}</label>
      <textarea ref={inputRef} id={id} className={styles.input} rows={1} value={value} placeholder={hasThread ? "Ask a follow-up" : "Ask anything"}
        onChange={event => setValue(event.target.value)} onKeyDown={onKeyDown} />
      <button type={busy ? "button" : "submit"} className={styles.send} data-kind={busy ? "stop" : "send"} disabled={!busy && !ready}
        aria-label={busy ? "Stop answer" : "Send"} onClick={event => { if (busy) { event.preventDefault(); onStop(); } }}>
        <SwapIcon id={busy ? "stop" : "send"} reduced={reduced}>{busy ? <Square aria-hidden="true" className={styles.stopGlyph} /> : <ArrowUp aria-hidden="true" />}</SwapIcon>
      </button>
    </form>
  </div>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Turn: reasoning, sources, answer, actions and related questions for one question
 * ------------------------------------------------------------------------------------------------------------- */

interface TurnViewProps {
  turn: Turn;
  reduced: boolean;
  models: AnswerModel[];
  revealed: Set<number>;
  onRevealed: (id: number) => void;
  onRetry: () => void;
  onRegenerate: (mode: RegenerateMode, model?: AnswerModel) => void;
  onSelect: (index: number) => void;
  onFeedback: (value: "up" | "down" | null, reason?: string) => void;
  onAsk: (question: string) => void;
  shareLink: () => Promise<string>;
  announce: (message: string) => void;
}

function TurnView({ turn, reduced, models, revealed, onRevealed, onRetry, onRegenerate, onSelect, onFeedback, onAsk, shareLink, announce }: TurnViewProps) {
  const version = turn.versions[turn.index];
  const id = useId();
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [hot, setHot] = useState<Hot>(null);
  const rowRef = useRef<HTMLOListElement>(null);
  const live = working(version.status);
  const settled = version.status === "stopped" || version.status === "error" || (version.status === "done" && revealed.has(version.id));
  const busy = turn.versions.some(v => working(v.status));
  const handleRevealed = useCallback(() => onRevealed(version.id), [onRevealed, version.id]);

  const thoughtLabel = version.status === "thinking" ? "Thinking"
    : version.thought ? `Thought for ${version.thought}s`
    : version.firstText ? `Thought for ${Math.max(1, Math.round((version.firstText - version.started) / 1000))}s`
    : version.status === "stopped" || version.status === "error" ? "Stopped while thinking"
    : "Reasoning";
  const showReasoning = version.status === "thinking" || version.reasoning.length > 0;
  const n = version.sources.length;

  // On a phone the cards scroll as a row. A citation that lights a card outside the visible part brings it into view.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !sourcesOpen || !hot || hot.s === undefined || row.scrollWidth <= row.clientWidth + 1) return;
    const card = row.children[hot.n - 1] as HTMLElement | undefined;
    if (!card) return;
    const inset = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    const left = card.offsetLeft - inset;
    if (left >= row.scrollLeft && left + card.offsetWidth <= row.scrollLeft + row.clientWidth - inset - 28) return;
    row.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }, [hot, sourcesOpen, reduced]);

  return <div className={styles.turn}>
    <div className={styles.steps}>
      {showReasoning && <div className={styles.step}>
        <Disclosure open={reasoningOpen} controls={`${id}-reasoning`} onToggle={() => setReasoningOpen(open => !open)}
          label={<TextShimmer active={version.status === "thinking"} duration={1.1}>{thoughtLabel}</TextShimmer>} />
        <Panel open={reasoningOpen} id={`${id}-reasoning`} reduced={reduced}>
          <div className={styles.reasoning}>{version.reasoning ? <ReasoningText text={version.reasoning} live={version.status === "thinking"} /> : <p className={styles.muted}>Waiting for the first thought</p>}</div>
        </Panel>
      </div>}
      <AnimatePresence initial={false}>
        {n > 0 && <motion.div key="sources" className={styles.step}
          initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          transition={reduced ? { duration: duration.fast } : { height: spring.smooth, opacity: { duration: duration.standard, ease: enter } }}>
          <Disclosure open={sourcesOpen} controls={`${id}-sources`} onToggle={() => setSourcesOpen(open => !open)} label={<span className={styles.tabular}>{n} {n === 1 ? "source" : "sources"}</span>}>
            <MarkStack sources={version.sources} reduced={reduced} />
          </Disclosure>
          <Panel open={sourcesOpen} id={`${id}-sources`} reduced={reduced}>
            {/* Cards: a calm two column grid in a wide column, a snap scrolling row on phones. Each opening fades them in on a short stagger. */}
            <ol ref={rowRef} className={styles.sources} aria-label="Sources" data-open={sourcesOpen || undefined}>
              {version.sources.map((source, k) => <li key={source.id} className={styles.sourceItem} style={{ "--i": Math.min(k, 6) } as CSSProperties}>
                <a href={source.url} target="_blank" rel="noreferrer" title={source.title} className={styles.sourceCard} data-lit={hot?.n === k + 1 || undefined}
                  onPointerEnter={() => setHot({ n: k + 1 })} onPointerLeave={() => setHot(null)} onFocus={() => setHot({ n: k + 1 })} onBlur={() => setHot(null)}>
                  <span className={styles.sourceCardTop}>
                    <SourceMark source={source} className={styles.markCard} />
                    <span className={styles.truncate}>{source.domain.replace(/^www\./, "")}</span>
                  </span>
                  <span className={styles.sourceCardName}>{source.title}</span>
                  <span className={styles.sourceIndex}><span className={styles.srOnly}>Source </span>{k + 1}</span>
                </a>
              </li>)}
            </ol>
          </Panel>
        </motion.div>}
      </AnimatePresence>
    </div>

    <AutoHeight morphKey={version.id} reduced={reduced}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={version.id} className={styles.answer}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : duration.fast, ease: standard } }}
          transition={{ duration: reduced ? 0 : duration.standard, ease: enter }}>
          <AnswerBody markdown={version.text} live={live} instant={Boolean(version.instant) || revealed.has(version.id)} still={reduced}
            sources={version.sources} hot={hot} onHot={setHot} onRevealed={handleRevealed} />
        </motion.div>
      </AnimatePresence>
    </AutoHeight>

    <AnimatePresence initial={false}>
      {(version.status === "stopped" || version.status === "error") && <motion.div key={version.status} className={styles.note} data-tone={version.status} role={version.status === "error" ? "alert" : undefined}
        initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
        transition={reduced ? { duration: duration.fast } : { height: spring.smooth, opacity: { duration: duration.standard, ease: enter } }}>
        <div className={styles.noteInner}>
          {version.status === "error" ? <CircleAlert className={styles.noteIcon} aria-hidden="true" /> : <Square className={styles.noteIcon} aria-hidden="true" />}
          <span className={styles.noteText}>
            {version.status === "error" ? <><span className={styles.noteTitle}>The answer was cut off.</span> {version.error || "The model stopped responding."}</> : version.text ? "You stopped this answer, so it may be incomplete." : "You stopped this answer before it started."}
          </span>
          <button type="button" className={styles.noteAction} onClick={onRetry}><RotateCcw aria-hidden="true" />Try again</button>
        </div>
      </motion.div>}
    </AnimatePresence>

    <div className={styles.footer}>
      <AnimatePresence initial={false}>
        {settled && <motion.div key="actions" className={styles.footerSlot}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? duration.fast : duration.standard, ease: enter }}>
          <ActionBar reduced={reduced} busy={busy} models={models} model={version.model}
            copyText={() => markdownForCopy(version.text, version.sources)} shareLink={shareLink}
            feedback={version.feedback} onFeedback={onFeedback} onRegenerate={onRegenerate}
            versions={turn.versions.length} index={turn.index} onVersion={onSelect} announce={announce}
            meta={<p className={styles.modelLine}>
              <span className={styles.modelMark} aria-hidden="true">{version.model.mark}</span>
              <span className={styles.modelName}>{version.model.name}</span>
              {version.tokens !== undefined && <><span className={styles.dot} aria-hidden="true" /><span className={styles.tabular}>{formatTokens(version.tokens)} tokens</span></>}
              {version.seconds !== undefined && <><span className={styles.dot} aria-hidden="true" /><span className={styles.tabular}>{version.seconds}s</span></>}
            </p>} />
        </motion.div>}
      </AnimatePresence>
    </div>

    <AnimatePresence initial={false}>
      {settled && turn.followUps.length > 0 && <motion.section key="related" className={styles.related} aria-labelledby={`${id}-related`}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.standard, ease: enter }}>
        <h3 id={`${id}-related`} className={styles.relatedTitle}>Related</h3>
        <ul className={styles.relatedList}>
          {turn.followUps.map((question, k) => <motion.li key={question}
            initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.standard, ease: enter, delay: .06 + k * stagger.item * 1.5 }}>
            <button type="button" className={styles.relatedItem} disabled={busy} onClick={() => onAsk(question)}>
              <span>{question}</span><ArrowRight aria-hidden="true" />
            </button>
          </motion.li>)}
        </ul>
      </motion.section>}
    </AnimatePresence>
  </div>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Block
 * ------------------------------------------------------------------------------------------------------------- */

function initialTurn(props: AiAnswerProps, model: AnswerModel): Turn | null {
  const question = props.question ?? (props.answer ? "" : sampleQuestion);
  if (!question.trim() && !props.answer) return null;
  const followUps = props.followUps ?? (props.respond ? [] : demoFollowUps(question));
  const now = Date.now();
  const version: Version = props.answer
    ? { id: nextId(), mode: "answer", model, status: "done", reasoning: props.reasoning ?? "", sources: props.sources ?? [], text: blocksToMarkdown(props.answer), started: now, ended: now, thought: props.usage?.thoughtSeconds, tokens: props.usage?.tokens, seconds: props.usage?.seconds, instant: true }
    : { id: nextId(), mode: "answer", model, status: "thinking", reasoning: "", sources: [], text: "", started: now };
  return { id: nextId(), question, versions: [version], index: 0, followUps };
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "answer";

/**
 * A single AI answer in an app view: a slim top bar with the thread title and Share, the question, a reasoning row that
 * shimmers while thinking and settles to its duration, the sources as a stack of site marks, and the answer streaming in
 * chunks with headings, lists, a table, code and inline citations. Hovering or focusing a citation shows its source and
 * lights the sentence it supports. Under the answer: copy, regenerate with options, feedback, share, versions, the model line
 * and related questions. A docked composer asks follow-ups and turns into Stop while an answer streams.
 */
export function AiAnswer(props: AiAnswerProps) {
  const { models = defaultModels, respond, suggestions, title, onFeedback, onFollowUp, onShare, className } = props;
  const defaultModel = props.model ?? models[0] ?? defaultModels[0];
  const reduced = useReduced();
  const [turn, dispatch] = useReducer(reducer, null, () => initialTurn(props, defaultModel));
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllers = useRef(new Map<number, AbortController>());
  const responder = useRef<AnswerResponder>(respond ?? demoRespond);
  useEffect(() => { responder.current = respond ?? demoRespond; }, [respond]);
  const turnRef = useRef(turn);
  useEffect(() => { turnRef.current = turn; }, [turn]);
  const questionId = useId();

  const announce = useCallback((message: string) => {
    setAnnouncement("");
    window.requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const run = useCallback((id: number, request: Omit<AnswerRequest, "signal">) => {
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    dispatch({ type: "reset", id, now: Date.now() });
    void (async () => {
      let finished = false;
      try {
        for await (const event of responder.current({ ...request, signal: controller.signal })) {
          if (controller.signal.aborted) return;
          dispatch({ type: "event", id, event, now: Date.now() });
          if (event.type === "done") finished = true;
        }
        if (!controller.signal.aborted && !finished) dispatch({ type: "event", id, event: { type: "done" }, now: Date.now() });
      } catch (error) {
        if (!controller.signal.aborted) dispatch({ type: "end", id, status: "error", error: error instanceof Error ? error.message : undefined, now: Date.now() });
      } finally {
        if (controllers.current.get(id) === controller) controllers.current.delete(id);
      }
    })();
  }, []);

  // The first answer streams after mount. Strict mode runs this twice; the second run restarts the same version cleanly.
  useEffect(() => {
    const first = turnRef.current?.versions[0];
    if (!first || first.status !== "thinking") return;
    const question = turnRef.current!.question;
    run(first.id, { question, mode: "answer", model: first.model });
    const pending = controllers.current;
    return () => { pending.get(first.id)?.abort(); };
  }, [run]);

  useEffect(() => {
    const pending = controllers.current;
    return () => { pending.forEach(controller => controller.abort()); };
  }, []);

  const version = turn ? turn.versions[turn.index] : undefined;
  const busy = Boolean(turn?.versions.some(v => working(v.status)));
  const settled = Boolean(version && version.status === "done" && revealed.has(version.id));
  // Status is derived, so it needs no effect; action results go to their own live region.
  const statusText = !version ? "" : version.status === "thinking" ? "Thinking" : version.status === "writing" ? "Writing the answer"
    : version.status === "stopped" ? "Answer stopped" : version.status === "error" ? "The answer was cut off" : settled ? "Answer ready" : "";

  const onRevealed = useCallback((id: number) => setRevealed(set => set.has(id) ? set : new Set(set).add(id)), []);

  const stopAll = useCallback(() => {
    const current = turnRef.current;
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    current?.versions.filter(v => working(v.status)).forEach(v => dispatch({ type: "end", id: v.id, status: "stopped", now: Date.now() }));
  }, []);

  const regenerate = useCallback((mode: RegenerateMode, model?: AnswerModel) => {
    const current = turnRef.current;
    if (!current) return;
    const base = current.versions[current.index];
    const next: Version = { id: nextId(), mode, model: model ?? base.model, status: "thinking", reasoning: "", sources: [], text: "", started: Date.now() };
    dispatch({ type: "version", version: next });
    run(next.id, { question: current.question, mode, model: next.model, previous: base.text || undefined });
    // The old answer springs closed while the view glides back to the question, so the new one is read from its start.
    scrollerRef.current?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [run, reduced]);

  const retry = useCallback(() => regenerate("retry"), [regenerate]);

  /** Replaces the question and streams its answer. From a related question, focus moves to the new question heading. */
  const ask = useCallback((question: string, from: "list" | "composer" = "list") => {
    onFollowUp?.(question);
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    const model = turnRef.current?.versions[turnRef.current.index]?.model ?? defaultModel;
    const version: Version = { id: nextId(), mode: "answer", model, status: "thinking", reasoning: "", sources: [], text: "", started: Date.now() };
    const followUps = respond ? [] : demoFollowUps(question);
    dispatch({ type: "turn", turn: { id: nextId(), question, versions: [version], index: 0, followUps } });
    run(version.id, { question, mode: "answer", model });
    scrollerRef.current?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    if (from === "list") window.requestAnimationFrame(() => questionRef.current?.focus({ preventScroll: true }));
  }, [onFollowUp, reduced, defaultModel, respond, run]);

  const newThread = useCallback(() => {
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    dispatch({ type: "turn", turn: null });
    announce("New thread");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [announce]);

  const feedback = useCallback((value: "up" | "down" | null, reason?: string) => {
    const current = turnRef.current;
    if (!current) return;
    const v = current.versions[current.index];
    dispatch({ type: "feedback", id: v.id, value: value ?? undefined });
    announce(value === null ? "Feedback removed" : value === "up" ? "Thanks, marked as a good response" : `Thanks, sent: ${reason?.toLowerCase() ?? "bad response"}`);
    onFeedback?.({ value, reason, question: current.question, answer: v.text, model: v.model, version: current.index });
  }, [announce, onFeedback]);

  const link = useCallback(async (withVersion: boolean) => {
    const current = turnRef.current;
    if (!current) return "";
    const v = current.versions[current.index];
    if (onShare) return onShare({ question: current.question, answer: v.text, version: withVersion ? current.index : undefined });
    return `https://example.com/answers/${slug(current.question)}${withVersion && current.versions.length > 1 ? `?v=${current.index + 1}` : ""}`;
  }, [onShare]);
  const answerLink = useCallback(() => link(true), [link]);
  const threadLink = useCallback(() => link(false), [link]);

  const select = useCallback((index: number) => {
    // A version you return to shows whole, even one that was stopped before its reveal finished.
    const target = turnRef.current?.versions[index];
    if (target && !working(target.status)) onRevealed(target.id);
    dispatch({ type: "select", index });
    const count = turnRef.current?.versions.length ?? 0;
    announce(`Showing version ${index + 1} of ${count}`);
  }, [announce, onRevealed]);

  const offered = suggestions ?? (respond ? [] : answerScripts.map(script => script.question));
  const barTitle = turn ? title ?? (turn.question || "Answer") : "New thread";

  return <section className={cx(styles.root, className)} aria-labelledby={turn?.question ? questionId : turn ? undefined : `${questionId}-empty`} aria-label={turn && !turn.question ? "Answer" : undefined} aria-busy={busy || undefined}>
    <header className={styles.topBar}>
      <Tooltip content="New thread" side="bottom">
        <IconButton label="New thread" onClick={newThread} disabled={!turn}><SquarePen aria-hidden="true" /></IconButton>
      </Tooltip>
      <div className={styles.topTitle}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p key={barTitle} className={styles.topTitleText} title={barTitle}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : duration.instant } }}
            transition={{ duration: reduced ? 0 : duration.standard, ease: enter }}>{barTitle}</motion.p>
        </AnimatePresence>
      </div>
      <ShareButton disabled={!turn} reduced={reduced} getLink={threadLink} announce={announce} />
    </header>

    <div ref={scrollerRef} className={styles.scroller}>
      <div className={styles.column}>
        {turn ? <>
          {turn.question && <h2 ref={questionRef} id={questionId} className={styles.question} tabIndex={-1}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={turn.id} className={styles.questionText}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: reduced ? 0 : duration.instant } }}
                transition={{ duration: reduced ? duration.fast : duration.standard, ease: enter }}>{turn.question}</motion.span>
            </AnimatePresence>
          </h2>}
          <TurnView key={turn.id} turn={turn} reduced={reduced} models={models} revealed={revealed} onRevealed={onRevealed}
            onRetry={retry} onRegenerate={regenerate} onSelect={select} onFeedback={feedback} onAsk={ask} shareLink={answerLink} announce={announce} />
        </> : <div className={styles.empty}>
          <h2 id={`${questionId}-empty`} className={styles.question}>What do you want to know?</h2>
          <p className={styles.emptyText}>Answers stream in with their sources, and every citation points to the sentence it supports.</p>
          {offered.length > 0 && <ul className={styles.relatedList} aria-label="Suggested questions">
            {offered.map(question => <li key={question}><button type="button" className={styles.relatedItem} onClick={() => ask(question)}><span>{question}</span><ArrowRight aria-hidden="true" /></button></li>)}
          </ul>}
        </div>}
      </div>
    </div>

    <Composer busy={busy} reduced={reduced} hasThread={Boolean(turn)} inputRef={inputRef} onSubmit={question => ask(question, "composer")} onStop={stopAll} />
    <p className={styles.srOnly} role="status" aria-live="polite">{statusText}</p>
    <p className={styles.srOnly} aria-live="polite">{announcement}</p>
  </section>;
}

export default AiAnswer;
