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
    if (card && m.n === currentN) {
      const cw = card.offsetWidth || 300;
      const ch = card.offsetHeight || 150;
      const c = placeLabel(toRect({ left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 4 }), free, { w: cw, h: ch }, vp, 12);
      Object.assign(card.style, { left: `${c.left}px`, top: `${c.top}px` });
    }
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
  const text = doc.createElement("span");
  text.className = "agent-mark-text";
  text.textContent = label.slice(0, 120);
  tag.appendChild(text);
  if (opts.n != null && currentN != null) tag.dataset.state = opts.n === currentN ? "current" : "min";
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
  card?.remove();
  card = null;
  if (currentN != null) {
    currentN = null;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fu:tour-current", { detail: { n: null } }));
  }
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
  /** One or two sentences on what this part of the page is and why it matters, shown beside the stop. */
  explain?: string;
  /** A tab or toggle that has to be pressed for the target to be on screen. */
  click?: string;
  /** Path and query of the page the stop is on. */
  path: string;
}

let pinSeq = 0;
/** The stops of the walkthrough on screen, and which one the reader is on. */
let tour: Pin[] = [];
let currentN: number | null = null;
let card: HTMLDivElement | null = null;
/** While a guide is still adding stops: how many it means to make, so the card can say "2 of 5" before all exist. */
let planned = 0;

/** Start a new assistant turn: numbering restarts and the previous turn's marks come off the page. */
export function beginTour() {
  pinSeq = 0;
  tour = [];
  planned = 0;
  setCurrentStop(null);
  clearHighlights();
}

export const tourStops = () => tour;
export const currentStop = () => currentN;

/**
 * Make stop `n` the one being read. It gets a card beside it on the page (its takeaway, the explanation,
 * where it sits in the sequence, back and next); the other stops shrink to their number so the page stays
 * readable. null puts every stop back to its plain label.
 */
export function setCurrentStop(n: number | null) {
  currentN = n != null && tour.some((p) => p.n === n) ? n : null;
  for (const m of marks.values()) {
    if (m.n == null) continue;
    if (currentN == null) delete m.tag.dataset.state;
    else m.tag.dataset.state = m.n === currentN ? "current" : "min";
  }
  card?.remove();
  card = null;
  const pin = tour.find((p) => p.n === currentN);
  if (pin && typeof document !== "undefined") {
    const doc = document;
    const idx = tour.indexOf(pin);
    const el = (tag: string, cls: string, text?: string) => {
      const e = doc.createElement(tag);
      e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    card = el("div", "agent-tour") as HTMLDivElement;
    card.setAttribute("role", "dialog");
    const total = Math.max(planned, tour.length);
    card.setAttribute("aria-label", `Stop ${idx + 1} of ${total}: ${pin.label}`);
    const head = el("div", "agent-tour-head");
    head.append(el("span", "agent-pin-ref", String(pin.n)), el("span", "agent-tour-count", `Stop ${idx + 1} of ${total}`));
    const close = el("button", "agent-tour-x", "×") as HTMLButtonElement;
    close.type = "button";
    close.setAttribute("aria-label", "Close this stop");
    close.addEventListener("click", () => setCurrentStop(null));
    head.append(close);
    card.append(head, el("p", "agent-tour-title", pin.label));
    if (pin.explain) card.append(el("p", "agent-tour-text", pin.explain));
    // Back and Next appear once the guide has finished placing its stops.
    if (tour.length > 1 && !planned) {
      const foot = el("div", "agent-tour-foot");
      const go = (label: string, to: Pin | undefined, primary: boolean) => {
        const b = el("button", primary ? "agent-tour-btn agent-tour-next" : "agent-tour-btn", label) as HTMLButtonElement;
        b.type = "button";
        b.disabled = !to;
        b.addEventListener("click", () => to && window.dispatchEvent(new CustomEvent("fu:tour-step", { detail: { n: to.n } })));
        return b;
      };
      const last = idx === tour.length - 1;
      const next = go(last ? "Done" : "Next", tour[idx + 1], true);
      if (last) {
        next.disabled = false;
        next.addEventListener("click", () => setCurrentStop(null));
      }
      foot.append(go("Back", tour[idx - 1], false), next);
      card.append(foot);
    }
    layer(doc).appendChild(card);
    schedule();
    for (const t of [120, 260, 450, 700]) setTimeout(schedule, t);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fu:tour-current", { detail: { n: currentN } }));
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
    // The stop sat behind a tab or toggle: press it again once the page has had a moment to draw.
    if (pin.click && i === 2) {
      const control = locate(pin.click, "auto");
      if (control) safeClick(control.el);
    }
    await settle(250);
  }
  if (!hit) return { ok: false, reason: "That part of the page isn't showing any more. A tab or range may have changed." };
  await bringIntoView(hit.el);
  highlight(hit.how === "text" ? hit.el : regionOf(hit.el), pin.label, 0, { n: pin.n, pulse: true });
  if (!tour.some((p) => p.n === pin.n)) tour = [...tour, pin].sort((a, b) => a.n - b.n);
  setCurrentStop(pin.n);
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

// ── Guided walkthrough: several stops played in order, one at a time. ──

export interface StopSpec {
  target: string;
  kind?: LocateKind;
  near?: string;
  /** Safe control (tab, range toggle) to press before looking for the target. */
  click?: string;
  label: string;
  explain?: string;
}

/**
 * Play stops in order: press the stop's control if it names one, scroll the target clear of the panel,
 * mark and number it, then dwell so the user can follow before the next one. A stop that can't be found
 * is reported and skipped; the rest still play.
 */
export async function playStops(
  stops: StopSpec[],
  dwellMs = 1100,
  /** Called once a stop is on screen, e.g. to read it aloud. The walkthrough waits for it before moving on. */
  onStop?: (pin: Pin) => Promise<void> | void,
): Promise<{ pins: Pin[]; missed: string[]; notes: string[] }> {
  const pins: Pin[] = [];
  const missed: string[] = [];
  const notes: string[] = [];
  planned = tour.length + stops.length;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const kind = s.kind ?? "auto";
    const near = s.near?.trim() || undefined;
    let click: string | undefined;
    if (s.click?.trim()) {
      const control = locate(s.click, "auto");
      const pressed = control ? safeClick(control.el) : null;
      if (pressed?.ok) {
        click = s.click.trim();
        await settle(350);
      } else {
        notes.push(`"${s.click}" was not pressed (${!control ? "no such control" : pressed && !pressed.ok ? pressed.reason : "unknown"})`);
      }
    }
    const hit = locateNear(s.target, kind, near);
    if (!hit) {
      missed.push(s.target);
      planned = Math.max(tour.length, planned - 1);
      continue;
    }
    const moved = await bringIntoView(hit.el);
    if (moved && !notes.includes(moved)) notes.push(moved);
    const n = nextPin();
    highlight(hit.how === "text" ? hit.el : regionOf(hit.el), s.label, 0, { n, pulse: true });
    const pin: Pin = { n, target: s.target, kind, near, label: s.label, explain: s.explain?.trim() || undefined, click, path: pagePath() };
    pins.push(pin);
    tour = [...tour.filter((p) => p.n !== n), pin].sort((a, b) => a.n - b.n);
    setCurrentStop(n);
    if (onStop) await onStop(pin);
    else if (i < stops.length - 1 && dwellMs > 0) await settle(dwellMs);
  }
  planned = 0;
  if (pins.length) setCurrentStop(pins[pins.length - 1].n);
  return { pins, missed, notes };
}

/**
 * What is on the page, component by component: each section with what it holds (table, chart, controls and
 * which are on), whether it is on screen, and the start of its text. Gives the agent the page's structure,
 * not only its words.
 */
export function pageMap(root: HTMLElement = agentRoot(), max = 24): string[] {
  const out: string[] = [];
  const seen = new Set<HTMLElement>();
  const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
  for (const el of root.querySelectorAll<HTMLElement>("[data-section],h1,h2,h3")) {
    if (ignored(el) || !visible(el)) continue;
    const label = labelOf(el);
    if (!label || label.length > 80) continue;
    const region = regionOf(el);
    if (seen.has(region)) continue;
    seen.add(region);
    // A heading whose "region" wraps several other sections is a page title, not a component.
    if (region.querySelectorAll("[data-section],h2,h3").length > 2 && !region.hasAttribute("data-section")) {
      out.push(`- ${label} [page heading]`);
    } else {
      const holds: string[] = [];
      const table = region.querySelector("table");
      if (table) holds.push(`table, ${table.querySelectorAll("tr").length} rows`);
      if (region.querySelector(".recharts-wrapper, svg.recharts-surface, canvas, figure svg, [data-chart]")) holds.push("chart");
      const controls = [...region.querySelectorAll<HTMLElement>("[role=tab],[role=radio],[role=switch],[aria-pressed]")]
        .filter((c) => !ignored(c))
        .slice(0, 8)
        .map((c) => {
          const l = (c.getAttribute("aria-label") || c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
          const on = ["aria-selected", "aria-checked", "aria-pressed"].some((a) => c.getAttribute(a) === "true");
          return l ? (on ? `${l} (on)` : l) : "";
        })
        .filter(Boolean);
      if (controls.length) holds.push(`controls: ${controls.join(", ")}`);
      const r = region.getBoundingClientRect();
      const where = r.width === 0 && r.height === 0 ? "" : r.bottom < 0 ? "above the screen" : r.top > vh ? "below the screen" : "on screen";
      const text = ((region.innerText ?? region.textContent ?? "") as string).replace(/\s+/g, " ").trim();
      const preview = (text.startsWith(label) ? text.slice(label.length) : text).trim().slice(0, 140);
      out.push(`- ${label}${holds.length ? ` [${holds.join("; ")}]` : ""}${where ? ` (${where})` : ""}${preview ? `: ${preview}` : ""}`);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Add a stop made by a single highlight call to the walkthrough, so it can be stepped through like the rest. */
export function addTourStop(pin: Pin) {
  tour = [...tour.filter((p) => p.n !== pin.n), pin].sort((a, b) => a.n - b.n);
}

// ── Reading the page like a developer would: search it, pull a table out, inspect one element. ──

const sectionOf = (el: HTMLElement) => {
  const box = el.closest<HTMLElement>("[data-section]") ?? null;
  if (box) return box.getAttribute("data-section") ?? "";
  // Nearest heading above the element inside its card or section.
  const region = el.closest<HTMLElement>("section,article,[data-slot=card],figure") ?? agentRoot(el.ownerDocument);
  const h = region.querySelector<HTMLElement>("h1,h2,h3,[role=heading]");
  return h ? labelOf(h) : "";
};
const onScreen = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
  return r.width === 0 && r.height === 0 ? "" : r.bottom < 0 ? "above the screen" : r.top > vh ? "below the screen" : "on screen";
};

export interface PageMatch {
  text: string;
  section: string;
  tag: string;
  where: string;
}

/**
 * Search the page's text, like grep: a plain phrase (case-insensitive) or a regular expression. Each match
 * comes back with the line it sits in, its section, its element and where it is, ready to pass to highlight.
 */
export function findOnPage(query: string, opts: { regex?: boolean; limit?: number } = {}, root: HTMLElement = agentRoot()): { total: number; matches: PageMatch[] } {
  const limit = Math.max(1, Math.min(40, opts.limit ?? 12));
  let test: (s: string) => boolean;
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch (e) {
      throw new Error(`Not a valid regular expression: ${(e as Error).message}`);
    }
    test = (s) => re.test(s);
  } else {
    const q = norm(query);
    if (!q) return { total: 0, matches: [] };
    test = (s) => norm(s).includes(q);
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<HTMLElement>();
  const matches: PageMatch[] = [];
  let total = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || ignored(parent) || !visible(parent)) continue;
    if (!test(node.textContent ?? "")) continue;
    const line = (parent.closest("tr,li,p,dd,dt,figcaption,h1,h2,h3,h4") as HTMLElement | null) ?? parent;
    if (seen.has(line)) continue;
    seen.add(line);
    total++;
    if (matches.length < limit) matches.push({ text: (line.innerText ?? line.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180), section: sectionOf(line), tag: line.tagName.toLowerCase(), where: onScreen(line) });
  }
  return { total, matches };
}

/** A table on the page as rows of cells (header row first when it has one), for exact figures. */
export function readTable(el: HTMLElement, maxRows = 40): { caption: string; rows: string[][]; total: number } | null {
  const table = el.matches("table") ? el : regionOf(el).querySelector("table");
  if (!table) return null;
  const trs = [...table.querySelectorAll("tr")];
  const rows = trs.slice(0, Math.max(1, Math.min(200, maxRows))).map((tr) => [...tr.querySelectorAll("th,td")].map((c) => ((c as HTMLElement).innerText ?? c.textContent ?? "").replace(/\s+/g, " ").trim()));
  return { caption: (table.querySelector("caption")?.textContent ?? sectionOf(table as HTMLElement)).replace(/\s+/g, " ").trim(), rows, total: trs.length };
}

/** One element in detail: what it is in the markup, the section path down to it, what it holds and where it is. */
export function inspectElement(el: HTMLElement): string {
  const region = regionOf(el);
  const attrs = (e: HTMLElement) =>
    [...e.attributes]
      .filter((a) => /^(id|role|data-(section|slot|state|agent-click|chart)|aria-(label|selected|pressed|expanded|current|checked))$/.test(a.name))
      .map((a) => `${a.name}="${a.value.slice(0, 60)}"`)
      .join(" ");
  const path: string[] = [];
  for (let e: HTMLElement | null = el; e && e !== agentRoot(el.ownerDocument); e = e.parentElement) {
    const l = e.getAttribute("data-section") ?? (e.matches("section,article,[data-slot=card],figure,table") ? labelOf(e) || e.tagName.toLowerCase() : "");
    if (l && path[0] !== l) path.unshift(l);
  }
  const holds: string[] = [];
  const table = region.querySelector("table");
  if (table) holds.push(`table with ${table.querySelectorAll("tr").length} rows`);
  const charts = region.querySelectorAll(".recharts-wrapper, svg.recharts-surface, canvas, figure svg, [data-chart]").length;
  if (charts) holds.push(`${charts} chart${charts === 1 ? "" : "s"}`);
  const controls = [...region.querySelectorAll<HTMLElement>("[role=tab],[role=radio],[role=switch],[aria-pressed],a[href^='/'],button")]
    .filter((c) => !ignored(c) && visible(c))
    .slice(0, 14)
    .map((c) => {
      const l = (c.getAttribute("aria-label") || c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
      const on = ["aria-selected", "aria-checked", "aria-pressed"].some((a) => c.getAttribute(a) === "true");
      const can = clickRefusal(c) == null;
      return l ? `${l}${on ? " (on)" : ""}${can ? "" : " (not pressable)"}` : "";
    })
    .filter(Boolean);
  const r = el.getBoundingClientRect();
  return [
    `Element: <${el.tagName.toLowerCase()}${attrs(el) ? ` ${attrs(el)}` : ""}>`,
    `Component: <${region.tagName.toLowerCase()}${attrs(region) ? ` ${attrs(region)}` : ""}>`,
    `Section path: ${path.join(" › ") || "(top of page)"}`,
    `Position: ${onScreen(el) || "not laid out"}, ${Math.round(r.width)}×${Math.round(r.height)}px`,
    `Holds: ${holds.join("; ") || "text only"}`,
    `Controls: ${controls.join(", ") || "none"}`,
    `Text: ${((region.innerText ?? region.textContent ?? "") as string).replace(/\s+/g, " ").trim().slice(0, 600)}`,
  ].join("\n");
}
