/**
 * The curation layer for official datasets: every screen passes a stored dataset through
 * `describeDataset` before showing it. Pure: no network, no database.
 *
 * Nothing here invents a fact. A title comes from the publisher's own listing, with the address
 * it was taken from (`titles.generated.json`, written by `bun scripts/source-catalog.ts`), or the
 * stored name is kept, tidied only by the rules in `clean.ts`. Kinds, parents and issues come
 * from the audit of 25 Nov 2026 and from what each snapshot declares about itself (`relations.ts`).
 */
import generatedTitles from "./titles.generated.json";
import { cleanName, codeByRule, withoutLongDashes } from "./clean";
import { COLLECTIONS, collectionFor } from "./collections";
import { familyFor } from "./families";
import { PUBLISHERS, publisherFor } from "./publishers";
import { hiddenByDefault, issuesFor, relationFor } from "./relations";
import type { CatalogEntry, CatalogInput } from "./types";

export type {
  CatalogEntry,
  CatalogInput,
  CatalogIssue,
  CatalogKind,
  Collection,
  Publisher,
} from "./types";
export { COLLECTIONS, PUBLISHERS };
export { cleanName, isBareName, withoutLongDashes } from "./clean";

export type GeneratedTitle = { title: string; code?: string; source: string };

const TITLES = generatedTitles as Record<string, GeneratedTitle>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Never throws: a dataset the catalog has not seen keeps its stored name, tidied by rule. */
export function describeDataset(d: CatalogInput): CatalogEntry {
  const input: CatalogInput = {
    id: text(d?.id),
    name: text(d?.name),
    sector: text(d?.sector),
    agency: text(d?.agency),
    source_id: typeof d?.source_id === "string" && d.source_id ? d.source_id : null,
    source_url: typeof d?.source_url === "string" && d.source_url ? d.source_url : null,
    grain: text(d?.grain),
    rows: typeof d?.rows === "number" ? d.rows : null,
    retrieved_at: typeof d?.retrieved_at === "string" ? d.retrieved_at : null,
  };

  const relation = relationFor(input);
  const family = familyFor(input);
  const generated = TITLES[input.id];
  const cleaned = cleanName(input.name) || cleanName(input.id) || "Untitled table";
  const title = withoutLongDashes(generated?.title || cleaned);
  const code = generated?.code ?? codeByRule(input.name, input.source_id);

  const entry: CatalogEntry = {
    title,
    publisher: publisherFor(input.agency, input.source_url),
    collection: collectionFor(input.sector),
    family: family?.id ?? null,
    familyName: family?.name ?? null,
    kind: relation.kind,
    hiddenByDefault: hiddenByDefault(input, relation.kind),
    issues: issuesFor(input),
  };
  if (code && code !== title) entry.code = code;
  if (generated?.source) entry.titleSource = generated.source;
  if (relation.parent) entry.parentId = relation.parent;
  return entry;
}

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** True only when both retrieval times are known and the parent was retrieved after the child. */
export function staleAgainstParent(child: CatalogInput, parent: CatalogInput): boolean {
  const c = time(child?.retrieved_at);
  const p = time(parent?.retrieved_at);
  return c !== null && p !== null && p > c;
}
