"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import type { RunClock } from "./agent-status-clock";
import { formatStep } from "./agent-status-clock";
import type { AgentActivity, AgentIcon, AgentRunStatus, AgentStep } from "./agent-status-types";
import styles from "./agent-status.module.css";

const ease = [...motionTokens.ease.standard] as [number, number, number, number];
const enter = [...motionTokens.ease.enter] as [number, number, number, number];

/**
 * The live indicator: the agent's mark inside a thin ring. Working spins a short arc, paused freezes it, needs input swaps
 * the arc for an accent dot, and done or failed closes the ring as the mark morphs into a check or a cross.
 */
export function Orb({ state, mark, reduced }: { state: AgentRunStatus; mark?: ReactNode; reduced: boolean }) {
  const glyph = state === "done" ? "check" : state === "failed" ? "cross" : state === "stopped" ? "stop" : "mark";
  const closed = state === "done" || state === "failed";
  const pop = reduced ? { duration: motionTokens.duration.instant } : { type: "spring", visualDuration: 0.22, bounce: 0 } as const;
  return <span className={styles.orb} data-state={state} aria-hidden="true">
    <svg className={styles.ring} viewBox="0 0 24 24" fill="none">
      <circle className={styles.track} cx="12" cy="12" r="10.75" />
      <g className={styles.spinner}><circle className={styles.arc} cx="12" cy="12" r="10.75" pathLength={100} strokeDasharray="24 76" /></g>
      <motion.circle className={styles.closed} cx="12" cy="12" r="10.75" initial={false}
        animate={{ pathLength: closed ? 1 : 0, opacity: closed ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : { pathLength: { duration: .42, ease: enter }, opacity: { duration: motionTokens.duration.instant } }} />
    </svg>
    <AnimatePresence initial={false}>
      <motion.span key={glyph} className={styles.glyph} data-glyph={glyph}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .4 }} animate={{ opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: .4, transition: { duration: motionTokens.duration.instant, ease } }}
        transition={pop}>
        {glyph === "mark" ? mark : glyph === "stop" ? <span className={styles.stopGlyph} /> : <svg viewBox="0 0 24 24" fill="none">
          <motion.path d={glyph === "check" ? "M5.5 12.5l4.25 4.25L18.5 7.75" : "M7.5 7.5l9 9M16.5 7.5l-9 9"} initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: .28, delay: .12, ease: enter }} />
        </svg>}
      </motion.span>
    </AnimatePresence>
    <AnimatePresence>
      {state === "needs-input" ? <motion.span key="dot" className={styles.dot} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : 0, transition: { duration: motionTokens.duration.instant } }} transition={pop} /> : null}
    </AnimatePresence>
  </span>;
}

export interface LabelView { key: string; text: string; icon?: AgentIcon; progress?: AgentActivity["progress"]; tone: "quiet" | "live" | "plain" }

/** Icon and text roll in together from below while the old pair leaves upward. The count ticks in place without a roll. */
export function RollingLabel({ view, reduced }: { view: LabelView; reduced: boolean }) {
  const Icon = view.icon;
  return <span className={styles.labelSlot}>
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={view.key} className={styles.labelUnit} data-tone={view.tone}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -12, transition: { duration: .14, ease } }}
        transition={{ duration: reduced ? motionTokens.duration.instant : .18, ease }}>
        {Icon ? <Icon className={styles.labelIcon} size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
        <span className={styles.labelText}>{view.text}{view.progress ? <span className={styles.count}> {view.progress.value} of {view.progress.total}</span> : null}</span>
      </motion.span>
    </AnimatePresence>
  </span>;
}

/** The same label without motion, for the width ghosts. */
export function StaticLabel({ view }: { view: LabelView }) {
  const Icon = view.icon;
  return <span className={styles.labelSlot}>
    <span className={styles.labelUnit} data-tone={view.tone}>
      {Icon ? <Icon className={styles.labelIcon} size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span className={styles.labelText}>{view.text}{view.progress ? <span className={styles.count}> {view.progress.value} of {view.progress.total}</span> : null}</span>
    </span>
  </span>;
}

/** One thin segment per step: done fills, the active step fills with its count, a failed step fills with the danger color. */
export function StepSegments({ steps, progress }: { steps: AgentStep[]; progress?: AgentActivity["progress"] }) {
  const done = steps.filter(step => step.status === "done" || step.status === "skipped").length;
  return <div className={styles.segments} role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-valuetext={`${done} of ${steps.length} steps finished`}>
    {steps.map(step => {
      const fill = step.status === "done" || step.status === "skipped" || step.status === "failed" ? 1 : step.status === "active" && progress ? progress.value / progress.total : 0;
      return <span key={step.id} className={styles.segment} data-status={step.status}><span className={styles.segmentFill} style={{ transform: `scaleX(${fill})` }} /></span>;
    })}
  </div>;
}

/** The latest steps, newest last. A new step fades in at the bottom while the list slides up to make room. */
export function StepList({ steps, progress, running, clock, now, reduced, limit }: { steps: AgentStep[]; progress?: AgentActivity["progress"]; running: boolean; clock: RunClock; now: number; reduced: boolean; limit: number }) {
  const shown = steps.filter(step => step.status !== "pending").slice(-limit);
  const layout = reduced ? { duration: 0 } : motionTokens.spring.smooth;
  return <ol className={styles.steps}>
    <AnimatePresence mode="popLayout" initial={false}>
      {shown.map(step => {
        const Icon = step.icon;
        const live = step.status === "active" || step.status === "waiting";
        const time = live ? clock.since(step.startedAt, now) : step.durationMs;
        return <motion.li key={step.id} layout="position" className={styles.step} data-status={step.status}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
          transition={{ layout, opacity: { duration: reduced ? 0 : .18, ease } }}>
          <span className={styles.stepIcon}>{Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}</span>
          <span className={styles.stepText}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={step.label} className={running && step.status === "active" ? `${styles.stepLabel} ${styles.shimmer}` : styles.stepLabel}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }} transition={{ duration: reduced ? 0 : .16, ease }}>
                {step.label}{step.status === "active" && progress ? <span className={styles.count}> {progress.value} of {progress.total}</span> : null}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className={styles.stepTime}>{time !== undefined && (live || time > 0) ? live ? `${Math.floor(time / 1000)}s` : formatStep(time) : ""}</span>
        </motion.li>;
      })}
    </AnimatePresence>
  </ol>;
}
