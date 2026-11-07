"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Transition, type Variants } from "motion/react";
import { CircleDot, FilePen, FilePlus, FileText, Gauge, Search, SquareTerminal } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import type { AgentPlanStepState } from "./agent-plan-data";
import styles from "./agent-plan.module.css";

const { duration, ease } = motionTokens;
const easeOut = [...ease.enter] as [number, number, number, number];
const standard = [...ease.standard] as [number, number, number, number];

/** Heights, reorders and inserts: critically damped and quick, so nothing that moves or resizes ever overshoots. */
export const glide: Transition = { type: "spring", visualDuration: .26, bounce: 0 };
export const fadeIn: Transition = { duration: duration.fast, ease: easeOut };
export const fadeOut: Transition = { duration: .1, ease: standard };
export const instant: Transition = { duration: 0 };

/** One minimal crossfade for swapped labels and icons: the old one leaves fast, the new one rises 3px into place. */
export function swapMotion(reduced: boolean) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 3 },
    animate: { opacity: 1, y: 0, transition: reduced ? instant : fadeIn },
    exit: { opacity: 0, transition: reduced ? instant : fadeOut },
  };
}

/* ---------------------------------------------------------------------------------------------------------------
 * Status glyphs: one 14px shape per state, so state never rests on color alone
 * ------------------------------------------------------------------------------------------------------------- */

export type GlyphKind = AgentPlanStepState | "paused";

export function StatusGlyph({ kind, reduced }: { kind: GlyphKind; reduced: boolean }) {
  switch (kind) {
    case "active":
      return <svg viewBox="0 0 16 16" className={styles.spin} aria-hidden="true"><circle cx="8" cy="8" r="6.25" className={styles.track} /><path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" className={styles.arc} /></svg>;
    case "paused":
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" className={styles.pausedRing} /><path d="M6.6 5.9v4.2M9.4 5.9v4.2" className={styles.pausedBars} /></svg>;
    case "done":
      // The signature detail: the check strokes itself in over about 220ms while the disc fades up under it.
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className={styles.doneDisc} />
        <motion.path d="M5 8.25 7.1 10.3 11 6" className={styles.ink} initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={reduced ? instant : { duration: .22, ease: easeOut, delay: .04 }} />
      </svg>;
    case "failed":
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className={styles.failDisc} /><path d="M8 4.9v3.6" className={styles.ink} /><circle cx="8" cy="11.1" r=".95" className={styles.inkDot} /></svg>;
    case "skipped":
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" className={styles.skipRing} /><path d="M5.6 8h4.8" className={styles.skipDash} /></svg>;
    default:
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" className={styles.ring} /></svg>;
  }
}

/* ---------------------------------------------------------------------------------------------------------------
 * Rolling number: tabular digits in a reserved width, rolling in the direction the value moved
 * ------------------------------------------------------------------------------------------------------------- */

const roll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${.4 * direction}em` }),
  center: { opacity: 1, y: "0em", transition: { duration: .2, ease: easeOut } },
  exit: (direction: number) => ({ opacity: 0, y: `${-.4 * direction}em`, transition: fadeOut }),
};

export function Rolling({ value, reduced }: { value: number; reduced: boolean }) {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(1);
  if (previous !== value) { setDirection(value > previous ? 1 : -1); setPrevious(value); }
  const text = String(value);
  return <span className={styles.roll} style={{ width: `${text.length}ch` }}>
    <AnimatePresence initial={false} custom={direction}>
      <motion.span key={reduced ? "static" : text} className={styles.rollValue} custom={direction} variants={roll} initial={reduced ? false : "enter"} animate="center" exit={reduced ? undefined : "exit"}>{text}</motion.span>
    </AnimatePresence>
  </span>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Streamed text: chunks of a few words on a steady requestAnimationFrame clock, each one fading in once
 * ------------------------------------------------------------------------------------------------------------- */

const TICK = 34;

/** Splits text into chunks of three to six words (about 15 to 40 characters), the way fast model output arrives. */
export function chunkText(text: string) {
  const words = text.match(/\S+\s*/g) ?? [];
  const sizes = [4, 3, 5, 4, 6];
  const chunks: string[] = [];
  let current = "", count = 0;
  for (const word of words) {
    current += word;
    count += 1;
    if (count >= sizes[chunks.length % sizes.length]! || current.length >= 36) { chunks.push(current); current = ""; count = 0; }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function StreamedText({ text, onDone }: { text: string; onDone?: () => void }) {
  const chunks = useMemo(() => chunkText(text), [text]);
  const [count, setCount] = useState(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    let frame = 0, shown = 0, last = performance.now() - TICK;
    const tick = (now: number) => {
      // A steady rate with catch-up: a late frame appends every chunk it owes instead of slowing the stream down.
      const due = Math.floor((now - last) / TICK);
      if (due > 0) { shown = Math.min(chunks.length, shown + due); last += due * TICK; setCount(shown); }
      if (shown < chunks.length) frame = requestAnimationFrame(tick);
      else done.current?.();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [chunks]);
  return <>{chunks.slice(0, count).map((chunk, index) => <span key={index} className={styles.chunk}>{chunk}</span>)}</>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Auto height: a box whose height follows its content on the glide spring, so a swapped footer never resizes in one frame
 * ------------------------------------------------------------------------------------------------------------- */

export function AutoHeight({ children, className, reduced }: { children: ReactNode; className?: string; reduced: boolean }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.div className={className} initial={false} animate={{ height }} transition={reduced ? instant : glide}>
    <div ref={inner}>{children}</div>
  </motion.div>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Substeps: activity lines under the active step. The first word picks the icon.
 * ------------------------------------------------------------------------------------------------------------- */

function SubstepIcon({ label }: { label: string }) {
  const verb = label.split(" ", 1)[0]?.toLowerCase() ?? "";
  const Icon = verb === "read" ? FileText
    : verb === "edited" || verb === "updated" ? FilePen
    : verb === "created" || verb === "wrote" || verb === "added" ? FilePlus
    : verb === "searched" || verb === "found" ? Search
    : verb === "ran" ? SquareTerminal
    : verb === "measured" ? Gauge
    : CircleDot;
  return <Icon size={12} strokeWidth={1.75} aria-hidden="true" />;
}

export function Substeps({ lines, reduced }: { lines: string[]; reduced: boolean }) {
  return <ul className={styles.subs} aria-label="Activity">
    <AnimatePresence initial={false}>
      {lines.map((line, index) => <motion.li key={index} className={styles.sub}
        initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
        transition={reduced ? instant : { height: glide, opacity: fadeIn }}>
        <span className={styles.subInner}><SubstepIcon label={line} /><span className={styles.subText}>{line}</span></span>
      </motion.li>)}
    </AnimatePresence>
  </ul>;
}
