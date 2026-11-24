/**
 * A small in-memory stand-in for the Supabase admin client, for job tests: tables are arrays of rows;
 * the query builder supports the filters the jobs use (eq, neq, in, lt, lte, gt, gte, like, is,
 * not … is null, a simple `or`), order, limit, single/maybeSingle, count/head, and insert, upsert
 * (with onConflict and ignoreDuplicates), update and delete. Writes are logged for assertions.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

const KEYS: Record<string, string[]> = {
  job_state: ["job"],
  job_runs: ["id"],
  options_daily: ["ticker", "date"],
  analyst_estimates: ["ticker"],
  earnings_events: ["ticker", "accn"],
  market_bars: ["symbol", "date"],
  sec_filings: ["accn"],
  macro_observations: ["series_id", "date"],
  macro_summaries: ["series_id"],
  alt_data: ["uid"],
  email_log: ["idempotency_key"],
  insider_trades: ["accn", "seq"],
  insider_buys: ["accn", "owner"],
};

/**
 * CHECK constraints the real tables have (from drizzle/migrations and production's pg_constraint),
 * enforced on insert, upsert and update so a test cannot pass with a value the database refuses
 * (the IR release collector wrote `retry`/`error` into ir_release_scan.status for a day that way).
 * Key: table, then column, then the allowed values (null is allowed when the column is nullable).
 */
export const CHECKS: Record<string, Record<string, { name: string; allowed: readonly unknown[]; nullable?: boolean }>> = {
  ir_release_scan: { status: { name: "ir_release_scan_status_check", allowed: ["done", "partial", "empty"] } },
  email_log: { status: { name: "email_log_status_check", allowed: ["queued", "waiting_sender", "sent", "suppressed", "failed"] } },
  reports: { status: { name: "reports_status_check", allowed: ["generating", "ready", "failed"] }, kind: { name: "reports_kind_check", allowed: ["primer", "preview", "recap", "memo"] }, scope: { name: "reports_scope_check", allowed: ["shared", "firm", "user"] } },
  filing_redlines: { form: { name: "filing_redlines_form_check", allowed: ["10-K", "10-Q"] } },
  waitlist: { status: { name: "waitlist_status_check", allowed: ["pending", "approved", "declined"] } },
  waitlist_requests: { status: { name: "waitlist_requests_status_check", allowed: ["pending", "approved", "declined"] } },
  report_runs: { status: { name: "report_runs_status_check", allowed: ["running", "ready", "failed"] }, source: { name: "report_runs_source_check", allowed: ["app", "pregen"] } },
  supply_links: { relation: { name: "supply_links_relation_check", allowed: ["customer", "supplier", "partner", "competitor"] } },
  openai_allowance: { tier: { name: "openai_allowance_tier_check", allowed: ["large", "mini", "paid_large", "paid_mini"] } },
};

/** The Postgres error for the first row that breaks a declared CHECK constraint, or null. */
export function checkViolation(table: string, rows: Record<string, unknown>[], checks = CHECKS): string | null {
  const cols = checks[table];
  if (!cols) return null;
  for (const r of rows)
    for (const [col, c] of Object.entries(cols)) {
      if (!(col in r)) continue;
      const v = r[col];
      if (v == null) {
        if (!c.nullable) return `null value in column "${col}" of relation "${table}" violates not-null constraint`;
      } else if (!c.allowed.includes(v)) return `new row for relation "${table}" violates check constraint "${c.name}"`;
    }
  return null;
}

/** `a:detail->>error` style projections in a select list (other columns return whole rows). */
function projection(cols: string | undefined): ((r: Row) => Row) | null {
  if (!cols || !cols.includes("->")) return null;
  const parts = cols.split(",").map((c) => c.trim()).filter(Boolean);
  return (r) => {
    const out: Row = {};
    for (const p of parts) {
      const m = /^(?:([a-z_]+):)?([a-z_]+)(?:(->>?)([a-z_]+))?$/.exec(p);
      if (!m) continue;
      const [, alias, col, arrow, key] = m;
      if (!arrow) out[alias ?? col] = r[col];
      else {
        const base = r[col] as Record<string, unknown> | null | undefined;
        const v = base && typeof base === "object" ? base[key] : undefined;
        out[alias ?? key] = v === undefined ? null : arrow === "->>" && v !== null && typeof v !== "string" ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : v;
      }
    }
    return out;
  };
}

const likeRe = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*")}$`);

export interface Write {
  table: string;
  op: "insert" | "upsert" | "update" | "delete";
  value: unknown;
}

export function fakeSupabase(
  seed: Record<string, Row[]> = {},
  opts: { rpc?: Record<string, (args?: Record<string, unknown>) => unknown>; failUpsert?: (table: string) => string | null; checks?: typeof CHECKS } = {},
) {
  const checks = opts.checks ?? CHECKS;
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Write[] = [];
  let nextId = 1;
  const t = (name: string) => (tables[name] ??= []);

  function builder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let offset = 0;
    let single: "one" | "maybe" | null = null;
    let countHead = false;
    let returning = false;
    let project: ((r: Row) => Row) | null = null;

    const run = () => {
      const rows = t(table);
      if (op === "select") {
        let out = rows.filter((r) => filters.every((f) => f(r)));
        if (order) {
          const { col, asc } = order;
          out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
        }
        if (limit != null || offset) out = out.slice(offset, limit != null ? offset + limit : undefined);
        if (countHead) return { data: null, count: out.length, error: null };
        // PostgREST answers at most 1,000 rows per request (review R15: the fake used to hide this).
        out = out.slice(0, 1000);
        if (single) return out.length ? { data: { ...out[0] }, error: null } : single === "one" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
        return { data: out.map((r) => (project ? project(r) : { ...r })), error: null };
      }
      if (op === "insert" || op === "upsert") {
        const fail = op === "upsert" ? opts.failUpsert?.(table) : null;
        if (fail) return { data: null, error: { message: fail } };
        const list = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ ...r }));
        const bad = checkViolation(table, list, checks);
        if (bad) return { data: null, error: { code: "23514", message: bad } };
        writes.push({ table, op, value: Array.isArray(payload) ? list : list[0] });
        const keys = upsertOpts.onConflict ? upsertOpts.onConflict.split(",") : (KEYS[table] ?? ["id"]);
        const out: Row[] = [];
        for (const r of list) {
          if (table === "job_runs" && r.id == null) r.id = nextId++;
          const i = op === "upsert" ? rows.findIndex((x) => keys.every((k) => x[k] === r[k])) : -1;
          if (i >= 0) {
            if (upsertOpts.ignoreDuplicates) continue;
            rows[i] = { ...rows[i], ...r };
            out.push(rows[i]);
          } else {
            rows.push(r);
            out.push(r);
          }
        }
        if (single) return { data: out[0] ? { ...out[0] } : null, error: null };
        return { data: returning ? out.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "update") {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        const bad = checkViolation(table, [payload as Row], checks);
        if (bad) return { data: null, error: { code: "23514", message: bad } };
        for (const r of hit) Object.assign(r, payload);
        writes.push({ table, op, value: payload });
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      const keep = rows.filter((r) => !filters.every((f) => f(r)));
      writes.push({ table, op: "delete", value: rows.length - keep.length });
      tables[table] = keep;
      return { data: null, error: null };
    };

    const q: Record<string, unknown> = {
      select(cols?: string, o?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        else project = projection(cols);
        if (o?.head) countHead = true;
        return q;
      },
      insert(v: Row | Row[]) {
        op = "insert";
        payload = v;
        return q;
      },
      upsert(v: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
        op = "upsert";
        payload = v;
        upsertOpts = o;
        return q;
      },
      update(v: Row) {
        op = "update";
        payload = v;
        return q;
      },
      delete() {
        op = "delete";
        return q;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, v: unknown[]) => {
        // A GET filter list this long would be refused by the gateway (review R6, R15).
        if (v.length > 500) throw new Error(`fake-supabase: .in() with ${v.length} values (URL too long)`);
        filters.push((r) => v.includes(r[c]));
        return q;
      },
      lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) < String(v)), q),
      lte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) <= String(v)), q),
      gt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) > String(v)), q),
      gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) >= String(v)), q),
      like: (c: string, p: string) => (filters.push((r) => typeof r[c] === "string" && likeRe(p).test(r[c] as string)), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, o: string, v: unknown) => {
        if (o === "in") {
          const list = String(v).replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
          filters.push((r) => !list.includes(String(r[c])));
        } else filters.push((r) => (o === "is" ? (r[c] ?? null) !== v : true));
        return q;
      },
      or: (expr: string) => {
        const parts = expr.split(/,(?=[a-z_]+\.)/).map((p) => {
          const m = /^([a-z_]+)\.(not\.is|like|eq)\.(.*)$/.exec(p);
          if (!m) return () => false;
          const [, c, o, raw] = m;
          const v = raw.replace(/^"|"$/g, "");
          if (o === "not.is") return (r: Row) => (r[c] ?? null) !== null;
          if (o === "like") return (r: Row) => typeof r[c] === "string" && likeRe(v).test(r[c] as string);
          return (r: Row) => String(r[c]) === v;
        });
        filters.push((r) => parts.some((f) => f(r)));
        return q;
      },
      order: (col: string, o: { ascending?: boolean } = {}) => ((order = { col, asc: o.ascending !== false }), q),
      limit: (n: number) => ((limit = n), q),
      range: (a: number, b: number) => ((offset = a), (limit = b - a + 1), q),
      single: () => ((single = "one"), q),
      maybeSingle: () => ((single = "maybe"), q),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return q;
  }

  const client = {
    from: (table: string) => builder(table),
    // The real client's rpc is a method that reads `this.rest`. Kept that way here, so code that
    // detaches it (`const rpc = client.rpc`) fails in tests exactly as it does in production.
    rest: {
      // A function the database does not have answers as PostgREST does (migration not applied).
      rpc: async (fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }> =>
        opts.rpc?.[fn]
          ? { data: opts.rpc[fn](args) ?? null, error: null }
          : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}${args ? `(${Object.keys(args).join(", ")})` : " without parameters"} in the schema cache` } },
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      return this.rest.rpc(fn, args);
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "no storage" } }) }) },
  };
  const state = (job: string) => t("job_state").find((r) => r.job === job) as { job: string; cursor: number; paused_reason: string | null; updated_at: string } | undefined;
  return { client, tables, writes, state };
}
