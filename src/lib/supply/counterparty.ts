import { entityKey } from "./core";

export interface CpSignal {
  id: string; kind: string; counterparty: string | null; quote: string; amount_usd: number | null; pct: number | null;
  period: string | null; speaker: string | null; source_kind: string; filed: string | null; accn: string | null;
}
export type CpConfidence = "high" | "medium" | "low";

const UNNAMED = /^(a |an |one |two |three |certain |unnamed|undisclosed|customer [a-z]$|n\/a|none|various|multiple)/i;
export const isNamed = (cp: string | null): boolean => !!cp && cp.trim().length > 1 && !UNNAMED.test(cp.trim());

/** Signed contract exhibit naming the party = high; a management statement on a call naming it, or an exhibit with an unnamed party = medium; anything else = low. */
export function signalConfidence(s: CpSignal): CpConfidence {
  const named = isNamed(s.counterparty);
  const quoteNames = named && s.quote.toLowerCase().includes(s.counterparty!.trim().toLowerCase().split(/[ ,]/)[0]);
  if (s.source_kind === "exhibit") return named ? "high" : "medium";
  if (s.source_kind === "transcript") return named && (quoteNames || s.speaker) ? "medium" : "low";
  return "low";
}

export interface Counterparty<T extends CpSignal> {
  key: string; name: string; signals: T[]; contracts: number; calls: number;
  first: string | null; last: string | null; confidence: CpConfidence; amount: number | null;
}

const RANK: Record<CpConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Groups contract and earnings-call statements by counterparty (merged via entityKey), newest first. */
export function byCounterparty<T extends CpSignal>(signals: T[]): Counterparty<T>[] {
  const m = new Map<string, Counterparty<T>>();
  for (const s of signals) {
    if (s.kind !== "contract" && s.kind !== "call") continue;
    for (const name of (s.counterparty ?? "").split(/;|\s\/\s/).map((x) => x.trim()).filter(isNamed)) {
    const key = entityKey(name, null);
    const g = m.get(key) ?? { key, name, signals: [], contracts: 0, calls: 0, first: null, last: null, confidence: "low" as CpConfidence, amount: null };
    g.signals.push(s);
    if (s.kind === "contract") g.contracts++; else g.calls++;
    if (s.filed) { if (!g.first || s.filed < g.first) g.first = s.filed; if (!g.last || s.filed > g.last) g.last = s.filed; }
    const c = signalConfidence(s);
    if (RANK[c] > RANK[g.confidence]) g.confidence = c;
    if (s.amount_usd != null) g.amount = Math.max(g.amount ?? 0, s.amount_usd);
    if (name.length < g.name.length) g.name = name;
    m.set(key, g);
    }
  }
  for (const g of m.values()) g.signals.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""));
  return [...m.values()].sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.signals.length - a.signals.length || (b.last ?? "").localeCompare(a.last ?? ""));
}
