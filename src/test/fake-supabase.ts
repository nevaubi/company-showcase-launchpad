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

const likeRe = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*")}$`);

export interface Write {
  table: string;
  op: "insert" | "upsert" | "update" | "delete";
  value: unknown;
}

export function fakeSupabase(seed: Record<string, Row[]> = {}, opts: { rpc?: Record<string, (args?: Record<string, unknown>) => unknown>; failUpsert?: (table: string) => string | null } = {}) {
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
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      if (op === "insert" || op === "upsert") {
        const fail = op === "upsert" ? opts.failUpsert?.(table) : null;
        if (fail) return { data: null, error: { message: fail } };
        const list = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ ...r }));
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
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
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
      not: (c: string, o: string, v: unknown) => (filters.push((r) => (o === "is" ? (r[c] ?? null) !== v : true)), q),
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
    rpc: async (fn: string, args?: Record<string, unknown>) => ({ data: opts.rpc?.[fn]?.(args) ?? null, error: opts.rpc?.[fn] ? null : { message: `no rpc ${fn}` } }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "no storage" } }) }) },
  };
  const state = (job: string) => t("job_state").find((r) => r.job === job) as { job: string; cursor: number; paused_reason: string | null; updated_at: string } | undefined;
  return { client, tables, writes, state };
}
