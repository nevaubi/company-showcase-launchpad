"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";
import { ChevronUp, CircleAlert, RotateCcw, Sparkles, Square } from "lucide-react";
import { Button } from "../../button/button";
import { TextShimmer } from "../../text-shimmer/text-shimmer";
import { motionTokens } from "../../lib/motion-tokens";
import { InsightChart } from "./ai-insight-card-chart";
import { formatCompactUsd, sampleFollowUps, sampleInsight, sampleMetric } from "./ai-insight-card-data";
import type { Insight, InsightFollowUp, InsightMetric } from "./ai-insight-card-data";
import { ClaudeMark, StripeMark } from "./ai-insight-card-marks";
import styles from "./ai-insight-card.module.css";

export type { Insight, InsightDriver, InsightFollowUp, InsightMetric, InsightSegment } from "./ai-insight-card-data";
export { formatCompactUsd, sampleFollowUps, sampleInsight, sampleMetric } from "./ai-insight-card-data";

export type AiInsightStatus = "idle" | "thinking" | "streaming" | "done" | "stopped" | "error";

export interface AiInsightExplainRequest {
  metric: InsightMetric;
  /** The follow-up that was picked, or undefined for the first explanation. */
  followUp?: InsightFollowUp;
  /** Aborts when the reader presses Stop, hides the panel, or asks something else. */
  signal: AbortSignal;
}

export interface AiInsightCardMeta {
  label: string;
  icon?: ReactNode;
}

export interface AiInsightCardProps {
  /** The KPI: totals, the two series and point labels. Defaults to a sample week of net revenue. */
  metric?: InsightMetric;
  /** The local answer for Explain, used when no `explain` function is passed. */
  insight?: Insight;
  /** Follow-up chips under the answer. Each carries its own local answer unless `explain` is passed. */
  followUps?: InsightFollowUp[];
  /** Fetch a real answer. Resolve with the full insight; the card streams it in and lights up each driver as it is read. */
  explain?: (request: AiInsightExplainRequest) => Promise<Insight>;
  /** Called when the reader presses Explain or picks a follow-up. */
  onExplain?: (followUp?: InsightFollowUp) => void;
  /** Plays Explain and each follow-up on a loop until the reader interacts. Defaults to true when no `explain` is passed. */
  autoPlay?: boolean;
  /** Status line shown while the answer is prepared. */
  thinkingLabel?: string;
  /** Data source in the footer. Pass null to hide it. */
  source?: AiInsightCardMeta | null;
  /** Model in the footer. Pass null to hide it. */
  model?: AiInsightCardMeta | null;
  className?: string;
}

const MAIN = "main";
const NONE: ReadonlySet<string> = new Set();
const THINK_MS = 820;
const TICK_MS = 34;
/** Words per tick: varied a little so the stream reads like a model, never like a metronome. */
const CHUNK_SIZES = [4, 6, 3, 5, 7, 4, 5];
const HOLD_IDLE_MS = 1400;
const HOLD_DONE_MS = 3600;

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

const defaultSource: AiInsightCardMeta = { label: "Stripe billing, 1,284 invoices", icon: <StripeMark width={14} height={14} aria-hidden="true" /> };
const defaultModel: AiInsightCardMeta = { label: "Claude Sonnet 5.5", icon: <ClaudeMark width={14} height={14} aria-hidden="true" /> };

type Token = { text: string; segment: number; chunk: number };

function tokenize(insight: Insight) {
  const tokens: Token[] = [];
  let chunk = 0, inChunk = 0;
  insight.segments.forEach((segment, index) => {
    for (const word of segment.text.match(/\S+\s*|\s+/g) ?? []) {
      tokens.push({ text: word, segment: index, chunk });
      if (/\S/.test(word) && ++inChunk >= CHUNK_SIZES[chunk % CHUNK_SIZES.length]) { chunk++; inChunk = 0; }
    }
  });
  const total = tokens.length ? tokens[tokens.length - 1].chunk + 1 : 0;
  return { tokens, total };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

/** Springs a box to the height of its content when the answer changes, and cuts straight there when the card is resized. */
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
      controls = animate(box, { height: [from, nextHeight] }, { type: "spring", visualDuration: .24, bounce: 0, onComplete: release });
    });
    observer.observe(content);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [reduced]);
  return { outer, inner };
}

/**
 * A KPI card that explains itself. The metric and a two line sparkline sit on top; Explain streams a short reason,
 * ranks the three drivers with contribution bars, and lights up a numbered chart annotation as each one is read.
 * Follow-up chips ask the next question in place. Without `explain`, every answer is simulated from local samples.
 */
export function AiInsightCard({
  metric = sampleMetric,
  insight = sampleInsight,
  followUps = sampleFollowUps,
  explain,
  onExplain,
  autoPlay,
  thinkingLabel = "Reading invoices and renewals",
  source = defaultSource,
  model = defaultModel,
  className,
}: AiInsightCardProps) {
  const reduced = useReducedMotion() ?? false;
  const root = useRef<HTMLElement>(null);
  const inView = useInView(root, { amount: .4 });
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiInsightStatus>("idle");
  const [current, setCurrent] = useState(MAIN);
  const [answer, setAnswer] = useState<Insight>(insight);
  const [chunks, setChunks] = useState(0);
  const [hovered, setHovered] = useState<string>();
  const [errorText, setErrorText] = useState("");
  const [interacted, setInteracted] = useState(false);
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const { outer, inner } = useAutoHeight(reduced);
  const panelId = useId();

  const format = metric.format ?? formatCompactUsd;
  const plays = (autoPlay ?? !explain) && !interacted && !reduced;
  const { tokens, total } = useMemo(() => tokenize(answer), [answer]);
  const visible = status === "done" ? Infinity : chunks;

  // Which drivers the stream has reached, and the one being read right now.
  const { mentioned, reading } = useMemo(() => {
    const set = new Set<string>();
    let last: string | undefined;
    for (const token of tokens) {
      if (token.chunk >= visible) break;
      const id = answer.segments[token.segment].driver;
      if (id) { set.add(id); last = id; }
    }
    return { mentioned: set, reading: last };
  }, [tokens, visible, answer]);
  const activeId = hovered ?? (status === "streaming" ? reading : undefined);

  const run = useCallback(async (key: string) => {
    const id = ++runId.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const followUp = key === MAIN ? undefined : followUps.find((item) => item.id === key);
    const local = followUp?.insight ?? insight;
    setOpen(true);
    setCurrent(key);
    setStatus("thinking");
    setChunks(0);
    setHovered(undefined);
    setErrorText("");
    if (!explain) setAnswer(local);
    onExplain?.(followUp);
    try {
      const started = performance.now();
      const result = explain ? await explain({ metric, followUp, signal: controller.signal }) : local;
      await sleep(Math.max(0, THINK_MS - (performance.now() - started)), controller.signal);
      if (id !== runId.current) return;
      setAnswer(result);
      setStatus(reduced ? "done" : "streaming");
    } catch (error) {
      if (controller.signal.aborted || id !== runId.current) return;
      setErrorText(error instanceof Error && error.message ? error.message : "The request failed.");
      setStatus("error");
    }
  }, [explain, followUps, insight, metric, onExplain, reduced]);

  const stop = useCallback(() => {
    runId.current++;
    abort.current?.abort();
    setStatus("stopped");
  }, []);

  const hide = useCallback(() => {
    runId.current++;
    abort.current?.abort();
    setOpen(false);
    setHovered(undefined);
  }, []);

  // Fast chunked streaming: one chunk of words per tick, each chunk only fades in.
  useEffect(() => {
    if (status !== "streaming") return;
    const timer = setTimeout(() => {
      if (chunks + 1 >= total) setStatus("done");
      setChunks(chunks + 1);
    }, chunks >= total ? 0 : TICK_MS);
    return () => clearTimeout(timer);
  }, [status, chunks, total]);

  // The demo loop: Explain, each follow-up, then fold away. It waits while off screen and ends for good on first interaction.
  useEffect(() => {
    if (!plays || !inView) return;
    let next: (() => void) | undefined, wait = HOLD_DONE_MS;
    if (!open && (status === "idle" || status === "done" || status === "stopped")) { next = () => run(MAIN); wait = HOLD_IDLE_MS; }
    else if (open && status === "done") {
      const order = [MAIN, ...followUps.map((item) => item.id)];
      const after = order[order.indexOf(current) + 1];
      next = after ? () => run(after) : hide;
    }
    if (!next) return;
    const timer = setTimeout(next, wait);
    return () => clearTimeout(timer);
  }, [plays, inView, open, status, current, followUps, run, hide]);

  useEffect(() => () => abort.current?.abort(), []);

  const busy = open && (status === "thinking" || status === "streaming");
  const change = metric.value - metric.previous;
  const pct = metric.previous ? (change / metric.previous) * 100 : 0;
  const tone = (delta: number) => delta === 0 ? "neutral" : (delta < 0) !== Boolean(metric.lowerIsBetter) ? "bad" : "good";
  const maxAbs = Math.max(1, ...answer.drivers.map((driver) => Math.abs(driver.delta)));
  const fullText = answer.segments.map((segment) => segment.text).join("");
  const announcement = !open ? "" : status === "thinking" ? `Explaining ${metric.label.toLowerCase()}.${explain ? "" : " Simulated from sample data, nothing was queried."}`
    : status === "done" ? `Explanation ready. ${fullText}` : status === "stopped" ? "Stopped." : status === "error" ? `Could not explain this change. ${errorText}` : "";

  const headAction = busy ? { label: "Stop", icon: <Square className={styles.stopIcon} />, onClick: stop }
    : open ? { label: "Hide", icon: <ChevronUp />, onClick: hide }
    : { label: "Explain", icon: <Sparkles className={styles.sparkle} />, onClick: () => run(MAIN) };

  // Text, grouped by segment so mentions carry their highlight, and by chunk so each chunk fades in once.
  const streamed = answer.segments.map((segment, index) => {
    const parts: { chunk: number; text: string }[] = [];
    for (const token of tokens) {
      if (token.segment !== index || token.chunk >= visible) continue;
      const last = parts[parts.length - 1];
      if (last && last.chunk === token.chunk) last.text += token.text;
      else parts.push({ chunk: token.chunk, text: token.text });
    }
    if (!parts.length) return null;
    const body = parts.map((part) => <span key={part.chunk} className={styles.chunk}>{part.text}</span>);
    if (!segment.driver) return <span key={index}>{body}</span>;
    const id = segment.driver;
    return <span key={index} className={styles.mention} data-active={activeId === id || undefined}
      onPointerEnter={() => setHovered(id)} onPointerLeave={() => setHovered(undefined)}>{body}</span>;
  });

  return <section ref={root} className={cx(styles.root, className)} aria-label={`${metric.label}, ${metric.period}`}
    onPointerDownCapture={() => setInteracted(true)} onKeyDownCapture={() => setInteracted(true)}>
    <div className={styles.head}>
      <div className={styles.titleRow}>
        <h3 className={styles.title}>{metric.label}</h3>
        <span className={styles.period}>{metric.period}</span>
      </div>
      <Button size="sm" variant="secondary" className={styles.explain} onClick={headAction.onClick} disabled={metric.series.length < 2 && !open}
        aria-expanded={open} aria-controls={open ? panelId : undefined}>
        {headAction.icon}{headAction.label}
      </Button>
    </div>

    <div className={styles.valueRow}>
      <span className={styles.value}>{format(metric.value)}</span>
      <span className={styles.delta} data-tone={tone(change)}>{pct < 0 ? "−" : pct > 0 ? "+" : ""}{Math.abs(pct).toFixed(1)}%</span>
      <span className={styles.compare}>{metric.comparisonLabel}</span>
      {metric.previousSeries?.length ? <span className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}><i className={styles.swatchCurrent} />{metric.seriesLabel ?? "Current"}</span>
        <span className={styles.legendItem}><i className={styles.swatchPrevious} />{metric.previousSeriesLabel ?? "Previous"}</span>
      </span> : null}
    </div>

    <InsightChart metric={metric} format={format} drivers={answer.drivers} mentioned={open ? mentioned : NONE} activeId={activeId} onHoverDriver={setHovered} />
    {metric.series.length >= 2 ? <div className={styles.axis} aria-hidden="true">
      <span>{metric.points[0]}</span><span>{metric.points[metric.points.length - 1]}</span>
    </div> : null}

    <AnimatePresence initial={false}>
      {open ? <motion.div key="panel" id={panelId} className={styles.panelClip}
        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
        transition={reduced ? { duration: 0 } : { height: { type: "spring", visualDuration: .26, bounce: 0 }, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }}>
        <div ref={outer}>
          <div ref={inner} className={styles.panel}>
            <div className={styles.textBox}>
              <p className={styles.ghost} aria-hidden="true">{fullText}</p>
              <div className={styles.textLayer}>
                <AnimatePresence initial={false} mode="popLayout">
                  {status === "thinking" ? <motion.div key="thinking" className={styles.thinking}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }} transition={{ duration: .16 }}>
                    <Sparkles className={styles.sparkle} aria-hidden="true" />
                    <TextShimmer>{thinkingLabel}</TextShimmer>
                  </motion.div>
                  : status === "error" ? <motion.div key="error" className={styles.error} role="alert"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }} transition={{ duration: .16 }}>
                    <CircleAlert className={styles.errorIcon} aria-hidden="true" />
                    <span className={styles.errorText}>Could not explain this change. {errorText}</span>
                    <Button size="sm" variant="ghost" className={styles.retry} onClick={() => run(current)}><RotateCcw />Retry</Button>
                  </motion.div>
                  : <motion.p key={`answer-${current}`} className={styles.text}
                    initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }}>
                    {streamed}
                    {status === "stopped" ? <span className={styles.stopped}>{chunks === 0 ? "Stopped before the answer started." : " Stopped."}</span> : null}
                  </motion.p>}
                </AnimatePresence>
              </div>
            </div>

            <ol className={styles.drivers} aria-label="Top drivers">
              {answer.drivers.slice(0, 3).map((driver, rank) => {
                const shown = mentioned.has(driver.id);
                const share = Math.abs(driver.delta) / maxAbs;
                return <li key={`${current}-${driver.id}`} className={styles.driver} aria-hidden={!shown || undefined} data-shown={shown || undefined} data-active={activeId === driver.id || undefined}
                  onPointerEnter={shown ? () => setHovered(driver.id) : undefined} onPointerLeave={() => setHovered(undefined)}>
                  <span className={styles.rank} aria-hidden="true">{rank + 1}</span>
                  <span className={styles.driverBody}>
                    <span className={styles.skeleton} aria-hidden="true"><i style={{ width: `${[62, 48, 54][rank]}%` }} /></span>
                    <span className={styles.driverLabel}>{driver.label}</span>
                  </span>
                  <span className={styles.bar} aria-hidden="true">
                    <i data-tone={tone(driver.delta)} style={{ width: `${shown ? share * 100 : 0}%` }} />
                  </span>
                  <span className={styles.driverDelta} data-tone={tone(driver.delta)}>
                    {driver.delta > 0 ? "+" : ""}{format(driver.delta)}
                  </span>
                </li>;
              })}
            </ol>

            {followUps.length ? <div className={styles.chips} role="group" aria-label="Follow-up questions">
              {followUps.map((item) => <button key={item.id} type="button" className={styles.chip} aria-pressed={current === item.id}
                disabled={busy} onClick={() => { if (current !== item.id || status !== "done") run(item.id); }}>{item.label}</button>)}
            </div> : null}

            {source || model ? <div className={styles.footer}>
              {source ? <span className={styles.meta}>{source.icon}<span className={styles.metaText}>{source.label}</span></span> : <span />}
              {model ? <span className={styles.meta}>{model.icon}<span className={styles.metaText}>{model.label}</span></span> : null}
            </div> : null}
          </div>
        </div>
      </motion.div> : null}
    </AnimatePresence>
    <span className={styles.srOnly} aria-live="polite">{announcement}</span>
  </section>;
}

export default AiInsightCard;
