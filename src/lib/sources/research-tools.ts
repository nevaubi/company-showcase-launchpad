/** Read-only tools. Native identifiers are supplied explicitly; no company identity is inferred. */
const str = (description: string, maxLength = 512) => ({ type: "string", description, maxLength });
const optional = (value: Record<string, unknown>) => ({ ...value, type: [value.type as string, "null"] });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const integer = (description: string, minimum: number, maximum: number) => ({ type: "integer", description, minimum, maximum });

export const OFFICIAL_SOURCE_TOOL_DEFS = [
  {
    type: "function",
    name: "search_official_sources",
    description: "Search the published official-source catalogue by dataset name/description, exact sector or agency. Returns bounded pages with immutable snapshot IDs, declared grain and original source URLs. These native datasets are separate from company statements and derived alt-data series. Do not infer a ticker-to-CERT, plant, tract or other entity link. Inspect a source's fields and population before querying it; overlapping source views are not distinct populations.",
    parameters: obj({
      query: optional(str("Literal catalogue text search; null for all published sources", 200)),
      sector: optional(str("Exact declared sector/collection; null for all")),
      agency: optional(str("Exact declared agency; null for all")),
      after: optional(str("Dataset ID from next_cursor; null for the first catalogue page", 1024)),
      limit: optional(integer("Maximum datasets, default 10; whole-item output budget may return fewer", 1, 20)),
    }),
    strict: true,
  },
  {
    type: "function",
    name: "inspect_official_source",
    description: "Inspect one published native source: exact scope, source units, identity rules and an ordered, searchable field dictionary. Returns the immutable snapshot ID to pin record queries. Field keys are unambiguous; repeated native labels must not be guessed. Unit and scale metadata describe the original strings and never instruct an automatic conversion. Page fields with next_field_after, preserving the same search and snapshot.",
    parameters: obj({
      dataset_id: str("Exact dataset ID from search_official_sources", 1024),
      snapshot_id: optional(str("Immutable snapshot ID; null resolves the current ready snapshot", 64)),
      field_search: optional(str("Literal search of native field key, label, title, definition or unit", 200)),
      field_after: optional(integer("Last zero-based field position from next_field_after; null starts at the first field", -1, 16383)),
      limit: optional(integer("Maximum field descriptors, default 8; whole-field budget may return fewer", 1, 20)),
      include_definitions: optional({ type: "boolean", description: "Include complete original definitions; false by default. A long definition may require opening the source explorer." }),
    }),
    strict: true,
  },
  {
    type: "function",
    name: "query_official_records",
    description: "Read a bounded slice of one ready, immutable native source snapshot. Choose 1–12 exact field keys from inspect_official_source (a unique exact native label is also accepted; duplicate labels are rejected). Returns at most 20 complete rows, their original string/null cells, declared units, immutable row IDs, original source URLs and pinned app links. No numeric parsing, scaling, aggregation or ticker/entity inference. Entity, geography and period are exact native search-index values; monthly/county normalization exists only where the source declares it. Blank strings, literal zeroes and suppression markers remain distinct. Follow next_cursor with the same snapshot, filters and fields. If one row is too wide, request fewer fields; do not treat omitted rows as missing data.",
    parameters: obj({
      dataset_id: str("Exact dataset ID", 1024),
      snapshot_id: { ...str("Required immutable ready snapshot ID from source search/inspection", 64), pattern: "^[0-9a-f]{64}$" },
      fields: { type: "array", items: str("Exact field key, or a unique exact native label"), minItems: 1, maxItems: 12, uniqueItems: true },
      entity: optional(str("Exact entity ID or exact entity name already established by this source; null for no filter")),
      geography: optional(str("Exact declared geography code or name; null for no filter")),
      period: optional(str("Exact source period/search-index label; null for no filter")),
      after: optional(integer("Last row number from next_cursor, default 0", 0, Number.MAX_SAFE_INTEGER)),
      limit: optional(integer("Maximum complete rows, default 10; output budget may return fewer", 1, 20)),
    }),
    strict: true,
  },
] as const;

export type OfficialSourceToolName = (typeof OFFICIAL_SOURCE_TOOL_DEFS)[number]["name"];
