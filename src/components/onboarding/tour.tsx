import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TOUR_STEPS } from "@/lib/onboarding/steps";

type Box = { x: number; y: number; w: number; h: number } | null;

function findBox(sel?: string): Box {
  if (!sel) return null;
  const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.offsetParent !== null || e.getClientRects().length);
  if (!el) return null;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 };
}

/** Spotlight tour: dims the page, cuts out the current target, card with Back / Next / Skip. */
export function Tour({ open, onClose }: { open: boolean; onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const step = TOUR_STEPS[i];

  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    if (open && step?.path && pathname !== step.path) void navigate({ to: step.path as never });
  }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Targets may render after navigation/data loads: poll briefly, and follow resizes.
  useLayoutEffect(() => {
    if (!open || !step) return;
    let tries = 0;
    setBox(null);
    const t = setInterval(() => { const b = findBox(step.target); if (b || ++tries > 30) { setBox(b); if (b) clearInterval(t); } }, 150);
    const re = () => setBox(findBox(step.target));
    window.addEventListener("resize", re);
    return () => { clearInterval(t); window.removeEventListener("resize", re); };
  }, [open, i, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback((done: boolean) => onClose(done), [onClose]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "ArrowRight") setI((n) => (n < TOUR_STEPS.length - 1 ? n + 1 : n));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);

  if (!open || !step) return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const narrow = vw < 640;
  const spot = narrow ? null : box;
  const cardW = 320;
  let left = (vw - cardW) / 2, top = vh / 2 - 90;
  if (spot) {
    left = Math.min(Math.max(12, spot.x), vw - cardW - 12);
    top = spot.y + spot.h + 12 + 180 < vh ? spot.y + spot.h + 12 : Math.max(12, spot.y - 192);
  }
  const last = i === TOUR_STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="Guided tour" data-agent-ignore>
      {spot ? (
        <div className="pointer-events-none absolute rounded-lg ring-2 ring-foreground transition-all duration-300"
          style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h, boxShadow: "0 0 0 9999px color-mix(in oklab, var(--foreground) 45%, transparent)" }} />
      ) : (
        <div className="absolute inset-0 bg-foreground/45" />
      )}
      <div className="absolute rounded-lg border bg-popover p-4 text-popover-foreground shadow-lift" style={{ left, top, width: narrow ? vw - 24 : cardW, ...(narrow ? { left: 12 } : {}) }}>
        <p className="eyebrow">{i + 1} of {TOUR_STEPS.length}</p>
        <p className="mt-1 text-sm font-medium">{step.title}</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="xs" variant="ghost" onClick={() => close(false)}>Skip</Button>
          <div className="ml-auto flex gap-2">
            {i > 0 && <Button size="xs" variant="outline" onClick={() => setI(i - 1)}>Back</Button>}
            <Button size="xs" variant="ink" onClick={() => (last ? close(true) : setI(i + 1))}>{last ? "Done" : "Next"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
