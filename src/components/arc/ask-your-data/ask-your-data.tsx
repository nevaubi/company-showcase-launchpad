"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls, Transition } from "motion/react";
import { ArrowUp, ChevronDown, CircleAlert, CircleSlash, CornerDownRight, Database, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "../button/button";
import { CopyButton } from "../copy-button/copy-button";
import SegmentedControl from "../segmented-control/segmented-control";
import { TextShimmer } from "../text-shimmer/text-shimmer";
import { askYourDataSamples, askYourDataSuggestions, signupsSample } from "./ask-your-data-data";
import { DataTable, Plot, defaultFormat, isStacked, seriesColor, seriesTotal } from "./ask-your-data-chart";
import { PostgresMark } from "./ask-your-data-marks";
import { SqlCode, sqlChunkEnds, tokenizeSql } from "./ask-your-data-sql";
import type { AskYourDataChart, AskYourDataGenerateContext, AskYourDataResult, AskYourDataRunContext, AskYourDataSource, AskYourDataSqlResponse, AskYourDataStatus } from "./ask-your-data-types";
import styles from "./ask-your-data.module.css";

export type { AskYourDataChart, AskYourDataGenerateContext, AskYourDataResult, AskYourDataRunContext, AskYourDataSeries, AskYourDataSource, AskYourDataSqlResponse, AskYourDataStatus } from "./ask-your-data-types";
export { askYourDataSamples, askYourDataSuggestions } from "./ask-your-data-data";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const TICK = 34;
const WORDS_PER_TICK = 4;

const DEFAULT_SOURCE: AskYourDataSource = { name: "analytics", dialect: "PostgreSQL" };
const CHART_OPTIONS = [{ value: "bar", label: "Bar" }, { value: "line", label: "Line" }, { value: "table", label: "Table" }];

type Failure = { stage: "sql" | "query" | "stopped"; title: string; message: string; detail?: string };

class UnmatchedQuestion extends Error {}

/** Resolves after ms, or rejects at once when the signal aborts. */
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

const sampleFor = (question: string) => askYourDataSamples.find(sample => sample.match.test(question));

/* The simulated model: a short think, then the canned SQL for the closest sample, or a clear miss. */
async function simulateSql(question: string, source: AskYourDataSource, signal: AbortSignal) {
  await wait(560, signal);
  const sample = sampleFor(question);
  if (!sample) throw new UnmatchedQuestion(`No table in ${source.name} matches "${question}". This preview knows signups, revenue and churn.`);
  return sample.sql;
}

/* The simulated database: rows scanned roll up on an ease-out curve, then the result lands. */
async function simulateRun(question: string, signal: AbortSignal, onProgress: (rows: number, total?: number) => void, reduced: boolean) {
  const sample = sampleFor(question) ?? signupsSample;
  if (reduced) { onProgress(sample.rowsScanned, sample.rowsScanned); await wait(700, signal); return sample.result; }
  onProgress(0, sample.rowsScanned);
  const controls = animate(0, sample.rowsScanned, { duration: .82, ease: [0.22, 1, 0.36, 1], onUpdate: value => onProgress(Math.round(value), sample.rowsScanned) });
  signal.addEventListener("abort", () => controls.stop(), { once: true });
  await wait(1040, signal);
  return sample.result;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const plural = (count: number, word: string) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
const formatMs = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

/** Springs a box to its content's height when the content grows (a live SQL stream), and cuts straight to it on width changes. */
function useAutoHeight(reduced: boolean, mounted: boolean) {
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
  }, [reduced, mounted]);
  return { outer, inner };
}

/** Text that crossfades on change: the old line leaves in 100ms, the new one arrives in 160ms with a 2px settle. */
function Swap({ value, children, className, reduced }: { value: string; children: ReactNode; className?: string; reduced: boolean }) {
  return <span className={cx(styles.swap, className)}>
    <AnimatePresence initial={false}>
      <motion.span key={value} className={styles.swapItem}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0 : .16, ease: [0.22, 1, 0.36, 1] } }}
        exit={{ opacity: 0, transition: { duration: reduced ? 0 : .1, ease: "easeOut" } }}>{children}</motion.span>
    </AnimatePresence>
  </span>;
}

function Spinner() {
  return <svg className={styles.spinner} width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.75" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>;
}

function DrawnCheck({ reduced }: { reduced: boolean }) {
  return <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <motion.path d="M3.25 8.5 6.5 11.75 12.75 4.75" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .28, ease: [0.22, 1, 0.36, 1] }} />
  </svg>;
}

/** One status glyph that trades places with a quick fade and scale, so the slot never changes size. */
function StatusGlyph({ kind, reduced }: { kind: "spinner" | "check" | "alert" | "stopped" | null; reduced: boolean }) {
  return <span className={styles.glyph} aria-hidden="true">
    <AnimatePresence initial={false}>
      {kind ? <motion.span key={kind} className={styles.glyphItem} data-kind={kind}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .6 }}
        transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: .2, bounce: 0, opacity: { duration: .12 } }}>
        {kind === "spinner" ? <Spinner /> : kind === "check" ? <DrawnCheck reduced={reduced} /> : kind === "alert" ? <CircleAlert size={16} strokeWidth={1.75} /> : <CircleSlash size={16} strokeWidth={1.75} />}
      </motion.span> : null}
    </AnimatePresence>
  </span>;
}

/** The insight streams in four words a tick; the unrevealed words hold their space so the line never reflows. */
function Insight({ text, shown }: { text: string; shown: number }) {
  const words = useMemo(() => text.split(/(\s+)/).filter(Boolean), [text]);
  let count = 0, cut = words.length;
  for (let index = 0; index < words.length; index++) { if (!/^\s+$/.test(words[index])) count++; if (count > shown) { cut = index; break; } }
  const chunks: string[][] = [];
  words.slice(0, cut).forEach((word, index) => { const chunk = Math.floor(index / (WORDS_PER_TICK * 2)); (chunks[chunk] ??= []).push(word); });
  return <p className={styles.insight}>
    <Sparkles size={14} strokeWidth={1.75} className={styles.insightIcon} aria-hidden="true" />
    <span className={styles.insightText}>
      {chunks.map((chunk, index) => <span key={index} className={styles.tk}>{chunk.join("")}</span>)}
      {cut < words.length ? <span className={styles.ghost} aria-hidden="true">{words.slice(cut).join("")}</span> : null}
    </span>
  </p>;
}

export interface AskYourDataProps {
  /** Controlled question text. Pair with onQuestionChange. */
  question?: string;
  /** Starting question when uncontrolled. Defaults to "Weekly signups by plan since August". */
  defaultQuestion?: string;
  onQuestionChange?: (question: string) => void;
  placeholder?: string;
  /** The database the question runs against: its name, dialect and mark. Defaults to analytics on PostgreSQL. */
  source?: AskYourDataSource;
  /** Questions offered in the empty and error states. Defaults to the three samples. Pass [] to hide them. */
  suggestions?: string[];
  /** Writes SQL for a question. Return the whole string (it streams in on screen) or an async iterable of chunks. Without it, a sample model answers. */
  generateSql?: (question: string, context: AskYourDataGenerateContext) => Promise<AskYourDataSqlResponse> | AskYourDataSqlResponse;
  /** Runs the SQL and returns a chart ready result. Call onProgress with rows scanned. Without it, sample data answers. */
  runQuery?: (sql: string, context: AskYourDataRunContext) => Promise<AskYourDataResult>;
  /** Called once a result is charted. */
  onResult?: (result: AskYourDataResult, details: { question: string; sql: string }) => void;
  /** Called when writing or running fails. Not called when the person stops a run. */
  onError?: (error: unknown, details: { question: string; stage: "sql" | "query" }) => void;
  /** Controlled chart view. Pair with onChartChange. */
  chart?: AskYourDataChart;
  /** View for results that do not name one. Defaults to "bar". */
  defaultChart?: AskYourDataChart;
  onChartChange?: (chart: AskYourDataChart) => void;
  /** Asks the starting question once the card scrolls into view. Defaults to true when no generateSql is passed. */
  autoRun?: boolean;
  /** Keep the SQL open after the query runs instead of folding it away. Defaults to false. */
  keepSqlOpen?: boolean;
  className?: string;
}

/**
 * Ask a question in plain words and get a chart: the model writes PostgreSQL that streams into a collapsible panel,
 * the query runs with a rolling row count, and the result builds as stacked bars, lines or a table with a one line read.
 */
export function AskYourData({
  question: questionProp, defaultQuestion = signupsSample.question, onQuestionChange, placeholder = "Ask a question about your data",
  source = DEFAULT_SOURCE, suggestions = askYourDataSuggestions, generateSql, runQuery, onResult, onError,
  chart: chartProp, defaultChart = "bar", onChartChange, autoRun, keepSqlOpen = false, className,
}: AskYourDataProps) {
  const reduced = useReducedMotion() ?? false;
  const id = useId();
  const [questionState, setQuestionState] = useState(defaultQuestion);
  const question = questionProp ?? questionState;
  const [phase, setPhase] = useState<AskYourDataStatus>("idle");
  const [sql, setSql] = useState("");
  const [revealed, setRevealed] = useState(0);
  const [live, setLive] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [result, setResult] = useState<AskYourDataResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [chartState, setChartState] = useState<AskYourDataChart>(defaultChart);
  const chart = chartProp ?? chartState;
  const [sqlOpen, setSqlOpen] = useState(false);
  const [insightShown, setInsightShown] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [visible, setVisible] = useState(true);
  const sqlTouched = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const lastQuestion = useRef("");
  const root = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);
  const revealedRef = useRef(0);
  const askRef = useRef<(question: string) => Promise<void>>(async () => {});
  const [scanTarget, setScanTarget] = useState<number | null>(null);

  const simulated = !generateSql || !runQuery;
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
  const busy = phase === "writing" || phase === "running";
  const lines = sql ? sql.split("\n").length : 0;
  const sqlHeight = useAutoHeight(reduced, sqlOpen && !!sql);
  const reveal = (count: number) => { revealedRef.current = count; setRevealed(count); };

  const setQuestion = (next: string) => { if (questionProp === undefined) setQuestionState(next); onQuestionChange?.(next); };
  const setChart = (next: AskYourDataChart) => { if (chartProp === undefined) setChartState(next); onChartChange?.(next); };

  useEffect(() => () => controller.current?.abort(), []);

  const ask = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++runId.current;
    const { signal } = abort;
    const current = () => runId.current === run && !signal.aborted;
    lastQuestion.current = q;
    let stage: "sql" | "query" = "sql";
    let text = "";

    setPhase("writing"); setSql(""); reveal(0); setLive(false); setScanned(0); setScanTarget(null); setResult(null); setFailure(null); setInsightShown(0);
    if (!sqlTouched.current) setSqlOpen(true);
    setAnnouncement(`Writing SQL for: ${q}`);

    try {
      const response = generateSql ? await generateSql(q, { signal, source }) : await simulateSql(q, source, signal);
      if (!current()) return;
      if (typeof response === "string") {
        text = response;
        const ends = sqlChunkEnds(tokenizeSql(text), WORDS_PER_TICK);
        setSql(text);
        if (reduced) reveal(ends[ends.length - 1]);
        else for (const end of ends) { if (!current()) return; reveal(end); await wait(TICK, signal); }
      } else {
        setLive(true);
        for await (const chunk of response) {
          if (!current()) return;
          text += chunk;
          setSql(text);
          reveal(Number.MAX_SAFE_INTEGER);
        }
      }
      if (!current()) return;
      setLive(false); reveal(Number.MAX_SAFE_INTEGER);
      await wait(reduced ? 0 : 140, signal);

      stage = "query";
      setPhase("running");
      if (!sqlTouched.current && !keepSqlOpen) setSqlOpen(false);
      setAnnouncement("SQL ready. Running query.");
      const onProgress = (rows: number, total?: number) => { if (!current()) return; setScanned(rows); if (total !== undefined) setScanTarget(total); };
      const data = runQuery ? await runQuery(text, { signal, onProgress, question: q }) : await simulateRun(q, signal, onProgress, reduced);
      if (!current()) return;
      setResult(data);
      setPhase("done");
      if (chartProp === undefined) setChartState(data.chart ?? defaultChart);
      onResult?.(data, { question: q, sql: text });
      const meta = [data.rowCount !== undefined ? plural(data.rowCount, "row") : "", data.durationMs !== undefined ? formatMs(data.durationMs) : ""].filter(Boolean).join(", ");
      setAnnouncement(`${data.title}${meta ? `, ${meta}` : ""}. ${data.insight ?? ""}${simulated ? " Simulated with sample data, nothing was queried." : ""}`.trim());
    } catch (error) {
      if (runId.current !== run) return;
      if (signal.aborted || isAbort(error)) {
        setFailure({ stage: "stopped", title: "Stopped", message: stage === "sql" ? "The SQL was not finished, so nothing ran." : "The query was cancelled before it returned." });
        // Keep only the SQL that was written before the stop, so the panel and Copy never show text that did not arrive.
        if (stage === "sql" && text && revealedRef.current < Number.MAX_SAFE_INTEGER) setSql(tokenizeSql(text).slice(0, revealedRef.current).map(token => token.text).join("").trimEnd());
        reveal(Number.MAX_SAFE_INTEGER);
        setLive(false);
        setPhase("error");
        setAnnouncement("Stopped.");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setFailure(stage === "sql"
        ? { stage, title: error instanceof UnmatchedQuestion ? "No matching data" : "Could not write a query", message }
        : { stage, title: "The query failed", message: "The database returned an error. Edit the question or try again.", detail: message });
      setPhase("error");
      setAnnouncement(`${stage === "sql" ? "Could not write a query" : "The query failed"}. ${message}`);
      onError?.(error, { question: q, stage });
    }
  }, [generateSql, runQuery, source, reduced, keepSqlOpen, chartProp, defaultChart, onResult, onError, simulated]);

  askRef.current = ask;
  const stop = () => controller.current?.abort();
  const submit = (event: FormEvent) => { event.preventDefault(); if (busy) stop(); else void ask(question); };
  const pick = (suggestion: string) => { setQuestion(suggestion); void ask(suggestion); };

  // Ask the starting question once the card is on screen, and pause loops while it is off screen.
  const shouldAutoRun = autoRun ?? !generateSql;
  const startQuestion = useRef(question);
  startQuestion.current = question;
  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting && shouldAutoRun && !autoRan.current) {
        autoRan.current = true;
        timer = window.setTimeout(() => { if (runId.current === 0) void askRef.current(startQuestion.current); }, 420);
      }
    }, { threshold: .35 });
    observer.observe(node);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [shouldAutoRun]);

  // The insight streams once the chart has built.
  const insight = phase === "done" ? result?.insight : undefined;
  const insightWords = insight ? insight.split(/\s+/).filter(Boolean).length : 0;
  useEffect(() => {
    if (!insightWords) return;
    if (reduced) { setInsightShown(insightWords); return; }
    let shown = 0;
    let timer = window.setTimeout(function tick() {
      shown = Math.min(insightWords, shown + WORDS_PER_TICK);
      setInsightShown(shown);
      if (shown < insightWords) timer = window.setTimeout(tick, TICK);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [insightWords, reduced, result]);

  const toggleSql = () => { if (!sql) return; sqlTouched.current = true; setSqlOpen(open => !open); };

  const dialect = source.dialect ?? "SQL";
  const sqlTitle = "Generated SQL";
  const sqlMeta = phase === "done" && result
    ? [dialect, result.rowCount !== undefined ? plural(result.rowCount, "row") : `${lines} lines`, result.durationMs !== undefined ? formatMs(result.durationMs) : ""].filter(Boolean).join(" · ")
    : phase === "error" && failure?.stage === "query" ? `${dialect} · failed`
    : sql && phase !== "writing" ? `${dialect} · ${plural(lines, "line")}` : `${dialect} · ${source.name}`;
  // Narrow cards keep one fact: the dialect is in the mark, the duration is in the live announcement.
  const sqlMetaShort = sqlMeta.split(" · ")[1] ?? sqlMeta;
  const sqlGlyph = phase === "writing" ? "spinner" : phase === "error" && failure?.stage === "query" ? "alert" : sql && (phase === "running" || phase === "done") ? "check" : null;
  const settled = !live && revealed >= tokens.length && phase !== "writing";

  const format = result?.formatValue ?? defaultFormat;
  const stageGlyph = phase === "writing" || phase === "running" ? "spinner" : phase === "error" ? (failure?.stage === "stopped" ? "stopped" : "alert") : null;
  const head = phase === "done" && result ? { key: `done-${result.title}`, title: result.title, sub: result.subtitle ?? "" }
    : phase === "writing" ? { key: "writing", title: "Writing SQL", sub: `Reading the ${source.name} schema` }
    : phase === "running" ? { key: "running", title: "Running query", sub: `Read only on ${source.name}` }
    : phase === "error" && failure ? { key: `error-${failure.title}`, title: failure.title, sub: failure.stage === "query" ? `${dialect} returned an error` : failure.stage === "stopped" ? "Nothing else will run" : "Try a different question" }
    : { key: "idle", title: "Ask in plain words", sub: `Answers are charted from a read only query on ${source.name}` };

  const fade: Transition = { duration: reduced ? 0 : .16, ease: [0.22, 1, 0.36, 1] };
  const fadeOut: Transition = { duration: reduced ? 0 : .1, ease: "easeOut" };

  const suggestionList = suggestions.length ? <ul className={styles.suggestions} aria-label="Suggested questions">
    {suggestions.map(suggestion => <li key={suggestion}>
      <button type="button" className={styles.suggestion} onClick={() => pick(suggestion)}>
        <CornerDownRight size={14} strokeWidth={1.75} className={styles.suggestionIcon} aria-hidden="true" />
        <span className={styles.suggestionText}>{suggestion}</span>
      </button>
    </li>)}
  </ul> : null;

  const legendMode = result ? result.legendValue ?? (isStacked(result) ? "sum" : "none") : "none";
  const views = <SegmentedControl options={CHART_OPTIONS} value={chart} onValueChange={value => setChart(value as AskYourDataChart)} label="Chart type" />;

  let body: ReactNode;
  let bodyKey: string = phase;
  if (phase === "done" && result) {
    bodyKey = `done-${result.title}`;
    body = <div className={styles.result}>
      <div className={styles.viewsInline}>{views}</div>
      <ul className={styles.legend} aria-label="Series">
        {result.series.map((series, index) => <li key={series.id} className={styles.legendItem}>
          <span className={styles.dot} style={{ background: seriesColor(result, index) }} aria-hidden="true" />
          <span className={styles.legendLabel}>{series.label}</span>
          {legendMode === "sum" ? <span className={styles.legendValue}>{format(seriesTotal(series.values))}</span>
            : legendMode === "last" && series.values.length ? <span className={styles.legendValue}>{format(series.values[series.values.length - 1])}</span> : null}
        </li>)}
      </ul>
      <div className={styles.chartArea}>
        <AnimatePresence initial={false}>
          <motion.div key={chart} className={styles.chartLayer} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fadeOut }}>
            {chart === "table" ? <DataTable result={result} /> : <Plot result={result} kind={chart} reduced={reduced} />}
          </motion.div>
        </AnimatePresence>
      </div>
      {result.insight ? <Insight text={result.insight} shown={insightShown} /> : <div className={styles.insightSpacer} />}
    </div>;
  } else if (phase === "writing" || phase === "running") {
    bodyKey = "pending";
    body = <div className={styles.skeleton} aria-hidden="true" data-running={phase === "running" || undefined}>
      <div className={styles.skeletonLegend}><span /><span /><span /></div>
      <div className={styles.skeletonPlot}>
        {[38, 52, 46, 61, 44, 66, 72, 64, 78, 70, 84, 80].map((height, index) => <span key={index} style={{ height: `${height}%`, animationDelay: `${index * 60}ms` }} />)}
      </div>
      <span className={styles.skeletonInsight} />
    </div>;
  } else if (phase === "error" && failure) {
    bodyKey = `error-${failure.stage}`;
    body = <div className={styles.message}>
      <p className={styles.messageText}>{failure.message}</p>
      {failure.detail ? <pre className={styles.errorDetail}>{failure.detail}</pre> : null}
      {failure.stage === "sql" && failure.title === "No matching data" ? suggestionList : <div className={styles.messageActions}>
        <Button variant="secondary" size="sm" onClick={() => void ask(lastQuestion.current || question)}>
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />{failure.stage === "stopped" ? "Run again" : "Try again"}
        </Button>
      </div>}
    </div>;
  } else {
    body = <div className={styles.message}>{suggestionList}</div>;
  }

  return <div ref={root} className={cx(styles.root, className)} data-phase={phase} data-offscreen={!visible || undefined}>
    <form className={styles.ask} onSubmit={submit} role="search" aria-label={`Ask ${source.name}`}>
      <label className={styles.field}>
        <span className={styles.source}>
          <Database size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.sourceName}>{source.name}</span>
        </span>
        <input className={styles.input} value={question} onChange={event => setQuestion(event.target.value)} placeholder={placeholder}
          aria-label={`Question for ${source.name}`} enterKeyHint="go" onKeyDown={event => { if (event.key === "Escape" && busy) { event.preventDefault(); stop(); } }} autoComplete="off" spellCheck={false} />
        <button type="submit" className={styles.send} data-busy={busy || undefined} disabled={!busy && !question.trim()} aria-label={busy ? "Stop" : "Ask"}>
          <AnimatePresence initial={false}>
            <motion.span key={busy ? "stop" : "ask"} className={styles.sendIcon}
              initial={{ opacity: 0, scale: reduced ? 1 : .7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .7 }}
              transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: .18, bounce: 0, opacity: { duration: .1 } }}>
              {busy ? <span className={styles.stopIcon} /> : <ArrowUp size={16} strokeWidth={2} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </label>
    </form>

    <section className={styles.sql} data-open={sqlOpen || undefined} data-empty={!sql || undefined} aria-label="Generated SQL">
      <div className={styles.sqlHead}>
        <button type="button" className={styles.sqlToggle} onClick={toggleSql} disabled={!sql} aria-expanded={sqlOpen && !!sql} aria-controls={`${id}-sql`}
          aria-label={`${sqlTitle}, ${sqlMeta}`} />
        <PostgresMark className={styles.pgMark} />
        <span className={styles.sqlTitle}><TextShimmer active={phase === "writing"} className={styles.sqlTitleText}>{sqlTitle}</TextShimmer></span>
        <span className={styles.sqlMeta}><Swap value={sqlMeta} reduced={reduced}><span className={styles.metaFull}>{sqlMeta}</span><span className={styles.metaShort}>{sqlMetaShort}</span></Swap></span>
        <StatusGlyph kind={sqlGlyph} reduced={reduced} />
        <span className={styles.sqlCopy}>
          <CopyButton value={sql} label="Copy SQL" iconOnly variant="plain" disabled={!sql || phase === "writing"} />
        </span>
        <ChevronDown size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden="true" />
      </div>
      <AnimatePresence initial={false}>
        {sqlOpen && sql ? <motion.div key="sql" id={`${id}-sql`} className={styles.sqlClip}
          initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : { height: { type: "spring", visualDuration: .3, bounce: 0 }, opacity: { duration: .14 } }}>
          <div ref={sqlHeight.outer}>
            <div ref={sqlHeight.inner} className={styles.sqlBody}>
              <SqlCode tokens={tokens} revealed={revealed} settled={settled} label={`SQL for: ${lastQuestion.current}`} />
            </div>
          </div>
        </motion.div> : null}
      </AnimatePresence>
    </section>

    <section className={styles.stage} aria-label="Result" aria-busy={busy}>
      <div className={styles.stageHead}>
        <div className={styles.headText}>
          <Swap value={head.key} reduced={reduced}>
            <span className={stageGlyph ? styles.headLine : undefined}>
              {stageGlyph ? <StatusGlyph kind={stageGlyph} reduced={reduced} /> : null}
              <span className={styles.headCopy}>
                <span className={styles.headTitle}>
                  {busy ? <TextShimmer className={styles.headTitleText}>{head.title}</TextShimmer> : <span className={styles.headTitleText}>{head.title}</span>}
                  {phase === "running" ? <span className={styles.headCount}>
                    <span aria-hidden="true">·</span>
                    <span className={styles.count} style={scanTarget !== null ? { minWidth: `${scanTarget.toLocaleString("en-US").length - 0.4}ch` } : undefined}>{scanned.toLocaleString("en-US")}</span>
                    <span>rows</span>
                  </span> : null}
                </span>
                <span className={styles.headSub}>{head.sub}</span>
              </span>
            </span>
          </Swap>
        </div>
        <AnimatePresence initial={false}>
          {phase === "done" && result ? <motion.div key="views" className={styles.views} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fadeOut }}>
            {views}
          </motion.div> : null}
        </AnimatePresence>
      </div>
      <div className={styles.stageBody}>
        <AnimatePresence initial={false}>
          <motion.div key={bodyKey} className={styles.stageLayer} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fadeOut }}>
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>

    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
  </div>;
}

export default AskYourData;
