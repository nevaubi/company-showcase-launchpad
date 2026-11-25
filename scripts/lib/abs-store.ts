// The ABS-EE importer's only door to the database: the service-role functions of migration 0067.
// The importer holds no SQL. Two transports reach the same functions:
//   production  the Supabase client (scripts/lib/supa.ts), when ABS_DB_URL is not set
//   a Postgres  a plain connection (ABS_DB_URL), used to prove the import on a local database where the
//               migration is applied; it runs as `service_role`, like the client does
// Because the rules (all-or-nothing loads, no-op reruns, revision order) live in those functions, what
// is proven through one transport holds through the other.

export interface AbsDb {
  /** Calls a function and returns its value (a table function returns its rows). */
  rpc<T>(fn: AbsFn, args?: Record<string, unknown>): Promise<T>;
  /** Waits while the app's database is busy (production only). */
  gate(label: string): Promise<void>;
  runStart(job: string): Promise<number | null>;
  runFinish(id: number | null, ok: boolean, items: number, detail: unknown): Promise<void>;
  close(): Promise<void>;
}

const SIGNATURES = {
  abs_register_filings: { _rows: "jsonb" },
  abs_filing_states: { _list_cik: "bigint" },
  abs_begin_load: {
    _accession: "text",
    _parser: "text",
    _sha256: "text",
    _bytes: "bigint",
    _force: "boolean",
  },
  abs_put_rows: { _load_id: "bigint", _kind: "text", _rows: "jsonb" },
  abs_commit_load: { _load_id: "bigint", _filing: "jsonb", _documents: "jsonb", _expect: "jsonb" },
  abs_mark_filing: { _accession: "text", _status: "text", _detail: "text" },
  abs_verify_rows: { _accession: "text", _kind: "text", _rows: "jsonb" },
  abs_filing_load: { _accession: "text" },
  abs_store_filing: {
    _accession: "text",
    _parser: "text",
    _sha256: "text",
    _bytes: "bigint",
    _filing: "jsonb",
    _documents: "jsonb",
    _rows: "jsonb",
    _expect: "jsonb",
  },
  abs_claim_next: { _watch: "jsonb", _max_attempts: "integer" },
  abs_release_filing: { _accession: "text", _detail: "text" },
  abs_check: {},
  abs_summary: {},
} as const;
export type AbsFn = keyof typeof SIGNATURES;
const TABLE_FUNCTIONS = new Set<AbsFn>(["abs_check"]);

async function postgresDb(url: string): Promise<AbsDb> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  await sql.unsafe("set role service_role");
  return {
    async rpc<T>(fn: AbsFn, args: Record<string, unknown> = {}) {
      const sig = SIGNATURES[fn] as Record<string, string>;
      const names = Object.keys(args);
      for (const n of names) if (!sig[n]) throw new Error(`${fn} has no argument ${n}`);
      const list = names.map((n, i) => `${n} => $${i + 1}::${sig[n]}`).join(", ");
      // the driver serialises a jsonb argument itself: hand it the value, not a string of it
      const values = names.map((n) => args[n]) as never[];
      if (TABLE_FUNCTIONS.has(fn))
        return (await sql.unsafe(`select * from public.${fn}(${list})`, values)) as unknown as T;
      const rows = await sql.unsafe(`select public.${fn}(${list}) as r`, values);
      return rows[0].r as T;
    },
    gate: async () => undefined,
    async runStart(job) {
      const rows = await sql.unsafe("insert into public.job_runs (job) values ($1) returning id", [
        job,
      ]);
      return Number(rows[0].id);
    },
    async runFinish(id, ok, items, detail) {
      if (id != null)
        await sql.unsafe(
          "update public.job_runs set finished_at = now(), ok = $2, items = $3, detail = $4::jsonb where id = $1",
          [id, ok, items, detail] as never[],
        );
    },
    close: () => sql.end(),
  };
}

async function supabaseDb(): Promise<AbsDb> {
  const { sb, dbGate } = await import("./supa");
  return {
    async rpc<T>(fn: AbsFn, args: Record<string, unknown> = {}) {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as T;
    },
    gate: (label) => dbGate(label),
    async runStart(job) {
      const { data } = await sb.from("job_runs").insert({ job }).select("id").single();
      return data?.id ?? null;
    },
    async runFinish(id, ok, items, detail) {
      if (id != null)
        await sb
          .from("job_runs")
          .update({ finished_at: new Date().toISOString(), ok, items, detail })
          .eq("id", id);
    },
    close: async () => undefined,
  };
}

export const connectAbsDb = (): Promise<AbsDb> =>
  process.env.ABS_DB_URL ? postgresDb(process.env.ABS_DB_URL) : supabaseDb();
