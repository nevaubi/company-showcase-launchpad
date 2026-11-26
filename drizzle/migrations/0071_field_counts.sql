-- Field counts of published source snapshots, round 6 (unit fieldstats). What this adds:
--   source_field_counts: one row per field of a published snapshot. For each field: the records whose cell is
--   filled, empty ('') or null (a declared null marker of the snapshot), the filled records whose value reads as a
--   plain number (numbers.ts readNative), and, while the field holds at most value_cap distinct values, how many it
--   holds and its most common values (at most 50, most first, ties in code unit order) with their record counts and
--   the first record (row number) holding each. A field with more distinct values than value_cap (capped 'values'),
--   or one the counting pass dropped to stay within its memory bound (capped 'memory'), keeps its filled, empty,
--   null and number counts only: no distinct count and no list. The worker computes the rows once per snapshot from
--   the snapshot's stored file, read with the importer's own CSV reader and row projection
--   (scripts/source-field-counts.ts, off unless FIELD_COUNTS_ENABLED=1), and writes them with the service role.
--   Members read the rows of published snapshots, as they read the statistics of 0069.
--   source_field_top_valid: the check of a row's list (shape, order, and that the list and the remainder add up to
--   the filled records and the distinct values), used by the table's constraint.
-- Not changed: nothing that existed before this file. No existing table, function, policy or grant is altered, and
-- no grant is revoked from any role on an existing object. The only lock on an existing table is the short one the
-- foreign key takes on source_snapshots while this table is created; no statement waits more than 5 s for it.
-- The project's default privileges grant every new table and function to anon, authenticated and service_role, so
-- each new object starts from REVOKE ALL and gets explicit grants.
-- A snapshot's counts are complete when the row of its last field (position column_count - 1) exists: the worker
-- writes a snapshot's rows in field order, the last one last, and the app uses a snapshot's counts only when that row
-- is there and every row it reads adds up to the snapshot's records.
-- The whole file can be applied twice: every statement creates what is missing or replaces a definition with the
-- same one.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.source_field_top_valid(_top jsonb, _filled bigint, _other_rows bigint, _distinct integer, _other_values integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE e jsonb; n integer := 0; total bigint := 0; prev bigint; r bigint;
BEGIN
  IF jsonb_typeof(_top) IS DISTINCT FROM 'array' OR jsonb_array_length(_top) > 50 THEN RETURN false; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(_top) LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'array' OR jsonb_array_length(e) <> 3
      OR jsonb_typeof(e->0) IS DISTINCT FROM 'string' OR e->>0 = ''
      OR jsonb_typeof(e->1) IS DISTINCT FROM 'number' OR (e->>1) !~ '^[1-9][0-9]{0,15}$'
      OR jsonb_typeof(e->2) IS DISTINCT FROM 'number' OR (e->>2) !~ '^[1-9][0-9]{0,15}$' THEN RETURN false; END IF;
    r := (e->>1)::bigint;
    IF prev IS NOT NULL AND r > prev THEN RETURN false; END IF;
    prev := r; total := total + r; n := n + 1;
  END LOOP;
  IF _filled IS NULL OR _other_rows IS NULL OR total + _other_rows <> _filled THEN RETURN false; END IF;
  IF _distinct IS NULL THEN RETURN n = 0 AND _other_values IS NULL; END IF;
  RETURN _other_values IS NOT NULL AND n + _other_values = _distinct;
END $$;

CREATE TABLE IF NOT EXISTS public.source_field_counts (
  snapshot_id text NOT NULL REFERENCES public.source_snapshots(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 16383),
  filled bigint NOT NULL CHECK (filled >= 0),
  blank bigint NOT NULL CHECK (blank >= 0),
  missing bigint NOT NULL CHECK (missing >= 0),
  numeric_rows bigint NOT NULL CHECK (numeric_rows >= 0 AND numeric_rows <= filled),
  value_cap integer NOT NULL CHECK (value_cap > 0),
  distinct_values integer CHECK (distinct_values >= 0 AND distinct_values <= value_cap),
  capped text CHECK (capped IN ('values', 'memory')),
  top jsonb NOT NULL DEFAULT '[]'::jsonb,
  other_rows bigint NOT NULL CHECK (other_rows >= 0),
  other_values integer CHECK (other_values >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, position),
  CONSTRAINT source_field_counts_exact CHECK ((distinct_values IS NULL) = (capped IS NOT NULL)),
  CONSTRAINT source_field_counts_top CHECK (public.source_field_top_valid(top, filled, other_rows, distinct_values, other_values))
);
ALTER TABLE public.source_field_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_field_counts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.source_field_counts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.source_field_counts TO service_role;
DROP POLICY IF EXISTS "Members read field counts of published source snapshots" ON public.source_field_counts;
CREATE POLICY "Members read field counts of published source snapshots" ON public.source_field_counts FOR SELECT TO authenticated USING ((SELECT public.has_app_access(auth.uid())) AND EXISTS (SELECT 1 FROM public.source_snapshots s WHERE s.id = source_field_counts.snapshot_id AND s.status = 'ready'));

-- The check runs when the service role writes a row; no one else writes, so no one else executes it.
REVOKE ALL ON FUNCTION public.source_field_top_valid(jsonb, bigint, bigint, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_field_top_valid(jsonb, bigint, bigint, integer, integer) TO service_role;

-- sandbox_exec, a platform login role that bypasses row-level security, gets every new table through the project's
-- default privileges. It has no use for the field counts, so it keeps no grant on them (as 0069 does for its
-- statistics). Where the role does not exist there is nothing to revoke.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    REVOKE ALL ON public.source_field_counts FROM sandbox_exec;
    REVOKE ALL ON FUNCTION public.source_field_top_valid(jsonb, bigint, bigint, integer, integer) FROM sandbox_exec;
  END IF;
END $$;
