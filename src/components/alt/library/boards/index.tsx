import { boardSpec, collectionBoardId } from "@/lib/sources/boards/specs";
import { collectionIdFromSlug, isCollectionId } from "@/lib/sources/collections";
import { BoardView } from "./board";

export { BoardView, boardQuery } from "./board";
export { Tile } from "./tile";

/**
 * "What the data says" for the Data library landing: the cross-collection board. Mount it before any table
 * list; it holds its final height while it loads.
 */
export function LibraryBoard() {
  const spec = boardSpec("library");
  if (!spec) return null;
  return <BoardView id="library" tiles={spec.tiles.length} section="What the data says" />;
}

/**
 * The board of one collection, by its id (the dataset `sector` value, "04_energy") or its slug ("energy").
 * Renders nothing for a collection without a proven board, so the page can mount it unconditionally.
 */
export function CollectionBoard({ collection }: { collection: string }) {
  const sector = isCollectionId(collection) ? collection : collectionIdFromSlug(collection);
  const id = sector ? collectionBoardId(sector) : null;
  const spec = id ? boardSpec(id) : null;
  if (!id || !spec) return null;
  return <BoardView id={id} tiles={spec.tiles.length} section={`${spec.title} board`} />;
}
