/** Evict only disposable files from this worker's own SEC cache, never followed symlinks. */
import { lstatSync, readdirSync, rmSync, unlinkSync } from "node:fs";
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

/** Evidence folders of failed or held refresh collections are kept this long, then swept at worker start. */
export const REFRESH_EVIDENCE_KEEP_MS = 7 * 24 * 3600_000;

/**
 * Removes the work folders a refresh collection left behind (`refresh-*` directly in `workDir`: the
 * response bodies of a failed or held collection, kept as evidence) once they are older than
 * `REFRESH_EVIDENCE_KEEP_MS`. Never follows a link, never touches anything else (the SEC cache, the
 * receipts), and never a folder a collection could still be using: those are minutes old.
 */
export function sweepRefreshFolders(workDir: string, now = Date.now(), keepMs = REFRESH_EVIDENCE_KEEP_MS): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(workDir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!/^refresh-[A-Za-z0-9_-]+$/.test(name)) continue;
    const path = join(workDir, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory() || st.isSymbolicLink() || now - st.mtimeMs < keepMs) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(name);
    } catch {
      /* gone already, or not ours to remove */
    }
  }
  return removed;
}
