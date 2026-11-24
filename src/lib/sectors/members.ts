// One member list per page. Breadth is counted in several places (the board, the peers table, the summary
// strip, the company rows); they can only agree if they all ask the same list which companies belong to a
// group. The list is the pipeline's own assignment (`companies` in sectors.json), or the app's coverage
// list when that file does not carry it, with the open group's own file laid over it, so the strip, the
// group's row among its peers and the company table of one page rest on the same tickers. Pure.
import type { Constituent, Overview } from "./groups";

export interface Member {
  ticker: string;
  sector: string;
  industry: string;
}

/** A covered company as `src/lib/coverage.ts` lists it; `group` is the partner industry group. */
export interface CoverageLike {
  ticker: string;
  sector: string;
  group?: string;
  industry: string;
}

export interface MemberList {
  list: Member[];
  /** Where the assignment comes from. */
  from: "pipeline" | "coverage";
}

/** The pipeline's assignment when the overview file carries one, else the coverage list's industry groups. */
export function baseMembers(ov: Pick<Overview, "companies"> | null | undefined, coverage: readonly CoverageLike[]): MemberList {
  const cos = ov?.companies;
  if (cos?.length) return { list: cos.map((c) => ({ ticker: c.tk, sector: c.sector, industry: c.industry })), from: "pipeline" };
  return { list: coverage.map((c) => ({ ticker: c.ticker, sector: c.sector, industry: c.group ?? c.industry })), from: "coverage" };
}

/**
 * The list a group page uses: the base list with the open group's own constituents laid over it. Every
 * ticker the group file lists belongs to that group (and to no other), and nothing else does.
 */
export function pageMembers(
  base: readonly Member[],
  d?: { kind: "sector" | "industry"; name: string; sector: string; constituents: readonly Pick<Constituent, "tk" | "industry">[] } | null,
): Member[] {
  if (!d) return [...base];
  const own = new Set(d.constituents.map((c) => c.tk));
  const inGroup = (m: Member) => (d.kind === "sector" ? m.sector === d.name : m.sector === d.sector && m.industry === d.name);
  return [
    ...base.filter((m) => !own.has(m.ticker) && !inGroup(m)),
    ...d.constituents.map((c) => ({ ticker: c.tk, sector: d.sector, industry: d.kind === "industry" ? d.name : c.industry })),
  ];
}

/** Tickers of a sector (by sector name) or an industry (by its name within the sector). */
export function membersOf(kind: "sector" | "industry", name: string, sector: string, list: readonly Member[]): string[] {
  return list.filter((c) => (kind === "sector" ? c.sector === name : c.sector === sector && c.industry === name)).map((c) => c.ticker);
}
