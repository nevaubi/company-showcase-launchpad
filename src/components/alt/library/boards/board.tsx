import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getBoard } from "@/lib/sources/boards/board.functions";
import { boardLayout, sectionRequests } from "@/lib/sources/boards/layout";
import type { Board as BoardData, BoardLayoutSection, BoardLayoutTile, BoardRead, BoardTile } from "@/lib/sources/boards/types";
import { cn } from "@/lib/utils";
import { Tile } from "./tile";

/**
 * Query of one board request: the whole board, or the tiles of one section. A board's tiles are pinned to snapshots,
 * so ten minutes is fresh enough.
 */
export const boardQuery = (id: string, tiles?: readonly string[]) => ({
  queryKey: ["source-board", id, tiles ? [...tiles] : null] as const,
  queryFn: () => getBoard({ data: tiles ? { id, tiles: [...tiles] } : { id } }) as Promise<BoardRead>,
  staleTime: 10 * 60_000,
  retry: false,
});

/** One column on a phone, two from 42rem of the board's own width, three from 64rem; a wide tile spans two. */
const GRID = "grid grid-cols-1 gap-x-3 gap-y-3 @2xl:grid-cols-2 @5xl:grid-cols-3";
const WIDE = "@2xl:col-span-2";
/** Consecutive stat tiles share one dense row. */
const STATS = "col-span-full grid grid-cols-2 gap-2 @2xl:grid-cols-3 @5xl:grid-cols-4";

/** True once the element comes within 600 px of the viewport; at once where nothing can observe (tests). */
function useNear(): [(el: HTMLElement | null) => void, boolean] {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!el || near || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el, near]);
  return [ref, near];
}

/** What a tile slot holds: the computed tile, the reason it was refused, a read failure, or nothing yet. */
type Slot = { tile: BoardTile } | { refused: string } | { failed: string; unavailable: boolean };

/**
 * One request's tiles: fetches them, reports each outcome, and asks again for the tiles the server deferred (its read
 * budget spent), one request after another. Renders nothing itself.
 */
function Loader({ board, ids, enabled, report }: { board: string; ids: readonly string[]; enabled: boolean; report: (ids: readonly string[], read: BoardRead | Error) => void }) {
  const q = useQuery({ ...boardQuery(board, ids), enabled });
  const { data, error } = q;
  useEffect(() => {
    if (data) report(ids, data);
    else if (error) report(ids, error instanceof Error ? error : new Error("The charts could not be loaded."));
    // ids is stable per request key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, error]);
  const deferred = data && data.ok ? (data.data.deferred ?? []) : [];
  return deferred.length ? <Loader board={board} ids={deferred} enabled={enabled} report={report} /> : null;
}

/** The final size of a tile while it loads, so nothing moves when it fills. */
function SkeletonTile({ tile }: { tile: BoardLayoutTile }) {
  if (tile.form === "stat")
    return (
      <div aria-hidden className="flex h-[6.25rem] flex-col gap-2 rounded-md border bg-card px-3 py-2.5 shadow-paper">
        <div className="h-3 w-2/3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
        <div className="h-6 w-1/2 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
        <div className="h-3 w-3/4 animate-pulse rounded-sm bg-muted/70 motion-reduce:animate-none" />
      </div>
    );
  return (
    <div aria-hidden className={cn("row-span-4 flex h-[29.5rem] flex-col gap-3 rounded-md border bg-card p-3.5 shadow-paper", tile.size === "wide" && WIDE)}>
      <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
      <div className="h-5 w-1/3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
      <div className="h-10 w-full animate-pulse rounded-sm bg-muted/70 motion-reduce:animate-none" />
      <div className="mt-2 flex-1 animate-pulse rounded-sm bg-muted/50 motion-reduce:animate-none" />
      <div className="h-3 w-3/4 animate-pulse rounded-sm bg-muted/70 motion-reduce:animate-none" />
    </div>
  );
}

function Quiet({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[11px] leading-snug text-muted-foreground", className)}>{children}</p>;
}

/** The tiles of one section in board order, consecutive stat tiles in one dense row. */
function SectionGrid({ tiles, slots }: { tiles: readonly BoardLayoutTile[]; slots: Map<string, Slot> }) {
  const shown = tiles.filter((t) => {
    const s = slots.get(t.id);
    return !s || "tile" in s;
  });
  const groups: { stats: boolean; tiles: BoardLayoutTile[] }[] = [];
  for (const t of shown) {
    const stats = t.form === "stat";
    const last = groups[groups.length - 1];
    if (last && last.stats === stats && stats) last.tiles.push(t);
    else groups.push({ stats, tiles: [t] });
  }
  const cell = (t: BoardLayoutTile) => {
    const s = slots.get(t.id);
    if (s && "tile" in s) return <Tile key={t.id} tile={s.tile} className={t.size === "wide" && t.form !== "stat" ? WIDE : undefined} />;
    return <SkeletonTile key={t.id} tile={t} />;
  };
  if (!shown.length) return null;
  return (
    <div className={GRID}>
      {groups.map((g, i) => (g.stats ? <div key={`stats-${i}`} className={STATS}>{g.tiles.map(cell)}</div> : g.tiles.map(cell)))}
    </div>
  );
}

/** Refused tiles and failed reads of a section, each as one quiet line in board order. */
function SectionNotes({ tiles, slots, retry }: { tiles: readonly BoardLayoutTile[]; slots: Map<string, Slot>; retry: () => void }) {
  const notes = tiles.flatMap((t) => {
    const s = slots.get(t.id);
    if (!s || "tile" in s) return [];
    return [{ t, s }];
  });
  if (!notes.length) return null;
  const failed = notes.filter((n) => "failed" in n.s);
  const unavailable = failed.length > 0 && failed.every((n) => "failed" in n.s && n.s.unavailable);
  return (
    <div className="mt-2 space-y-0.5" aria-label="Charts not shown">
      {notes
        .filter((n) => "refused" in n.s)
        .map(({ t, s }) => (
          <Quiet key={t.id}>
            Not shown: {t.title}. {"refused" in s ? s.refused : ""}
          </Quiet>
        ))}
      {failed.length > 0 &&
        (unavailable ? (
          <Quiet>Charts arrive with the next database update.</Quiet>
        ) : (
          <div className="flex items-center gap-2">
            <Quiet>
              {failed.length === 1 ? `${failed[0].t.title} could not be loaded` : `${failed.length} charts could not be loaded`}: {"failed" in failed[0].s ? failed[0].s.failed : ""}
            </Quiet>
            <Button variant="ghost" size="xs" onClick={retry}>
              Retry
            </Button>
          </div>
        ))}
    </div>
  );
}

/**
 * One section of a board: its heading, its tiles loaded as the section comes near the viewport (one request of at most
 * six tiles at a time, deferred tiles asked for again), skeletons of each tile's real size until then.
 */
export function BoardSection({ board, section, heading = true }: { board: string; section: BoardLayoutSection; heading?: boolean }) {
  const [ref, near] = useNear();
  const [slots, setSlots] = useState<Map<string, Slot>>(() => new Map());
  const [attempt, setAttempt] = useState(0);
  const report = useCallback((ids: readonly string[], read: BoardRead | Error) => {
    setSlots((prev) => {
      const next = new Map(prev);
      if (read instanceof Error) for (const id of ids) next.set(id, { failed: read.message, unavailable: false });
      else if (!read.ok) for (const id of ids) next.set(id, { failed: read.message, unavailable: read.reason === "unavailable" });
      else {
        for (const t of read.data.tiles) next.set(t.id, { tile: t });
        for (const r of read.data.refused) next.set(r.id, { refused: r.reason });
      }
      return next;
    });
  }, []);
  const requests = sectionRequests(section);
  const retry = () => {
    setSlots(new Map());
    setAttempt((a) => a + 1);
  };
  return (
    <section ref={ref} data-section={section.title ?? undefined} className="min-w-0">
      {heading && section.title && <h3 className="mb-2 text-[14px] font-semibold tracking-tight">{section.title}</h3>}
      {requests.map((ids) => (
        <Loader key={`${attempt}:${ids.join(",")}`} board={board} ids={ids} enabled={near} report={report} />
      ))}
      <SectionGrid tiles={section.tiles} slots={slots} />
      <SectionNotes tiles={section.tiles} slots={slots} retry={retry} />
    </section>
  );
}

/** A whole board: its sections in order, each loading as it nears the viewport. */
export function BoardView({ id, section }: { id: string; section: string }) {
  const layout = boardLayout(id);
  if (!layout) return null;
  return (
    <div data-section={section} className="@container min-w-0 space-y-6">
      {layout.sections.map((s) => (
        <BoardSection key={s.title ?? "lead"} board={id} section={s} />
      ))}
    </div>
  );
}

/** A computed board's tiles as one grid, for a board already read (tests and previews of a whole board). */
export function BoardBody({ data }: { data: BoardData }) {
  const slots = new Map<string, Slot>([...data.tiles.map((t) => [t.id, { tile: t }] as const), ...data.refused.map((r) => [r.id, { refused: r.reason }] as const)]);
  const layout = boardLayout(data.id);
  const sections = layout?.sections ?? [{ title: null, tiles: data.tiles.map((t) => ({ id: t.id, title: t.title, form: t.form, size: t.size ?? "regular", collection: "", datasetId: t.source.datasetId })) }];
  return (
    <div className="@container min-w-0 space-y-6">
      {sections.map((s) => (
        <section key={s.title ?? "lead"} data-section={s.title ?? undefined} className="min-w-0">
          {s.title && <h3 className="mb-2 text-[14px] font-semibold tracking-tight">{s.title}</h3>}
          <SectionGrid tiles={s.tiles.filter((t) => slots.has(t.id))} slots={slots} />
          <SectionNotes tiles={s.tiles} slots={slots} retry={() => undefined} />
        </section>
      ))}
    </div>
  );
}

