/** Evict only disposable files from this worker's own SEC cache, never followed symlinks. */
import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";

export function trimSourceCache(
  directory: string,
  maxBytes: number,
  now = Date.now(),
): { bytes: number; removed: number } {
  const root = resolve(directory);
  if (root === "/" || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("Invalid source cache boundary");
  if (lstatSync(root).isSymbolicLink())
    throw new Error("A source cache root cannot be a symbolic link");
  const files: { path: string; bytes: number; modified: number }[] = [];
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name !== "manifest.jsonl") {
        const st = lstatSync(file);
        files.push({ path: file, bytes: st.size, modified: st.mtimeMs });
      }
    }
  }
  visit(root);
  let bytes = files.reduce((n, file) => n + file.bytes, 0);
  let removed = 0;
  for (const file of files.sort((a, b) => a.modified - b.modified)) {
    if (bytes <= maxBytes && file.modified >= now - 7 * 24 * 60 * 60_000) continue;
    unlinkSync(file.path);
    bytes -= file.bytes;
    removed++;
  }
  return { bytes, removed };
}
