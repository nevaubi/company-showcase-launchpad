import { queryOptions } from "@tanstack/react-query";
import type { PatternEdge, PatternKind, Reaction, ReactionStats } from "./core";

export interface PatternEvent {
  kind: PatternKind;
  date: string;
  price: number;
  fwd20: number | null;
  levels?: number[];
  ago?: number;
}
export interface MarketCompany {
  ticker: string;
  sector: string;
  asOf: string;
  price: number;
  reactions: Reaction[];
  stats: ReactionStats;
  active: PatternEvent[];
  recent: PatternEvent[];
  edges: PatternEdge[];
  levels: {
    support: { price: number; touches: number }[];
    resistance: { price: number; touches: number }[];
  };
}
export interface MarketsFile {
  generatedAt: string;
  companies: MarketCompany[];
}
export interface ReturnsFile {
  dates: string[];
  returns: Record<string, (number | null)[]>;
}

const get = async <T>(p: string) => {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`Could not load ${p}`);
  return (await r.json()) as T;
};

export const marketsQuery = queryOptions({
  queryKey: ["markets-file"],
  queryFn: () => get<MarketsFile>("/data/markets.json"),
  staleTime: Infinity,
});
export const returnsQuery = queryOptions({
  queryKey: ["returns-file"],
  queryFn: () => get<ReturnsFile>("/data/returns.json"),
  staleTime: Infinity,
});

/** Returns of one symbol as a date → return map (nulls dropped). */
export function returnMap(f: ReturnsFile, sym: string): Map<string, number> {
  const r = f.returns[sym];
  const m = new Map<string, number>();
  if (r) r.forEach((v, i) => v != null && m.set(f.dates[i], v));
  return m;
}

/** Compounded return over the last n sessions. */
export function trailing(f: ReturnsFile, sym: string, n: number): number | null {
  const r = f.returns[sym];
  if (!r) return null;
  const xs = r.slice(-n).filter((v): v is number => v != null);
  return xs.length < n * 0.8 ? null : xs.reduce((a, v) => a * (1 + v), 1) - 1;
}
