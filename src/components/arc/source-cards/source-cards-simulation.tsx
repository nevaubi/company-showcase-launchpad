"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import { sourceCardsAnswer, sourceCardsQuery, sourceCardsQuestion, sourceCardsSamples } from "./source-cards-data";
import type { SourceCardsAnswerToken, SourceCardsSource, SourceCardsStatus } from "./source-cards-data";
import { sourceHost } from "./source-cards-marks";
import { SourceCardsView, SourceCitation, useAutoHeight } from "./source-cards-view";
import styles from "./source-cards-simulation.module.css";

export type SourceCardsScenario = "live" | "error" | "empty";

const ease = [...motionTokens.ease.enter] as [number, number, number, number];
const SIMULATED = "Sample sources. Simulated search, nothing was fetched.";
const EMPTY_QUESTION = "Where is the changelog for our internal billing-sync service?";
const EMPTY_QUERY = "billing-sync service changelog";

/** Splits the answer into units the stream reveals: words keep their trailing space, code and citations stay whole. */
function toUnits(tokens: SourceCardsAnswerToken[]): SourceCardsAnswerToken[] {
  return tokens.flatMap<SourceCardsAnswerToken>(token => typeof token === "string" ? [...(token.match(/\S+\s*|\s+/g) ?? [])] : [token]);
}

function AnswerStream({ units, chunks }: { units: SourceCardsAnswerToken[]; chunks: number[] }) {
  return <p className={styles.answer}>
    {chunks.map((end, index) => {
      const start = index === 0 ? 0 : chunks[index - 1];
      return <span key={index} className={styles.chunk}>
        {units.slice(start, end).map((unit, offset) => {
          const key = start + offset;
          if (typeof unit === "string") return <Fragment key={key}>{unit}</Fragment>;
          if ("code" in unit) return <code key={key} className={styles.code}>{unit.code}</code>;
          return <SourceCitation key={key} n={unit.cite} />;
        })}
      </span>;
    })}
  </p>;
}

/**
 * The self-playing demo `<SourceCards />` renders with no props: a question, a search that streams cards in,
 * a cited answer and a short tour of the citations. It loops until someone interacts, and pauses off screen.
 */
export function SourceCardsSimulation({ scenario = "live", className }: { scenario?: SourceCardsScenario; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const units = useMemo(() => toUnits(sourceCardsAnswer), []);
  const [mode, setMode] = useState<SourceCardsScenario>(scenario);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(false);
  const [found, setFound] = useState(0);
  const [status, setStatus] = useState<SourceCardsStatus>("searching");
  const [chunks, setChunks] = useState<number[] | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(SIMULATED);
  const [elapsed, setElapsed] = useState<number | undefined>();
  const [dim, setDim] = useState(false);
  const interacted = useRef(false);
  const clearHighlight = useRef<number | undefined>(undefined);
  const { outerRef: questionOuterRef, innerRef: questionInnerRef } = useAutoHeight(reduced);

  // A new scenario from the outside restarts the demo (state derived during render, not in an effect).
  const [shownScenario, setShownScenario] = useState(scenario);
  if (scenario !== shownScenario) { setShownScenario(scenario); setMode(scenario); setRun(value => value + 1); }

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "80px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>(resolve => { timers.push(window.setTimeout(resolve, reduced ? Math.min(ms, 400) : ms)); });
    const reset = () => { setFound(0); setStatus("searching"); setChunks(null); setHighlighted(null); setExpanded(false); setElapsed(undefined); setNote(SIMULATED); };

    interacted.current = false;
    (async () => {
      let replay = false;
      do {
        reset();
        // A replay resets while the body is faded out and waits for the height to settle, so the loop restarts without
        // the panel visibly shrinking under content that is already fading back in.
        if (replay) { await wait(380); if (cancelled) return; }
        setDim(false);
        replay = true;
        const started = performance.now();
        await wait(420);
        if (cancelled) return;
        if (mode === "empty") {
          await wait(1500);
          if (cancelled) return;
          setStatus("done");
          return;
        }
        const arrive = mode === "error" ? 2 : sourceCardsSamples.length;
        for (let index = 1; index <= arrive; index++) {
          setFound(index);
          await wait(index <= 3 ? 300 : 220);
          if (cancelled) return;
        }
        if (mode === "error") { await wait(520); if (cancelled) return; setStatus("error"); return; }
        setElapsed(performance.now() - started);
        setStatus("done");
        await wait(320);
        if (cancelled) return;
        // Fast chunked streaming: 3 to 7 words every 34ms, each chunk only fades in.
        const bounds: number[] = [];
        for (let end = 0; end < units.length && !cancelled;) {
          end = Math.min(units.length, end + 3 + Math.floor(Math.random() * 5));
          bounds.push(end);
          setChunks([...bounds]);
          await wait(34);
        }
        if (cancelled) return;
        await wait(1100);
        if (cancelled || interacted.current) return;
        setHighlighted(2);
        await wait(1500);
        if (cancelled || interacted.current) return;
        setHighlighted(6);
        setExpanded(true);
        await wait(1800);
        if (cancelled || interacted.current) return;
        setHighlighted(null);
        await wait(240);
        setExpanded(false);
        await wait(3600);
        if (cancelled || interacted.current) return;
        setDim(true);
        await wait(200);
      } while (!cancelled && !interacted.current);
    })();
    return () => { cancelled = true; timers.forEach(window.clearTimeout); };
  }, [visible, run, mode, units, reduced]);

  useEffect(() => () => window.clearTimeout(clearHighlight.current), []);

  const sources: SourceCardsSource[] = sourceCardsSamples.slice(0, found);
  const question = mode === "empty" ? EMPTY_QUESTION : sourceCardsQuestion;
  const retry = () => { interacted.current = false; setMode("live"); setRun(value => value + 1); };

  return <div ref={rootRef} className={[styles.panel, className].filter(Boolean).join(" ")}
    onPointerDown={() => { interacted.current = true; }} onKeyDown={() => { interacted.current = true; }}>
    <div ref={questionOuterRef} className={styles.questionBox}>
      <div ref={questionInnerRef} className={styles.question}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p key={question} className={styles.questionText} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }} transition={{ duration: .16, ease }}>{question}</motion.p>
        </AnimatePresence>
      </div>
    </div>
    <motion.div className={styles.body} initial={false} animate={{ opacity: dim ? 0 : 1 }} transition={{ duration: dim ? .18 : .2, ease }}>
    <SourceCardsView
      sources={sources}
      status={status}
      total={mode === "live" ? sourceCardsSamples.length : mode === "error" ? 7 : undefined}
      query={mode === "empty" ? EMPTY_QUERY : sourceCardsQuery}
      duration={elapsed}
      error="The search provider timed out after 8s."
      expanded={expanded}
      onExpandedChange={setExpanded}
      highlighted={highlighted}
      onHighlightChange={n => {
        setHighlighted(n);
        window.clearTimeout(clearHighlight.current);
        if (n !== null) clearHighlight.current = window.setTimeout(() => setHighlighted(null), 2600);
      }}
      onSourceClick={(source, n) => {
        setHighlighted(n);
        window.clearTimeout(clearHighlight.current);
        clearHighlight.current = window.setTimeout(() => setHighlighted(null), 2600);
        setNote(`Would open ${sourceHost(source.url)}. Simulated, nothing was opened.`);
      }}
      onRetry={retry}
    >
      {chunks ? <AnswerStream units={units} chunks={chunks} /> : null}
    </SourceCardsView>
    </motion.div>
    <p className={styles.note} aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={note} className={styles.noteText} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .1 } }} transition={{ duration: .16, ease }}>{note}</motion.span>
      </AnimatePresence>
    </p>
  </div>;
}
