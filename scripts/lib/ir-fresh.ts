/**
 * Fresh lane for the IR deep loop (round 8): a company's newest release must not wait behind
 * thousands of its old files. Before the loop takes its next company (priority campaign or normal
 * order) it reads, in one pass, the recently filed table documents of leading companies, newest
 * first, and only those files; then the companies that gained figures are rebuilt.
 *   IR_FRESH_DAYS=45        files filed in the last N days (0 turns the lane off)
 *   IR_FRESH_TOP=200        companies ranked 1..N by 20-day dollar volume, plus every company of the priority campaign
 *   IR_FRESH_MAX_FILES=60   files per pass; one pass between two company starts
 * A file is tried at most FRESH_MAX_TRIES times by the lane (a pass stopped on credits, or one whose
 * reader never started, does not count); then it is left to the normal order. Decks (kind
 * presentation) stay with the company run unless the company has no other fresh file; images are
 * never table documents. Pure: the loop owns the state and the database reads.
 */

export const FRESH_MAX_TRIES = 2;

export interface FreshSettings {
  /** window in days; 0 = lane off */
  days: number;
  /** companies by rank 1..top */
  top: number;
  /** files per pass */
  maxFiles: number;
}

const int = (v: string | undefined, dflt: number, min: number, max: number) => {
  if (v === undefined || v.trim() === "") return dflt;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(max, n) : dflt;
};

/** Settings from the environment. IR_FRESH_DAYS=0 turns the lane off; bad values fall back to the defaults. */
export function freshSettings(env: Record<string, string | undefined>): FreshSettings {
  return {
    days: int(env["IR_FRESH_DAYS"], 45, 0, 365),
    top: int(env["IR_FRESH_TOP"], 200, 1, 5000),
    maxFiles: int(env["IR_FRESH_MAX_FILES"], 60, 1, 500),
  };
}

/** First filed date inside the window (UTC day), or null when the lane is off. */
export function freshSince(s: FreshSettings, nowMs: number): string | null {
  if (s.days <= 0) return null;
  return new Date(nowMs - s.days * 86_400_000).toISOString().slice(0, 10);
}

/** Companies the lane serves: the priority campaign (in its order), then ranks 1..top by rank. */
export function freshCompanies(priorityOrder: readonly string[], rank: Map<string, number>, top: number): string[] {
  const out = [...new Set(priorityOrder)];
  const seen = new Set(out);
  for (const [t] of [...rank].filter(([, r]) => r <= top).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** An unread table document as the loop reads it (extract_status and extracted_at null, readable as HTML, kind extractable). */
export interface FreshDoc {
  id: string;
  ticker: string;
  kind: string;
  filed: string | null;
  accn?: string | null;
}

export type FreshSkip = "running" | "review" | "tried" | "deck" | "undated" | "future" | "old" | "outside" | "cap";

export interface FreshPlan {
  /** files to read this pass, newest first */
  ids: string[];
  /** companies of those files, in the order of their first file */
  tickers: string[];
  /** files left out, by reason */
  skipped: Partial<Record<FreshSkip, number>>;
  /** tries kept for the next pass: only files still among the candidates */
  tries: Record<string, number>;
}

export interface FreshInput {
  settings: FreshSettings;
  nowMs: number;
  /** companies served (freshCompanies) */
  companies: readonly string[];
  /** companies a lane is reading now */
  busy: ReadonlySet<string>;
  /** companies set aside for review */
  review: Record<string, string>;
  /** lane tries per file id */
  tries: Record<string, number>;
  /** the candidate rows were cut at the query limit: tries of unseen files are kept */
  truncated?: boolean;
}

/**
 * The files of one pass: unread fresh table documents of the served companies, newest filed first
 * (then company order, then id), at most maxFiles. Empty when the lane is off.
 */
export function planFresh(docs: readonly FreshDoc[], o: FreshInput): FreshPlan {
  const skipped: Partial<Record<FreshSkip, number>> = {};
  const skip = (r: FreshSkip) => (skipped[r] = (skipped[r] ?? 0) + 1);
  const since = freshSince(o.settings, o.nowMs);
  if (!since) return { ids: [], tickers: [], skipped, tries: { ...o.tries } };
  const today = new Date(o.nowMs).toISOString().slice(0, 10);
  const order = new Map(o.companies.map((t, i) => [t, i]));
  const tries: Record<string, number> = {};
  const ok: FreshDoc[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    if (o.tries[d.id]) tries[d.id] = o.tries[d.id]!;
    if (!order.has(d.ticker)) skip("outside");
    else if (!d.filed) skip("undated");
    else if (d.filed > today) skip("future");
    else if (d.filed < since) skip("old");
    else if (o.busy.has(d.ticker)) skip("running");
    else if (o.review[d.ticker]) skip("review");
    else if ((o.tries[d.id] ?? 0) >= FRESH_MAX_TRIES) skip("tried");
    else ok.push(d);
  }
  if (o.truncated) for (const [id, n] of Object.entries(o.tries)) if (!(id in tries)) tries[id] = n;
  // Decks only for a company with no other fresh file.
  const tables = new Set(ok.filter((d) => d.kind !== "presentation").map((d) => d.ticker));
  const eligible = ok.filter((d) => {
    if (d.kind === "presentation" && tables.has(d.ticker)) {
      skip("deck");
      return false;
    }
    return true;
  });
  eligible.sort((a, b) => (b.filed! < a.filed! ? -1 : b.filed! > a.filed! ? 1 : 0) || order.get(a.ticker)! - order.get(b.ticker)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const take = eligible.slice(0, o.settings.maxFiles);
  for (let i = take.length; i < eligible.length; i++) skip("cap");
  return { ids: take.map((d) => d.id), tickers: [...new Set(take.map((d) => d.ticker))], skipped, tries };
}

/** One log line for a pass. */
export function freshLine(p: FreshPlan, candidates: number): string {
  const why = Object.entries(p.skipped)
    .filter(([, n]) => n)
    .map(([r, n]) => `${r} ${n}`)
    .join(", ");
  if (!p.ids.length) return `fresh lane: nothing to read (${candidates} candidates${why ? `; skipped: ${why}` : ""})`;
  return `fresh lane: ${p.ids.length} files of ${p.tickers.length} companies (${p.tickers.slice(0, 12).join(", ")}${p.tickers.length > 12 ? ", ..." : ""}); skipped: ${why || "none"}`;
}

/** How a pass ended, from the child's stop reason. */
export type FreshOutcome = "credits" | "not-run" | "ran";
export function freshOutcome(stopped: string | null | undefined): FreshOutcome {
  if (stopped && /quota|auth|credit|payment|402|outage|budget/i.test(stopped)) return "credits";
  if (stopped && /^busy|without a spend report/i.test(stopped)) return "not-run";
  return "ran";
}

/** Tries after a pass: counted only when the reader ran (credit stops and readers that never started leave the files as they were). */
export function settleFresh(tries: Record<string, number>, ids: readonly string[], outcome: FreshOutcome): Record<string, number> {
  if (outcome !== "ran") return tries;
  for (const id of ids) tries[id] = (tries[id] ?? 0) + 1;
  return tries;
}

/** A pass is due at start and after every company start (one pass between two company runs), never beside another. */
export function freshDue(o: { settings: FreshSettings; running: boolean; companiesStartedSincePass: number; passes: number }): boolean {
  if (o.settings.days <= 0 || o.running) return false;
  return o.passes === 0 || o.companiesStartedSincePass > 0;
}

// ---------- ir-extract.ts --ids / --since ----------
export interface ExtractScope {
  ticker?: string;
  ids?: string[];
  since?: string;
}

/** `--ids=a,b` and `--since=2026-10-01` as given (empty when neither is set). */
export function extractScope(a: Record<string, string | undefined>): ExtractScope {
  const ids = (a["ids"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const since = (a["since"] ?? "").trim();
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since must be a date (YYYY-MM-DD)");
  return { ...(a["ticker"] ? { ticker: a["ticker"] } : {}), ...(ids.length ? { ids } : {}), ...(since ? { since } : {}) };
}

export const scoped = (s: ExtractScope) => !!(s.ids?.length || s.since);
