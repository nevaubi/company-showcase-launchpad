// Paper autopilots: fixed rules that turn each day's strategy signals into paper positions, filled at
// the next open and closed by the tested holding period (or stops/targets when chosen). Pure; the
// daily setups job feeds it market bars and writes the result.
import { z } from "zod";
import type { Family } from "./strategies";

export const BotRulesSchema = z.object({
  select: z.enum(["proven", "watch", "family", "variants"]).default("proven"),
  families: z.array(z.enum(["reversal", "momentum", "events", "links", "multi"])).max(6).default([]),
  variants: z.array(z.string().max(40)).max(60).default([]),
  side: z.enum(["both", "long", "short"]).default("both"),
  maxPositions: z.number().int().min(1).max(30).default(10),
  positionPct: z.number().min(0.01).max(0.25).default(0.1),
  maxPerSector: z.number().int().min(1).max(30).default(3),
  minStrength: z.number().min(0).max(50).default(0),
  /** "time" = exit at the tested holding period only; "stops" = also stop-loss / take-profit. */
  exits: z.enum(["time", "stops"]).default("time"),
});
export type BotRules = z.infer<typeof BotRulesSchema>;

export function parseRules(x: unknown): BotRules {
  const r = BotRulesSchema.safeParse(x ?? {});
  return r.success ? r.data : BotRulesSchema.parse({});
}

export interface Candidate {
  ticker: string;
  name: string;
  sector: string;
  variant: string;
  strategy: string;
  family: Family;
  side: 1 | -1;
  horizon: number;
  strength: number;
  price: number;
  atr: number;
  cost: number;
  stop: number;
  target: number;
  /** Ranking score: out-of-sample average net return of the variant. */
  edge: number;
  proven: boolean;
  near: boolean;
  /** The variant has made money in today's regime (required for proven/watch bots). */
  regimeOk: boolean;
}

export interface Position {
  id?: string;
  bot_id: string;
  ticker: string;
  name: string | null;
  sector: string | null;
  variant: string;
  strategy: string;
  side: 1 | -1;
  horizon: number;
  signal_date: string;
  signal_price: number | null;
  stop: number | null;
  target: number | null;
  atr: number | null;
  cost: number;
  status: "pending" | "open" | "closed" | "cancelled";
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  notional: number | null;
  spy_entry: number | null;
  exit_date: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  pnl: number | null;
  ret: number | null;
  ret_spy: number | null;
  close_requested: boolean;
}

export interface Ohlc {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface EquityRow {
  date: string;
  equity: number;
  invested: number;
  realized: number;
  open_positions: number;
  spy: number | null;
}

export interface StepInput {
  botId: string;
  rules: BotRules;
  capital: number;
  /** Trading dates (ascending) from the earliest open position's entry (or the bot's last day) to today. */
  calendar: string[];
  /** Last day already processed; only later calendar days are stepped. Null on the first run. */
  from: string | null;
  positions: Position[];
  /** Realised P&L of positions closed before this step. */
  realized: number;
  bars: Record<string, Record<string, Ohlc>>;
  spy: Record<string, Ohlc>;
  candidates: Candidate[];
}

/** Trading days a position may wait for its first bar before it is cancelled (halts, delistings). */
const MAX_FILL_WAIT = 3;

export function wants(rules: BotRules, c: Candidate): boolean {
  if (rules.side === "long" && c.side !== 1) return false;
  if (rules.side === "short" && c.side !== -1) return false;
  if (c.strength < rules.minStrength) return false;
  switch (rules.select) {
    case "proven":
      return c.proven && c.regimeOk;
    case "watch":
      return (c.proven || c.near) && c.regimeOk;
    case "family":
      return c.family !== "pairs" && rules.families.includes(c.family as never);
    case "variants":
      return rules.variants.includes(c.variant);
  }
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** Advance one bot through every trading day it hasn't processed yet, then queue today's new signals. */
export function stepBot(inp: StepInput): { positions: Position[]; equity: EquityRow[]; realized: number } {
  const { rules, calendar } = inp;
  const pos = inp.positions.map((p) => ({ ...p }));
  const touched = new Set<Position>();
  let realized = inp.realized;
  const equity: EquityRow[] = [];
  const today = calendar[calendar.length - 1];
  const openValue = (p: Position, px: number) => p.side * (px - p.entry_price!) * p.shares!;
  if (!calendar.length) return { positions: [], equity: [], realized };

  const close = (p: Position, date: string, px: number, reason: string) => {
    const gross = openValue(p, px);
    const pnl = gross - p.notional! * p.cost;
    const spyExit = inp.spy[date]?.c;
    p.status = "closed";
    p.exit_date = date;
    p.exit_price = round(px, 4);
    p.exit_reason = reason;
    p.pnl = round(pnl, 2);
    p.ret = round(pnl / p.notional!, 5);
    p.ret_spy = p.spy_entry && spyExit ? round(spyExit / p.spy_entry - 1, 5) : null;
    p.close_requested = false;
    realized += pnl;
    touched.add(p);
  };

  // Holding period counts trading days from the entry day (inclusive).
  const dayIdx = new Map(calendar.map((d, k) => [d, k]));
  const lastPx = new Map<string, number>();
  const firstStep = inp.from == null ? calendar.length - 1 : calendar.findIndex((d) => d > inp.from!);
  for (let k = 0; k < Math.max(firstStep, 0); k++)
    for (const p of pos) {
      const b = inp.bars[p.ticker]?.[calendar[k]];
      if (b) lastPx.set(p.ticker, b.c);
    }
  const markEquity = () => {
    let unreal = 0;
    for (const p of pos) if (p.status === "open") unreal += openValue(p, lastPx.get(p.ticker) ?? p.entry_price!);
    return inp.capital + realized + unreal;
  };

  for (let t = Math.max(firstStep, 0); firstStep >= 0 && t < calendar.length; t++) {
    const date = calendar[t];
    let invested = pos.filter((p) => p.status === "open").reduce((s, p) => s + p.notional!, 0);

    // 1. Fill orders queued on an earlier day at today's open.
    for (const p of pos.filter((x) => x.status === "pending" && x.signal_date < date)) {
      const bar = inp.bars[p.ticker]?.[date];
      const waited = t - (dayIdx.get(p.signal_date) ?? t - 1);
      if (!bar || !(bar.o > 0)) {
        if (waited >= MAX_FILL_WAIT) {
          p.status = "cancelled";
          p.exit_reason = "No trading after the signal";
          touched.add(p);
        }
        continue;
      }
      const eq = markEquity();
      const notional = eq * rules.positionPct;
      if (notional > eq - invested + 1e-6 || p.close_requested) {
        p.status = "cancelled";
        p.exit_reason = p.close_requested ? "Cancelled before entry" : "Not enough cash";
        p.close_requested = false;
        touched.add(p);
        continue;
      }
      p.status = "open";
      p.entry_date = date;
      p.entry_price = round(bar.o, 4);
      p.notional = round(notional, 2);
      p.shares = round(notional / bar.o, 6);
      p.spy_entry = inp.spy[date]?.o ?? null;
      // Re-anchor stops to the actual fill.
      if (p.signal_price && p.stop != null && p.target != null) {
        const dStop = p.signal_price - p.stop, dTgt = p.target - p.signal_price;
        p.stop = round(bar.o - dStop, 4);
        p.target = round(bar.o + dTgt, 4);
      }
      invested += notional;
      touched.add(p);
    }

    // 2. Exits on today's bar.
    for (const p of pos.filter((x) => x.status === "open")) {
      const bar = inp.bars[p.ticker]?.[date];
      if (!bar) continue;
      lastPx.set(p.ticker, bar.c);
      const held = t - (dayIdx.get(p.entry_date!) ?? t) + 1;
      if (rules.exits === "stops" && p.stop != null && p.target != null) {
        const hitStop = p.side > 0 ? bar.l <= p.stop : bar.h >= p.stop;
        const hitTgt = p.side > 0 ? bar.h >= p.target : bar.l <= p.target;
        // Both touched on one bar: assume the stop came first (conservative).
        if (hitStop) {
          close(p, date, p.side > 0 ? Math.min(bar.o, p.stop) : Math.max(bar.o, p.stop), "Stop");
          continue;
        }
        if (hitTgt) {
          close(p, date, p.side > 0 ? Math.max(bar.o, p.target) : Math.min(bar.o, p.target), "Target");
          continue;
        }
      }
      if (held >= p.horizon) close(p, date, bar.c, "Holding period");
      else if (p.close_requested && date === today) close(p, date, bar.c, "Closed by you");
    }

    // 3. Mark to market at the close.
    const open = pos.filter((p) => p.status === "open");
    equity.push({
      date,
      equity: round(markEquity(), 2),
      invested: round(open.reduce((s, p) => s + p.notional!, 0), 2),
      realized: round(realized, 2),
      open_positions: open.length,
      spy: inp.spy[date]?.c ?? null,
    });
  }

  // 4. Queue today's new signals for tomorrow's open.
  const active = pos.filter((p) => p.status === "open" || p.status === "pending");
  const held = new Set(active.map((p) => p.ticker));
  const perSector = new Map<string, number>();
  for (const p of active) perSector.set(p.sector ?? "", (perSector.get(p.sector ?? "") ?? 0) + 1);
  let slots = rules.maxPositions - active.length;
  const ranked = inp.candidates
    .filter((c) => wants(rules, c))
    .sort((a, b) => Number(b.proven) - Number(a.proven) || b.edge - a.edge || b.strength - a.strength);
  for (const c of ranked) {
    if (slots <= 0) break;
    if (held.has(c.ticker) || (perSector.get(c.sector) ?? 0) >= rules.maxPerSector) continue;
    const p: Position = {
      bot_id: inp.botId, ticker: c.ticker, name: c.name, sector: c.sector, variant: c.variant, strategy: c.strategy, side: c.side, horizon: c.horizon,
      signal_date: today, signal_price: c.price, stop: c.stop, target: c.target, atr: c.atr, cost: c.cost, status: "pending",
      entry_date: null, entry_price: null, shares: null, notional: null, spy_entry: null, exit_date: null, exit_price: null, exit_reason: null,
      pnl: null, ret: null, ret_spy: null, close_requested: false,
    };
    pos.push(p);
    touched.add(p);
    held.add(c.ticker);
    perSector.set(c.sector, (perSector.get(c.sector) ?? 0) + 1);
    slots--;
  }
  return { positions: pos.filter((p) => touched.has(p)), equity, realized };
}

export interface BotStats {
  totalReturn: number | null;
  spyReturn: number | null;
  excess: number | null;
  trades: number;
  hit: number | null;
  avgTrade: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  days: number;
}

/** Performance from the equity curve and closed trades. */
export function botStats(capital: number, equity: { date: string; equity: number; spy: number | null }[], closed: { ret: number | null }[]): BotStats {
  const eq = [...equity].sort((a, b) => (a.date < b.date ? -1 : 1));
  const rets: number[] = [];
  let peak = capital, dd = 0;
  for (let k = 0; k < eq.length; k++) {
    const prev = k ? eq[k - 1].equity : capital;
    if (prev > 0) rets.push(eq[k].equity / prev - 1);
    peak = Math.max(peak, eq[k].equity);
    dd = Math.min(dd, eq[k].equity / peak - 1);
  }
  const m = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : NaN;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) : NaN;
  const firstSpy = eq.find((r) => r.spy)?.spy ?? null, lastSpy = [...eq].reverse().find((r) => r.spy)?.spy ?? null;
  const total = eq.length ? eq[eq.length - 1].equity / capital - 1 : null;
  const spyRet = firstSpy && lastSpy ? lastSpy / firstSpy - 1 : null;
  const done = closed.filter((c) => c.ret != null) as { ret: number }[];
  return {
    totalReturn: total,
    spyReturn: spyRet,
    excess: total != null && spyRet != null ? total - spyRet : null,
    trades: done.length,
    hit: done.length ? done.filter((c) => c.ret > 0).length / done.length : null,
    avgTrade: done.length ? done.reduce((a, c) => a + c.ret, 0) / done.length : null,
    maxDrawdown: eq.length ? dd : null,
    sharpe: rets.length >= 20 && sd > 0 ? (m / sd) * Math.sqrt(252) : null,
    days: eq.length,
  };
}
