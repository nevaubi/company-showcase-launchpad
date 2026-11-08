// Insider timeline points from Form 4 rows: discretionary buys and sells, 10b5-1 plan sales, and funds / holding
// companies / 10% owners kept on their own layer. One economic transaction reported by several related filers (a
// holding company and the trust that controls it) is drawn once.
import type { InsiderTrade } from "@/lib/financials/types";

export type OwnerKind = "officer" | "director" | "holder" | "other";
export type PointKind = "buy" | "sell" | "plan";

const ENTITY =
  /\b(L\.?P\.?|LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION|LTD\.?|ADVISORS?|ADVISERS?|CAPITAL|PARTNERS|FUNDS?|MANAGEMENT|HOLDINGS?|TRUST|INVESTMENTS?|GROUP|FOUNDATION|ASSOCIATES|VENTURES|PLC|N\.V\.|S\.A\.|GMBH|AG)\b/i;
const OFFICER =
  /\b(chief|ceo|cfo|coo|cto|president|officer|vp|vice president|evp|svp|treasurer|secretary|controller|general counsel|chair(man|woman|person)?)\b/i;

export const cleanOwner = (name: string) => (name || "").replace(/\s*\(\+\d+\)\s*$/, "").trim();

export function ownerKind(owner: string, role: string): OwnerKind {
  const name = cleanOwner(owner);
  if (ENTITY.test(name)) return "holder";
  if (OFFICER.test(role || "")) return "officer";
  if (/\bdirector\b/i.test(role || "")) return "director";
  if ((role || "").includes("10%")) return "holder";
  return "other";
}

export interface TimelinePoint {
  date: string;
  kind: PointKind;
  holder: boolean;
  value: number;
  shares: number;
  price: number;
  owner: string;
  role: string;
  accn: string;
  doc: string;
  filed: string;
  joint: string[];
}

/** P and S open-market trades with a price, joint filings collapsed, newest last. */
export function timelinePoints(rows: InsiderTrade[]): TimelinePoint[] {
  const seen = new Map<string, TimelinePoint>();
  const out: TimelinePoint[] = [];
  const sorted = [...rows].sort((a, b) => (a.filed + a.accn).localeCompare(b.filed + b.accn));
  for (const r of sorted) {
    if ((r.code !== "P" && r.code !== "S") || r.price == null || !(r.price > 0) || !(r.shares > 0)) continue;
    const key =
      r.ownedAfter != null ? [r.date, r.code, r.security, r.shares, r.price.toFixed(4), r.ownedAfter].join("|") : null;
    const owner = cleanOwner(r.owner);
    const first = key ? seen.get(key) : undefined;
    if (first && first.owner !== owner) {
      if (!first.joint.includes(owner)) first.joint.push(owner);
      continue;
    }
    const p: TimelinePoint = {
      date: r.date,
      kind: r.code === "P" ? "buy" : r.plan10b5 ? "plan" : "sell",
      holder: ownerKind(r.owner, r.role) === "holder",
      value: r.shares * r.price,
      shares: r.shares,
      price: r.price,
      owner,
      role: r.role,
      accn: r.accn,
      doc: r.doc,
      filed: r.filed,
      joint: [],
    };
    if (key) seen.set(key, p);
    out.push(p);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface TimelineTotals {
  buys: number;
  buyValue: number;
  sells: number;
  sellValue: number;
  plan: number;
  planValue: number;
  buyers: number;
}

export function totals(points: TimelinePoint[], since: string, holders = false): TimelineTotals {
  const t: TimelineTotals = { buys: 0, buyValue: 0, sells: 0, sellValue: 0, plan: 0, planValue: 0, buyers: 0 };
  const who = new Set<string>();
  for (const p of points) {
    if (p.date < since || p.holder !== holders) continue;
    if (p.kind === "buy") {
      t.buys++;
      t.buyValue += p.value;
      who.add(p.owner);
    } else if (p.kind === "sell") {
      t.sells++;
      t.sellValue += p.value;
    } else {
      t.plan++;
      t.planValue += p.value;
    }
  }
  t.buyers = who.size;
  return t;
}
