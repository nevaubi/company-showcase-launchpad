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

const GRID = "grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3";

/** The final layout while the board loads: tiles of the final height, so nothing moves when they fill. */
function Skeleton({ count }: { count: number }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-[25.5rem] flex-col gap-3 rounded-md border bg-card p-3.5 shadow-paper">
          <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-muted" />
          <div className="h-5 w-1/3 animate-pulse rounded-sm bg-muted" />
          <div className="h-10 w-full animate-pulse rounded-sm bg-muted/70" />
          <div className="mt-2 flex-1 animate-pulse rounded-sm bg-muted/50" />
          <div className="h-3 w-3/4 animate-pulse rounded-sm bg-muted/70" />
        </div>
      ))}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[11px] text-muted-foreground">{children}</p>;
}

function BoardBody({ data }: { data: BoardData }) {
  return (
    <>
      {data.tiles.length > 0 ? (
        <div className={GRID}>
          {data.tiles.map((t) => (
            <Tile key={t.id} tile={t} />
          ))}
        </div>
      ) : (
        <Quiet>No chart of this board could be computed from the stored data right now.</Quiet>
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
