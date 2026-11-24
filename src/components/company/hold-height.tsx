import { Component, useLayoutEffect, useRef, type ReactNode } from "react";
import type { StatementState } from "@/lib/company/currency-view";
import { cn } from "@/lib/utils";

/** True when this commit is the one where the newer filing's figures (or its failure) replace the served ones. */
const swapped = (prev: StatementState, next: StatementState) => prev === "reading" && next !== "reading";

interface HoldProps {
  phase: StatementState;
  children: ReactNode;
  className?: string;
}

/**
 * A panel that depends on the statements keeps the height it had before the read-time extension landed as a
 * minimum for the rest of the visit, so a shorter read (fewer sentences, fewer cards) never pulls the page up.
 * The child fills the held box, so the panel's frame stays where it was. A class component because only
 * `getSnapshotBeforeUpdate` sees the old layout in the same commit as the new content, before it is painted.
 */
export class HoldHeight extends Component<HoldProps> {
  private el: HTMLDivElement | null = null;
  private held = 0;

  override getSnapshotBeforeUpdate(prev: HoldProps): number | null {
    return swapped(prev.phase, this.props.phase) && this.el ? this.el.getBoundingClientRect().height : null;
  }

  override componentDidUpdate(_prev: HoldProps, _state: unknown, before: number | null) {
    if (before == null || !this.el) return;
    this.held = Math.max(this.held, before);
    this.el.style.minHeight = `${this.held}px`;
  }

  override render() {
    return (
      <div ref={(el) => void (this.el = el)} className={cn("flex min-w-0 flex-col *:flex-1", this.props.className)} style={this.held ? { minHeight: this.held } : undefined}>
        {this.props.children}
      </div>
    );
  }
}

interface Anchor {
  el: Element;
  box: Element;
  top: number;
  boxTop: number;
}

/**
 * Keeps what the reader is looking at in place across the swap. Before the new figures are committed it notes
 * the element under the middle of the viewport (and its nearest `data-section`, in case that element is
 * replaced); after every panel below it has applied its held height (children commit first), it scrolls by
 * however far that element moved, which covers a panel above the reader that grew. When the browser's own
 * scroll anchoring already kept the element in place, the difference is zero and nothing scrolls.
 */
export class KeepReaderInPlace extends Component<{ phase: StatementState; children: ReactNode }> {
  override getSnapshotBeforeUpdate(prev: { phase: StatementState }): Anchor | null {
    if (!swapped(prev.phase, this.props.phase) || typeof document === "undefined") return null;
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (!el) return null;
    const box = el.closest("[data-section]") ?? el;
    return { el, box, top: el.getBoundingClientRect().top, boxTop: box.getBoundingClientRect().top };
  }

  override componentDidUpdate(_prev: unknown, _state: unknown, a: Anchor | null) {
    if (!a) return;
    const target = a.el.isConnected ? a.el : a.box.isConnected ? a.box : null;
    if (!target) return;
    const moved = target.getBoundingClientRect().top - (target === a.el ? a.top : a.boxTop);
    if (Math.abs(moved) >= 0.5) window.scrollBy(0, moved);
  }

  override render() {
    return this.props.children;
  }
}

/**
 * For a panel that loads its own content late (a skeleton, then a table or a one-line note): when its height
 * changes while it sits wholly above the middle of the viewport, scroll by the change, so the reader below it
 * stays put. Skipped when the browser's own scroll anchoring already moved the page by that amount.
 * Returns the ref to put on the panel's outer element.
 */
export function useKeepReaderBelow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const last = useRef<{ h: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const prev = last.current;
    last.current = { h: r.height, y: window.scrollY };
    if (!prev) return;
    const delta = r.height - prev.h;
    if (Math.abs(delta) < 0.5 || r.top + prev.h > window.innerHeight / 2) return;
    const scrolled = window.scrollY - prev.y;
    if (scrolled !== 0 && Math.abs(scrolled - delta) < 1) return;
    window.scrollBy(0, delta);
    last.current = { h: r.height, y: window.scrollY };
  });
  return ref;
}
