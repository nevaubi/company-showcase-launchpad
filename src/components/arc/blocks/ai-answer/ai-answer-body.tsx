"use client";

import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HoverCard } from "../../hover-card/hover-card";
import { CopyButton } from "../../copy-button/copy-button";
import type { AnswerSource } from "./ai-answer-data";
import { parseAnswer, type Block, type InlineUnit, type ParsedAnswer } from "./ai-answer-markdown";
import styles from "./ai-answer.module.css";

/**
 * What is lit. From a citation: that citation, the one sentence it supports and its source card (`s` is set). From a source
 * card: every citation of that source and every sentence that cites it.
 */
export type Hot = { n: number; s?: number } | null;

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/* ---------------------------------------------------------------------------------------------------------------
 * Reveal pacing
 * ------------------------------------------------------------------------------------------------------------- */

/** Milliseconds between commits. Each commit is one chunk of a few words that fades in together, like a model's tokens. */
const TICK = 34;
/** Base pace in units (about one word each) per second. A backlog adds to it, so a burst drains fast instead of trailing behind. */
const PACE = 100;

/**
 * Reveals parsed units in chunks on a requestAnimationFrame clock. The pace is steady at about a hundred words a second plus a
 * catch-up term for whatever is waiting, and once the stream ends the rest drains in under half a second. Commits land every
 * 34ms, so each one adds three to eight words. Code lines and table rows cost a little more than a word.
 */
function useReveal(parsed: ParsedAnswer, live: boolean, instant: boolean) {
  const { total, weights } = parsed;
  const [shown, setShown] = useState(() => instant ? total : 0);
  const position = useRef(0);
  const committed = useRef(0);
  const lastCommit = useRef(0);
  const cumulative = useMemo(() => {
    const sums: number[] = [];
    let sum = 0;
    for (let k = 0; k < total; k++) { sum += weights[k] ?? 1; sums.push(sum); }
    return sums;
  }, [total, weights]);

  useEffect(() => {
    const end = cumulative[total - 1] ?? 0;
    if (instant) { position.current = end; committed.current = total; return; }
    if (committed.current > total) { committed.current = 0; position.current = 0; }
    let frame = 0, then = performance.now();
    const tick = (at: number) => {
      const dt = Math.min(.05, Math.max(0, (at - then) / 1000));
      then = at;
      const backlog = end - position.current;
      if (backlog > 0) {
        const speed = live ? PACE + backlog * 3 : Math.max(PACE * 1.5, backlog / .4);
        position.current = Math.min(end, position.current + speed * dt);
      }
      if (at - lastCommit.current >= TICK) {
        let next = committed.current;
        while (next < total && cumulative[next] <= position.current + 1e-6) next++;
        if (next !== committed.current) { committed.current = next; lastCommit.current = at; setShown(next); }
      }
      if (committed.current < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cumulative, total, live, instant]);

  return instant ? total : Math.min(shown, total);
}

/* ---------------------------------------------------------------------------------------------------------------
 * Small parts
 * ------------------------------------------------------------------------------------------------------------- */

export function SourceMark({ source, className }: { source: AnswerSource; className?: string }) {
  return <span className={cx(styles.mark, className)} aria-hidden="true">
    {source.icon ?? <span className={styles.markLetter}>{source.domain.replace(/^www\./, "")[0]?.toUpperCase()}</span>}
  </span>;
}

function SourceCard({ source, n }: { source: AnswerSource; n: number }) {
  return <div className={styles.citeCard}>
    <div className={styles.citeCardSite}>
      <SourceMark source={source} className={styles.markSmall} />
      <span className={styles.truncate}>{source.site}</span>
      <span className={styles.citeCardNumber}>{n}</span>
    </div>
    <p className={styles.citeCardTitle}>{source.title}</p>
    {source.snippet && <p className={styles.citeCardSnippet}>{source.snippet}</p>}
    <p className={styles.citeCardMeta}><span className={styles.truncate}>{source.domain}</span>{source.date && <><span className={styles.dot} aria-hidden="true" /><span>{source.date}</span></>}</p>
  </div>;
}

function Citation({ n, s, sources, hot, onHot }: { n: number; s: number; sources: AnswerSource[]; hot: Hot; onHot: (hot: Hot) => void }) {
  const source = sources[n - 1];
  const lit = hot?.n === n && (hot.s === undefined || hot.s === s);
  if (!source) return <span className={styles.cite} data-missing="">{n}</span>;
  return <HoverCard content={<SourceCard source={source} n={n} />} side="bottom" align="center" openDelay={220}>
    <a href={source.url} target="_blank" rel="noreferrer" className={styles.cite} data-lit={lit || undefined}
      aria-label={`Source ${n}: ${source.title}, ${source.site}`}
      onPointerEnter={() => onHot({ n, s })} onPointerLeave={() => onHot(null)}
      onFocus={() => onHot({ n, s })} onBlur={() => onHot(null)}>{n}</a>
  </HoverCard>;
}

/** A small steady dot after the last word while the model is still writing. Zero width, so nothing shifts when it leaves. */
const Caret = () => <span className={styles.caret} aria-hidden="true"><span /></span>;

/* ---------------------------------------------------------------------------------------------------------------
 * Inline text: words grouped into sentences, so a citation can light up the claim it supports
 * ------------------------------------------------------------------------------------------------------------- */

interface InlineProps { units: InlineUnit[]; shown: number; sources: AnswerSource[]; hot: Hot; onHot: (hot: Hot) => void; cites: ParsedAnswer["cites"]; caret?: boolean }

function Inline({ units, shown, sources, hot, onHot, cites, caret }: InlineProps) {
  const visible = units.filter(u => u.i < shown);
  const out: ReactNode[] = [];
  let group: ReactNode[] = [], groupSentence = -1;
  const flush = () => {
    if (!group.length) return;
    const s = groupSentence;
    const lit = hot !== null && (hot.s !== undefined ? hot.s === s : Boolean(cites.get(s)?.has(hot.n)));
    out.push(<span key={`s${s}-${out.length}`} className={styles.sentence} data-lit={lit || undefined}>{group}</span>);
    group = [];
  };
  visible.forEach((u, k) => {
    const space = u.space && k > 0 ? " " : "";
    if (u.kind === "cite") {
      flush();
      // A no-break space keeps the marker on the line of the claim it supports.
      out.push(<Fragment key={u.i}>{space ? "\u00a0" : ""}<Citation n={u.n} s={u.s} sources={sources} hot={hot} onHot={onHot} /></Fragment>);
      return;
    }
    if (u.s !== groupSentence) { flush(); groupSentence = u.s; if (space) out.push(space); }
    else if (space) group.push(space);
    group.push(u.kind === "code"
      ? <code key={u.i} className={cx(styles.word, styles.inlineCode)}>{u.text}</code>
      : <span key={u.i} className={cx(styles.word, u.bold && styles.strong)}>{u.text}</span>);
  });
  flush();
  if (caret) out.push(<Caret key="caret" />);
  return <>{out}</>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Code
 * ------------------------------------------------------------------------------------------------------------- */

const tokenPattern = /\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
const keywords = /^(?:async|await|break|case|catch|const|else|export|for|from|function|if|import|let|new|of|return|throw|try|typeof|var|while|true|false|null|undefined)$/;

function highlight(line: string) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(tokenPattern)) {
    const value = match[0], index = match.index ?? 0;
    if (cursor < index) parts.push(line.slice(cursor, index));
    const after = line.slice(index + value.length);
    const kind = value.startsWith("//") ? "comment"
      : /^["'`]/.test(value) ? "string"
      : /^\d/.test(value) ? "number"
      : keywords.test(value) ? "keyword"
      : /^\s*\(/.test(after) || /^\?\.\(/.test(after) ? "fn"
      : /^\s*:/.test(after) ? "prop" : undefined;
    parts.push(kind ? <span key={index} className={styles[`tok_${kind}`]}>{value}</span> : value);
    cursor = index + value.length;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

const languageNames: Record<string, string> = { js: "JavaScript", ts: "TypeScript", tsx: "TypeScript", jsx: "JavaScript", json: "JSON", bash: "Shell", sh: "Shell", html: "HTML", css: "CSS", py: "Python", python: "Python" };

function CodePanel({ block, shown, complete }: { block: Extract<Block, { kind: "code" }>; shown: number; complete: boolean }) {
  const lines = block.lines.filter(line => line.i < shown);
  const language = languageNames[block.language] ?? block.language;
  return <figure className={cx(styles.code, styles.develop)}>
    <figcaption className={styles.codeHeader}>
      <span className={styles.codeTitle}>
        {block.filename && <span className={styles.truncate}>{block.filename}</span>}
        {language && <span className={styles.codeLanguage}>{language}</span>}
      </span>
      <CopyButton value={block.source} variant="plain" label="Copy" className={styles.codeCopy} disabled={!complete} />
    </figcaption>
    <pre className={styles.pre} tabIndex={0} aria-label={block.filename ? `Code: ${block.filename}` : "Code"}><code>
      {lines.map(line => <span key={line.i} className={cx(styles.codeLine, styles.develop)}>{line.text ? highlight(line.text) : " "}{"\n"}</span>)}
    </code></pre>
  </figure>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Table
 * ------------------------------------------------------------------------------------------------------------- */

function plain(units: InlineUnit[]) {
  return units.map((u, k) => <Fragment key={k}>{u.space && k > 0 ? " " : ""}{u.kind === "code" ? <code className={styles.inlineCode}>{u.text}</code> : u.kind === "cite" ? `[${u.n}]` : u.kind === "word" && u.bold ? <span className={styles.strong}>{u.text}</span> : u.text}</Fragment>);
}

function Table({ block, shown }: { block: Extract<Block, { kind: "table" }>; shown: number }) {
  if (block.headerIndex >= shown) return null;
  const rows = block.rows.filter(row => row.i < shown);
  const rowHeader = block.header[0]?.length === 0;
  return <div className={cx(styles.tableWrap, styles.develop)} tabIndex={0} role="region" aria-label="Comparison table">
    <table className={styles.table}>
      <thead><tr>{block.header.map((cell, c) => c === 0 && rowHeader ? <td key={c} /> : <th key={c} scope="col">{plain(cell)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.i} className={styles.develop}>{row.cells.map((cell, c) => c === 0 && rowHeader ? <th key={c} scope="row">{plain(cell)}</th> : <td key={c}>{plain(cell)}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Body
 * ------------------------------------------------------------------------------------------------------------- */

export interface AnswerBodyProps {
  markdown: string;
  /** More text is expected. */
  live: boolean;
  /** Show everything at once: a finished answer passed in, or a version already read. */
  instant: boolean;
  /** Reduced motion: chunks still arrive, but appear without a fade. */
  still?: boolean;
  sources: AnswerSource[];
  hot: Hot;
  onHot: (hot: Hot) => void;
  /** Called once every unit is on screen and the stream has ended. */
  onRevealed?: () => void;
}

function firstUnit(block: Block) {
  switch (block.kind) {
    case "p": case "h": return block.units[0]?.i;
    case "ol": case "ul": return block.items[0]?.[0]?.i;
    case "table": return block.headerIndex;
    case "code": return block.lines[0]?.i ?? Infinity;
  }
}

export const AnswerBody = memo(function AnswerBody({ markdown, live, instant, still, sources, hot, onHot, onRevealed }: AnswerBodyProps) {
  const parsed = useMemo(() => parseAnswer(markdown, live), [markdown, live]);
  const shown = useReveal(parsed, live, instant);
  const revealed = !live && shown >= parsed.total;
  const reported = useRef(false);
  useEffect(() => {
    if (revealed && !reported.current) { reported.current = true; onRevealed?.(); }
  }, [revealed, onRevealed]);

  const visible = parsed.blocks.filter(block => (firstUnit(block) ?? Infinity) < shown || (block.kind === "code" && block.lines.length === 0 && live && shown >= parsed.total));
  const caretOn = live || shown < parsed.total;
  const common = { shown, sources, hot, onHot, cites: parsed.cites };

  return <div className={styles.body} data-instant={instant || still || undefined}>
    {visible.map((block, b) => {
      const last = caretOn && b === visible.length - 1;
      switch (block.kind) {
        case "p": return <p key={b} className={styles.paragraph}><Inline units={block.units} caret={last} {...common} /></p>;
        case "h": return <h3 key={b} className={styles.heading}><Inline units={block.units} caret={last} {...common} /></h3>;
        case "ol": case "ul": {
          const List = block.kind;
          const items = block.items.filter(item => item.length && item[0].i < shown);
          return <List key={b} className={styles.list}>
            {items.map((item, k) => <li key={item[0].i} className={styles.listItem}><Inline units={item} caret={last && k === items.length - 1} {...common} /></li>)}
          </List>;
        }
        case "table": return <Table key={b} block={block} shown={shown} />;
        case "code": return <CodePanel key={b} block={block} shown={shown} complete={!live && shown >= parsed.total} />;
      }
    })}
  </div>;
});

/** Plain reasoning text, revealed word by word as it arrives. */
export function ReasoningText({ text, live }: { text: string; live: boolean }) {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  let index = 0;
  return <div className={styles.reasoningText}>
    {paragraphs.map((paragraph, p) => <p key={p}>
      {paragraph.split(/(\s+)/).map(token => {
        const key = index++;
        return /^\s+$/.test(token) ? " " : <span key={key} className={styles.word}>{token}</span>;
      })}
      {live && p === paragraphs.length - 1 && <Caret />}
    </p>)}
  </div>;
}
