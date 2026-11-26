/**
 * What a collection holds over time, pure: one bar per table from the first day of its first period to the last day
 * of its last period (the least and greatest period strings of its current snapshot, from the snapshot statistics),
 * placed only when both ends parse in one detected format (`periods.ts`). Coloured by publisher in the fixed slot
 * order (the publishers with the most tables here take the five slots, the rest share the quiet grey), sorted by the
 * last period, newest first. Tables without a period, with periods that are not dates, or not yet counted are counted
 * in the caption and not drawn.
 */
import { detectPeriodFormat, parsePeriod } from "@/lib/sources/periods";
import type { SourceLibraryRow } from "@/lib/sources/read-types";
import type { TablePeriod } from "./wire";

/** Publishers drawn in their own colour; the others share the quiet grey. */
export const PUBLISHER_SLOTS = 5;
/** Rows drawn before "Show all". */
export const TIMELINE_ROWS = 40;

export type TimelineRow = {
  id: string;
  title: string;
  publisherId: string;
  publisher: string;
  /** Slot index of the publisher (0 to 4) or null for the quiet grey. */
  slot: number | null;
  firstLabel: string;
  lastLabel: string;
  /** ISO dates of the first day of the first period and the last day of the last. */
  start: string;
  end: string;
  periods: number | null;
  records: number;
  tip: string;
};

export type TimelinePublisher = { id: string; short: string; slot: number | null; tables: number };

export type Timeline = {
  rows: TimelineRow[];
  /** First and last calendar year of the axis. */
  fromYear: number;
  toYear: number;
  /** In slot order; the quiet grey last, as one entry, when any publisher shares it. */
  publishers: TimelinePublisher[];
  /** Tables of the collection, and those not drawn, by reason. */
  tables: number;
  noPeriod: number;
  notDates: number;
  notCounted: number;
};

type Names = (id: string) => { name: string; short: string } | undefined;
type Periods = ReadonlyMap<string, TablePeriod & { note: boolean }>;

const n = (v: number) => v.toLocaleString("en-US");
const year = (iso: string) => Number(iso.slice(0, 4));

/**
 * The placed range of one table, or why it is not placed. `hasPeriod` is whether its current snapshot declares a period
 * (the library row's dimensions): a table without one is "no-period" whatever the statistics hold.
 */
export function tableRange(p: (TablePeriod & { note: boolean }) | undefined, hasPeriod: boolean):
  | { ok: true; start: string; end: string; firstLabel: string; lastLabel: string }
  | { ok: false; reason: "no-period" | "not-dates" | "not-counted" } {
  if (!hasPeriod) return { ok: false, reason: "no-period" };
  if (!p) return { ok: false, reason: "not-counted" };
  if (p.note) return { ok: false, reason: "not-dates" };
  if (!p.first || !p.last) return { ok: false, reason: "not-counted" };
  const format = detectPeriodFormat([p.first, p.last]);
  if (format === "text") return { ok: false, reason: "not-dates" };
  const a = parsePeriod(p.first, format);
  const b = parsePeriod(p.last, format);
  if (!a || !b) return { ok: false, reason: "not-dates" };
  return { ok: true, start: a.start, end: b.end, firstLabel: a.label, lastLabel: b.label };
}

export function collectionTimeline(rows: readonly SourceLibraryRow[], periods: Periods, names: Names): Timeline {
  let noPeriod = 0;
  let notDates = 0;
  let notCounted = 0;
  const placed: Omit<TimelineRow, "slot">[] = [];
  for (const r of rows) {
    const range = tableRange(periods.get(r.id), r.dimensions.includes("period"));
    if (!range.ok) {
      if (range.reason === "no-period") noPeriod += 1;
      else if (range.reason === "not-dates") notDates += 1;
      else notCounted += 1;
      continue;
    }
    const p = periods.get(r.id)!;
    const publisher = names(r.publisherId)?.short ?? r.publisherId;
    const span = range.firstLabel === range.lastLabel ? range.firstLabel : `${range.firstLabel} to ${range.lastLabel}`;
    placed.push({
      id: r.id,
      title: r.title,
      publisherId: r.publisherId,
      publisher,
      firstLabel: range.firstLabel,
      lastLabel: range.lastLabel,
      start: range.start,
      end: range.end,
      periods: p.periods,
      records: r.rows,
      tip: `${r.title} (${publisher}): ${span}${p.periods ? `, ${n(p.periods)} ${p.periods === 1 ? "period" : "periods"}` : ""}, ${n(r.rows)} ${r.rows === 1 ? "record" : "records"}`,
    });
  }
  // slots by tables drawn here, most first; ties by name, so a page always paints the same way
  const byPublisher = new Map<string, { short: string; tables: number }>();
  for (const p of placed) {
    const cur = byPublisher.get(p.publisherId) ?? { short: p.publisher, tables: 0 };
    cur.tables += 1;
    byPublisher.set(p.publisherId, cur);
  }
  const ranked = [...byPublisher.entries()].sort((a, b) => b[1].tables - a[1].tables || a[1].short.localeCompare(b[1].short, "en"));
  const slotOf = new Map(ranked.map(([id], i) => [id, i < PUBLISHER_SLOTS ? i : null] as const));
  const publishers: TimelinePublisher[] = ranked.slice(0, PUBLISHER_SLOTS).map(([id, p], i) => ({ id, short: p.short, slot: i, tables: p.tables }));
  const rest = ranked.slice(PUBLISHER_SLOTS);
  if (rest.length)
    publishers.push({ id: "other", short: `${n(rest.length)} other ${rest.length === 1 ? "publisher" : "publishers"}`, slot: null, tables: rest.reduce((s, [, p]) => s + p.tables, 0) });
  const out: TimelineRow[] = placed
    .map((p) => ({ ...p, slot: slotOf.get(p.publisherId) ?? null }))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || a.title.localeCompare(b.title, "en"));
  const fromYear = out.length ? Math.min(...out.map((r) => year(r.start))) : 0;
  const toYear = out.length ? Math.max(...out.map((r) => year(r.end))) : 0;
  return { rows: out, fromYear, toYear, publishers, tables: rows.length, noPeriod, notDates, notCounted };
}

/** "84 of 95 tables placed by their periods, from 1949 to 2026; 9 have no period, 2 have periods that are not dates." */
export function timelineCaption(t: Timeline): string {
  if (!t.rows.length) return `None of the ${n(t.tables)} tables has periods that are dates.`;
  const parts = [`${n(t.rows.length)} of ${n(t.tables)} tables placed by their periods, from ${t.fromYear} to ${t.toYear}; newest last period first`];
  const notes: string[] = [];
  if (t.noPeriod) notes.push(`${n(t.noPeriod)} ${t.noPeriod === 1 ? "has" : "have"} no period`);
  if (t.notDates) notes.push(`${n(t.notDates)} ${t.notDates === 1 ? "has periods" : "have periods"} that are not dates`);
  if (t.notCounted) notes.push(`${n(t.notCounted)} ${t.notCounted === 1 ? "is" : "are"} not counted yet`);
  return `${parts.join("")}${notes.length ? `. ${notes.join(", ")}` : ""}.`;
}

/** Year ticks on clean steps (1, 2, 5, 10, 20, 25 or 50 years, on years divisible by the step), about `room`, the last year always named. */
export function yearTicks(fromYear: number, toYear: number, room: number): number[] {
  const span = toYear - fromYear + 1;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => Math.floor(span / s) + 1 <= Math.max(2, room)) ?? 100;
  const ticks: number[] = [];
  for (let y = Math.ceil(fromYear / step) * step; y <= toYear; y += step) ticks.push(y);
  if (!ticks.length) ticks.push(fromYear);
  // the last year is named; a tick less than a step before it gives way
  while (ticks.length && toYear - ticks[ticks.length - 1] < step && ticks[ticks.length - 1] !== toYear) ticks.pop();
  if (ticks[ticks.length - 1] !== toYear) ticks.push(toYear);
  return ticks;
}
