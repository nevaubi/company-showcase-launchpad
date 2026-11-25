/**
 * The declarations a snapshot carries about its file (`file.provenance`), its checks (`quality`) and its scope
 * (`coverage`), said in words. Known keys become sentences; any other key is listed as stored, under its own
 * name, so nothing the snapshot declares is hidden and nothing is reworded beyond what the key states.
 */
type Json = unknown;
export type Said = { label: string; text: string; href?: string };
export type Stored = { key: string; value: string };

const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: Json): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const words = (key: string) => key.replace(/_/g, " ");

/** A stored value written plainly: strings as they are, numbers without separators, lists joined. */
export function storedValue(v: Json): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ") : "none";
  return JSON.stringify(v);
}

const yes = (v: Json) => v === true;

/** How the file was obtained. */
export function sourceWords(provenance: Record<string, Json> | null | undefined, datasetUrl: string | null): { said: Said[]; used: Set<string> } {
  const p = provenance ?? {};
  const said: Said[] = [];
  const used = new Set<string>();
  const take = (k: string) => {
    used.add(k);
    return p[k];
  };
  const direct = str(take("direct_url"));
  if (datasetUrl) said.push({ label: "Publisher address", text: datasetUrl, href: datasetUrl });
  if (direct && direct !== datasetUrl) said.push({ label: "File address", text: direct, href: direct });
  if (yes(take("direct_download_sha256_verified"))) said.push({ label: "Download", text: "Downloaded directly from the publisher; the stored bytes match the downloaded file's SHA-256." });
  const adapter = str(take("adapter"));
  if (adapter) said.push({ label: "Collected by", text: `The ${adapter} adapter${yes(take("fetched_complete_response")) ? ", which received the complete response" : ""}.` });
  else take("fetched_complete_response");
  const status = take("http_status");
  if (typeof status === "number") said.push({ label: "HTTP status", text: String(status) });
  const etag = str(take("response_etag"));
  if (etag) said.push({ label: "ETag", text: etag });
  const modified = str(take("response_last_modified"));
  if (modified) said.push({ label: "Last-Modified (publisher's server)", text: modified });
  const resolved = str(take("response_resolved_url"));
  if (resolved && resolved !== direct) said.push({ label: "Answered from", text: resolved, href: resolved });
  const original = str(take("original_direct_url"));
  if (original && original !== direct) said.push({ label: "First collected from", text: original, href: original });
  const retrieved = str(take("retrieved_at"));
  if (retrieved) said.push({ label: "Retrieved", text: retrieved });
  const spec = str(take("specification_url"));
  if (spec) said.push({ label: "Specification", text: spec, href: spec });
  const sourceUrl = str(take("source_url"));
  if (sourceUrl && sourceUrl !== datasetUrl) said.push({ label: "Read from", text: sourceUrl, href: sourceUrl });
  const assembled = take("assembled_rows");
  if (typeof assembled === "number") said.push({ label: "Assembled", text: `${assembled.toLocaleString("en-US")} rows assembled into one CSV from the publisher's answer.` });
  const evidence = take("original_evidence");
  if (Array.isArray(evidence))
    evidence.filter(isObj).forEach((e, i) => {
      const url = str(e.final_url) ?? str(e.url);
      const at = str(e.retrieved_at);
      const bytes = typeof e.bytes === "number" ? `${e.bytes.toLocaleString("en-US")} bytes` : null;
      const parts = [url, at ? `retrieved ${at}` : null, bytes].filter(Boolean).join(", ");
      if (parts) said.push({ label: evidence.length > 1 ? `Original download ${i + 1}` : "Original download", text: parts, href: url ?? undefined });
    });
  for (const k of ["role", "collection", "relative_path", "previous_snapshot_id", "refresh_identity_version", "family"]) used.add(k);
  return { said, used };
}

/** The checks the snapshot records. */
export function checkWords(quality: Record<string, Json> | null | undefined): { said: Said[]; used: Set<string> } {
  const q = quality ?? {};
  const said: Said[] = [];
  const used = new Set<string>(["blank_counts_by_column", "source_value_policy", "previous_snapshot_id", "refresh_identity_version"]);
  const take = (k: string) => {
    used.add(k);
    return q[k];
  };
  const checks: string[] = [];
  if (yes(take("row_width_verified"))) checks.push("Every row has the header's width.");
  if (yes(take("source_bytes_sha256_verified"))) checks.push("The stored file matches its SHA-256.");
  if (yes(take("header_matches_previous"))) checks.push("The header is the same as in the previous version.");
  if (yes(take("native_values_unchanged"))) checks.push("Values are stored as the publisher wrote them.");
  if (yes(take("expected_row_count_known"))) checks.push("The expected number of rows was known before loading.");
  if (checks.length) said.push({ label: "Checks", text: checks.join(" ") });
  const policy = str(q.source_value_policy);
  if (policy === "exact_strings_blank_is_empty_string") said.push({ label: "Values", text: "Exact strings; a blank cell is stored as an empty string, not as null." });
  else if (policy) said.push({ label: "Values", text: words(policy) });
  const markers = take("source_lexical_marker_counts");
  if (isObj(markers)) {
    const list = Object.entries(markers).filter(([, n]) => typeof n === "number" && n > 0) as [string, number][];
    if (list.length)
      said.push({
        label: "Markers",
        text: list
          .sort((a, b) => b[1] - a[1])
          .map(([m, n]) => `"${m}" appears ${n.toLocaleString("en-US")} ${n === 1 ? "time" : "times"}`)
          .join("; ")
          .concat(". Markers are kept as written and are never read as numbers."),
      });
  }
  const geo = take("geo_identifier_validation");
  if (isObj(geo) && Object.keys(geo).length) said.push({ label: "Place codes", text: storedValue(geo) });
  const dup = take("duplicate_header_labels");
  if (isObj(dup) && Object.keys(dup).length) said.push({ label: "Repeated headers", text: storedValue(dup) });
  const refresh = take("refresh");
  if (isObj(refresh) && Object.keys(refresh).length) said.push({ label: "Refresh", text: storedValue(refresh) });
  return { said, used };
}

const ROLE: Record<string, string> = {
  source_native_table: "The publisher's own table, every row kept.",
  projection_or_subset: "A projection or subset of a larger file.",
};

/** What the table covers and how its identities are to be read. */
export function scopeWords(coverage: Record<string, Json> | null | undefined): { said: Said[]; used: Set<string> } {
  const c = coverage ?? {};
  const said: Said[] = [];
  const used = new Set<string>(["collection_slug", "source_ids", "source_path", "source_urls", "source_retrieval_times", "refresh_provenance", "supporting_source_file_shas", "_preview_dropped_keys"]);
  const take = (k: string) => {
    used.add(k);
    return c[k];
  };
  const identity = str(take("identity_rule"));
  if (identity) said.push({ label: "Identity", text: identity });
  const geography = str(take("geography_rule"));
  if (geography) said.push({ label: "Places", text: geography });
  const entity = str(take("entity_type"));
  const column = str(take("entity_id_column"));
  if (entity && entity !== "source_native_entity") said.push({ label: "One entity", text: `${words(entity)}${column ? `, identified by ${column}` : ""}` });
  else if (column) said.push({ label: "Entity field", text: column });
  const role = str(take("population_role"));
  if (role) said.push({ label: "Population", text: ROLE[role] ?? words(role) });
  const overlaps = take("overlaps_files");
  if (Array.isArray(overlaps) && overlaps.length) said.push({ label: "Overlaps", text: `Its rows also appear in ${overlaps.join(", ")}. Overlapping tables are never added together.` });
  const components = take("period_components");
  if (Array.isArray(components) && components.length) said.push({ label: "Period from", text: components.join(", ") });
  const times: string[] = [];
  if (take("publication_time_known") === false) times.push("The publisher's own release time is not known.");
  if (take("availability_time_known") === false) times.push("When the data first became public is not known; the retrieval time does not establish it.");
  if (times.length) said.push({ label: "Time", text: times.join(" ") });
  if (yes(take("period_index_is_native_text"))) said.push({ label: "Periods", text: "Indexed as the publisher writes them, as text." });
  if (yes(take("archive_population_is_not_unique_entity_count"))) said.push({ label: "Counting", text: "The number of records is not a count of distinct entities." });
  const basis = str(take("source_linkage_basis"));
  if (basis) said.push({ label: "Linked by", text: words(basis) });
  return { said, used };
}

/** Keys of an object that no sentence above used, with their stored values. */
export function rest(obj: Record<string, Json> | null | undefined, used: Set<string>): Stored[] {
  return Object.entries(obj ?? {})
    .filter(([k]) => !used.has(k))
    .map(([key, v]) => ({ key, value: storedValue(v) }));
}

/** The stored notes, one statement a line. */
export function noteLines(notes: string): string[] {
  return notes
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}
