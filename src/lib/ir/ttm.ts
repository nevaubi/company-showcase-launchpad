// Trailing-twelve-month figures (pure; run at the start of `tidyPayload`, so on load for every stored
// or partner payload and in every new build). A TTM figure is twelve months of flow, or a ratio over
// twelve months, printed at a quarter-end: under a quarter head it reads as that quarter's figure, and
// under a fiscal-year head as the fiscal year's (review p3-ir H1: AMZN, HIG, HOOD, AMP, UNFI, EQH, ZM).
// Such figures are taken out of the quarter and year columns; each line keeps the count it lost in
// `ttm`, and the payload the total in `stats.ttm`, so the page can say how many the documents carry.
import type { IrPayload, PayloadCell, PayloadCheck, PayloadSeries } from "@/lib/ir/payload";
import { closingMonth } from "@/lib/ir/periods";

/** Words that make a figure a trailing-twelve-month one. */
export const TRAILING_WORDS = /\b(last|trailing|latest)[ -](twelve|12)[ -]months?\b|\b(ttm|ltm)\b|\btrailing (four|4) quarters\b/i;
/**
 * "Customers contributing more than $100,000 in trailing 12 months revenue" is a count at the
 * quarter-end: the twelve months qualify the threshold, not the figure.
 */
const THRESHOLD = /(>|≥|\bmore than|\bover|\bgreater than|\bat least|\bexceeding|\babove)\s*\$/i;

/** Whether a line's printed name or its table's says trailing twelve months. */
export function trailingLine(s: Pick<PayloadSeries, "label" | "bd" | "sc">): boolean {
  if (THRESHOLD.test(s.label) && TRAILING_WORDS.test(s.label)) return false;
  return TRAILING_WORDS.test(`${s.label} ${s.bd ?? ""} ${s.sc ?? ""}`);
}

/** Whether one cell is a TTM figure whatever its line: its source sentence says so, or it spans twelve months in a quarter column. */
export function trailingCell(c: PayloadCell, kind: "q" | "y" | "mo"): boolean {
  if (kind !== "y" && c.m === 12) return true;
  return !!c.x && TRAILING_WORDS.test(c.x) && !THRESHOLD.test(c.x);
}

const DAY = 86_400_000;

/**
 * Year columns that close twelve months off the company's fiscal year-end.
 *
 * With the company's 10-K year-ends (`annual`, from its statements): a year column closing in another
 * month than the nearest 10-K year-end within a year is a trailing twelve months (HOOD's 12-month
 * figures at Jun 2025 and Jun 2026, fiscal years ending December); a column with no 10-K year-end
 * within a year is left alone (an older era the statements don't reach).
 *
 * Without them, the payload's own evidence: Q4 derived as "Full year − ..." and years summed from four
 * quarters mark a fiscal year-end strongly, other figures of flows one vote each; the winning month
 * must have at least twice the votes of any other, and a column in another month within a year after
 * one of its year-ends is moved. Without a clear winner nothing is moved.
 */
export function offYearEnds(series: PayloadSeries[], annual?: string[] | null): Set<string> {
  const ends = new Set<string>();
  for (const s of series) if (!s.pit) for (const e of Object.keys(s.y)) ends.add(e);
  const out = new Set<string>();
  if (annual?.length) {
    const fy = annual.map((a) => Date.parse(a));
    for (const e of ends) {
      const t = Date.parse(e);
      const near = fy.filter((y) => Math.abs(y - t) <= 371 * DAY).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
      if (near != null && closingMonth(new Date(near).toISOString().slice(0, 10)) !== closingMonth(e)) out.add(e);
    }
    return out;
  }
  const n = new Map<number, number>();
  const vote = (e: string, w: number) => n.set(closingMonth(e), (n.get(closingMonth(e)) ?? 0) + w);
  for (const s of series) {
    if (s.pit) continue;
    for (const [e, c] of Object.entries(s.y)) vote(e, /^Q1 \+ Q2 \+ Q3 \+ Q4/.test(c.f?.formula ?? "") ? 4 : 1);
    for (const [e, c] of Object.entries(s.q)) if (/^Full year −/.test(c.f?.formula ?? "")) vote(e, 4);
  }
  const ranked = [...n.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || (ranked[1] && ranked[1][1] * 2 > ranked[0][1])) return out;
  const fy = ranked[0][0];
  const fyEnds = [...ends, ...series.flatMap((s) => Object.keys(s.q).filter((e) => /^Full year −/.test(s.q[e].f?.formula ?? "")))].filter((e) => closingMonth(e) === fy).map((e) => Date.parse(e));
  for (const e of ends) {
    if (closingMonth(e) === fy) continue;
    const t = Date.parse(e);
    if (fyEnds.some((y) => y < t && t - y <= 371 * DAY)) out.add(e);
  }
  return out;
}

/** The company's fiscal year-ends from its statements' annual columns (twelve-month periods only). */
export function annualEnds(periods: { end: string; start?: string }[] | null | undefined): string[] {
  return (periods ?? []).filter((x) => !x.start || Math.abs(Date.parse(x.end) - Date.parse(x.start) - 364 * DAY) <= 20 * DAY).map((x) => x.end);
}

type Kind = "q" | "y" | "mo";

/** Take TTM figures out of the quarter, year and month columns (see the file comment). */
export function splitTrailing(p: IrPayload, annual?: string[] | null): IrPayload {
  const off = offYearEnds(p.series.filter((s) => !trailingLine(s)), annual);
  let total = 0;
  const lost = new Set<string>(); // `${key}|${kind}|${end}`
  const series = p.series.map((s) => {
    const whole = trailingLine(s);
    let n = 0;
    const pick = (cells: Record<string, PayloadCell> | undefined, kind: Kind) => {
      if (!cells) return cells;
      let out: Record<string, PayloadCell> | undefined;
      for (const [e, c] of Object.entries(cells)) {
        const ttm = whole || trailingCell(c, kind) || (kind === "y" && !s.pit && off.has(e));
        if (!ttm) continue;
        out ??= { ...cells };
        delete out[e];
        n++;
        lost.add(`${s.k}|${kind}|${e}`);
      }
      return out ?? cells;
    };
    const q = pick(s.q, "q")!;
    const y = pick(s.y, "y")!;
    const mo = pick(s.mo, "mo");
    const held = s.held ? { ...(s.held.q ? { q: pick(s.held.q, "q") } : {}), ...(s.held.y ? { y: pick(s.held.y, "y") } : {}), ...(s.held.mo ? { mo: pick(s.held.mo, "mo") } : {}) } : undefined;
    if (!n) return s;
    total += n;
    return { ...s, q, y, ...(mo ? { mo } : {}), ...(held ? { held } : {}), ttm: (s.ttm ?? 0) + n };
  });
  if (!total) return p;
  // Columns only TTM figures filled go; checks on a total or a part that lost its figure go.
  const used = (kind: Kind) => {
    const u = new Set<string>();
    for (const s of series) {
      const lists = kind === "q" ? [s.q, s.held?.q, s.pit ? s.mo : undefined] : kind === "y" ? [s.y, s.held?.y] : [s.mo, s.held?.mo];
      for (const l of lists) if (l) for (const e of Object.keys(l)) u.add(e);
    }
    return u;
  };
  const lostEnds = (kind: Kind) => new Set([...lost].filter((x) => x.split("|")[1] === kind).map((x) => x.split("|")[2]));
  const keep = (ends: string[] | undefined, kind: Kind) => {
    if (!ends) return ends;
    const u = used(kind);
    const gone = lostEnds(kind);
    return ends.filter((e) => u.has(e) || !gone.has(e));
  };
  const kidsOf = new Map<string, string[]>();
  for (const s of series) if (s.parent) kidsOf.set(s.parent, [...(kidsOf.get(s.parent) ?? []), s.k]);
  const touches = (x: PayloadCheck) => {
    const kind = x.kind === "q" ? "q" : "y";
    return [x.k, ...(kidsOf.get(x.k) ?? []), ...(x.sub ?? [])].some((k) => lost.has(`${k}|${kind}|${x.e}`));
  };
  return {
    ...p,
    series,
    quarters: keep(p.quarters, "q")!,
    years: keep(p.years, "y")!,
    ...(p.months ? { months: keep(p.months, "mo") } : {}),
    checks: p.checks.filter((x) => !touches(x)),
    stats: { ...p.stats, ttm: (p.stats.ttm ?? 0) + total },
  };
}

/** Lines that still show a TTM figure under a quarter or year head (0 after `splitTrailing`); for counts and tests. */
export function trailingShown(p: IrPayload, annual?: string[] | null): string[] {
  const off = offYearEnds(p.series.filter((s) => !trailingLine(s)), annual);
  return p.series
    .filter((s) => {
      const whole = trailingLine(s);
      const any = (cells: Record<string, PayloadCell> | undefined, kind: Kind) => !!cells && Object.entries(cells).some(([e, c]) => whole || trailingCell(c, kind) || (kind === "y" && !s.pit && off.has(e)));
      return any(s.q, "q") || any(s.y, "y") || any(s.mo, "mo");
    })
    .map((s) => s.k);
}
