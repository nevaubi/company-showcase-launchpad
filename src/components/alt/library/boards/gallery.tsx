import { useMemo } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Input } from "@/components/ui/input";
import { COLLECTIONS } from "@/lib/sources/catalog/collections";
import { galleryBoards } from "@/lib/sources/boards/layout";
import type { BoardLayout, BoardLayoutSection } from "@/lib/sources/boards/types";
import { collectionHref, libraryHref } from "@/lib/sources/links";
import { collectionIdFromSlug, collectionSlug } from "@/lib/sources/collections";
import { cn } from "@/lib/utils";
import { AltNav } from "../alt-nav";
import { HrefLink } from "../href-link";
import { BoardSection } from "./board";

export const CHARTS_DESCRIPTION = "Every chart the Data library draws from reviewed tables, board by board, each one opening the records behind it.";

/** The filter value of the landing board, which is no collection. */
export const LANDING_KEY = "landing";

/** What the Charts page is filtered by: a board (its collection's slug, or "landing") and words of a chart's title. */
export type ChartsSearch = { c?: string; q?: string };

/** The search params of the Charts page, validated: unknown keys dropped, text bounded. */
export function chartsSearch(raw: Record<string, unknown>): ChartsSearch {
  const out: ChartsSearch = {};
  if (typeof raw.c === "string" && /^[a-z0-9_-]{1,64}$/.test(raw.c)) out.c = raw.c;
  if (typeof raw.q === "string" && raw.q.trim()) out.q = raw.q.slice(0, 120);
  return out;
}

/** The filter value of a board: its collection's slug, or "landing" for the landing board. */
export function galleryKey(boardId: string): string {
  return boardId === "library" ? LANDING_KEY : collectionSlug(boardId);
}

/** The name a board goes by on the Charts page: its collection's name, or the landing board's title. */
export function galleryName(board: Pick<BoardLayout, "id" | "title">): string {
  return COLLECTIONS.find((c) => c.id === board.id)?.name ?? board.title;
}

/** The board a filter value names (a slug, an older alias, a stored id or "landing"); null when it names none. */
export function chosenBoard(boards: readonly BoardLayout[], c: string | undefined): BoardLayout | null {
  if (!c) return null;
  const id = c === LANDING_KEY ? "library" : collectionIdFromSlug(c);
  return boards.find((b) => b.id === id) ?? null;
}

/** One section on the Charts page: the whole section (what is requested) and the tiles the search keeps (what is shown). */
export type GallerySection = { section: BoardLayoutSection; shown: string[] };
export type GalleryBoard = { board: BoardLayout; sections: GallerySection[] };

/**
 * The boards and sections to show: only the chosen board when the filter names one (a filter that names no board
 * filters nothing), and in each section only the charts whose title holds every word asked for, case aside. Sections
 * and boards left without a chart are dropped.
 */
export function filterGallery(boards: readonly BoardLayout[], search: ChartsSearch): GalleryBoard[] {
  const chosen = chosenBoard(boards, search.c);
  const words = (search.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (title: string) => words.every((w) => title.toLowerCase().includes(w));
  return boards
    .filter((b) => !chosen || b.id === chosen.id)
    .map((board) => ({
      board,
      sections: board.sections.map((section) => ({ section, shown: section.tiles.filter((t) => keep(t.title)).map((t) => t.id) })).filter((s) => s.shown.length > 0),
    }))
    .filter((b) => b.sections.length > 0);
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "59 charts on 7 boards", with the words searched for when there are any. */
export function gallerySummary(shown: readonly GalleryBoard[], q: string | undefined): string {
  const charts = shown.reduce((s, b) => s + b.sections.reduce((t, x) => t + x.shown.length, 0), 0);
  return `${count(charts, "chart", "charts")} on ${count(shown.length, "board", "boards")}${q?.trim() ? `, with "${q.trim()}" in the title` : ""}`;
}

const CONTROL =
  "h-8 rounded-md border bg-card px-2.5 text-[13px] shadow-paper transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The Charts page of the Data library: every collection board in collection order, each with its sections and tiles,
 * tiles loaded as they come into view; one row of filters above (a board, words of a title), the count of what is
 * shown, and each tile's "Open records" leading to its table page.
 */
export function ChartsPage({ search, onSearch }: { search: ChartsSearch; onSearch: (patch: ChartsSearch) => void }) {
  const boards = useMemo(() => galleryBoards(), []);
  const shown = useMemo(() => filterGallery(boards, search), [boards, search]);
  const chosen = chosenBoard(boards, search.c);
  return (
    <div className="@container grid grid-cols-1 content-start gap-5">
      <div className="min-w-0">
        <PageHeader className="mb-3" eyebrow="Filings and data" title="Alternative data" description={CHARTS_DESCRIPTION} />
        <AltNav />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-section="Chart filters">
        <label className="sr-only" htmlFor="charts-collection">
          Collection
        </label>
        <select
          id="charts-collection"
          className={cn(CONTROL, "min-w-0 max-w-full")}
          value={chosen ? galleryKey(chosen.id) : ""}
          onChange={(e) => onSearch({ c: e.target.value || undefined })}
        >
          <option value="">All collections</option>
          {boards.map((b) => (
            <option key={b.id} value={galleryKey(b.id)}>
              {galleryName(b)}
            </option>
          ))}
        </select>
        <Input
          type="search"
          aria-label="Find a chart by its title"
          placeholder="Find a chart"
          className="h-8 w-full min-w-0 max-w-xs text-[13px] @md:w-64"
          value={search.q ?? ""}
          onChange={(e) => onSearch({ q: e.target.value || undefined })}
        />
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {gallerySummary(shown, search.q)}
        </p>
      </div>
      {shown.length === 0 && <p className="text-[13px] text-muted-foreground">No chart has those words in its title.</p>}
      {shown.map(({ board, sections }) => (
        <section key={board.id} data-section={`${galleryName(board)} charts`} className="@container min-w-0 space-y-4 border-t pt-4 first:border-t-0 first:pt-0">
          <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[16px] font-semibold tracking-tight">{galleryName(board)}</h2>
            <HrefLink
              href={board.id === "library" ? libraryHref() : collectionHref(collectionSlug(board.id))}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {board.id === "library" ? "Open the Data library" : "Open the collection"}
            </HrefLink>
          </header>
          {sections.map(({ section, shown: only }) => (
            <BoardSection key={`${board.id}:${section.title ?? "lead"}`} board={board.id} section={section} only={only} />
          ))}
        </section>
      ))}
    </div>
  );
}
