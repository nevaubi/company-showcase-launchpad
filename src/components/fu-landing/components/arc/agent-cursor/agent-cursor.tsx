"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { MotionStyle, MotionValue } from "motion/react";
import { Check, CircleAlert, Pencil, RotateCcw, Sparkles, Square, Undo2 } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import { Avatar } from "../avatar/avatar";
import { Button } from "../button/button";
import { TextShimmer } from "../text-shimmer/text-shimmer";
import { ClaudeMark } from "./agent-cursor-marks";
import { sampleBlocks, sampleEdits, sampleMeta } from "./agent-cursor-sample";
import type { AgentCursorPhase, AgentEdit, AgentIdentity, Collaborator, DocBlock, DocBlockType } from "./agent-cursor-types";
import styles from "./agent-cursor.module.css";

export type { AgentCursorPhase, AgentEdit, AgentIdentity, Collaborator, DocBlock, DocBlockType } from "./agent-cursor-types";
export { sampleBlocks, sampleEdits } from "./agent-cursor-sample";

export interface AgentCursorProps {
  /** The document. Defaults to a sample launch brief. */
  blocks?: DocBlock[];
  /** A muted line under the title, such as the owner and a date. */
  meta?: string;
  /** The edits the agent makes, in order. Ignored when `run` is set. Defaults to the sample edits. */
  edits?: AgentEdit[];
  /** Fetches the edits from your agent. Receives an AbortSignal that fires when someone presses Stop. */
  run?: (signal: AbortSignal) => Promise<AgentEdit[]>;
  /** The agent's name, mark and color. Defaults to Claude. */
  agent?: AgentIdentity;
  /** A human in the doc, drawn as a second cursor with their portrait. Null hides it. */
  collaborator?: Collaborator | null;
  /** Starts a run as soon as the card is on screen. Defaults to true. */
  autoPlay?: boolean;
  /** Replays the run: the collaborator accepts the edits, then the doc resets. Defaults to true for the built in sample. */
  loop?: boolean;
  /** Playback speed multiplier. Defaults to 1. */
  speed?: number;
  /** Called with the edited document when someone accepts. */
  onAccept?: (blocks: DocBlock[]) => void;
  /** Called with the restored document when someone undoes the edits. */
  onUndo?: (blocks: DocBlock[]) => void;
  onPhaseChange?: (phase: AgentCursorPhase) => void;
  /** Tells screen readers the run is simulated and nothing was saved. Defaults to true for the built in sample. */
  simulated?: boolean;
  className?: string;
}

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };
type Who = "agent" | "human";
type Fix = { start: number; from: string; to: string; applied: boolean };
interface LiveBlock {
  id: string;
  type: DocBlockType;
  /** Always the block's final text, so accept can read it at any moment. */
  text: string;
  pending?: boolean;
  inserted?: boolean;
  fading?: boolean;
  fresh?: number;
  chunks?: string[];
  shown?: number;
  fix?: Fix;
}
interface Selection { key: number; boxes: Box[]; ms: number }
interface CursorState { x: MotionValue<number>; y: MotionValue<number>; stop?: () => void }

const CLAUDE_CLAY = "#D97757";
const defaultAgent: AgentIdentity = { name: "Claude", color: CLAUDE_CLAY };
const defaultCollaborator: Collaborator = { name: "Emma Collins", avatar: "/media/people/emma-collins.svg" };
const glideEase: [number, number, number, number] = [0.4, 0, 0.2, 1];
const dragEase: [number, number, number, number] = [0.35, 0, 0.6, 1];
const enterEase = [...motionTokens.ease.standard] as [number, number, number, number];
const CHUNK_SIZES = [4, 5, 3, 6, 4, 5];
const TICK = 34;
const TAG_ROOM = 112;

const toLive = (blocks: DocBlock[], fresh?: number): LiveBlock[] => blocks.map(b => ({ id: b.id, type: b.type, text: b.text, fresh }));
const toBlocks = (doc: LiveBlock[]): DocBlock[] => doc.map(b => ({ id: b.id, type: b.type, text: b.text }));
const abortError = () => new DOMException("Aborted", "AbortError");
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** Splits text into chunks of 3 to 6 words, each carrying its leading space, so the caret sits right after the last word. */
function chunk(text: string) {
  const words = text.split(/(?=\s)/);
  const chunks: string[] = [];
  for (let i = 0, n = 0; i < words.length; n++) {
    const size = CHUNK_SIZES[n % CHUNK_SIZES.length];
    chunks.push(words.slice(i, i + size).join(""));
    i += size;
  }
  return chunks;
}

/** The text's line boxes relative to `origin`, one per line, stretched to the full line height so a selection reads gapless. */
function lineBoxes(el: Element, origin: DOMRect): Box[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  const lines: Box[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1) continue;
    const mid = r.top + r.height / 2 - origin.top;
    const left = r.left - origin.left;
    const line = lines.find(l => Math.abs(l.y + l.h / 2 - mid) < lh / 2);
    if (line) {
      const right = Math.max(line.x + line.w, left + r.width);
      line.x = Math.min(line.x, left);
      line.w = right - line.x;
    } else lines.push({ x: left, y: mid - lh / 2, w: r.width, h: lh });
  }
  return lines.sort((a, b) => a.y - b.y);
}

const statusText = (phase: AgentCursorPhase, name: string, activity: string, count: number, error: string) => {
  const edits = `${count} ${count === 1 ? "edit" : "edits"}`;
  switch (phase) {
    case "idle": return `${name} is in this doc`;
    case "thinking": return "Reading the doc";
    case "editing": return activity;
    case "review": return `${edits} ready for review`;
    case "accepted": return `Accepted ${edits}`;
    case "reverted": return `Undid ${edits}`;
    case "stopped": return "Stopped before any edits";
    case "empty": return "No edits needed";
    case "error": return error;
  }
};

const defaultLabel = (edit: AgentEdit) =>
  edit.label ?? (edit.type === "rewrite" ? "Rewriting a paragraph" : edit.type === "fix" ? "Fixing a typo" : edit.block.type === "heading" ? "Adding a heading" : "Adding a paragraph");

/**
 * A document where an AI agent edits live like a collaborator. Its labeled cursor glides to a paragraph, selects it and
 * streams in a rewrite, inserts a heading and fixes a typo while a human cursor sits in the same doc. Changes stay tinted
 * until someone accepts or undoes them from a floating review bar. With no props it plays a simulated run on a launch brief.
 */
export function AgentCursor({
  blocks = sampleBlocks, meta, edits, run, agent = defaultAgent, collaborator = defaultCollaborator, autoPlay = true, loop,
  speed = 1, onAccept, onUndo, onPhaseChange, simulated, className,
}: AgentCursorProps) {
  const reduced = useReducedMotion() ?? false;
  const isSample = blocks === sampleBlocks && !edits && !run;
  const metaLine = meta ?? (blocks === sampleBlocks ? sampleMeta : undefined);
  const loopDefault = (loop ?? isSample) && !reduced;
  const agentColor = agent.color ?? CLAUDE_CLAY;
  const firstName = collaborator?.name.split(/\s+/)[0] ?? "";

  const rootRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const textEls = useRef(new Map<string, HTMLElement>());
  const fixEls = useRef(new Map<string, HTMLElement>());

  const [doc, setDoc] = useState<LiveBlock[]>(() => toLive(blocks));
  const [phase, setPhase] = useState<AgentCursorPhase>(autoPlay ? "thinking" : "idle");
  const [activity, setActivity] = useState("");
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fading, setFading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ready, setReady] = useState(false);
  const [agentAway, setAgentAway] = useState(true);
  const [flip, setFlip] = useState({ agent: false, human: false });
  const [pressed, setPressed] = useState(false);

  // Live mirrors for the async run.
  const docRef = useRef(doc);
  const phaseRef = useRef(phase);
  const props = useRef({ blocks, edits, run, speed, onAccept, onUndo, reduced, loopDefault });
  useLayoutEffect(() => {
    docRef.current = doc;
    phaseRef.current = phase;
    props.current = { blocks, edits, run, speed, onAccept, onUndo, reduced, loopDefault };
  });

  const agentC = useRef<CursorState>({ x: useMotionValue(0), y: useMotionValue(0) }).current;
  const humanC = useRef<CursorState>({ x: useMotionValue(0), y: useMotionValue(0) }).current;
  const agentParked = useRef(true);
  const awayTimer = useRef(0);
  const agentAvatarRef = useRef<HTMLSpanElement>(null);
  const humanBusy = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const loopOn = useRef(loopDefault);
  const applied = useRef(0);
  const snapshot = useRef<DocBlock[]>(blocks);
  const decide = useRef<(() => void) | null>(null);
  const engaged = useRef({ hover: false, focus: false });
  const visible = useRef(true);
  const visibleWaiters = useRef(new Set<() => void>());
  const selKey = useRef(0);
  const freshKey = useRef(0);

  useEffect(() => { onPhaseChange?.(phase); }, [phase, onPhaseChange]);

  // ---- Timing -------------------------------------------------------------------------------------------------------
  const whenVisible = useCallback(() => visible.current ? Promise.resolve() : new Promise<void>(resolve => { visibleWaiters.current.add(resolve); }), []);
  const sleep = useCallback((ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => { window.clearTimeout(id); reject(abortError()); };
    const id = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      void whenVisible().then(() => signal.aborted ? reject(abortError()) : resolve());
    }, ms / props.current.speed);
    signal.addEventListener("abort", onAbort, { once: true });
  }), [whenVisible]);

  // ---- Geometry -----------------------------------------------------------------------------------------------------
  const origin = useCallback(() => rootRef.current?.getBoundingClientRect() ?? new DOMRect(), []);
  const boxesOf = useCallback((el: Element | undefined) => el ? lineBoxes(el, origin()) : [], [origin]);
  /** The agent's avatar in the header: its cursor comes out of it at the start of a run and returns to it when done. */
  const parkPoint = useCallback((): Pt | null => {
    const avatar = agentAvatarRef.current?.getBoundingClientRect();
    if (!avatar) return null;
    const o = origin();
    return { x: avatar.left - o.left + avatar.width / 2, y: avatar.top - o.top + avatar.height / 2 };
  }, [origin]);
  const homePoint = useCallback((): Pt | null => {
    const second = docRef.current.find((b, i) => i > 0 && b.type === "paragraph");
    // Just past the end of the first paragraph, so the tag rests in the gap below it instead of over text.
    const root = rootRef.current, box = boxesOf(second ? textEls.current.get(second.id) : undefined).at(-1);
    if (!box || !root) return null;
    return { x: Math.min(box.x + box.w + 10, root.clientWidth - TAG_ROOM - 4), y: box.y + box.h * 0.55 };
  }, [boxesOf]);

  // ---- Cursors ------------------------------------------------------------------------------------------------------
  const glide = useCallback((who: Who, to: Pt, opts: { ms?: number; straight?: boolean; ease?: [number, number, number, number] } = {}) => new Promise<void>(resolve => {
    const c = who === "agent" ? agentC : humanC;
    c.stop?.();
    const width = rootRef.current?.clientWidth ?? 0;
    const flipped = to.x > width - TAG_ROOM;
    setFlip(f => f[who] === flipped ? f : { ...f, [who]: flipped });
    const fx = c.x.get(), fy = c.y.get(), dx = to.x - fx, dy = to.y - fy, dist = Math.hypot(dx, dy);
    if (props.current.reduced || dist < 1) { c.x.set(to.x); c.y.set(to.y); return resolve(); }
    const ms = (opts.ms ?? Math.min(600, Math.max(280, 220 + dist * 0.7))) / props.current.speed;
    const bend = opts.straight ? 0 : Math.min(dist * 0.14, 32);
    const cx = fx + dx / 2 - (dy / dist) * bend, cy = fy + dy / 2 + (dx / dist) * bend;
    const controls = animate(0, 1, {
      duration: ms / 1000, ease: opts.ease ?? glideEase,
      onUpdate: t => { const u = 1 - t; c.x.set(u * u * fx + 2 * u * t * cx + t * t * to.x); c.y.set(u * u * fy + 2 * u * t * cy + t * t * to.y); },
      onComplete: () => { c.stop = undefined; resolve(); },
    });
    c.stop = () => { controls.stop(); c.stop = undefined; resolve(); };
  }), [agentC, humanC]);

  const glideAgent = useCallback(async (to: Pt, opts?: Parameters<typeof glide>[2]) => {
    agentParked.current = false;
    window.clearTimeout(awayTimer.current);
    setAgentAway(false);
    await glide("agent", to, opts);
  }, [glide]);
  const parkAgent = useCallback(async () => {
    const p = parkPoint();
    agentParked.current = true;
    window.clearTimeout(awayTimer.current);
    awayTimer.current = window.setTimeout(() => setAgentAway(true), props.current.reduced ? 0 : 180);
    if (p) await glide("agent", p);
  }, [glide, parkPoint]);

  // ---- Edits --------------------------------------------------------------------------------------------------------
  const patch = (id: string, change: Partial<LiveBlock> | ((b: LiveBlock) => Partial<LiveBlock>)) =>
    setDoc(d => d.map(b => b.id === id ? { ...b, ...(typeof change === "function" ? change(b) : change) } : b));
  const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const select = useCallback((boxes: Box[], ms: number) => setSelection({ key: ++selKey.current, boxes, ms }), []);

  const applyEdit = useCallback(async (edit: AgentEdit, signal: AbortSignal) => {
    const reducedNow = props.current.reduced;
    if (edit.type === "rewrite") {
      const lines = boxesOf(textEls.current.get(edit.blockId));
      if (!lines.length) return;
      const first = lines[0], last = lines[lines.length - 1];
      await glideAgent({ x: first.x, y: first.y + first.h * 0.6 });
      await sleep(90, signal);
      const dragMs = Math.min(520, Math.max(240, lines.length * 110));
      select(lines, dragMs);
      await glideAgent({ x: last.x + last.w, y: last.y + last.h * 0.6 }, { ms: dragMs, straight: true, ease: dragEase });
      await sleep(180, signal);
      applied.current++;
      setSelection(null);
      patch(edit.blockId, { fading: true });
      await sleep(110, signal);
      const chunks = chunk(edit.text);
      patch(edit.blockId, { text: edit.text, chunks, shown: reducedNow ? chunks.length : 0, fading: false, pending: true, fix: undefined });
      await nextFrame();
      if (reducedNow) return;
      const end = boxesOf(textEls.current.get(edit.blockId)).at(-1);
      if (end) void glideAgent({ x: end.x + end.w, y: end.y + end.h * 0.6 }, { ms: Math.max(320, chunks.length * TICK + 140), ease: glideEase });
      for (let i = 1; i <= chunks.length; i++) {
        patch(edit.blockId, { shown: i });
        await sleep(TICK, signal);
      }
      await sleep(200, signal);
    } else if (edit.type === "insert") {
      const index = docRef.current.findIndex(b => b.id === edit.afterBlockId);
      if (index < 0) return;
      const next = docRef.current[index + 1];
      const nextBox = boxesOf(next ? textEls.current.get(next.id) : undefined)[0];
      const prevBox = boxesOf(textEls.current.get(edit.afterBlockId)).at(-1);
      const target = nextBox ? { x: nextBox.x, y: nextBox.y + 6 } : prevBox ? { x: prevBox.x, y: prevBox.y + prevBox.h + 18 } : null;
      if (target) await glideAgent(target);
      await sleep(120, signal);
      applied.current++;
      setDoc(d => {
        const at = d.findIndex(b => b.id === edit.afterBlockId);
        const block: LiveBlock = { id: edit.block.id, type: edit.block.type, text: edit.block.text, inserted: true, pending: true };
        return [...d.slice(0, at + 1), block, ...d.slice(at + 1)];
      });
      await sleep(300, signal);
      const heading = boxesOf(textEls.current.get(edit.block.id)).at(-1);
      if (heading) await glideAgent({ x: heading.x + heading.w + 2, y: heading.y + heading.h * 0.6 }, { ms: 260 });
      await sleep(240, signal);
    } else {
      const word = fixEls.current.get(edit.blockId);
      const box = boxesOf(word)[0];
      if (!box) return;
      await glideAgent({ x: box.x + box.w * 0.55, y: box.y + box.h * 0.62 });
      await sleep(80, signal);
      select([box], 140);
      await sleep(260, signal);
      applied.current++;
      setSelection(null);
      patch(edit.blockId, b => b.fix ? { fix: { ...b.fix, applied: true }, text: b.text.slice(0, b.fix.start) + b.fix.to + b.text.slice(b.fix.start + b.fix.from.length), pending: true } : {});
      await sleep(320, signal);
    }
  }, [boxesOf, glideAgent, select, sleep]);

  // ---- Decisions ----------------------------------------------------------------------------------------------------
  const accept = useCallback(() => {
    if (phaseRef.current !== "review") return;
    setDoc(d => d.map(b => ({ ...b, pending: false })));
    setPhase("accepted");
    props.current.onAccept?.(toBlocks(docRef.current));
    decide.current?.();
    decide.current = null;
  }, []);

  const undo = useCallback(() => {
    if (phaseRef.current !== "review") return;
    const restored = snapshot.current;
    const fresh = ++freshKey.current;
    // Rewritten blocks fade back to their old text, fixed words crossfade back, inserted blocks collapse away.
    setDoc(d => restored.map(b => {
      const live = d.find(l => l.id === b.id);
      if (live?.fix?.applied && !live.chunks) return { id: b.id, type: b.type, text: b.text, fix: { ...live.fix, applied: false } };
      const changed = !live || live.text !== b.text || !!live.chunks;
      return { id: b.id, type: b.type, text: b.text, fresh: changed ? fresh : live?.fresh };
    }));
    setPhase("reverted");
    props.current.onUndo?.(restored);
    decide.current?.();
    decide.current = null;
  }, []);

  /** In a looping demo the collaborator accepts the edits, unless someone is hovering or focused inside the card. */
  const autoAccept = useCallback(async (signal: AbortSignal) => {
    await sleep(1500, signal);
    while (engaged.current.hover || engaged.current.focus) await sleep(250, signal);
    if (phaseRef.current !== "review") return;
    const button = acceptRef.current?.getBoundingClientRect();
    const o = origin();
    humanBusy.current = true;
    try {
      if (button) await glide("human", { x: button.left - o.left + button.width * 0.55, y: button.top - o.top + button.height * 0.62 }, { ms: 520 });
      if (signal.aborted || phaseRef.current !== "review") return;
      setPressed(true);
      await sleep(130, signal);
      setPressed(false);
      accept();
      await sleep(420, signal);
      const home = homePoint();
      if (home) await glide("human", home, { ms: 560 });
    } finally {
      setPressed(false);
      humanBusy.current = false;
    }
  }, [accept, glide, homePoint, origin, sleep]);

  // ---- Run ----------------------------------------------------------------------------------------------------------
  const resetDoc = useCallback(async (signal: AbortSignal) => {
    const base = props.current.blocks;
    const live = docRef.current;
    const dirty = live.length !== base.length || live.some((b, i) => b.text !== base[i]?.text || b.pending || b.fix);
    setSelection(null);
    if (!dirty) return;
    setFading(true);
    await sleep(130, signal);
    setResetting(true);
    setDoc(toLive(base));
    await nextFrame();
    setResetting(false);
    setFading(false);
  }, [sleep]);

  const cycle = useCallback(async (signal: AbortSignal) => {
    for (;;) {
      await resetDoc(signal);
      await whenVisible();
      setPhase("thinking");
      setError("");
      applied.current = 0;
      snapshot.current = props.current.blocks;
      if (!agentParked.current) await parkAgent();
      const reading = (async () => {
        await sleep(240, signal);
        const second = docRef.current.find((b, i) => i > 0 && b.type === "paragraph");
        const line = boxesOf(second ? textEls.current.get(second.id) : undefined)[0];
        if (line) await glideAgent({ x: line.x + Math.min(line.w, 480) * 0.3, y: line.y + line.h * 0.6 }, { ms: 520 });
      })();
      let list: AgentEdit[];
      try {
        const { run: runFn, edits: given } = props.current;
        const work = runFn ? runFn(signal) : sleep(900, signal).then(() => given ?? sampleEdits);
        [list] = await Promise.all([work, reading, sleep(700, signal)]);
      } catch (err) {
        if (signal.aborted) throw abortError();
        setError(err instanceof Error && err.message ? err.message : "The edit could not finish");
        setPhase("error");
        void parkAgent();
        if (!loopOn.current) return;
        await sleep(2600, signal);
        continue;
      }
      const live = docRef.current;
      const valid = list.filter(e => e.type === "insert" ? live.some(b => b.id === e.afterBlockId) && !live.some(b => b.id === e.block.id)
        : e.type === "rewrite" ? live.some(b => b.id === e.blockId) : live.some(b => b.id === e.blockId && b.text.includes(e.find)));
      if (!valid.length) {
        setPhase("empty");
        void parkAgent();
        if (!loopOn.current) return;
        await sleep(2000, signal);
        continue;
      }
      // Flag every typo the agent is about to fix, the way a spellchecker would.
      setDoc(d => d.map(b => {
        const fix = valid.find(e => e.type === "fix" && e.blockId === b.id);
        return fix && fix.type === "fix" ? { ...b, fix: { start: b.text.indexOf(fix.find), from: fix.find, to: fix.text, applied: false } } : b;
      }));
      setPhase("editing");
      for (const edit of valid) {
        setActivity(defaultLabel(edit));
        await applyEdit(edit, signal);
        setCount(applied.current);
        await sleep(200, signal);
      }
      setCount(applied.current);
      setPhase("review");
      void parkAgent();
      const decided = new Promise<void>(resolve => { decide.current = resolve; });
      if (loopOn.current) void autoAccept(signal).catch(() => {});
      await Promise.race([decided, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(abortError()), { once: true }))]);
      if (!loopOn.current) return;
      await sleep(1900, signal);
    }
  }, [applyEdit, autoAccept, boxesOf, glideAgent, parkAgent, resetDoc, sleep, whenVisible]);

  const start = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    loopOn.current = props.current.loopDefault;
    decide.current = null;
    void cycle(c.signal).catch(err => { if (!isAbort(err)) console.error(err); });
  }, [cycle]);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    loopOn.current = false;
    agentC.stop?.();
    setSelection(null);
    setDoc(d => d.map(b => ({
      ...b, fading: false,
      shown: b.chunks ? b.chunks.length : b.shown,
      fix: b.fix?.applied ? b.fix : undefined,
    })));
    setCount(applied.current);
    setPhase(applied.current > 0 ? "review" : "stopped");
    void parkAgent();
  }, [agentC, parkAgent]);

  // ---- Lifecycle ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    const id = autoPlay ? requestAnimationFrame(start) : 0;
    return () => { cancelAnimationFrame(id); ctrl.current?.abort(); };
  }, [autoPlay, start]);

  // A new document from the parent replaces the doc whenever no run is using it. Compared by content, so inline arrays are fine.
  const blocksKey = blocks.map(b => `${b.id}\u0000${b.type}\u0000${b.text}`).join("\u0001");
  const firstKey = useRef(blocksKey);
  useEffect(() => {
    if (firstKey.current === blocksKey) return;
    firstKey.current = blocksKey;
    if (phaseRef.current === "thinking" || phaseRef.current === "editing" || phaseRef.current === "review") return;
    setDoc(toLive(props.current.blocks));
  }, [blocksKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (entry.isIntersecting) { visibleWaiters.current.forEach(fn => fn()); visibleWaiters.current.clear(); }
    }, { threshold: 0.1 });
    io.observe(root);
    return () => { io.disconnect(); window.clearTimeout(awayTimer.current); };
  }, []);

  // Place both cursors once the doc has laid out, and keep resting cursors on their anchors when the card resizes.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const place = () => {
      const park = parkPoint(), home = homePoint();
      if (park && agentParked.current && !agentC.stop) { agentC.x.set(park.x); agentC.y.set(park.y); setFlip(f => ({ ...f, agent: park.x > root.clientWidth - TAG_ROOM })); }
      if (home && !humanBusy.current) { humanC.stop?.(); humanC.x.set(home.x); humanC.y.set(home.y); setFlip(f => ({ ...f, human: home.x > root.clientWidth - TAG_ROOM })); }
      setSelection(null);
    };
    place();
    setReady(true);
    let width = root.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(root.clientWidth - width) > 1) { width = root.clientWidth; place(); } });
    ro.observe(root);
    return () => ro.disconnect();
  }, [agentC, humanC, parkPoint, homePoint]);

  // The collaborator reads along: small, slow drifts around their spot.
  useEffect(() => {
    if (!collaborator || reduced) return;
    let id = 0;
    const tick = () => {
      id = window.setTimeout(() => {
        const home = homePoint();
        if (home && visible.current && !humanBusy.current) void glide("human", { x: home.x + (Math.random() - 0.5) * 40, y: home.y + (Math.random() - 0.5) * 10 }, { ms: 720 });
        tick();
      }, 1700 + Math.random() * 900);
    };
    tick();
    return () => window.clearTimeout(id);
  }, [collaborator, reduced, glide, homePoint]);

  // ---- Render -------------------------------------------------------------------------------------------------------
  const working = phase === "thinking" || phase === "editing";
  const label = statusText(phase, agent.name, activity, count, error);
  const statusIcon = phase === "accepted" ? <Check className={styles.success} />
    : phase === "reverted" ? <Undo2 />
    : phase === "stopped" ? <Square />
    : phase === "empty" ? <Check />
    : phase === "error" ? <CircleAlert className={styles.danger} />
    : phase === "review" ? <Pencil />
    : null;
  const simulatedNote = (simulated ?? isSample) && (phase === "review" || phase === "accepted" || phase === "reverted" || phase === "error") ? " Simulated, nothing was saved." : "";
  const action = working ? { label: "Stop", icon: <Square />, onClick: stop }
    : phase === "error" ? { label: "Retry", icon: <RotateCcw />, onClick: start }
    : phase === "idle" ? { label: `Ask ${agent.name}`, icon: <Sparkles />, onClick: start }
    : phase === "review" ? null
    : { label: "Run again", icon: <RotateCcw />, onClick: start };
  const mark = agent.mark ?? <ClaudeMark aria-hidden="true" />;

  const bindText = (id: string) => (el: HTMLElement | null) => { if (el) textEls.current.set(id, el); else textEls.current.delete(id); };
  const bindFix = (id: string) => (el: HTMLElement | null) => { if (el) fixEls.current.set(id, el); else fixEls.current.delete(id); };

  return (
    <div
      ref={rootRef}
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={{ "--agent": agentColor, "--human": collaborator?.color ?? "var(--series-2)" } as CSSProperties}
      onPointerEnter={() => { engaged.current.hover = true; }}
      onPointerLeave={() => { engaged.current.hover = false; }}
      onFocus={() => { engaged.current.focus = true; }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) engaged.current.focus = false; }}
    >
      <div className={styles.header}>
        <div className={styles.stack}>
          <span ref={agentAvatarRef} className={styles.agentAvatar} data-working={working} role="img" aria-label={agent.name}>{mark}</span>
          {collaborator ? <Avatar className={styles.stackAvatar} name={collaborator.name} src={collaborator.avatar} size="sm" /> : null}
        </div>
        <div className={styles.status} aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${phase}:${label}`}
              className={styles.statusInner}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.16, ease: enterEase } }}
              exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}
            >
              {statusIcon ? <span className={styles.statusIcon}>{statusIcon}</span> : null}
              <span className={styles.statusLabel}>{working ? <TextShimmer>{label}</TextShimmer> : label}</span>
            </motion.span>
          </AnimatePresence>
        </div>
        <span className={styles.srOnly} role="status" aria-live="polite">{`${label}.${simulatedNote}`}</span>
        <div className={styles.action}>
          <AnimatePresence initial={false}>
            {action ? (
              <motion.span key="action" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.14 }}>
                <Button variant="ghost" size="sm" onClick={action.onClick}>
                  <span className={styles.buttonInner}>{action.icon}{action.label}</span>
                </Button>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className={styles.selectionLayer} aria-hidden="true">
        <AnimatePresence>
          {selection ? (
            <motion.div key={selection.key} exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.12 } }}>
              {selection.boxes.map((box, i) => {
                const per = selection.ms / selection.boxes.length / 1000;
                return (
                  <motion.span
                    key={i}
                    className={styles.selection}
                    style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                    initial={{ scaleX: reduced ? 1 : 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: reduced ? 0 : per, delay: reduced ? 0 : i * per, ease: "linear" }}
                  />
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <article className={styles.doc} data-fading={fading} aria-label={doc[0]?.text ?? "Document"} aria-busy={working}>
        <AnimatePresence initial={false}>
          {doc.map((block, index) => (
            <motion.div
              key={block.id}
              className={styles.block}
              data-type={block.type}
              exit={{ height: 0, opacity: 0, transition: resetting || reduced ? { duration: 0 } : { opacity: { duration: 0.1 }, height: motionTokens.spring.snappy } }}
            >
              <Fit enter={block.inserted} instant={resetting || reduced}>
                <div className={styles.pad}>
                  <BlockText block={block} reduced={reduced} textRef={bindText(block.id)} fixRef={bindFix(block.id)} />
                </div>
                {index === 0 && metaLine ? <div className={styles.meta}>{metaLine}</div> : null}
              </Fit>
            </motion.div>
          ))}
        </AnimatePresence>
      </article>

      <div className={styles.barWrap}>
        <AnimatePresence>
          {phase === "review" ? (
            <motion.div
              className={styles.bar}
              role="group"
              aria-label="Review edits"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: reduced ? 0 : 0.2, ease: enterEase }}
            >
              <span className={styles.barLabel}>
                <span className={styles.barMark}>{mark}</span>
                <span className={styles.barCount}>{count} {count === 1 ? "edit" : "edits"}<span className={styles.barBy}> by {agent.name}</span></span>
              </span>
              <Button variant="ghost" size="sm" onClick={undo}><span className={styles.buttonInner}><Undo2 />Undo</span></Button>
              <Button ref={acceptRef} variant="primary" size="sm" onClick={accept}><span className={styles.buttonInner}><Check />Accept changes</span></Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className={styles.cursorLayer} aria-hidden="true">
        {collaborator ? (
          <Cursor x={humanC.x} y={humanC.y} color="var(--human)" flip={flip.human} ready={ready} pressed={pressed} reduced={reduced}>
            {collaborator.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.tagAvatar} src={collaborator.avatar} alt="" width={16} height={16} />
            ) : null}
            {firstName}
          </Cursor>
        ) : null}
        <Cursor x={agentC.x} y={agentC.y} color="var(--agent)" flip={flip.agent} ready={ready && !agentAway} reduced={reduced} agent>
          <span className={styles.tagMark}>{mark}</span>
          {agent.name}
        </Cursor>
      </div>
    </div>
  );
}

function Cursor({ x, y, color, flip, ready, pressed = false, reduced, agent = false, children }: {
  x: MotionValue<number>; y: MotionValue<number>; color: string; flip: boolean; ready: boolean; pressed?: boolean; reduced: boolean; agent?: boolean; children: ReactNode;
}) {
  return (
    <motion.div className={styles.cursor} data-ready={ready} data-agent={agent} style={{ x, y, ...({ "--c": color } as MotionStyle) }}>
      <motion.svg className={styles.arrow} viewBox="0 0 20 20" animate={{ scale: pressed ? 0.84 : 1 }} transition={reduced ? { duration: 0 } : { duration: 0.12, ease: "easeOut" }}>
        <path d="M4.4 2.9 16.6 9.1c.8.4.7 1.5-.2 1.7l-5 1.2a1.1 1.1 0 0 0-.8.6l-2.2 4.7c-.4.8-1.6.7-1.8-.2L2.8 4.2c-.2-.9.8-1.7 1.6-1.3Z" />
      </motion.svg>
      <span className={styles.tag} data-flip={flip}>{children}</span>
    </motion.div>
  );
}

/** Animates its own height to follow the measured content, with no bounce. `enter` grows from zero. */
function Fit({ children, enter = false, instant = false }: { children: ReactNode; enter?: boolean; instant?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const instantRef = useRef(instant);
  useLayoutEffect(() => { instantRef.current = instant; });
  useLayoutEffect(() => {
    const box = outer.current, el = inner.current;
    if (!box || !el || typeof ResizeObserver === "undefined") return;
    let last: number | null = enter ? 0 : null;
    let controls: ReturnType<typeof animate> | undefined;
    const apply = () => {
      const next = el.getBoundingClientRect().height;
      if (last === null) { last = next; return; }
      if (Math.abs(next - last) < 0.5) return;
      const from = box.getBoundingClientRect().height;
      last = next;
      controls?.stop();
      if (instantRef.current) { box.style.height = "auto"; return; }
      controls = animate(box, { height: [from, next] }, { ...motionTokens.spring.snappy, visualDuration: 0.24 });
      void controls.then(() => { if (last === next) box.style.height = "auto"; });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => { ro.disconnect(); controls?.stop(); };
  }, [enter]);
  return <div ref={outer} className={styles.fit} style={enter ? { height: 0 } : undefined}><div ref={inner}>{children}</div></div>;
}

function BlockText({ block, reduced, textRef, fixRef }: { block: LiveBlock; reduced: boolean; textRef: (el: HTMLElement | null) => void; fixRef: (el: HTMLElement | null) => void }) {
  const Tag = block.type === "title" ? "h3" : block.type === "heading" ? "h4" : "p";
  let content: ReactNode;
  if (block.chunks) {
    const shown = block.shown ?? block.chunks.length;
    const streaming = shown < block.chunks.length;
    content = block.chunks.map((part, i) => (
      <Fragment key={i}>
        {streaming && i === shown ? <span className={styles.caretSlot}><span className={styles.caret} /></span> : null}
        <span className={styles.chunk} data-shown={i < shown} data-pending={!!block.pending}>{part}</span>
      </Fragment>
    ));
  } else if (block.fix) {
    const { start, from, to, applied } = block.fix;
    const word = applied ? to : from;
    content = (
      <>
        {block.text.slice(0, start)}
        <span ref={fixRef} className={styles.swap}>
          <AnimatePresence initial={false}>
            <motion.span
              key={word}
              className={applied ? styles.tint : styles.typo}
              data-pending={applied && !!block.pending}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: reduced ? 0 : 0.16, delay: reduced ? 0 : 0.05 } }}
              exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}
            >
              {word}
            </motion.span>
          </AnimatePresence>
        </span>
        {block.text.slice(start + word.length)}
      </>
    );
  } else {
    content = (
      <motion.span
        key={block.fresh ?? 0}
        className={styles.tint}
        data-pending={!!block.pending}
        initial={block.inserted || block.fresh ? { opacity: 0 } : false}
        animate={{ opacity: 1, transition: { duration: reduced ? 0 : 0.16, delay: block.inserted && !reduced ? 0.1 : 0 } }}
      >
        {block.text}
      </motion.span>
    );
  }
  return <Tag ref={textRef} className={styles[block.type]} data-fading={!!block.fading}>{content}</Tag>;
}

export default AgentCursor;
