/**
 * Sets the grid's label and period column widths on its root (`--irt-fc`, `--col`, in px) from the frame's
 * width, so the frame shows whole period columns only (`fitGrid`, table-style.ts). Runs before paint and
 * again only when the frame's width, the number of columns or the widest figure changes: never while the
 * page scrolls. The figure width is measured once from a probe of ten tabular zeros in the table's type.
 */
import { useLayoutEffect, type RefObject } from "react";
import { FIGURE_ROOM, FIGURE_ROOM_PHONE, fitGrid } from "@/components/ir/table-style";

const PHONE = "(max-width: 639.98px)";

export function useGridFit(
  root: RefObject<HTMLElement | null>,
  n: number,
  chars: number,
  extra = 0,
) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const probe = document.createElement("span");
    probe.className = "irg-probe";
    probe.setAttribute("aria-hidden", "true");
    probe.textContent = "0000000000";
    el.appendChild(probe);
    let last = "";
    const fit = () => {
      const w = el.clientWidth;
      if (!w) return;
      const phone = typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;
      const ch = probe.getBoundingClientRect().width / 10 || 7.2;
      const need = Math.ceil(Math.max(chars, 1) * ch + (phone ? FIGURE_ROOM_PHONE : FIGURE_ROOM));
      const { label, col } = fitGrid(w, n, need, phone, extra);
      const key = `${label}|${col}`;
      if (key === last) return;
      last = key;
      el.style.setProperty("--irt-fc", `${label}px`);
      el.style.setProperty("--col", `${col}px`);
    };
    fit();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      let width = el.clientWidth;
      ro = new ResizeObserver(() => {
        if (Math.abs(el.clientWidth - width) < 1) return;
        width = el.clientWidth;
        fit();
      });
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      probe.remove();
    };
  }, [root, n, chars, extra]);
}
