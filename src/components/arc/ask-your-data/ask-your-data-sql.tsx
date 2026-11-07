"use client";

import styles from "./ask-your-data.module.css";

export type SqlTokenKind = "keyword" | "function" | "string" | "number" | "comment" | "punct" | "ident" | "space";
export interface SqlToken { text: string; kind: SqlTokenKind }

const KEYWORDS = new Set(("select from join left right inner outer full cross on where and or not in is null as group by order having limit offset "
  + "with distinct case when then else end union all asc desc between like ilike exists interval date timestamp timestamptz true false "
  + "filter over partition window rows range preceding following current row lateral using returning into values").split(" "));

const PATTERN = /--[^\n]*|'(?:[^']|'')*'?|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|::|<>|<=|>=|!=|[^\sA-Za-z0-9_]/g;

/** A small PostgreSQL tokenizer: enough to tint keywords, functions, strings, numbers and comments while text streams in. */
export function tokenizeSql(sql: string): SqlToken[] {
  const raw = sql.match(PATTERN) ?? [];
  return raw.map((text, index) => {
    if (text.startsWith("--")) return { text, kind: "comment" };
    if (text.startsWith("'")) return { text, kind: "string" };
    if (/^\s+$/.test(text)) return { text, kind: "space" };
    if (/^\d/.test(text)) return { text, kind: "number" };
    if (/^[A-Za-z_]/.test(text)) {
      if (raw[index - 1] === "::") return { text, kind: "keyword" };
      let next = index + 1;
      while (next < raw.length && /^\s+$/.test(raw[next])) next++;
      if (raw[next] === "(" && !KEYWORDS.has(text.toLowerCase())) return { text, kind: "function" };
      return { text, kind: KEYWORDS.has(text.toLowerCase()) ? "keyword" : "ident" };
    }
    return { text, kind: "punct" };
  });
}

/** Token counts after which each streamed chunk ends: four words or symbols per tick, whitespace riding along. */
export function sqlChunkEnds(tokens: SqlToken[], wordsPerChunk = 4) {
  const ends: number[] = [];
  let words = 0;
  tokens.forEach((token, index) => {
    if (token.kind !== "space") words++;
    if (words === wordsPerChunk) { ends.push(index + 1); words = 0; }
  });
  if (!ends.length || ends[ends.length - 1] !== tokens.length) ends.push(tokens.length);
  return ends;
}

const kindClass: Partial<Record<SqlTokenKind, string>> = {
  keyword: styles.tkKeyword, function: styles.tkFunction, string: styles.tkString, number: styles.tkNumber, comment: styles.tkComment, punct: styles.tkPunct,
};

interface SqlCodeProps {
  tokens: SqlToken[];
  /** Tokens shown so far. The rest is laid out invisibly, so the block holds its final size from the first chunk. */
  revealed: number;
  /** Streaming is over: new spans stop fading in, so reopening the panel never replays the reveal. */
  settled: boolean;
  label: string;
}

export function SqlCode({ tokens, revealed, settled, label }: SqlCodeProps) {
  const shown = tokens.slice(0, revealed);
  const rest = tokens.slice(revealed).map(token => token.text).join("");
  const lines = Math.max(1, tokens.reduce((count, token) => count + (token.text.match(/\n/g)?.length ?? 0), 1));
  const shownLines = shown.reduce((count, token) => count + (token.text.match(/\n/g)?.length ?? 0), 1);
  return <div className={styles.code} data-settled={settled || undefined}>
    <div className={styles.gutter} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => <span key={index} data-on={index < shownLines || undefined}>{index + 1}</span>)}
    </div>
    <pre className={styles.pre} tabIndex={0} aria-label={label}>
      <code>
        {shown.map((token, index) => <span key={index} className={[styles.tk, kindClass[token.kind]].filter(Boolean).join(" ")}>{token.text}</span>)}
        {rest ? <span className={styles.ghost} aria-hidden="true">{rest}</span> : null}
      </code>
    </pre>
  </div>;
}
