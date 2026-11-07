"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, CircleAlert, Copy, Link2, Maximize2, Minimize2, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { motionTokens } from "../../lib/motion-tokens";
import { Tooltip } from "../../tooltip/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover/popover";
import type { AnswerModel } from "./ai-answer-data";
import type { RegenerateMode } from "./ai-answer-demo";
import styles from "./ai-answer.module.css";
import { writeClipboard } from "../../lib/use-copy-feedback";

const { spring, duration, ease } = motionTokens;
/** Moves, resizes and swaps settle without overshoot, so nothing wobbles. */
const settle = { type: "spring", visualDuration: 0.24, bounce: 0 } as const;
const enter = [...ease.enter] as [number, number, number, number];
const standard = [...ease.standard] as [number, number, number, number];
const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/* ---------------------------------------------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------------------------------------------- */

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(function IconButton({ label, className, children, ...props }, ref) {
  return <button ref={ref} type="button" aria-label={label} className={cx(styles.iconButton, className)} {...props}>{children}</button>;
});

/** Icons trade places in one breath: the old glyph fades out while the new one fades in. Same box, so nothing moves. */
export function SwapIcon({ id, reduced, children }: { id: string; reduced: boolean; children: ReactNode }) {
  return <span className={styles.swapIcon} aria-hidden="true">
    <AnimatePresence initial={false}>
      <motion.span key={id} className={styles.swapIconInner}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: .85, transition: { duration: duration.fast, ease: standard } }}
        transition={reduced ? { duration: duration.instant } : { scale: settle, opacity: { duration: duration.standard, ease: enter }, filter: { duration: duration.standard, ease: enter } }}>
        {children}
      </motion.span>
    </AnimatePresence>
  </span>;
}

/** The success tick draws itself on. */
export function DrawnCheck({ reduced }: { reduced: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={styles.drawnCheck}>
    <motion.path d="M4 12l5 5L20 6" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .36, ease: standard, delay: .04 }} />
  </svg>;
}

type CopyState = "idle" | "copied" | "error";

/** Copies text and holds the result for a moment. */
export function useClipboard(hold = 1600) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (text: string | (() => Promise<string>)) => {
    window.clearTimeout(timer.current);
    let ok = false;
    try {
      const value = typeof text === "string" ? text : await text();
      await writeClipboard(value);
      ok = true;
    } catch { ok = false; }
    setState(ok ? "copied" : "error");
    timer.current = window.setTimeout(() => setState("idle"), hold);
    return ok;
  };
  return { state, copy };
}

/* ---------------------------------------------------------------------------------------------------------------
 * Regenerate menu
 * ------------------------------------------------------------------------------------------------------------- */

function RegenerateMenu({ models, model, disabled, onRegenerate }: { models: AnswerModel[]; model: AnswerModel; disabled: boolean; onRegenerate: (mode: RegenerateMode, model?: AnswerModel) => void }) {
  const others = models.filter(item => item.id !== model.id);
  return <Menu.Root modal={false}>
    <Tooltip content="Regenerate">
      <Menu.Trigger asChild disabled={disabled}>
        <IconButton label="Regenerate" className={styles.anchor}><RotateCcw aria-hidden="true" /></IconButton>
      </Menu.Trigger>
    </Tooltip>
    <Menu.Portal>
      <Menu.Content className={styles.menu} side="top" align="start" sideOffset={6} collisionPadding={12} loop>
        <Menu.Item className={styles.menuItem} onSelect={() => onRegenerate("retry")}><RotateCcw aria-hidden="true" />Try again</Menu.Item>
        <Menu.Item className={styles.menuItem} onSelect={() => onRegenerate("concise")}><Minimize2 aria-hidden="true" />More concise</Menu.Item>
        <Menu.Item className={styles.menuItem} onSelect={() => onRegenerate("detailed")}><Maximize2 aria-hidden="true" />More detailed</Menu.Item>
        {others.length > 0 && <>
          <Menu.Separator className={styles.menuSeparator} />
          <Menu.Sub>
            <Menu.SubTrigger className={styles.menuItem}><ArrowLeftRight aria-hidden="true" />Switch model<ChevronRight className={styles.menuChevron} aria-hidden="true" /></Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className={styles.menu} sideOffset={6} alignOffset={-5} collisionPadding={12} loop>
                <Menu.Label className={styles.menuLabel}>Answer again with</Menu.Label>
                {others.map(item => <Menu.Item key={item.id} className={styles.menuItem} onSelect={() => onRegenerate("model", item)}>
                  <span className={styles.menuMark} aria-hidden="true">{item.mark}</span>{item.name}
                </Menu.Item>)}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        </>}
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}

/** Springs to its content's height, so a panel that swaps content resizes smoothly instead of in one frame. */
function MeasuredHeight({ reduced, className, children }: { reduced: boolean; className?: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.div className={className} initial={false} animate={{ height }} transition={reduced ? { duration: 0 } : spring.smooth}>
    <div ref={inner}>{children}</div>
  </motion.div>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Feedback
 * ------------------------------------------------------------------------------------------------------------- */

const reasons = ["Not accurate", "Out of date", "Missing a source", "Too long", "Did not answer the question"];

function DownFeedback({ active, reduced, onPick, onClear }: { active: boolean; reduced: boolean; onPick: (reason: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pick = (reason: string) => {
    setSent(reason);
    onPick(reason);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 1500);
  };
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) window.clearTimeout(timer.current); }}>
    <Tooltip content={active ? "Remove feedback" : "Bad response"}>
      <PopoverTrigger asChild onClick={event => {
        // A second press takes the feedback back instead of asking again.
        if (active) { event.preventDefault(); onClear(); return; }
        setSent(null);
      }}>
        <IconButton label="Bad response" aria-pressed={active} className={cx(styles.anchor, active && styles.pressed)}>
          <SwapIcon id={active ? "on" : "off"} reduced={reduced}><ThumbsDown aria-hidden="true" className={active ? styles.filled : undefined} /></SwapIcon>
        </IconButton>
      </PopoverTrigger>
    </Tooltip>
    <PopoverContent className={styles.feedback} side="top" align="start" sideOffset={8} aria-label="What went wrong">
      <MeasuredHeight reduced={reduced} className={styles.feedbackStage}>
        <AnimatePresence mode="popLayout" initial={false}>
          {sent
            ? <motion.div key="thanks" className={styles.feedbackThanks} role="status"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: duration.standard, ease: enter, delay: reduced ? 0 : .06 }}>
                <span className={styles.feedbackCheck}><DrawnCheck reduced={reduced} /></span>
                <span><span className={styles.feedbackTitle}>Thanks for telling us</span><span className={styles.feedbackNote}>Noted: {sent.toLowerCase()}</span></span>
              </motion.div>
            : <motion.div key="ask" exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, transition: { duration: duration.fast, ease: standard } }}>
                <p className={styles.feedbackTitle} id="ai-answer-feedback-title">What went wrong?</p>
                <div className={styles.reasons} role="group" aria-labelledby="ai-answer-feedback-title">
                  {reasons.map(reason => <button key={reason} type="button" className={styles.reason} onClick={() => pick(reason)}>{reason}</button>)}
                </div>
              </motion.div>}
        </AnimatePresence>
      </MeasuredHeight>
    </PopoverContent>
  </Popover>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Action bar
 * ------------------------------------------------------------------------------------------------------------- */

export interface ActionBarProps {
  reduced: boolean;
  copyText: () => string;
  shareLink: () => Promise<string>;
  feedback?: "up" | "down";
  onFeedback: (value: "up" | "down" | null, reason?: string) => void;
  models: AnswerModel[];
  model: AnswerModel;
  busy: boolean;
  onRegenerate: (mode: RegenerateMode, model?: AnswerModel) => void;
  versions: number;
  index: number;
  onVersion: (index: number) => void;
  announce: (message: string) => void;
  meta: ReactNode;
}

export function ActionBar({ reduced, copyText, shareLink, feedback, onFeedback, models, model, busy, onRegenerate, versions, index, onVersion, announce, meta }: ActionBarProps) {
  const copy = useClipboard();
  const share = useClipboard();
  const [direction, setDirection] = useState(1);
  const go = (next: number) => { setDirection(next > index ? 1 : -1); onVersion(next); };

  return <div className={styles.actionBar}>
    <div className={styles.actions} role="toolbar" aria-label="Answer actions">
      <Tooltip content={copy.state === "copied" ? "Copied" : copy.state === "error" ? "Could not copy" : "Copy answer"}>
        <IconButton label="Copy answer" data-state={copy.state} onClick={async () => {
          const ok = await copy.copy(copyText());
          announce(ok ? "Answer copied with its sources" : "Could not copy the answer");
        }}>
          <SwapIcon id={copy.state} reduced={reduced}>
            {copy.state === "copied" ? <DrawnCheck reduced={reduced} /> : copy.state === "error" ? <CircleAlert aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </SwapIcon>
        </IconButton>
      </Tooltip>
      <RegenerateMenu models={models} model={model} disabled={busy} onRegenerate={onRegenerate} />
      <Tooltip content={feedback === "up" ? "Remove feedback" : "Good response"}>
        <IconButton label="Good response" aria-pressed={feedback === "up"} className={cx(feedback === "up" && styles.pressed)} onClick={() => onFeedback(feedback === "up" ? null : "up")}>
          <SwapIcon id={feedback === "up" ? "on" : "off"} reduced={reduced}><ThumbsUp aria-hidden="true" className={feedback === "up" ? styles.filled : undefined} /></SwapIcon>
        </IconButton>
      </Tooltip>
      <DownFeedback active={feedback === "down"} reduced={reduced} onPick={reason => onFeedback("down", reason)} onClear={() => onFeedback(null)} />
      <Tooltip content={share.state === "copied" ? "Link copied" : share.state === "error" ? "Could not copy" : "Copy share link"}>
        <IconButton label="Copy share link" data-state={share.state} onClick={async () => {
          const ok = await share.copy(shareLink);
          announce(ok ? "Share link copied. This preview copies a sample link" : "Could not copy the share link");
        }}>
          <SwapIcon id={share.state} reduced={reduced}>
            {share.state === "copied" ? <DrawnCheck reduced={reduced} /> : share.state === "error" ? <CircleAlert aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          </SwapIcon>
        </IconButton>
      </Tooltip>
      <AnimatePresence initial={false}>
        {versions > 1 && <motion.div key="versions" className={styles.versions} role="group" aria-label="Versions"
          initial={reduced ? { opacity: 0 } : { opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }}
          transition={reduced ? { duration: duration.fast } : { width: settle, opacity: { duration: duration.standard, ease: enter } }}>
          <span className={styles.versionsRule} aria-hidden="true" />
          <IconButton label="Previous version" className={styles.versionStep} disabled={busy || index === 0} onClick={() => go(index - 1)}><ChevronLeft aria-hidden="true" /></IconButton>
          <span className={styles.versionCount}>
            <span className={styles.versionRoll} aria-hidden="true">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.span key={index} custom={direction}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: `${direction * .6}em` }} animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: `${direction * -.6}em`, transition: { duration: duration.fast, ease: standard } }}
                  transition={reduced ? { duration: duration.instant } : settle}>{index + 1}</motion.span>
              </AnimatePresence>
            </span>
            <span aria-hidden="true">/</span><span aria-hidden="true">{versions}</span>
            <span className={styles.srOnly}>Version {index + 1} of {versions}</span>
          </span>
          <IconButton label="Next version" className={styles.versionStep} disabled={busy || index === versions - 1} onClick={() => go(index + 1)}><ChevronRight aria-hidden="true" /></IconButton>
        </motion.div>}
      </AnimatePresence>
    </div>
    {meta}
  </div>;
}
