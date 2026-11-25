import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getBoard } from "@/lib/sources/boards/board.functions";
import type { Board as BoardData, BoardRead } from "@/lib/sources/boards/types";
import { Tile } from "./tile";

/** Query key and options of one board. A board's tiles are pinned to snapshots, so ten minutes is fresh enough. */
export const boardQuery = (id: string) => ({
  queryKey: ["source-board", id] as const,
  queryFn: () => getBoard({ data: { id } }) as Promise<BoardRead>,
  staleTime: 10 * 60_000,
  retry: false,
});

/** Three columns on a wide page, two where four tiles would leave one alone on a row. */
const grid = (count: number) =>
  `grid grid-cols-1 gap-x-3 gap-y-3 @2xl:grid-cols-2 ${count === 4 || count === 2 ? "" : "@5xl:grid-cols-3"}`;

/**
 * Below the container width of two columns (42rem) a board is one column of tall tiles: it shows the first
 * four, then a button for the rest. The button and the hidden tiles are container-query classes, so a wide
 * board never shows the button and nothing is measured.
 */
export const PHONE_TILES = 4;
const FOLDED = "@max-2xl:hidden";

/** The final layout while the board loads: tiles of the final height, so nothing moves when they fill. */
function Skeleton({ count }: { count: number }) {
  return (
    <div aria-hidden>
      <div className={grid(count)}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={`flex h-[28.75rem] flex-col gap-3 rounded-md border bg-card p-3.5 shadow-paper @2xl:h-[29.5rem] ${i >= PHONE_TILES ? FOLDED : ""}`}
          >
            <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-muted" />
            <div className="h-5 w-1/3 animate-pulse rounded-sm bg-muted" />
            <div className="h-10 w-full animate-pulse rounded-sm bg-muted/70" />
            <div className="mt-2 flex-1 animate-pulse rounded-sm bg-muted/50" />
            <div className="h-3 w-3/4 animate-pulse rounded-sm bg-muted/70" />
          </div>
        ))}
      </div>
      {count > PHONE_TILES && <div className="mt-3 h-8 @2xl:hidden" />}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[11px] text-muted-foreground">{children}</p>;
}

export function BoardBody({ data }: { data: BoardData }) {
  const count = data.tiles.length;
  const [all, setAll] = useState(false);
  const gridId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const folded = !all && count > PHONE_TILES;
  useEffect(() => {
    if (!all || shown.current) return;
    shown.current = true;
    // The button is gone: focus goes on to the first tile it showed, without scrolling the page.
    const first = gridRef.current?.children[PHONE_TILES];
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  }, [all]);
  return (
    <>
      {count > 0 ? (
        <div id={gridId} ref={gridRef} className={grid(count)}>
          {data.tiles.map((t, i) => (
            <Tile key={t.id} tile={t} className={folded && i >= PHONE_TILES ? FOLDED : undefined} focusable={i === PHONE_TILES} />
          ))}
        </div>
      ) : (
        <Quiet>No chart of this board could be computed from the stored data right now.</Quiet>
      )}
      {folded && (
        <Button variant="outline" size="sm" className="mt-3 w-full @2xl:hidden" aria-expanded={false} aria-controls={gridId} onClick={() => setAll(true)}>
          Show all {count} charts
        </Button>
      )}
      {data.refused.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground" aria-label="Charts not shown">
          {data.refused.map((r) => (
            <li key={r.id}>
              Not shown: {r.title}. {r.reason}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A board by id, computed on the server. Shows one quiet line instead when the reads are not there yet. */
export function BoardView({ id, tiles, section }: { id: string; tiles: number; section: string }) {
  const q = useQuery(boardQuery(id));
  const answer = q.data;
  return (
    <section data-section={section} className="@container min-w-0">
      {q.isPending ? (
        <Skeleton count={tiles} />
      ) : q.isError || !answer ? (
        <div className="flex items-center gap-2">
          <Quiet>The charts could not be loaded.</Quiet>
          <Button variant="ghost" size="xs" onClick={() => q.refetch()}>
            Retry
          </Button>
        </div>
      ) : !answer.ok ? (
        answer.reason === "unavailable" ? (
          <Quiet>Charts arrive with the next database update.</Quiet>
        ) : (
          <div className="flex items-center gap-2">
            <Quiet>The charts could not be loaded: {answer.message}</Quiet>
            {(answer.reason === "timeout" || answer.reason === "error") && (
              <Button variant="ghost" size="xs" onClick={() => q.refetch()}>
                Retry
              </Button>
            )}
          </div>
        )
      ) : (
        <BoardBody data={answer.data} />
      )}
    </section>
  );
}
