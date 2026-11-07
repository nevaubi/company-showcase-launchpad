"use client";

import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import type { ToolCallInput, ToolCallOutput, ToolCallValue } from "./tool-call-types";
import styles from "./tool-call.module.css";

/** Row heights are fixed, so a folded block knows its height without measuring and never jumps. */
const ROW = { line: 20, list: 32, table: 30 } as const;
const FOLD = { line: 10, list: 5, table: 5 } as const;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A short meta line for the row, such as "4 results", when the call does not pass its own summary. */
export function summarize(output?: ToolCallOutput): string | undefined {
  if (!output) return undefined;
  if (output.type === "list") return plural(output.items.length, "result");
  if (output.type === "table") return plural(output.rows.length, "row");
  if (output.type === "json") {
    const value = output.value;
    if (Array.isArray(value)) return plural(value.length, "item");
    if (value && typeof value === "object") return plural(Object.keys(value).length, "field");
  }
  return undefined;
}

const cell = (value: string | number | boolean | null) => value === null ? "null" : String(value);

/** Plain text for the copy button: JSON stays JSON, lists become lines, tables become tab separated rows. */
export function outputText(output: ToolCallOutput): string {
  if (output.type === "text") return output.text;
  if (output.type === "json") return JSON.stringify(output.value, null, 2) ?? "";
  if (output.type === "list") return output.items.map(item => [item.lead, item.title, item.tag && `(${item.tag})`].filter(Boolean).join(" ")).join("\n");
  return [output.columns, ...output.rows.map(row => row.map(cell))].map(row => row.join("\t")).join("\n");
}

export const inputText = (input: ToolCallInput) => JSON.stringify(input, null, 2);

const formatValue = (value: ToolCallValue): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(item => typeof item !== "object" || item === null)) return value.map(item => String(item)).join(", ");
  return JSON.stringify(value);
};

export function InputList({ input }: { input: ToolCallInput }) {
  return <dl className={styles.kv}>
    {Object.entries(input).map(([key, value]) => <div key={key} className={styles.kvRow}>
      <dt className={styles.kvKey}>{key}</dt>
      <dd className={[styles.kvValue, value === null ? styles.literal : ""].filter(Boolean).join(" ")}>{formatValue(value)}</dd>
    </div>)}
  </dl>;
}

/** Tints keys, strings, numbers and literals in one pass. Color supports the text; it never replaces it. */
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;
function tintJson(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(line.slice(last, index));
    const [whole, string, colon, number, literal] = match;
    if (string && colon) parts.push(<span key={index} className={styles.jsonKey}>{string}</span>, colon);
    else if (string) parts.push(<span key={index} className={styles.jsonString}>{string}</span>);
    else if (number) parts.push(<span key={index} className={styles.jsonNumber}>{number}</span>);
    else if (literal) parts.push(<span key={index} className={styles.literal}>{literal}</span>);
    else parts.push(whole);
    last = index + whole.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/**
 * Shows the first rows and folds the rest behind "Show 18 more lines". The block springs between the folded height
 * (rows times a fixed row height) and its full height. Folded rows are hidden from assistive technology.
 */
function Fold({ total, visible, row, head = 0, unit, children }: { total: number; visible: number; row: number; head?: number; unit: string; children: (hidden: (index: number) => boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const id = useId();
  const folds = total > visible + 1;
  const hidden = (index: number) => folds && !open && index >= visible;
  if (!folds) return <div className={styles.foldBody}>{children(() => false)}</div>;
  const rest = total - visible;
  return <>
    <motion.div id={id} className={styles.foldBody} initial={false} animate={{ height: open ? "auto" : visible * row + head }} transition={reduced ? { duration: 0 } : motionTokens.spring.smooth} style={{ overflow: "hidden" } as CSSProperties}>
      {children(hidden)}
    </motion.div>
    <button type="button" className={styles.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <ChevronDown size={14} strokeWidth={1.75} className={styles.moreIcon} data-open={open || undefined} aria-hidden="true" />
      <span>{open ? "Show less" : `Show ${plural(rest, unit)}`}</span>
    </button>
  </>;
}

export function OutputView({ output }: { output: ToolCallOutput }) {
  if (output.type === "text") return <p className={styles.text}>{output.text}</p>;

  if (output.type === "json") {
    const lines = (JSON.stringify(output.value, null, 2) ?? "").split("\n");
    return <Fold total={lines.length} visible={FOLD.line} row={ROW.line} unit="more line">
      {hidden => <pre className={styles.json} style={{ "--row": `${ROW.line}px` } as CSSProperties}>
        {lines.map((line, index) => <span key={index} className={styles.jsonLine} aria-hidden={hidden(index) || undefined}>{tintJson(line)}</span>)}
      </pre>}
    </Fold>;
  }

  if (output.type === "list") {
    const items = output.items;
    return <Fold total={items.length} visible={FOLD.list} row={ROW.list} unit="more result">
      {hidden => <ul className={styles.list} style={{ "--row": `${ROW.list}px` } as CSSProperties}>
        {items.map((item, index) => <li key={`${item.lead ?? ""}${item.title}`} className={styles.listRow} aria-hidden={hidden(index) || undefined}>
          <span className={styles.listLead}>{item.lead}</span>
          <span className={styles.listTitle}>{item.title}</span>
          <span className={styles.listTag}>{item.tag}</span>
        </li>)}
      </ul>}
    </Fold>;
  }

  return <Fold total={output.rows.length} visible={FOLD.table} row={ROW.table} head={ROW.table} unit="more row">
    {hidden => <div className={styles.tableScroll}>
      <table className={styles.table} style={{ "--row": `${ROW.table}px` } as CSSProperties}>
        <thead><tr>{output.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{output.rows.map((row, index) => <tr key={index} aria-hidden={hidden(index) || undefined}>
          {row.map((value, column) => <td key={column} className={value === null ? styles.literal : undefined}>{cell(value)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </Fold>;
}
