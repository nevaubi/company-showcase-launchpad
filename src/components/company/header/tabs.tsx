import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, Lock } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { CompanyLogo } from "@/components/app/company-logo";
import { fmtPct, fmtPrice, fmtSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  activeTab,
  barTopRem,
  changeTone,
  isWide,
  landingScrollY,
  stickyTopRem,
  TAB_GROUPS,
  type QuoteLike,
} from "./model";

const TONE = { positive: "text-positive", negative: "text-negative", flat: "text-muted-foreground" } as const;
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * A label that keeps one width in both weights: the medium-weight text is laid out (hidden) under the
 * visible one, so the strip does not shuffle sideways when the active tab changes.
 */
const HOLD_WIDTH =
  "flex-col items-center justify-center before:invisible before:block before:h-0 before:overflow-hidden before:font-medium before:content-[attr(data-label)]";
const TAB = cn(
  "relative inline-flex h-9 shrink-0 rounded-sm px-3 text-sm transition-colors duration-150 motion-reduce:transition-none",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:transition-colors after:duration-150",
  HOLD_WIDTH,
  FOCUS,
);
const TAB_ON = "font-medium text-foreground after:bg-foreground";
const TAB_OFF = "text-muted-foreground hover:text-foreground hover:after:bg-rule";
const SUB = cn(
  "inline-flex h-7 shrink-0 rounded-md px-3 text-[13px] transition-colors duration-150 motion-reduce:transition-none",
  HOLD_WIDTH,
  FOCUS,
);
const CROSS = cn(
  "relative inline-flex h-9 shrink-0 items-center gap-1 rounded-sm px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground motion-reduce:transition-none",
  FOCUS,
);

const plainClick = (e: MouseEvent) =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Logo, name, ticker, price and change in one line: what stays in view once the header has scrolled away. */
function PinnedIdentity({
  ticker,
  name,
  logoSrc,
  quote,
  restricted,
  shown,
  wide,
}: {
  ticker: string;
  name: string;
  logoSrc?: string;
  quote: QuoteLike | undefined;
  restricted: boolean;
  shown: boolean;
  wide: boolean;
}) {
  const tone = changeTone(quote?.change);
  return (
    <div
      data-section="Pinned company bar"
      aria-hidden={!shown || undefined}
      inert={!shown}
      className={cn(
        "@container flex min-w-0 items-center gap-3 transition-[opacity,visibility] duration-150 motion-reduce:transition-none",
        shown ? "visible opacity-100" : "pointer-events-none invisible opacity-0",
        wide
          ? "h-9 flex-1 justify-end pl-6"
          : "absolute inset-x-0 bottom-full h-8 justify-between bg-background px-4 lg:px-6",
      )}
    >
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" })}
        title="Back to the top of the page"
        className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CompanyLogo ticker={ticker} src={logoSrc} size="xs" decorative />
        <span className="hidden min-w-0 truncate text-[13px] font-semibold leading-5 @min-[17rem]:block">{name}</span>
        <span className="num shrink-0 text-[13px] leading-5 text-muted-foreground">{ticker}</span>
        <span className="sr-only">, back to the top of the page</span>
      </button>
      <span className="flex shrink-0 items-center gap-2">
        {restricted && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-negative" title="On the firm's restricted list">
            <Lock aria-hidden className="size-3.5" />
            <span className="hidden @min-[26rem]:inline">Restricted</span>
            <span className="sr-only @min-[26rem]:hidden">Restricted</span>
          </span>
        )}
        {quote && (
          <span className="num flex items-baseline gap-1.5 text-[13px] leading-5">
            <span className="font-medium">{fmtPrice(quote.price)}</span>
            <span className={TONE[tone]}>
              <span className="sr-only">{tone === "positive" ? "up " : tone === "negative" ? "down " : "unchanged "}</span>
              <span className="hidden @min-[26rem]:inline">{fmtSigned(quote.change)} </span>
              <span className="@min-[26rem]:hidden">{fmtPct(quote.changePct, 2, true)}</span>
              <span className="hidden @min-[26rem]:inline">({fmtPct(quote.changePct, 2, true)})</span>
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The company page's navigation and the frame of the page under it.
 *
 * One strip holds the seven groups and, after a rule, the two links that leave the company page; the
 * pages of the active group sit in a second row under their group. The block is sticky under the app
 * header, so it is the same element before and after it pins: nothing is duplicated and nothing shifts.
 * Once pinned, a compact identity (logo, name, ticker, price, change) fades in: beside the tabs when
 * there is room, otherwise in a slim row above them. `--sticky-top` on the page body is the bottom edge
 * of the pinned block, for every sticky element inside the page.
 *
 * A tab click never moves the strip: above the pin point the page stays where it was, past it the new
 * page starts right under the bar (landingScrollY).
 */
export function CompanyTabs({
  ticker,
  name,
  logoSrc,
  quote,
  restricted = false,
  children,
}: {
  ticker: string;
  name: string;
  logoSrc?: string;
  quote: QuoteLike | undefined;
  restricted?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { group, sub } = activeTab(pathname);
  const hasSubs = group.subs.length > 1;

  const sentinel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [edge, setEdge] = useState({ start: false, end: false });
  const [pinned, setPinned] = useState(false);

  /* Room beside the tabs decides where the pinned identity goes; the strip's own overflow decides its edge fades. */
  useLayoutEffect(() => {
    const r = row.current;
    const n = strip.current;
    const i = inner.current;
    if (!r || !n || !i || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setWide(isWide(r.clientWidth, i.offsetWidth));
      const start = n.scrollLeft > 1;
      const end = n.scrollWidth - n.clientWidth - n.scrollLeft > 1;
      setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(r);
    ro.observe(i);
    n.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      n.removeEventListener("scroll", measure);
    };
  }, []);

  /*
   * Pinned once the block's place in the page has reached the line it sticks to. The line itself counts
   * (a tab change lands exactly there), so the watched edge sits a pixel below it: the 1 px sentinel
   * leaves the watched area when its top is within a pixel of the line.
   */
  useEffect(() => {
    const s = sentinel.current;
    const b = bar.current;
    if (!s || !b || typeof IntersectionObserver === "undefined") return;
    const line = Math.round(parseFloat(getComputedStyle(b).top) || 0) + 2;
    const io = new IntersectionObserver(([e]) => setPinned(!e.isIntersecting && e.boundingClientRect.top < line), {
      rootMargin: `-${line}px 0px 0px 0px`,
      threshold: 0,
    });
    io.observe(s);
    return () => io.disconnect();
  }, [wide]);

  /* Keep the active group in view inside the strip (the strip scrolls sideways; the page never does). */
  useLayoutEffect(() => {
    const n = strip.current;
    const a = n?.querySelector<HTMLElement>("[aria-current='page']");
    if (!n || !a || n.scrollWidth <= n.clientWidth + 1) return;
    const box = n.getBoundingClientRect();
    const tab = a.getBoundingClientRect();
    const pad = 8;
    if (tab.left < box.left + pad) n.scrollLeft -= box.left + pad - tab.left;
    else if (tab.right > box.right - pad) n.scrollLeft += tab.right - (box.right - pad);
  }, [group.label, wide]);

  /** scrollY at which the block has just pinned, measured on the page as it is now. */
  const pinY = useCallback(() => {
    const s = sentinel.current;
    const b = bar.current;
    if (!s || !b) return 0;
    return s.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(b).top) || 0);
  }, []);

  /*
   * Where the reader was when a tab was pressed; applied once the new page has rendered. For a moment
   * after landing the page body is kept out of the browser's scroll anchoring: a page that fills in
   * above its first rows would otherwise be scrolled past its own top to hold those rows still.
   */
  const intent = useRef<{ y: number; timer: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const hold = useRef(0);
  useEffect(
    () =>
      router.subscribe("onRendered", () => {
        const it = intent.current;
        if (!it) return;
        window.clearTimeout(it.timer);
        intent.current = null;
        window.scrollTo({ top: landingScrollY(it.y, pinY()), left: 0, behavior: "instant" });
        const el = frame.current;
        if (!el) return;
        el.style.overflowAnchor = "none";
        window.clearTimeout(hold.current);
        hold.current = window.setTimeout(() => (el.style.overflowAnchor = ""), 1500);
      }),
    [router, pinY],
  );
  useEffect(
    () => () => {
      window.clearTimeout(intent.current?.timer);
      window.clearTimeout(hold.current);
    },
    [],
  );
  const onTab = (current: boolean) => (e: MouseEvent) => {
    if (!plainClick(e)) return;
    if (current) {
      /* already here: the same landing rule, as a visible move */
      window.scrollTo({ top: landingScrollY(window.scrollY, pinY()), left: 0, behavior: calm() ? "auto" : "smooth" });
      return;
    }
    window.clearTimeout(intent.current?.timer);
    intent.current = { y: window.scrollY, timer: window.setTimeout(() => (intent.current = null), 5000) };
  };

  const fade =
    edge.start || edge.end
      ? `linear-gradient(to right, ${edge.start ? "transparent, #000 1.5rem" : "#000, #000"}, ${edge.end ? "#000 calc(100% - 1.5rem), transparent" : "#000"})`
      : undefined;
  const before = TAB_GROUPS.slice(0, TAB_GROUPS.indexOf(group));

  return (
    <>
      <div ref={sentinel} aria-hidden className="pointer-events-none -mb-px h-px" />
      <div
        ref={bar}
        data-company-bar=""
        data-pinned={pinned}
        data-wide={wide}
        style={{ top: `${barTopRem(wide)}rem` }}
        className={cn(
          "sticky z-[15] -mx-4 bg-background px-4 lg:-mx-6 lg:px-6",
          hasSubs && pinned && "shadow-[0_1px_0_0_var(--color-border)]",
        )}
      >
        <div ref={row} className="flex h-9 items-stretch shadow-[inset_0_-1px_0_0_var(--color-border)]">
          <nav
            ref={strip}
            aria-label="Company research"
            style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
            className={cn("no-scrollbar relative min-w-0", wide ? "flex-none" : "flex-1 overflow-x-auto overscroll-x-contain")}
          >
            <div ref={inner} className="flex h-9 w-max items-stretch">
              {TAB_GROUPS.map((g) => {
                const on = g === group;
                return (
                  <Link
                    key={g.label}
                    data-tour={`tab-${g.label}`}
                    data-label={g.label}
                    to={g.subs[0].to as "/app/companies/$ticker"}
                    params={{ ticker }}
                    resetScroll={false}
                    activeOptions={{ exact: true }}
                    onClick={onTab(g.subs[0].seg === sub.seg)}
                    aria-current={on ? "page" : undefined}
                    className={cn(TAB, on ? TAB_ON : TAB_OFF)}
                  >
                    {g.label}
                  </Link>
                );
              })}
              <span aria-hidden className="mx-2 my-auto h-4 w-px shrink-0 bg-border" />
              <Link
                to="/app/markets"
                search={{ symbol: ticker }}
                title={`Technical analysis for ${ticker}, on the Markets page`}
                className={CROSS}
              >
                Technicals <ArrowUpRight aria-hidden className="size-3.5 opacity-70" />
                <span className="sr-only">(opens the Markets page)</span>
              </Link>
              <Link
                to="/app/supply-chain"
                search={{ t: ticker }}
                title={`Supply-chain map for ${ticker}, on the Supply chain page`}
                className={CROSS}
              >
                Supply chain <ArrowUpRight aria-hidden className="size-3.5 opacity-70" />
                <span className="sr-only">(opens the Supply chain page)</span>
              </Link>
            </div>
          </nav>
          <PinnedIdentity
            ticker={ticker}
            name={name}
            logoSrc={logoSrc}
            quote={quote}
            restricted={restricted}
            shown={pinned}
            wide={wide}
          />
        </div>
        {hasSubs && (
          <nav aria-label={`${group.label} pages`} className="no-scrollbar relative flex h-8 items-center overflow-x-auto">
            {/* the groups before the active one, laid out unseen, put the pages under their group; it gives way first when room is short */}
            {!edge.start && !edge.end && before.length > 0 && (
              <span aria-hidden className="invisible flex h-0 min-w-0 shrink overflow-hidden">
                {before.map((g) => (
                  <span key={g.label} data-label={g.label} className={cn(TAB, "h-0")}>
                    {g.label}
                  </span>
                ))}
              </span>
            )}
            {group.subs.map((s) => {
              const on = s === sub;
              return (
                <Link
                  key={s.seg}
                  data-label={s.label}
                  to={s.to as "/app/companies/$ticker"}
                  params={{ ticker }}
                  resetScroll={false}
                  activeOptions={{ exact: true }}
                  onClick={onTab(on)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    SUB,
                    on
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {s.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
      <div
        ref={frame}
        data-tour="company-body"
        className="min-h-[calc(100dvh-var(--sticky-top)-3rem)] min-w-0 pt-4"
        style={{ "--sticky-top": `${stickyTopRem(wide, hasSubs)}rem` } as CSSProperties}
      >
        {children}
      </div>
    </>
  );
}
