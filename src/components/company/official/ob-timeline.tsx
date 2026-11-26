import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { isoToday, obTimeline, type ObEvent } from "@/lib/sources/company/charts";
import type { CompanyPatents } from "@/lib/sources/company/orange-book";
import { dayLabel } from "@/lib/sources/company/present";
import { recordHref } from "@/lib/sources/links";
import { RecordLink } from "./record-link";

const ROW = 28;
const AXIS = 22;
const time = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const KIND_WORD = { patent: "Patent expiry", exclusivity: "Exclusivity ends" } as const;
/** How many listed dates the list under the timeline names. */
export const NEXT_LISTED = 6;

const eventText = (e: ObEvent) => (e.kind === "patent" ? `${e.items.length === 1 ? "patent" : "patents"} ${e.items.join(", ")}` : `exclusivity ${e.items.join(", ")}`);

/**
 * The listed patent expiry and exclusivity dates of the company's applications on one time axis: a row per product,
 * the soonest next date first, a dot per patent date and a diamond per exclusivity date (shape and colour both carry
 * the kind), today as a hairline, and the next listed dates beneath as a list. Dates are placed from the FDA's printed
 * dates; each mark opens its stored rows. Nothing is forecast.
 */
export function ObTimelineView({ data }: { data: CompanyPatents }) {
  const router = useRouter();
  const today = isoToday();
  const t = useMemo(() => obTimeline(data.applications, today), [data.applications, today]);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const live = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!box) return;
    if (box.clientWidth) setWidth(Math.max(280, box.clientWidth));
    const ro = new ResizeObserver(e => setWidth(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);
  const marks = useMemo(() => t.rows.flatMap((r, ri) => r.events.map(e => ({ e, ri, trade: r.trade }))).sort((a, b) => a.e.day.localeCompare(b.e.day) || a.ri - b.ri), [t.rows]);
  if (!t.rows.length) return null;

  const labelW = width < 480 ? 92 : 150;
  const M = { left: labelW, right: 16, top: AXIS };
  const iw = Math.max(80, width - M.left - M.right);
  const pad = 45 * 86_400_000;
  const t0 = time(t.from) - pad, t1 = time(t.to) + pad;
  const x = (iso: string) => M.left + ((time(iso) - t0) / (t1 - t0)) * iw;
  const height = M.top + t.rows.length * ROW + 4;
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  const yearsSpan = y1 - y0;
  const every = yearsSpan > 16 || iw < 260 ? 5 : yearsSpan > 7 || iw < 420 ? 2 : 1;
  const years: number[] = [];
  for (let yr = Math.ceil((y0 + 1) / every) * every; yr <= y1; yr += every) if (time(`${yr}-01-01`) > t0 && time(`${yr}-01-01`) < t1) years.push(yr);
  const at = active != null ? marks[active] : null;
  const open = (e: ObEvent) => router.history.push(recordHref(e.refs[0].dataset, e.refs[0].snapshot, e.refs[0].row));
  const say = (m: (typeof marks)[number]) => `${m.trade}: ${KIND_WORD[m.e.kind]} ${m.e.printed}, ${eventText(m.e)}`;
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!marks.length) return;
    const pos = active ?? marks.findIndex(m => m.e.day >= today);
    let to = pos < 0 ? 0 : pos;
    if (ev.key === "ArrowLeft") to = Math.max(0, to - 1);
    else if (ev.key === "ArrowRight") to = active == null ? to : Math.min(marks.length - 1, to + 1);
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = marks.length - 1;
    else if (ev.key === "Enter" && at) {
      ev.preventDefault();
      open(at.e);
      return;
    } else return;
    ev.preventDefault();
    setActive(to);
    if (live.current) live.current.textContent = say(marks[to]);
  };
  const nearestMark = (px: number, py: number) => {
    let best: number | null = null, dist = Infinity;
    marks.forEach((m, i) => {
      const dx = x(m.e.day) - px, dy = M.top + m.ri * ROW + ROW / 2 - py;
      const d = Math.hypot(dx, dy * 2);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return dist <= 28 ? best : null;
  };
  const tipW = 220;
  const tipLeft = at ? Math.min(Math.max(0, x(at.e.day) + 10), Math.max(0, width - tipW)) : 0;
  const tipTop = at ? Math.min(M.top + at.ri * ROW + ROW, Math.max(0, height - 70)) : 0;
  const upcoming = t.upcoming.slice(0, NEXT_LISTED);
  const tradeOf = (appl: string) => t.rows.find(r => r.appl === appl)?.trade ?? appl;

  return (
    <div data-section="Patent and exclusivity timeline" className="min-w-0 px-3.5 pb-2.5">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill="var(--chart-1)" /></svg>
          Patent expiry, as listed
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><rect x="1.5" y="1.5" width="7" height="7" transform="rotate(45 5 5)" fill="var(--chart-2)" /></svg>
          Exclusivity ends, as listed
        </span>
        {t.rows.some(r => r.events.some(e => e.kind === "patent" && e.delisted && e.items.length === 1)) && (
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="3.5" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" /></svg>
            Delisting requested
          </span>
        )}
      </div>
      <div className="relative">
        <div
          ref={setBox}
          tabIndex={0}
          role="group"
          aria-label={`Listed patent expiry and exclusivity dates of ${t.rows.length} ${t.rows.length === 1 ? "product" : "products"}. Arrow keys read each date; Enter opens its stored rows.`}
          onPointerMove={ev => {
            const r = ev.currentTarget.getBoundingClientRect();
            setActive(nearestMark(ev.clientX - r.left, ev.clientY - r.top));
          }}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          onClick={() => at && open(at.e)}
          className="relative rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ height, cursor: at ? "pointer" : "default" }}
        >
          <svg width={width} height={height} className="block" aria-hidden>
            {years.map(yr => (
              <g key={yr}>
                <line x1={x(`${yr}-01-01`)} x2={x(`${yr}-01-01`)} y1={M.top - 4} y2={height - 4} stroke="var(--border)" />
                <text x={x(`${yr}-01-01`)} y={12} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{yr}</text>
              </g>
            ))}
            {t.rows.map((r, ri) => (
              <g key={r.appl}>
                <line x1={M.left} x2={M.left + iw} y1={M.top + ri * ROW + ROW / 2} y2={M.top + ri * ROW + ROW / 2} stroke="var(--border)" strokeOpacity={0.6} />
                <text x={0} y={M.top + ri * ROW + ROW / 2} dy="0.32em" className="fill-foreground text-[11px]">
                  {r.trade.length * 6.2 > labelW - 8 ? `${r.trade.slice(0, Math.max(4, Math.floor((labelW - 14) / 6.2)))}…` : r.trade}
                </text>
              </g>
            ))}
            <line x1={x(today)} x2={x(today)} y1={M.top - 6} y2={height - 4} stroke="var(--foreground)" strokeOpacity={0.45} />
            <text x={x(today) + 4} y={M.top - 8} className="fill-muted-foreground text-[10px]">today</text>
            {marks.map((m, i) => {
              const cx = x(m.e.day), cy = M.top + m.ri * ROW + ROW / 2;
              const on = i === active;
              const past = m.e.day < today;
              const opacity = past && !on ? 0.45 : 1;
              return m.e.kind === "patent" ? (
                <circle key={`${m.e.appl}-${m.e.kind}-${m.e.day}`} cx={cx} cy={cy} r={on ? 5.5 : 4.5} fill={m.e.delisted && m.e.items.length === 1 ? "var(--card)" : "var(--chart-1)"} stroke={m.e.delisted && m.e.items.length === 1 ? "var(--chart-1)" : "var(--card)"} strokeWidth={2} opacity={opacity} />
              ) : (
                <rect key={`${m.e.appl}-${m.e.kind}-${m.e.day}`} x={cx - (on ? 5 : 4)} y={cy - (on ? 5 : 4)} width={on ? 10 : 8} height={on ? 10 : 8} transform={`rotate(45 ${cx} ${cy})`} fill="var(--chart-2)" stroke="var(--card)" strokeWidth={2} opacity={opacity} />
              );
            })}
          </svg>
          {at && (
            <div className="pointer-events-none absolute z-10 rounded-[4px] border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left: tipLeft, top: tipTop, width: tipW }}>
              <div className="num text-[13px] font-semibold text-foreground">{at.e.printed}</div>
              <div className="text-muted-foreground">
                {at.trade} · NDA {at.e.appl}
              </div>
              <div className="text-muted-foreground">
                {KIND_WORD[at.e.kind]}: {at.e.items.join(", ")}
                {at.e.delisted ? " (delisting requested)" : ""}
              </div>
              <div className="text-muted-foreground">
                {at.e.refs.length} stored {at.e.refs.length === 1 ? "row" : "rows"}; click or press Enter to open the first
              </div>
            </div>
          )}
        </div>
        <p ref={live} aria-live="polite" className="sr-only" />
      </div>
      <div data-section="Next listed dates" className="mt-2">
        <h4 className="mb-1 text-[11px] font-medium text-muted-foreground">Next listed dates after today, {dayLabel(today)}</h4>
        {upcoming.length ? (
          <ol className="divide-y text-[13px]">
            {upcoming.map(e => (
              <li key={`${e.appl}-${e.kind}-${e.day}`} className="flex min-h-7 flex-wrap items-baseline gap-x-2 py-1">
                <span className="num w-[6.75rem] shrink-0 whitespace-nowrap">{e.printed}</span>
                <span className="font-medium">{tradeOf(e.appl)}</span>
                <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                  {KIND_WORD[e.kind].toLowerCase()}, {e.items.join(", ")}
                  {e.delisted ? " (delisting requested)" : ""}
                </span>
                <RecordLink at={e.refs[0]} className="text-[11px] text-muted-foreground" title={`Stored rows ${e.refs.map(r => r.row.toLocaleString("en-US")).join(", ")}`}>
                  row {e.refs[0].row.toLocaleString("en-US")}
                  {e.refs.length > 1 ? ` +${e.refs.length - 1}` : ""}
                </RecordLink>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-muted-foreground">No listed date falls after today.</p>
        )}
      </div>
      {t.undated > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{t.undated} listed {t.undated === 1 ? "entry has" : "entries have"} no printed date that reads as a day and {t.undated === 1 ? "is" : "are"} not placed.</p>}
    </div>
  );
}
