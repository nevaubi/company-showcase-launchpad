import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TOUR_STEPS } from "@/lib/onboarding/steps";
import { Preview } from "./tour-previews";
import { useSource } from "@/components/source/source-context";

type Box = { x: number; y: number; w: number; h: number } | null;
const PAD = 6;

function findEl(sel?: string): HTMLElement | null {
  if (!sel) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.getClientRects().length > 0) ?? null;
}
/** Real press sequence: some controls (tabs) act on pointer/mouse down, not click. */
function press(el: HTMLElement) {
  const o = { bubbles: true, cancelable: true, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", o)); el.dispatchEvent(new MouseEvent("mousedown", o));
  el.dispatchEvent(new PointerEvent("pointerup", o)); el.dispatchEvent(new MouseEvent("mouseup", o));
  el.click();
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Resolves with the first visible match, or null after `ms` (pages may still be loading data). */
async function waitFor(sel: string, dead: () => boolean, ms = 12000): Promise<HTMLElement | null> {
  const t0 = Date.now();
  while (!dead() && Date.now() - t0 < ms) {
    const el = findEl(sel);
    if (el) return el;
    await pause(120);
  }
  return null;
}
function measure(el: HTMLElement | null): Box {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // Clamp to the viewport so large page regions still read as a frame.
  const top = Math.max(r.top - PAD, 4), bottom = Math.min(r.bottom + PAD, window.innerHeight - 8);
  const left = Math.max(r.left - PAD, 4), right = Math.min(r.right + PAD, window.innerWidth - 4);
  if (bottom - top < 8 || right - left < 8) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Spotlight tour across the real pages: it navigates, clicks to demonstrate, and glides the highlight to each feature. */
export function Tour({ open, onClose }: { open: boolean; onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const step = TOUR_STEPS[i];
  const elRef = useRef<HTMLElement | null>(null);
  const source = useSource();

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // Open the step's page, perform its demo click, then glide the spotlight to the target.
  // The previous box stays until the new target exists, so nothing flickers between pages.
  useLayoutEffect(() => {
    if (!open || !step) return;
    let dead = false, raf = 0;
    const ro = new ResizeObserver(() => sync());
    const sync = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (dead) return; setVp({ w: window.innerWidth, h: window.innerHeight }); setBox(measure(elRef.current)); }); };
    // Only the source step keeps the evidence panel open; it would cover the next pages.
    if (!step.target?.includes("source-panel")) source.close();
    const want = step.path?.split("?")[0];
    if (want && pathname !== want) void navigate({ href: step.path } as never);
    elRef.current = null;
    if (!step.target) setBox(null);
    void (async () => {
      if (step.click && !findEl(step.done ?? step.target)) {
        const c = await waitFor(step.click, () => dead);
        if (dead) return;
        if (c) { c.scrollIntoView({ block: "center" }); await pause(350); if (!dead) press(c); }
      }
      if (!step.target) return;
      const el = await waitFor(step.target, () => dead);
      if (dead) return;
      if (!el) { setBox(null); return; }
      elRef.current = el;
      const r = el.getBoundingClientRect();
      if (r.top < 64 || r.top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: "smooth", block: r.height > window.innerHeight * 0.6 ? "start" : "center" });
      ro.observe(el);
      sync();
    })();
    window.addEventListener("scroll", sync, true); window.addEventListener("resize", sync);
    sync();
    return () => { dead = true; ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("scroll", sync, true); window.removeEventListener("resize", sync); };
  }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback((done: boolean) => onClose(done), [onClose]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "ArrowRight") setI((n) => Math.min(TOUR_STEPS.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);

  if (!open || !step) return null;
  const narrow = vp.w < 640;
  const spot = narrow ? null : box;
  const cardW = narrow ? vp.w - 24 : 340, cardH = step.preview ? 300 : 175;
  let left = (vp.w - cardW) / 2, top = Math.max(12, (vp.h - cardH) / 2);
  if (spot) {
    const below = spot.y + spot.h + 14, above = spot.y - cardH - 14;
    if (below + cardH < vp.h) { left = Math.min(Math.max(12, spot.x), vp.w - cardW - 12); top = below; }
    else if (above > 12) { left = Math.min(Math.max(12, spot.x), vp.w - cardW - 12); top = above; }
    else {
      // Big region: dock the card beside it (left of a right-hand panel, else bottom-right corner).
      const rightSide = spot.x > vp.w / 2;
      left = rightSide ? Math.max(12, spot.x - cardW - 14) : vp.w - cardW - 20;
      top = vp.h - cardH - 20;
    }
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
          {step.preview && <Preview kind={step.preview} />}
          <div className="p-4">
            {step.area && <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{step.area} · {i + 1}/{TOUR_STEPS.length}</p>}
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
