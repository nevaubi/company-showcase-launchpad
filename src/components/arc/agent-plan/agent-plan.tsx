"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, Reorder, motion, useDragControls, useReducedMotion } from "motion/react";
import { GripVertical, Pause, Play, Plus, RotateCcw, SkipForward, X } from "lucide-react";
import { Button } from "../button/button";
import { TextShimmer } from "../text-shimmer/text-shimmer";
import { ClaudeBrandMark } from "./agent-plan-marks";
import { AutoHeight, Rolling, StatusGlyph, StreamedText, Substeps, fadeIn, fadeOut, glide, instant, swapMotion } from "./agent-plan-parts";
import {
  fallbackScript, sampleGoal, sampleScripts, sampleSteps, sampleSuggestions, sampleSummary,
  type AgentPlanStatus, type AgentPlanStep, type AgentPlanStepAction, type AgentPlanStepState,
} from "./agent-plan-data";
import styles from "./agent-plan.module.css";

export type { AgentPlanStatus, AgentPlanStep, AgentPlanStepAction, AgentPlanStepState } from "./agent-plan-data";

export interface AgentPlanModel {
  /** Shown in the header while the plan is a draft, and in the plan's accessible name. */
  name: string;
  /** A 16px mark. Defaults to nothing when you pass your own model. */
  mark?: ReactNode;
}

export interface AgentPlanProps {
  /** The plan. Without it the component shows a sample plan for "Add rate limiting to the public API". */
  steps?: AgentPlanStep[];
  /** Where the plan stands. Pass it to drive the plan from your agent; leave it out to run the built-in simulation. */
  status?: AgentPlanStatus;
  /** What the plan is for, shown under the header. */
  goal?: string;
  /** The model that wrote the plan. Defaults to Claude Opus 5.5. */
  model?: AgentPlanModel;
  /** One line shown after the total time when the plan is done. */
  summary?: string;
  /** Called with the approved steps (empty steps removed) when someone presses Approve plan. */
  onApprove?: (steps: AgentPlanStep[]) => void;
  /** Called after each edit to a draft: rename, reorder, remove, add, or a suggested step that finished streaming. */
  onChange?: (steps: AgentPlanStep[]) => void;
  /** Called when someone retries or skips a failed step. */
  onStepAction?: (action: AgentPlanStepAction) => void;
  /** Called by Keep planning. Append the agent's next suggested step to `steps`. */
  onKeepPlanning?: () => void;
  /** Called by Pause (true) and Resume (false). */
  onPauseChange?: (paused: boolean) => void;
  className?: string;
}

const defaultModel: AgentPlanModel = { name: "Claude Opus 5.5", mark: <ClaudeBrandMark /> };
const statusWord: Record<AgentPlanStepState, string> = { pending: "Pending", active: "In progress", done: "Done", failed: "Failed", skipped: "Skipped" };

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const stateOf = (step: AgentPlanStep): AgentPlanStepState => step.state ?? "pending";
const isFinished = (step: AgentPlanStep) => step.state === "done" || step.state === "skipped";
const scriptFor = (id: string) => sampleScripts[id] ?? fallbackScript;
const patch = (steps: AgentPlanStep[], id: string, change: Partial<AgentPlanStep>) => steps.map(step => step.id === id ? { ...step, ...change } : step);

export function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/* ---------------------------------------------------------------------------------------------------------------
 * One step
 * ------------------------------------------------------------------------------------------------------------- */

interface StepRowProps {
  step: AgentPlanStep;
  index: number;
  draft: boolean;
  paused: boolean;
  reduced: boolean;
  streaming: boolean;
  note?: string;
  fresh: boolean;
  mark: ReactNode;
  hintId: string;
  register: (key: string) => (node: HTMLElement | null) => void;
  onRename: (id: string, title: string) => void;
  onCommit: (id: string, changed: boolean) => void;
  onRemove: (id: string, focus: "next" | "previous") => void;
  onMove: (id: string, direction: -1 | 1, from: "field" | "grip") => void;
  onAction: (type: AgentPlanStepAction["type"], step: AgentPlanStep) => void;
  onDragEnd: () => void;
  onStreamDone: () => void;
}

function StepRow({ step, index, draft, paused, reduced, streaming, note, fresh, mark, hintId, register, onRename, onCommit, onRemove, onMove, onAction, onDragEnd, onStreamDone }: StepRowProps) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const snapshot = useRef(step.title);
  const state = stateOf(step);
  const glyph = state === "active" && paused ? "paused" : state;
  const label = step.title || "Empty step";
  const swap = swapMotion(reduced);
  const open = state === "active" || state === "failed";

  function keyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      onMove(step.id, event.key === "ArrowUp" ? -1 : 1, "field");
    } else if (event.key === "Enter") {
      event.preventDefault();
      onCommit(step.id, step.title !== snapshot.current);
      snapshot.current = step.title;
    } else if (event.key === "Escape" && step.title !== snapshot.current) {
      event.preventDefault();
      onRename(step.id, snapshot.current);
    } else if (event.key === "Backspace" && !step.title) {
      event.preventDefault();
      onRemove(step.id, "previous");
    }
  }

  return <Reorder.Item as="li" value={step.id} dragListener={false} dragControls={controls} layout="position" dragMomentum={false}
    dragTransition={{ bounceStiffness: 700, bounceDamping: 60 }}
    className={styles.row} data-state={state} data-dragging={dragging || undefined} data-fresh={fresh || undefined}
    initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
    animate={{ height: "auto", opacity: 1 }}
    exit={reduced ? { opacity: 0, transition: instant } : { height: 0, opacity: 0, transition: { ...glide, opacity: fadeOut } }}
    transition={reduced ? instant : { ...glide, opacity: fadeIn }}
    onDragStart={() => setDragging(true)} onDragEnd={() => { setDragging(false); onDragEnd(); }}>
    <div className={styles.rowInner}>
      <span className={styles.lead}>
        <AnimatePresence initial={false}>
          {draft
            ? <motion.button key="grip" ref={register(`grip:${step.id}`)} type="button" className={styles.grip} {...swap}
                aria-label={`Move step ${index + 1}: ${label}`} aria-describedby={hintId}
                onPointerDown={event => { if (event.button === 0) controls.start(event); }}
                onKeyDown={event => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  onMove(step.id, event.key === "ArrowUp" ? -1 : 1, "grip");
                }}>
                <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />
              </motion.button>
            : <motion.span key={glyph} className={styles.glyph} {...swap} initial={{ opacity: 0 }}><StatusGlyph kind={glyph} reduced={reduced} /></motion.span>}
        </AnimatePresence>
      </span>

      <div className={styles.body}>
        {!draft && <span className={styles.srOnly}>{statusWord[state]}: </span>}
        <div className={styles.title} data-value={draft && !streaming ? step.title : undefined}>
          {streaming
            ? <span className={styles.titleText}><StreamedText text={step.title} onDone={onStreamDone} /></span>
            : draft
              ? <textarea ref={register(`field:${step.id}`)} className={styles.field} rows={1} value={step.title} placeholder="Describe the step"
                  aria-label={`Step ${index + 1}`} aria-describedby={hintId} spellCheck={false}
                  onFocus={() => { snapshot.current = step.title; }}
                  onChange={event => onRename(step.id, event.target.value.replace(/\s*\n\s*/g, " "))}
                  onBlur={() => onCommit(step.id, step.title !== snapshot.current)}
                  onKeyDown={keyDown} />
              : <TextShimmer className={styles.titleText} active={state === "active" && !paused}>{step.title}</TextShimmer>}
        </div>
        {note && <p className={styles.note}><span className={styles.noteMark} aria-hidden="true">{mark}</span>{note}</p>}

        <AnimatePresence initial={false}>
          {open && <motion.div key="activity" className={styles.collapse} initial={false}
            exit={reduced ? { opacity: 0, transition: instant } : { height: 0, opacity: 0, transition: { ...glide, opacity: fadeOut } }}>
            <Substeps lines={step.substeps ?? []} reduced={reduced} />
          </motion.div>}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {state === "failed" && <motion.div key="failure" className={styles.collapse}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0, transition: instant } : { height: 0, opacity: 0, transition: { ...glide, opacity: fadeOut } }}
            transition={reduced ? instant : { height: glide, opacity: fadeIn }}>
            <div className={styles.fail}>
              <p className={styles.failText}><span className={styles.failLabel}>Failed</span> {step.error ?? "The step did not finish."}</p>
              <div className={styles.failActions}>
                <button type="button" className={styles.mini} data-tone="accent" onClick={() => onAction("retry", step)}><RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />Retry</button>
                <button type="button" className={styles.mini} onClick={() => onAction("skip", step)}><SkipForward size={14} strokeWidth={1.75} aria-hidden="true" />Skip</button>
              </div>
            </div>
          </motion.div>}
        </AnimatePresence>
      </div>

      <span className={styles.trail}>
        <AnimatePresence initial={false}>
          {draft
            ? <motion.span key="remove" className={styles.trailItem} {...swap}>
                <button ref={register(`remove:${step.id}`)} type="button" className={styles.remove} aria-label={`Remove step ${index + 1}: ${label}`} onClick={() => onRemove(step.id, "next")}>
                  <X size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </motion.span>
            : state === "done" && step.duration != null
              ? <motion.span key="time" className={styles.trailItem} {...swap}>{formatDuration(step.duration)}</motion.span>
              : state === "skipped"
                ? <motion.span key="skipped" className={styles.trailItem} {...swap} aria-hidden="true">Skipped</motion.span>
                : null}
        </AnimatePresence>
      </span>
    </div>
  </Reorder.Item>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * The plan
 * ------------------------------------------------------------------------------------------------------------- */

/**
 * The plan an agent writes before it acts, then works through as a live checklist. While it is a draft, people rename, reorder,
 * remove and add steps, ask for one more suggestion, and approve it. Once approved, the current step shimmers with its activity
 * underneath, finished steps draw a check and settle, the agent can insert a step, and a failed step offers Retry or Skip.
 * Without `status` the component runs a simulated agent so the whole journey can be tried in place.
 */
export function AgentPlan({ steps: stepsProp, status: statusProp, goal = sampleGoal, model = defaultModel, summary: summaryProp, onApprove, onChange, onStepAction, onKeepPlanning, onPauseChange, className }: AgentPlanProps) {
  const reduced = useReducedMotion() ?? false;
  const simulated = statusProp === undefined;
  const hintId = useId();

  const [steps, setSteps] = useState<AgentPlanStep[]>(() => stepsProp ?? sampleSteps);
  const [syncedSteps, setSyncedSteps] = useState(stepsProp);
  if (stepsProp !== syncedSteps) { setSyncedSteps(stepsProp); if (stepsProp) setSteps(stepsProp); }
  const [innerStatus, setInnerStatus] = useState<AgentPlanStatus>("draft");
  const status = statusProp ?? innerStatus;
  const draft = status === "draft";
  const paused = status === "paused";

  const [announcement, setAnnouncement] = useState("");
  const [thinking, setThinking] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<ReadonlySet<string>>(() => new Set());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());

  const latest = useRef(steps);
  useEffect(() => { latest.current = steps; });
  const run = useRef({ attempts: new Map<string, number>(), inserted: new Set<string>() });
  const thinkTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(thinkTimer.current), []);
  const counter = useRef(0);

  /* Focus follows the action: a moved step keeps focus, a removed one hands it to a neighbour, approve hands it to Pause. */
  const nodes = useRef(new Map<string, HTMLElement>());
  const focusTarget = useRef<{ key: string; at: number } | null>(null);
  const register = useCallback((key: string) => (node: HTMLElement | null) => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); }, []);
  const focusSoon = (key: string) => { focusTarget.current = { key, at: Date.now() }; };
  useLayoutEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    if (Date.now() - target.at > 1500) { focusTarget.current = null; return; }
    const node = nodes.current.get(target.key);
    if (!node) return;
    focusTarget.current = null;
    if (document.activeElement !== node) node.focus({ preventScroll: true });
  });

  const total = steps.length;
  const finishedCount = steps.filter(isFinished).length;
  const current = status === "done" ? total : Math.min(total, finishedCount + 1);
  const failedIndex = steps.findIndex(step => step.state === "failed");
  const totalTime = steps.reduce((sum, step) => sum + (step.state === "done" ? step.duration ?? 0 : 0), 0);
  const summary = summaryProp ?? (simulated ? sampleSummary : undefined);
  const suggestionsLeft = simulated ? suggestIndex < sampleSuggestions.length : true;

  /* ----- Draft edits ----- */

  function edit(next: AgentPlanStep[], message?: string) {
    setSteps(next);
    onChange?.(next);
    if (message) setAnnouncement(message);
  }

  const rename = (id: string, title: string) => setSteps(current => patch(current, id, { title }));

  function commitTitle(id: string, changed: boolean) {
    const step = latest.current.find(item => item.id === id);
    if (!step) return;
    if (!step.title.trim()) { edit(latest.current.filter(item => item.id !== id), "Removed the empty step"); return; }
    if (changed) { onChange?.(latest.current); setAnnouncement(`Renamed step to ${step.title}`); }
  }

  function remove(id: string, focus: "next" | "previous") {
    const index = steps.findIndex(step => step.id === id);
    const step = steps[index];
    if (!step) return;
    const next = steps.filter(item => item.id !== id);
    const neighbour = focus === "previous" ? next[index - 1] ?? next[index] : next[index] ?? next[index - 1];
    focusSoon(neighbour ? `${focus === "previous" ? "field" : "remove"}:${neighbour.id}` : "add");
    edit(next, `Removed ${step.title || "the empty step"}`);
  }

  function move(id: string, direction: -1 | 1, from: "field" | "grip") {
    const index = steps.findIndex(step => step.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    focusSoon(`${from}:${id}`);
    edit(next, `Moved to position ${target + 1} of ${next.length}`);
  }

  const reorder = (ids: string[]) => setSteps(current => ids.map(id => current.find(step => step.id === id)).filter((step): step is AgentPlanStep => Boolean(step)));

  function addStep() {
    counter.current += 1;
    const id = `step-${counter.current}-${Date.now().toString(36)}`;
    focusSoon(`field:${id}`);
    edit([...steps, { id, title: "" }], "Added an empty step");
  }

  function keepPlanning() {
    onKeepPlanning?.();
    if (!simulated || thinking || streamingId) return;
    const suggestion = sampleSuggestions[suggestIndex];
    if (!suggestion) return;
    setThinking(true);
    setAnnouncement("Planning one more step");
    thinkTimer.current = window.setTimeout(() => {
      setThinking(false);
      setSuggestIndex(index => index + 1);
      setSuggested(previous => new Set(previous).add(suggestion.id));
      setStreamingId(suggestion.id);
      // A suggestion lands before the last step, which in most plans is the wrap-up.
      setSteps(current => {
        if (current.some(step => step.id === suggestion.id)) return current;
        const next = [...current];
        next.splice(Math.max(0, current.length - 1), 0, { ...suggestion });
        return next;
      });
    }, 720);
  }

  const streamDone = useCallback(() => {
    setStreamingId(null);
    onChange?.(latest.current);
    setAnnouncement("Suggested one more step. Edit, move or remove it before approving.");
  }, [onChange]);

  function approve() {
    const cleaned = steps.filter(step => step.title.trim()).map(step => ({ ...step, title: step.title.trim() }));
    if (!cleaned.length) return;
    onApprove?.(cleaned);
    // A suggestion still thinking is dropped; one still streaming keeps its full title.
    window.clearTimeout(thinkTimer.current);
    setThinking(false);
    setStreamingId(null);
    focusSoon("pause");
    if (!simulated) return;
    run.current = { attempts: new Map(), inserted: new Set() };
    setSteps(cleaned.map(step => ({ ...step, state: "pending", substeps: [], error: undefined, duration: undefined })));
    setInnerStatus("running");
    setAnnouncement(`Plan approved. Running ${cleaned.length} steps as a simulation.`);
  }

  /* ----- Run controls ----- */

  function togglePause() {
    const pausing = status === "running";
    onPauseChange?.(pausing);
    if (simulated) setInnerStatus(pausing ? "paused" : "running");
    setAnnouncement(pausing ? "Paused" : "Resumed");
  }

  function stepAction(type: AgentPlanStepAction["type"], step: AgentPlanStep) {
    onStepAction?.({ type, step });
    focusSoon("pause");
    if (!simulated) return;
    if (type === "retry") {
      run.current.attempts.set(step.id, (run.current.attempts.get(step.id) ?? 0) + 1);
      setSteps(current => patch(current, step.id, { state: "active", error: undefined }));
      setAnnouncement(`Retrying ${step.title}`);
    } else {
      setSteps(current => patch(current, step.id, { state: "skipped", error: undefined }));
      setAnnouncement(`Skipped ${step.title}`);
    }
  }

  function startOver() {
    run.current = { attempts: new Map(), inserted: new Set() };
    setSteps(stepsProp ?? sampleSteps);
    setInnerStatus("draft");
    setSuggestIndex(0);
    setSuggested(new Set());
    setFresh(new Set());
    focusSoon("approve");
    setAnnouncement("Back to the draft plan");
  }

  /* ----- The simulated agent: each state change schedules exactly one next event, so pausing just drops the timer ----- */

  useEffect(() => {
    if (!simulated || status !== "running" || steps.some(step => step.state === "failed")) return;
    const index = steps.findIndex(step => step.state === "active");
    let delay: number;
    let act: () => void;
    if (index < 0) {
      const next = steps.find(step => stateOf(step) === "pending");
      if (!next) {
        delay = 420;
        act = () => {
          setInnerStatus("done");
          const seconds = latest.current.reduce((sum, step) => sum + (step.state === "done" ? step.duration ?? 0 : 0), 0);
          setAnnouncement(`Plan done in ${formatDuration(seconds)}. ${sampleSummary}`);
        };
      } else {
        delay = 260;
        act = () => setSteps(current => patch(current, next.id, { state: "active", substeps: [] }));
      }
    } else {
      const step = steps[index]!;
      const script = scriptFor(step.id);
      const attempt = run.current.attempts.get(step.id) ?? 0;
      const lines = attempt > 0 && script.fail ? [...script.substeps, ...script.fail.retry] : script.substeps;
      const shown = step.substeps?.length ?? 0;
      const insert = script.insert;
      if (insert && shown >= insert.after && !run.current.inserted.has(insert.step.id) && !steps.some(item => item.id === insert.step.id)) {
        delay = 420;
        act = () => {
          run.current.inserted.add(insert.step.id);
          setFresh(previous => new Set(previous).add(insert.step.id));
          setSteps(current => {
            const at = current.findIndex(item => item.id === step.id);
            const next = [...current];
            next.splice(at + 1, 0, { ...insert.step, state: "pending" });
            return next;
          });
          setAnnouncement(`The agent added a step: ${insert.step.title}`);
        };
      } else if (shown < lines.length) {
        delay = shown === 0 ? 360 : 540;
        act = () => setSteps(current => patch(current, step.id, { substeps: [...(current.find(item => item.id === step.id)?.substeps ?? []), lines[shown]!] }));
      } else if (script.fail && attempt === 0) {
        delay = 520;
        act = () => {
          setSteps(current => patch(current, step.id, { state: "failed", error: script.fail!.error }));
          setAnnouncement(`Step ${index + 1} failed: ${script.fail!.error}. Retry or skip it.`);
        };
      } else {
        delay = 480;
        act = () => {
          setSteps(current => patch(current, step.id, { state: "done", duration: script.duration }));
          setAnnouncement(`Done: ${step.title}`);
        };
      }
    }
    const timer = window.setTimeout(act, delay);
    return () => window.clearTimeout(timer);
  }, [simulated, status, steps]);

  const swap = swapMotion(reduced);
  const footLabel = failedIndex >= 0 ? `Step ${failedIndex + 1} failed` : paused ? `Paused on step ${current}` : `Working on step ${current}`;

  return <section className={cx(styles.root, className)} aria-label={`${model.name} plan: ${goal}`} data-status={status}>
    <header className={styles.header}>
      <div className={styles.headRow}>
        {model.mark && <span className={styles.mark} aria-hidden="true">{model.mark}</span>}
        <h3 className={styles.heading}>Plan<span className={styles.count}><span aria-hidden="true"> · </span><Rolling value={total} reduced={reduced} /> {total === 1 ? "step" : "steps"}</span></h3>
        <span className={styles.headMeta}>
          <AnimatePresence initial={false}>
            {draft
              ? <motion.span key="model" {...swap}>{model.name}</motion.span>
              : <motion.span key="count" {...swap}><Rolling value={current} reduced={reduced} /> of <Rolling value={total} reduced={reduced} /></motion.span>}
          </AnimatePresence>
        </span>
      </div>
      {goal && <p className={cx(styles.goal, !model.mark && styles.goalFlush)}>{goal}</p>}
      <div className={styles.progress} role="progressbar" aria-label="Plan progress" aria-hidden={draft || undefined}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={finishedCount} aria-valuetext={`${finishedCount} of ${total} steps finished`}>
        <motion.span className={styles.fill} initial={false} animate={{ scaleX: draft || !total ? 0 : finishedCount / total, opacity: draft ? 0 : 1 }}
          transition={reduced ? instant : { scaleX: glide, opacity: fadeIn }} />
      </div>
    </header>

    <div className={styles.listWrap}>
      <span id={hintId} className={styles.srOnly}>Alt plus Arrow up or down moves a step. Escape undoes a rename.</span>
      <Reorder.Group as="ol" axis="y" values={steps.map(step => step.id)} onReorder={reorder} className={styles.list} aria-label="Plan steps">
        <AnimatePresence initial={false}>
          {steps.map((step, index) => <StepRow key={step.id} step={step} index={index} draft={draft} paused={paused} reduced={reduced}
            streaming={streamingId === step.id} note={step.note ?? (draft && suggested.has(step.id) ? "Suggested" : undefined)} fresh={fresh.has(step.id)}
            mark={model.mark} hintId={hintId} register={register}
            onRename={rename} onCommit={commitTitle} onRemove={remove} onMove={move} onAction={stepAction}
            onDragEnd={() => onChange?.(latest.current)} onStreamDone={streamDone} />)}
        </AnimatePresence>
      </Reorder.Group>
      {!steps.length && <p className={styles.empty}>No steps yet. Add one or keep planning.</p>}
      <AnimatePresence initial={false}>
        {draft && <motion.div key="add" className={styles.collapse}
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0, transition: instant } : { height: 0, opacity: 0, transition: { ...glide, opacity: fadeOut } }}
          transition={reduced ? instant : { height: glide, opacity: fadeIn }}>
          <button ref={register("add")} type="button" className={styles.add} onClick={addStep}>
            <span className={styles.lead}><Plus size={16} strokeWidth={1.75} aria-hidden="true" /></span>Add step
          </button>
        </motion.div>}
      </AnimatePresence>
    </div>

    <AutoHeight className={styles.footWrap} reduced={reduced}>
      <div className={styles.foot}>
        <AnimatePresence mode="popLayout" initial={false}>
          {draft ? (
            <motion.div key="draft" className={styles.footRow} data-phase="draft" {...swap}>
              <Button variant="secondary" size="sm" loading={thinking} disabled={!suggestionsLeft && !thinking} onClick={keepPlanning}>Keep planning</Button>
              <Button ref={register("approve")} size="sm" className={styles.approve} disabled={!steps.some(step => step.title.trim())} onClick={approve}>Approve plan</Button>
            </motion.div>
          ) : status === "done" ? (
            <motion.div key="done" className={styles.footRow} data-phase="done" {...swap}>
              <p className={styles.summary}><strong>{totalTime ? `Done in ${formatDuration(totalTime)}.` : "Done."}</strong>{summary && <> <StreamedText text={summary} /></>}</p>
              {simulated && <Button ref={register("startOver")} variant="ghost" size="sm" onClick={startOver}><RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />Start over</Button>}
            </motion.div>
          ) : (
            <motion.div key="run" className={styles.footRow} data-phase="run" {...swap}>
              <span className={styles.footStatus}>
                <AnimatePresence initial={false}>
                  <motion.span key={footLabel} {...swap}>{footLabel}</motion.span>
                </AnimatePresence>
              </span>
              <AnimatePresence initial={false}>
                {failedIndex < 0 && <motion.span key="pause" className={styles.pauseSlot} {...swap}>
                  <Button ref={register("pause")} variant="secondary" size="sm" onClick={togglePause}>
                    {paused ? <><Play size={16} strokeWidth={1.75} aria-hidden="true" />Resume</> : <><Pause size={16} strokeWidth={1.75} aria-hidden="true" />Pause</>}
                  </Button>
                </motion.span>}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AutoHeight>

    <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
  </section>;
}

export default AgentPlan;
