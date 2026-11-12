// On-page agency for the assistant: find a region of the app by heading, text, section name or
// data attribute; scroll to it, outline it with a callout, read it, or press a safe in-app control.
// Read-mostly by design: clicks are limited to tabs, toggles, segmented controls and elements that
// opt in with data-agent-click, and never submit forms, follow external links or confirm anything.

import { avoidance, freeRegion, panelSideAwayFrom, placeLabel, scrollOffset, type Rect, type Viewport } from "@/lib/research/panel-geometry";
import { canvas } from "@/lib/research/views";

export type LocateKind = "auto" | "heading" | "text" | "section" | "selector";

export interface Located {
  el: HTMLElement;
  how: string;
  label: string;
  score: number;
}

const IGNORE = "[data-agent-ignore], [aria-label='AI assistant'], script, style, noscript, template";

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}$%.' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 0..100 similarity of a candidate label to the query. */
export function matchScore(label: string, query: string) {
  const a = norm(label);
  const q = norm(query);
  if (!a || !q) return 0;
  if (a === q) return 100;
  if (a.startsWith(q)) return 85 - Math.min(15, (a.length - q.length) / 4);
  if (a.includes(q)) return 70 - Math.min(20, (a.length - q.length) / 6);
  const qt = q.split(" ").filter((t) => t.length > 1);
  const at = new Set(a.split(" "));
  if (!qt.length) return 0;
  const hit = qt.filter((t) => at.has(t) || [...at].some((w) => w.startsWith(t))).length;
  const r = hit / qt.length;
  return r >= 0.5 ? Math.round(r * 55) : 0;
}

function ignored(el: Element) {
  return !!el.closest(IGNORE);
}

function visible(el: HTMLElement) {
  if (typeof window === "undefined") return true;
  const st = window.getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden") return false;
  return !el.closest("[hidden],[aria-hidden='true'],[inert]");
}

function labelOf(el: HTMLElement) {
  return (
    el.getAttribute("data-section") ||
    el.getAttribute("aria-label") ||
    (el.matches("h1,h2,h3,h4,h5,h6,[role=heading],[role=tab],button,th,legend,label,dt,summary,figcaption,caption") ? el.textContent : "") ||
    el.id.replace(/[-_]+/g, " ") ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

const CANDIDATES = "[data-section],h1,h2,h3,h4,h5,h6,[role=heading],[role=tab],[aria-label],summary,figcaption,caption,legend,th,dt,[id]";

/** Root the agent works in: the app's main content. */
export function agentRoot(doc: Document = document): HTMLElement {
  return (doc.querySelector("main") as HTMLElement | null) ?? doc.body;
}

export function locate(target: string, kind: LocateKind = "auto", root: HTMLElement = agentRoot()): Located | null {
  const t = target.trim();
  if (!t) return null;
  if (kind === "selector" || (kind === "auto" && /^(#[\w-]+|\[data-[\w-]+(=["']?[^\]]+["']?)?\])$/.test(t))) {
    const sel = /^data-[\w-]+=/.test(t) ? `[${t}]` : t;
    try {
      const el = root.querySelector<HTMLElement>(sel);
      if (el && !ignored(el)) return { el, how: "selector", label: labelOf(el) || sel, score: 100 };
    } catch {
      /* invalid selector */
    }
    if (kind === "selector") return null;
  }
  let best: Located | null = null;
  if (kind !== "text") {
    const nodes = root.querySelectorAll<HTMLElement>(kind === "section" ? "[data-section],section[aria-label],[id]" : kind === "heading" ? "h1,h2,h3,h4,h5,h6,[role=heading],[data-section]" : CANDIDATES);
    for (const el of nodes) {
      if (ignored(el)) continue;
      const label = labelOf(el);
      if (!label || label.length > 160) continue;
      let s = matchScore(label, t);
      if (!s) continue;
      if (el.hasAttribute("data-section")) s += 8;
      else if (/^H[1-4]$/.test(el.tagName)) s += 6;
      if (!visible(el)) continue;
      if (!best || s > best.score) best = { el, how: el.hasAttribute("data-section") ? "section" : /^H\d$/.test(el.tagName) ? "heading" : "label", label, score: s };
    }
    if (best && best.score >= 45) return best;
  }
  if (kind === "heading" || kind === "section") return best && best.score >= 30 ? best : null;
  // Text search: the tightest element containing the phrase. A text node that holds the phrase itself wins
  // outright; otherwise the parent with the least text does, so a wrapper with stray text of its own
  // (whitespace, a label) never beats the cell or line the phrase is actually in.
  const q = norm(t);
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let hit: HTMLElement | null = null;
  let hitSize = Infinity;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || ignored(parent)) continue;
    if (norm(node.textContent ?? "").includes(q)) {
      hit = parent;
      break;
    }
    const size = (parent.textContent ?? "").length;
    if (size < hitSize && norm(parent.textContent ?? "").includes(q)) {
      hit = parent;
      hitSize = size;
    }
  }
  if (hit) {
    const block = (hit.closest("tr,li,p,td,dd,div,section,article") as HTMLElement | null) ?? hit;
    return { el: block, how: "text", label: (block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80), score: 60 };
  }
  return best && best.score >= 30 ? best : null;
}

/** The region a heading or label introduces: its card/section, else the heading's parent. */
export function regionOf(el: HTMLElement): HTMLElement {
  if (el.matches("[data-section],section,article,table,figure,form,li,tr")) return el;
  const box = el.closest<HTMLElement>("[data-section],section,article,[data-slot=card],figure");
  if (box && box !== agentRoot(el.ownerDocument)) return box;
  return (el.parentElement as HTMLElement | null) ?? el;
}

/** Candidate labels on the page (for "not found" errors and get_page_context). */
export function outline(root: HTMLElement = agentRoot(), max = 40) {
  const out: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-section],h1,h2,h3,[role=tab]")) {
    if (ignored(el) || !visible(el)) continue;
    const l = labelOf(el);
    if (l && l.length <= 80 && !out.includes(l)) out.push(el.getAttribute("role") === "tab" ? `tab: ${l}` : l);
    if (out.length >= max) break;
  }
  return out;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ── Panel awareness: never scroll a target, or place a callout, under the assistant's own panel. ──

const toRect = (r: DOMRect | { left: number; top: number; right: number; bottom: number }): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** The assistant panel's on-screen box and mode, or null when it is closed/hidden. */
export function panelInfo(doc: Document = document): { rect: Rect; docked: boolean; wide: boolean } | null {
  const el = doc.querySelector<HTMLElement>("aside[aria-label='AI assistant']");
  if (!el || el.getAttribute("aria-hidden") === "true") return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return { rect: toRect(r), docked: el.dataset.docked === "1", wide: el.dataset.wide === "1" };
}

const viewport = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight });
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scroll so the element sits in the part of the screen the panel doesn't cover. If the panel covers it
 * horizontally: collapse an expanded canvas, or move a floating panel to the other side. Returns what
 * was done (for the agent's narration), or null.
 */
export async function bringIntoView(el: HTMLElement): Promise<string | null> {
  const behavior: ScrollBehavior = reduced() ? "auto" : "smooth";
  // Nested scroll containers first (tables, panels), then the page with the panel offset.
  el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "auto" });
  let action: string | null = null;
  let panel = panelInfo(el.ownerDocument);
  let free = freeRegion(viewport(), panel?.rect ?? null);
  const what = avoidance(toRect(el.getBoundingClientRect()), free, panel);
  if (what === "collapse-canvas") {
    canvas.hide();
    action = "collapsed the canvas so the page is visible";
    await settle(340);
  } else if (what === "move-panel") {
    const side = panelSideAwayFrom(toRect(el.getBoundingClientRect()), viewport());
    window.dispatchEvent(new CustomEvent("fu:assistant-avoid", { detail: { side } }));
    action = `moved the assistant to the ${side}`;
    await settle(260);
  }
  panel = panelInfo(el.ownerDocument);
  free = freeRegion(viewport(), panel?.rect ?? null);
  const dy = scrollOffset(toRect(el.getBoundingClientRect()), free);
  if (Math.abs(dy) > 2) window.scrollBy?.({ top: dy, behavior });
  return action;
}

/** Back-compat: synchronous centre scroll (used where panel awareness doesn't matter). */
export function scrollToEl(el: HTMLElement) {
  void bringIntoView(el);
}

export function readRegion(el: HTMLElement, max = 6000) {
  const r = regionOf(el);
  return ((r.innerText ?? r.textContent ?? "") as string).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, max);
}

// ── Highlights: fixed-position outlines with a callout, following the element on scroll. ──

interface Mark {
  id: number;
  el: HTMLElement;
  box: HTMLDivElement;
  tag: HTMLSpanElement;
  /** null for a numbered stop, which stays until it is cleared. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Stop number in the current walkthrough. */
  n?: number;
}
/** Numbered stops kept on screen at once; older ones drop off so a long walkthrough doesn't bury the page. */
const MAX_STOPS = 12;
const marks = new Map<number, Mark>();
let nextMark = 1;
let raf = 0;

function layer(doc: Document) {
  let l = doc.getElementById("agent-highlights") as HTMLDivElement | null;
  if (!l) {
    l = doc.createElement("div");
    l.id = "agent-highlights";
    l.setAttribute("data-agent-ignore", "");
    l.setAttribute("aria-hidden", "true");
    l.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:45";
    doc.body.appendChild(l);
  }
  return l;
}

function place() {
  raf = 0;
  if (!marks.size) return;
  const vp = viewport();
  const panel = panelInfo();
  const free = freeRegion(vp, panel?.rect ?? null);
  for (const m of marks.values()) {
    const r = m.el.getBoundingClientRect();
    Object.assign(m.box.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    const lw = m.tag.offsetWidth || Math.min(360, 8 * (m.tag.textContent?.length ?? 10) + 16);
    const lh = m.tag.offsetHeight || 22;
    const p = placeLabel(toRect({ left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 4 }), free, { w: lw, h: lh }, vp);
    Object.assign(m.tag.style, { left: `${p.left}px`, top: `${p.top}px` });
    m.tag.dataset.side = p.side;
  }
}
function schedule() {
  if (!raf && typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(place);
}
let listening = false;
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  // The panel moving or the canvas opening changes the free region.
  canvas.subscribe(schedule);
}

/**
 * Outline an element with a callout. With `ms` of 0 the mark stays until cleared; `n` numbers it as a
 * walkthrough stop (showing a stop again replaces its earlier mark) and `pulse` draws the eye on replay.
 */
export function highlight(el: HTMLElement, label: string, ms = 9000, opts: { n?: number; pulse?: boolean } = {}) {
  const doc = el.ownerDocument;
  if (opts.n != null) for (const m of [...marks.values()]) if (m.n === opts.n) clearHighlight(m.id);
  const box = doc.createElement("div");
  box.className = opts.pulse ? "agent-mark agent-mark-pulse" : "agent-mark";
  const tag = doc.createElement("span");
  tag.className = "agent-mark-label";
  if (opts.n != null) {
    const badge = doc.createElement("b");
    badge.className = "agent-mark-n";
    badge.textContent = String(opts.n);
    tag.appendChild(badge);
  }
  tag.appendChild(doc.createTextNode(label.slice(0, 120)));
  const l = layer(doc);
  l.appendChild(box);
  l.appendChild(tag);
  const id = nextMark++;
  const timer = ms > 0 ? setTimeout(() => clearHighlight(id), ms) : null;
  marks.set(id, { id, el, box, tag, timer, n: opts.n });
  const kept = [...marks.values()].filter((m) => m.timer === null);
  for (const m of kept.slice(0, Math.max(0, kept.length - MAX_STOPS))) clearHighlight(m.id);
  listen();
  place();
  // Keep following while smooth scrolling settles.
  for (const t of [120, 260, 450, 700]) setTimeout(schedule, t);
  return id;
}

export function clearHighlight(id: number) {
  const m = marks.get(id);
  if (!m) return;
  if (m.timer) clearTimeout(m.timer);
  m.box.classList.add("agent-mark-out");
  m.tag.classList.add("agent-mark-out");
  setTimeout(() => {
    m.box.remove();
    m.tag.remove();
  }, 250);
  marks.delete(id);
}

export function clearHighlights() {
  for (const id of [...marks.keys()]) clearHighlight(id);
}

export const activeHighlights = () => marks.size;

// ── Walkthrough stops: numbered highlights that persist, are cited from the answer, and can be shown again. ──

export interface Pin {
  /** Stop number within one assistant turn, from 1. */
  n: number;
  target: string;
  kind: LocateKind;
  /** Section the target sits in, when the same text appears more than once on the page. */
  near?: string;
  label: string;
  /** Path and query of the page the stop is on. */
  path: string;
}

let pinSeq = 0;

/** Start a new assistant turn: numbering restarts and the previous turn's marks come off the page. */
export function beginTour() {
  pinSeq = 0;
  clearHighlights();
}
export const nextPin = () => ++pinSeq;
export const pagePath = () => `${window.location.pathname}${window.location.search}`;

/** locate(), searching inside the section named by `near` first. */
export function locateNear(target: string, kind: LocateKind = "auto", near?: string): Located | null {
  if (near?.trim()) {
    const scope = locate(near, "auto");
    if (scope) {
      const hit = locate(target, kind, regionOf(scope.el));
      if (hit) return hit;
    }
  }
  return locate(target, kind);
}

/** How many places on the page show this text (capped at 20), to warn about ambiguous targets. */
export function countText(target: string, root: HTMLElement = agentRoot()) {
  const q = norm(target);
  if (!q) return 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let count = 0;
  while ((node = walker.nextNode()) && count < 20) {
    const parent = node.parentElement;
    if (!parent || ignored(parent) || !visible(parent)) continue;
    if (norm(node.textContent ?? "").includes(q)) count++;
  }
  return count;
}

/** Show a stop again: go to its page if needed, scroll it clear of the panel and re-mark it. */
export async function showPin(pin: Pin, navigate?: (href: string) => void): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (pagePath() !== pin.path) {
    if (!navigate) return { ok: false, reason: "That stop is on another page" };
    navigate(pin.path);
    for (let i = 0; i < 16 && pagePath() !== pin.path; i++) await settle(250);
    if (pagePath() !== pin.path) return { ok: false, reason: "Couldn't open the page that stop is on" };
  }
  let hit: Located | null = null;
  for (let i = 0; i < 16; i++) {
    hit = locateNear(pin.target, pin.kind, pin.near);
    if (hit) break;
    await settle(250);
  }
  if (!hit) return { ok: false, reason: "That part of the page isn't showing any more. A tab or range may have changed." };
  await bringIntoView(hit.el);
  highlight(hit.how === "text" ? hit.el : regionOf(hit.el), pin.label, 0, { n: pin.n, pulse: true });
  return { ok: true };
}

// ── Safe clicks ──

const DESTRUCTIVE = /\b(delete|remove|discard|erase|clear all|reset|sign ?out|log ?out|unsubscribe|cancel (plan|subscription)|pay|purchase|buy|checkout|submit|send|publish|share|invite|transfer|confirm)\b/i;

/** Why a click is refused, or null when the element is a safe in-app control. */
export function clickRefusal(el: HTMLElement): string | null {
  const control = el.closest<HTMLElement>("button,[role=tab],[role=radio],[role=switch],[role=checkbox],[role=menuitemradio],[role=option],a,[data-agent-click],summary") ?? el;
  if (ignored(control)) return "that control belongs to the assistant itself";
  const text = `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`.trim();
  if (control.closest("form") && (control.matches("[type=submit]") || (control.tagName === "BUTTON" && !control.getAttribute("type")))) return "it would submit a form";
  if (control.matches("input,textarea,select,[contenteditable=true]")) return "typing into fields is not allowed";
  if (DESTRUCTIVE.test(text)) return `"${text.slice(0, 40)}" looks like an action with side effects`;
  if (control.tagName === "A") {
    const href = control.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//") || control.getAttribute("target") === "_blank") return "it leaves the app";
    return null;
  }
  if (control.matches("[data-agent-click],[role=tab],[role=radio],[role=switch],[role=checkbox],[role=menuitemradio],[role=option],summary,[aria-pressed],[aria-expanded]")) return null;
  if (control.tagName === "BUTTON" && control.closest("[role=tablist],[role=radiogroup],[role=toolbar],[role=group],[data-agent-controls]")) return null;
  return "only tabs, toggles, segmented controls and in-app links can be pressed";
}

export function safeClick(el: HTMLElement): { ok: true; label: string } | { ok: false; reason: string } {
  const why = clickRefusal(el);
  if (why) return { ok: false, reason: why };
  const control = el.closest<HTMLElement>("button,[role=tab],[role=radio],[role=switch],[role=checkbox],[role=menuitemradio],[role=option],a,[data-agent-click],summary") ?? el;
  control.click();
  return { ok: true, label: (control.getAttribute("aria-label") ?? control.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) };
}
