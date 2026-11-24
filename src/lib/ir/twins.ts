// Twin period columns (pure; first step of the tidy pass). A 52/53-week company's quarter can be
// printed with two dates a week apart: the fiscal end in the release table (27 Aug 2026) and the
// calendar month or week end in a deck or data file (3 Sep 2026). The build keeps printed dates up to
// 6 days apart as one column and treats dates a week or more apart as different periods (a retail month
// next to a 12-week quarter), so such a quarter showed twice with the same figures. Two ends 7 to 10
// days apart are one period when every line that prints both prints the identical figure, at least
// two lines do (or one line, when no line prints either end alone), and no line prints different
// figures; the end more cells use is kept and every cell keeps its own source.
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

type Kind = "q" | "y";

function plan(p: IrPayload, kind: Kind): Map<string, string> {
  const ends = [...new Set(p.series.flatMap((s) => Object.keys(s[kind])))].sort();
  const into = new Map<string, string>();
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      const gap = (ms(b) - ms(a)) / DAY;
      if (gap > 10) break;
      if (gap < 7 || into.has(a) || into.has(b)) continue;
      let same = 0;
      let differ = 0;
      let na = 0;
      let nb = 0;
      for (const s of p.series) {
        const x = s[kind][a];
        const y = s[kind][b];
        if (x) na++;
        if (y) nb++;
        if (x && y) {
          if (x.v === y.v) same++;
          else differ++;
        }
      }
      if (differ || !same) continue;
      // One shared figure is enough only when the two dates never appear apart.
      if (same < 2 && (na > same || nb > same)) continue;
      const keep = na >= nb ? a : b;
      into.set(keep === a ? b : a, keep);
    }
  return into;
}

export function mergeTwinEnds(p: IrPayload): IrPayload {
  const q = plan(p, "q");
  const y = plan(p, "y");
  if (!q.size && !y.size) return p;
  const move = (cells: Record<string, PayloadCell>, into: Map<string, string>) => {
    const out: Record<string, PayloadCell> = {};
    for (const [e, c] of Object.entries(cells)) {
      const k = into.get(e);
      // The kept end's own cell wins; a twin's cell moves over only where the kept end has none.
      if (!k) out[e] = c;
      else if (!cells[k]) out[k] = c;
    }
    return out;
  };
  const series: PayloadSeries[] = p.series.map((s) => ({
    ...s,
    q: move(s.q, q),
    y: move(s.y, y),
    ...(s.held ? { held: { ...s.held, ...(s.held.q ? { q: move(s.held.q, q) } : {}), ...(s.held.y ? { y: move(s.held.y, y) } : {}) } } : {}),
  }));
  const seen = new Set<string>();
  const checks = p.checks
    .map((c) => ({ ...c, e: (c.kind === "q" ? q : y).get(c.e) ?? c.e }))
    .filter((c) => {
      const id = `${c.k}|${c.kind}|${c.e}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return {
    ...p,
    series,
    checks,
    quarters: p.quarters.filter((e) => !q.has(e) && !y.has(e)),
    years: p.years.filter((e) => !y.has(e)),
  };
}
