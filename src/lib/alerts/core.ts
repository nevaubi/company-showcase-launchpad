// Watchlist alerts — pure diffing of already-sourced rows into one inbox (no I/O).

export type AlertKind = "filing" | "insider" | "supply" | "alt" | "idea";

export interface Alert {
  id: string;
  ticker: string;
  kind: AlertKind;
  /** ISO timestamp used for ordering and unread state */
  at: string;
  title: string;
  detail?: string;
  /** SEC filing to open in the source panel */
  filing?: { accn: string; doc: string; form: string; filed: string };
  url?: string;
  /** In-app page */
  path?: string;
}

export interface AlertInputs {
  tickers: string[];
  since: string;
  filings: { accn: string; ticker: string; form: string; filed: string; doc: string; description: string | null; items: string | null; discovered_at: string }[];
  insiders: { accn: string; seq: number; ticker: string; owner: string; role: string; code: string; shares: number; price: number | null; plan_10b5: boolean; trade_date: string; doc: string; filed: string; discovered_at: string }[];
  links: { id: string; ticker: string; counterparty: string; relation: string; detail: string; accn: string; doc: string; form: string; filed: string; created_at: string; is_current: boolean }[];
  alt: { uid: string; ticker: string; dataset: string; title: string; date: string | null; source_url: string | null; created_at: string }[];
  ideas: { ticker: string; asOf: string; direction: string; signals: { detail: string }[] }[];
}

const MATERIAL = /^(10-K|10-Q|8-K|S-1|S-4|DEF 14A|SC 13D|SC 13G|424B)/;
const ITEM_NAMES: Record<string, string> = {
  "1.01": "material agreement", "2.01": "acquisition/disposal", "2.02": "results", "2.05": "restructuring", "2.06": "impairment",
  "5.02": "executive change", "7.01": "Reg FD disclosure", "8.01": "other event", "1.05": "cybersecurity incident", "4.02": "non-reliance on financials",
};
const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

export function buildAlerts(inp: AlertInputs): Alert[] {
  const watch = new Set(inp.tickers.map((t) => t.toUpperCase()));
  const ok = (t: string, d: string | null | undefined) => watch.has(t) && !!d && d >= inp.since;
  const out: Alert[] = [];
  for (const f of inp.filings) {
    if (!ok(f.ticker, f.filed) || !MATERIAL.test(f.form)) continue;
    const items = (f.items ?? "").split(",").map((s) => ITEM_NAMES[s.trim()]).filter(Boolean);
    out.push({
      id: `f:${f.accn}`, ticker: f.ticker, kind: "filing", at: f.discovered_at,
      title: `${f.form} filed${items.length ? ` — ${items.join(", ")}` : ""}`, detail: f.description ?? undefined,
      filing: { accn: f.accn, doc: f.doc, form: f.form, filed: f.filed },
    });
  }
  // Open-market buys/sells, grouped per filing so one Form 4 is one alert.
  const byForm = new Map<string, AlertInputs["insiders"]>();
  for (const x of inp.insiders) {
    if (!ok(x.ticker, x.filed) || (x.code !== "P" && x.code !== "S")) continue;
    byForm.set(x.accn, [...(byForm.get(x.accn) ?? []), x]);
  }
  for (const [accn, xs] of byForm) {
    const x = xs[0];
    const buy = xs.some((r) => r.code === "P");
    const value = xs.reduce((a, r) => a + r.shares * (r.price ?? 0), 0);
    out.push({
      id: `i:${accn}`, ticker: x.ticker, kind: "insider", at: x.discovered_at,
      title: `${x.owner} (${x.role}) ${buy ? "bought" : "sold"}${value ? ` ${usd(value)}` : ""}`,
      detail: xs.some((r) => r.plan_10b5) ? "Under a 10b5-1 plan" : "Discretionary open-market trade",
      filing: { accn, doc: x.doc, form: "4", filed: x.filed },
    });
  }
  for (const l of inp.links) {
    // Re-reads recreate rows, so a link only alerts when the filing that discloses it is new.
    if (!l.is_current || !ok(l.ticker, l.filed)) continue;
    out.push({
      id: `s:${l.id}`, ticker: l.ticker, kind: "supply", at: `${l.filed}T12:00:00Z`,
      title: `Supply chain: ${l.relation} ${l.counterparty}`, detail: l.detail,
      filing: { accn: l.accn, doc: l.doc, form: l.form, filed: l.filed },
    });
  }
  for (const a of inp.alt) {
    // Federal Register notices mention big companies constantly; only company-specific datasets alert.
    if (!ok(a.ticker, a.date) || a.dataset === "regulatory") continue;
    out.push({ id: `a:${a.uid}`, ticker: a.ticker, kind: "alt", at: `${a.date}T12:00:00Z`, title: a.title, detail: a.dataset, url: a.source_url ?? undefined });
  }
  for (const i of inp.ideas) {
    if (!ok(i.ticker, i.asOf)) continue;
    out.push({
      id: `t:${i.ticker}:${i.asOf}:${i.direction}`, ticker: i.ticker, kind: "idea", at: `${i.asOf}T21:00:00Z`,
      title: `${i.direction === "long" ? "Long" : "Short"} setup: ${i.signals.length} rule${i.signals.length === 1 ? "" : "s"} aligned`,
      detail: i.signals.map((s) => s.detail).slice(0, 2).join(" · "), path: "/app/ideas",
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export const unreadCount = (alerts: Pick<Alert, "at">[], lastSeen: string | null) =>
  lastSeen ? alerts.filter((a) => a.at > lastSeen).length : alerts.length;
