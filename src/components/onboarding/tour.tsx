import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TOUR_STEPS } from "@/lib/onboarding/steps";
import { Preview } from "./tour-previews";

type Box = { x: number; y: number; w: number; h: number } | null;
const PAD = 6;

function findEl(sel?: string): HTMLElement | null {
  if (!sel) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.getClientRects().length > 0) ?? null;
}
function measure(el: HTMLElement | null): Box {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** Spotlight tour on the dashboard: a gliding highlight, a sliding card and a looping preview per step. */
export function Tour({ open, onClose }: { open: boolean; onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const step = TOUR_STEPS[i];
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setI(0);
    if (pathname !== "/app") void navigate({ to: "/app" as never });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find the target without polling; keep the previous box until the new one exists so nothing flickers.
  useLayoutEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    const sync = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { setVp({ w: window.innerWidth, h: window.innerHeight }); setBox(measure(elRef.current)); }); };
    const attach = () => {
      const el = findEl(step.target);
      if (!el) return false;
      elRef.current = el;
      const r = el.getBoundingClientRect();
      if (r.top < 64 || r.bottom > window.innerHeight - 220) el.scrollIntoView({ behavior: "smooth", block: "center" });
      ro.observe(el);
      sync();
      return true;
    };
    const ro = new ResizeObserver(sync);
    const mo = new MutationObserver(() => { if (attach()) mo.disconnect(); });
    elRef.current = null;
    if (!step.target) setBox(null);
    else if (!attach()) {
      mo.observe(document.body, { childList: true, subtree: true });
      const t = setTimeout(() => { mo.disconnect(); if (!elRef.current) setBox(null); }, 4000);
      window.addEventListener("scroll", sync, true); window.addEventListener("resize", sync);
      return () => { clearTimeout(t); mo.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("scroll", sync, true); window.removeEventListener("resize", sync); };
    }
    window.addEventListener("scroll", sync, true); window.addEventListener("resize", sync);
    sync();
    return () => { mo.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("scroll", sync, true); window.removeEventListener("resize", sync); };
  }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback((done: boolean) => onClose(done), [onClose]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "ArrowRight") setI((n) => Math.min(TOUR_STEPS.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);

  if (!open || !step) return null;
  const narrow = vp.w < 640;
  const spot = narrow ? null : box;
  const cardW = narrow ? vp.w - 24 : 340, cardH = 290;
  let left = (vp.w - cardW) / 2, top = Math.max(12, (vp.h - cardH) / 2);
  if (spot) {
    left = Math.min(Math.max(12, spot.x), vp.w - cardW - 12);
    top = spot.y + spot.h + 14 + cardH < vp.h ? spot.y + spot.h + 14 : Math.max(12, spot.y - cardH - 14);
  }
  const last = i === TOUR_STEPS.length - 1;
  const hole = spot ?? { x: vp.w / 2, y: vp.h / 2, w: 0, h: 0 };
  return (
    <div className="tour-root fixed inset-0 z-[70]" role="dialog" aria-label="Guided tour" data-agent-ignore>
      <div className="absolute inset-0" onClick={() => close(false)} />
      <div className="tour-spot pointer-events-none absolute left-0 top-0" data-on={spot ? "1" : "0"}
        style={{ width: hole.w, height: hole.h, transform: `translate3d(${hole.x}px, ${hole.y}px, 0)` }} />
      <div className="tour-card absolute left-0 top-0 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lift"
        style={{ width: cardW, transform: `translate3d(${narrow ? 12 : left}px, ${top}px, 0)` }}>
        <div key={i} className="tour-step">
          <Preview kind={step.preview} />
          <div className="p-4">
            <p className="text-sm font-semibold tracking-tight">{step.title}</p>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{step.body}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 pb-4">
          <div className="flex gap-1">
            {TOUR_STEPS.map((_, n) => (
              <button key={n} aria-label={`Step ${n + 1}`} onClick={() => setI(n)}
                className={`h-1.5 rounded-full transition-all duration-300 ${n === i ? "w-4 bg-foreground" : "w-1.5 bg-border"}`} />
            ))}
          </div>
          <div className="ml-auto flex gap-1.5">
            {!last && <Button size="xs" variant="ghost" onClick={() => close(false)}>Skip</Button>}
            {i > 0 && <Button size="xs" variant="outline" onClick={() => setI(i - 1)}>Back</Button>}
            {last && <Button size="xs" variant="outline" onClick={() => { close(true); void navigate({ to: "/app/companies/$ticker/financials" as never, params: { ticker: "NVDA" } as never }); }}>Try it on NVIDIA</Button>}
            <Button size="xs" variant="ink" onClick={() => (last ? close(true) : setI(i + 1))}>{i === 0 ? "Start tour" : last ? "Done" : "Next"}</Button>
          </div>
        </div>
        <div className="h-0.5 bg-border"><div className="h-full bg-foreground transition-[width] duration-500 ease-out" style={{ width: `${((i + 1) / TOUR_STEPS.length) * 100}%` }} /></div>
      </div>
    </div>
  );
}
