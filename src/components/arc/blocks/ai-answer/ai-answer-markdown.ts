/*
 * The answer travels as a small markdown subset: paragraphs, ### headings, 1. and - lists, pipe tables and fenced code, with
 * **bold**, `code` and [n] citations inline. Typed blocks serialize to it, and a model can stream it directly.
 *
 * Parsing is append-stable: units are numbered in reading order, so the units of a prefix are always a prefix of the units of
 * the whole text. That lets the reveal cursor stay put while text keeps arriving. Every text unit knows its sentence, and every
 * sentence knows the sources it cites, so a citation can light up exactly the claim it supports.
 */
import type { AnswerBlock } from "./ai-answer-data";

export type InlineUnit =
  | { kind: "word"; text: string; bold: boolean; space: boolean; i: number; s: number }
  | { kind: "code"; text: string; space: boolean; i: number; s: number }
  | { kind: "cite"; n: number; space: boolean; i: number; s: number };

export type Block =
  | { kind: "p" | "h"; units: InlineUnit[] }
  | { kind: "ol" | "ul"; items: InlineUnit[][] }
  | { kind: "table"; header: InlineUnit[][]; headerIndex: number; rows: { i: number; cells: InlineUnit[][] }[] }
  | { kind: "code"; language: string; filename: string; source: string; lines: { i: number; text: string }[] };

export interface ParsedAnswer {
  blocks: Block[];
  /** Number of revealable units. */
  total: number;
  /** Reveal cost per unit: rows and code lines take a little longer than a word. */
  weights: number[];
  /** Sentence id to the source numbers it cites. */
  cites: Map<number, Set<number>>;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Blocks to markdown
 * ------------------------------------------------------------------------------------------------------------- */

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function blocksToMarkdown(blocks: AnswerBlock[]) {
  return blocks.map(block => {
    switch (block.type) {
      case "paragraph": return block.text;
      case "heading": return `### ${block.text}`;
      case "list": return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${item}`).join("\n");
      case "table": return [
        `| ${block.columns.map(cell).join(" | ")} |`,
        `| ${block.columns.map(() => "---").join(" | ")} |`,
        ...block.rows.map(row => `| ${row.map(cell).join(" | ")} |`),
      ].join("\n");
      case "code": return `\`\`\`${block.language ?? ""}${block.filename ? ` ${block.filename}` : ""}\n${block.code}\n\`\`\``;
    }
  }).join("\n\n");
}

/** Markdown for the clipboard, with the cited sources listed underneath. */
export function markdownForCopy(markdown: string, sources: { title: string; url: string }[]) {
  const cited = sources.map((source, i) => ({ ...source, n: i + 1 })).filter(source => markdown.includes(`[${source.n}]`));
  return cited.length ? `${markdown}\n\nSources\n${cited.map(s => `[${s.n}] ${s.title}, ${s.url}`).join("\n")}` : markdown;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Markdown to blocks
 * ------------------------------------------------------------------------------------------------------------- */

type Counter = { i: number; s: number; cites: Map<number, Set<number>>; weights: number[] };

/** Table cells are parsed on their own counter: a row reveals as one unit and its words take no sentence ids. */
const scratch = (): Counter => ({ i: 0, s: 0, cites: new Map(), weights: [] });

function inline(src: string, shared: Counter, numbered = true): InlineUnit[] {
  const counter = numbered ? shared : scratch();
  const units: InlineUnit[] = [];
  let bold = false, buf = "", space = false, closing = false, i = 0;
  const next = () => counter.i++;
  const push = (unit: { kind: "word"; text: string; bold: boolean } | { kind: "code"; text: string } | { kind: "cite"; n: number }) => {
    // The first word after a finished sentence starts the next one; citations stay with the sentence they follow.
    if (closing && unit.kind !== "cite") { counter.s++; closing = false; }
    const index = next();
    counter.weights[index] = 1;
    units.push({ ...unit, space: space && units.length > 0, i: index, s: counter.s } as InlineUnit);
    space = false;
    if (unit.kind === "cite") {
      const set = counter.cites.get(counter.s) ?? new Set<number>();
      set.add(unit.n);
      counter.cites.set(counter.s, set);
    }
    if (unit.kind === "word" && /[.!?]["”)]?$/.test(unit.text)) closing = true;
  };
  const flush = () => {
    for (const token of buf.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) space = true; else push({ kind: "word", text: token, bold });
    }
    buf = "";
  };
  while (i < src.length) {
    if (src.startsWith("**", i)) { flush(); bold = !bold; i += 2; continue; }
    if (src[i] === "`") {
      const close = src.indexOf("`", i + 1);
      if (close === -1) break; // held until the closing tick arrives
      flush();
      if (close > i + 1) push({ kind: "code", text: src.slice(i + 1, close) });
      i = close + 1;
      continue;
    }
    if (src[i] === "[") {
      const cite = /^\[(\d{1,2})\]/.exec(src.slice(i, i + 4));
      if (cite) {
        flush();
        push({ kind: "cite", n: Number(cite[1]) });
        i += cite[0].length;
        continue;
      }
      if (/^\[\d{0,2}$/.test(src.slice(i))) break; // a citation still arriving
    }
    if (src[i] === "\\" && src[i + 1] === "|") { buf += "|"; i += 2; continue; }
    buf += src[i++];
  }
  flush();
  // A sentence ends with its block, so the next block never continues it.
  if (units.length) counter.s++;
  return units;
}

const ESCAPED = "\u0000";
const splitRow = (line: string) => line.trim().replace(/\\\|/g, ESCAPED).replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(part => part.split(ESCAPED).join("\\|").trim());
const isSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim());

/**
 * Parses the answer. While `live`, anything after the last whitespace is held back, so a word, a table row or a code line only
 * shows once it is complete.
 */
export function parseAnswer(source: string, live = false): ParsedAnswer {
  let text = source;
  if (live) {
    const cut = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\n"));
    text = cut === -1 ? "" : text.slice(0, cut + 1);
    // A table row or code line waits for its newline, and a line that is only a list, heading or fence marker waits for its first word.
    const lastBreak = text.lastIndexOf("\n");
    const tail = text.slice(lastBreak + 1);
    if (/^\s*\|/.test(tail) || /^\s*(#{1,6}|[-*+]|\d+[.)]|`{1,3}\S*)\s*$/.test(tail) || inFence(text.slice(0, lastBreak + 1))) text = text.slice(0, lastBreak + 1);
  }
  const counter: Counter = { i: 0, s: 0, cites: new Map(), weights: [] };
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let list: Extract<Block, { kind: "ol" | "ul" }> | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) blocks.push({ kind: "p", units: inline(para.join(" "), counter) }); para = []; };

  for (let l = 0; l < lines.length; l++) {
    const raw = lines[l];
    const line = raw.trim();
    const fence = /^```(\S*)\s*(.*)$/.exec(line);
    if (fence) {
      flushPara(); list = null;
      const body: string[] = [];
      l++;
      while (l < lines.length && !/^\s*```/.test(lines[l])) body.push(lines[l++]);
      // An unfinished fence drops the line still being written (the text after the last newline).
      const complete = l < lines.length || !live ? body : body.slice(0, -1);
      const block: Extract<Block, { kind: "code" }> = { kind: "code", language: fence[1], filename: fence[2], source: body.join("\n"), lines: [] };
      for (const row of complete) { const index = counter.i++; counter.weights[index] = 2.4; block.lines.push({ i: index, text: row }); }
      blocks.push(block);
      continue;
    }
    if (!line) { flushPara(); list = null; continue; }
    if (line.startsWith("|")) {
      flushPara(); list = null;
      const header = splitRow(line);
      const headerIndex = counter.i++;
      counter.weights[headerIndex] = 2.4;
      const table: Extract<Block, { kind: "table" }> = { kind: "table", header: header.map(c => inline(c, counter, false)), headerIndex, rows: [] };
      while (l + 1 < lines.length && lines[l + 1].trim().startsWith("|")) {
        l++;
        if (isSeparator(lines[l])) continue;
        const index = counter.i++;
        counter.weights[index] = 3.2;
        table.rows.push({ i: index, cells: splitRow(lines[l]).map(c => inline(c, counter, false)) });
      }
      blocks.push(table);
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line), numbered = /^\d+[.)]\s+(.*)$/.exec(line), heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.kind !== kind) { list = { kind, items: [] }; blocks.push(list); }
      list.items.push(inline((bullet ?? numbered)![1], counter));
      continue;
    }
    if (heading) { flushPara(); list = null; blocks.push({ kind: "h", units: inline(heading[1], counter) }); continue; }
    // A list item can wrap onto the next line; anything else joins the paragraph.
    if (list && raw.startsWith("  ")) { const items = list.items; items[items.length - 1] = [...items[items.length - 1], ...inline(line, counter)]; continue; }
    list = null;
    para.push(line);
  }
  flushPara();
  return { blocks, total: counter.i, weights: counter.weights, cites: counter.cites };
}

function inFence(text: string) {
  return ((text.match(/^\s*```/gm) ?? []).length % 2) === 1;
}

/** Plain text of a run of inline units, for labels and screen readers. */
export function unitsText(units: InlineUnit[]) {
  return units.map(u => `${u.space ? " " : ""}${u.kind === "cite" ? `[${u.n}]` : u.text}`).join("");
}

/** The first paragraph and the first list, for More concise. */
export function conciseBlocks(blocks: AnswerBlock[]): AnswerBlock[] {
  const lead = blocks.find(b => b.type === "paragraph");
  const listIndex = blocks.findIndex(b => b.type === "list");
  const heading = listIndex > 0 && blocks[listIndex - 1].type === "heading" ? blocks[listIndex - 1] : undefined;
  return [lead, heading, blocks[listIndex]].filter((b): b is AnswerBlock => Boolean(b));
}
